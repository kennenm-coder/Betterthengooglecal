import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, getAdminClient } from "@/lib/auth";
import { canScanOut, isInstaller } from "@/lib/roles";
import {
  LOADING_SCANNED,
  LOADING_STAGED,
  canWriteToOrca,
  orcaToday,
  webhookInUrlFor,
} from "@/lib/orca";

export const runtime = "nodejs";

/**
 * Does this login get checkboxes, and which sheet is the trim one?
 *
 * The screen asks once on load. Keeping the answer server-side means the
 * allowlist that protects live inventory is not a client-side flag anyone can
 * flip in dev tools.
 */
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const roleAllows = canScanOut(user!.roles);
  const envAllows = canWriteToOrca(user!.email);

  return NextResponse.json({
    canWrite: roleAllows && envAllows,
    // Why not, so the screen can say something true rather than just hiding
    // the checkboxes and looking broken.
    reason: !roleAllows
      ? "role"
      : !envAllows
        ? process.env.ORCA_SCAN_TEST_EMAILS
          ? "not-on-test-list"
          : "not-enabled"
        : null,
    trimSheetId: process.env.ORCA_TRIM_SHEET_ID || null,
  });
}

interface ScanBody {
  sheetId?: string;
  barcode?: string;
  checked?: boolean;
}

/**
 * Tick one inventory row off as loaded, or put it back.
 *
 * `Loading Status` becomes `Scanned` and `Installer` becomes whoever ticked it;
 * unticking returns it to `Staged`. The write goes to Orca first and the mirror
 * second, so the screen never claims something Orca refused.
 *
 * The order of the checks below is the whole safety story:
 *
 *  1. Signed in, and a role that is offered this at all.
 *  2. ORCA_SCAN_TEST_EMAILS — the live warehouse gate. Empty means nobody
 *     writes, so the feature ships dormant and is switched on per person.
 *  3. The row must already be in the mirror. A WebHook In `update` CREATES the
 *     row when the barcode is unknown, so a typo'd or guessed barcode would add
 *     junk to live inventory. Only a barcode that came from Orca goes back.
 *  4. An installer may only touch an order that is theirs — asked with the
 *     SESSION client, because order_is_mine() reads the signed-in email out of
 *     auth.jwt() and the service role carries no session.
 *  5. The state machine, so two people on one job cannot both think they
 *     loaded it.
 *
 * Env:
 *   ORCA_SCAN_TEST_EMAILS           comma-separated; empty = writes disabled
 *   ORCA_WEBHOOK_SECRET             the Secret set on both sheets
 *   ORCA_TRIM_SHEET_ID              } which sheet a row belongs to, and
 *   ORCA_INVENTORY_SHEET_ID         } therefore which URL to write to
 *   ORCA_TRIM_WEBHOOK_IN_URL
 *   ORCA_INVENTORY_WEBHOOK_IN_URL
 */
export async function POST(request: Request) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  if (!canScanOut(user!.roles)) {
    return NextResponse.json(
      { error: "Your role can't scan items out." },
      { status: 403 }
    );
  }

  if (!canWriteToOrca(user!.email)) {
    return NextResponse.json(
      {
        error:
          "Scan-out is switched off. Live warehouse inventory is only writable " +
          "by the accounts named in ORCA_SCAN_TEST_EMAILS.",
      },
      { status: 403 }
    );
  }

  let body: ScanBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const sheetId = String(body.sheetId || "").trim();
  const barcode = String(body.barcode || "").trim();
  const checked = body.checked === true;

  if (!sheetId || !barcode) {
    return NextResponse.json({ error: "sheetId and barcode are required" }, { status: 400 });
  }

  const admin = getAdminClient();
  // The SESSION client, not the admin one, for anything that asks "who is
  // this": order_is_mine() and my_own_crew_name() both read the signed-in
  // email out of auth.jwt(), which the service role does not carry.
  const session = await createClient();

  // 3. Never send Orca a barcode that didn't come from Orca.
  const { data: row, error: rowError } = await admin
    .from("orca_rows")
    .select("sheet_id, barcode, order_number, loading_status, installer, staged_out")
    .eq("sheet_id", sheetId)
    .eq("barcode", barcode)
    .is("deleted_at", null)
    .maybeSingle();

  if (rowError) {
    return NextResponse.json({ error: "Couldn't read the row" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      {
        error:
          "That barcode isn't in our copy of the warehouse, so it won't be sent " +
          "to Orca — a bad barcode would create a new inventory row.",
      },
      { status: 404 }
    );
  }

  // 4. An installer's own jobs only. Asked through the session client so
  //    auth.jwt() is populated; through the service role this silently
  //    answers false for everyone.
  if (isInstaller(user!.roles)) {
    const { data: mine } = await session.rpc("order_is_mine", {
      p_order_number: row.order_number,
    });
    if (mine !== true) {
      return NextResponse.json(
        { error: "That job belongs to another crew." },
        { status: 403 }
      );
    }
  }

  // 5. State machine. A row the stager hasn't released is not the installer's
  //    to tick, and a 409 tells the screen to reload rather than guess.
  const current = row.loading_status || "";
  if (checked && current !== LOADING_STAGED) {
    return NextResponse.json(
      {
        error:
          current === LOADING_SCANNED
            ? "Already scanned out."
            : "The warehouse hasn't staged this one yet.",
        loadingStatus: current,
      },
      { status: 409 }
    );
  }
  if (!checked && current !== LOADING_SCANNED) {
    return NextResponse.json(
      { error: "That one isn't scanned out.", loadingStatus: current },
      { status: 409 }
    );
  }

  // Who. my_crew_names() is the wrong source — it mixes in the lead and both
  // rosters' aliases, unordered. my_own_crew_name() (migration 039) is the
  // login's own resource, spelled the way Orca's Installer column spells it.
  let who = "";
  if (isInstaller(user!.roles)) {
    const { data: ownName } = await session.rpc("my_own_crew_name");
    who = (ownName as string | null) || "";
  }
  if (!who) {
    // A member or admin ticking on someone's behalf, or an installer with no
    // resource assigned: fall back to the account's own name.
    const { data: me } = await admin
      .from("allowed_emails")
      .select("name")
      .eq("email", user!.email.toLowerCase())
      .maybeSingle();
    who = (me?.name as string) || user!.email;
  }

  const url = webhookInUrlFor(sheetId);
  if (!url) {
    return NextResponse.json(
      { error: "That sheet has no WebHook In URL configured." },
      { status: 500 }
    );
  }

  // `Staged out` is the stager's date on plenty of rows. Setting it on a tick
  // is useful; clearing it on an untick would delete the warehouse's own data,
  // so an untick only clears it when the value is the one this tick wrote.
  const today = orcaToday();
  const payload: Record<string, string> = {
    ___orca_action: "update",
    Barcode: barcode,
    "Loading Status": checked ? LOADING_SCANNED : LOADING_STAGED,
    Installer: checked ? who : "",
  };
  if (checked) {
    payload["Staged out"] = today;
  } else if (row.staged_out && row.staged_out === today) {
    payload["Staged out"] = "";
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ORCA_WEBHOOK_SECRET) {
    headers["orca-secret"] = process.env.ORCA_WEBHOOK_SECRET;
  }

  let orcaOk = false;
  let orcaStatus = 0;
  let orcaText = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    orcaOk = res.ok;
    orcaStatus = res.status;
    orcaText = (await res.text()).slice(0, 500);
  } catch (e) {
    orcaText = e instanceof Error ? e.message : String(e);
  }

  // Our own record of who did what, independent of Orca's. Written whether or
  // not Orca accepted it — a refused write is the more interesting one.
  await admin.from("orca_events").insert({
    sheet_id: sheetId,
    event: "scan",
    barcode,
    payload: {
      by: user!.email,
      as: who,
      checked,
      sent: payload,
      orcaStatus,
      orcaOk,
      orcaResponse: orcaText,
    },
  });

  if (!orcaOk) {
    return NextResponse.json(
      { error: `Orca refused the change (${orcaStatus || "no response"}).` },
      { status: 502 }
    );
  }

  // Mirror it optimistically. The WebHook Out echo overwrites this moments
  // later with whatever Orca ACTUALLY stored — which is how a silently-dropped
  // `Scanned` shows up, as a row that ticks and then unticks itself.
  //
  // `Scanned` has to exist on the Loading Status option list in Orca, or every
  // tick looks like it worked and nothing changes.
  const mirrored = {
    loading_status: checked ? LOADING_SCANNED : LOADING_STAGED,
    installer: checked ? who : "",
    staged_out: payload["Staged out"] !== undefined ? payload["Staged out"] : row.staged_out,
    updated_at: new Date().toISOString(),
  };
  await admin
    .from("orca_rows")
    .update(mirrored)
    .eq("sheet_id", sheetId)
    .eq("barcode", barcode);

  return NextResponse.json({ ok: true, row: { barcode, ...mirrored } });
}
