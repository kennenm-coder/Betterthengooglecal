import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/auth";
import { knownSheetIds, secretMatches } from "@/lib/orca";

// Service-role writes and a constant-time compare — Node runtime, not edge.
export const runtime = "nodejs";

/**
 * Orca's WebHook Out receiver — the only thing that fills the mirror.
 *
 * Orca POSTs here on every change to either sheet, one request per change,
 * with the row's values keyed by column name plus four system fields
 * (`___orca_event`, `___orca_row_id`, `___orca_sheet_name`,
 * `___orca_user_email`). An import arrives as a single request carrying a
 * `rows` array.
 *
 * This is Orca calling us, so there is no user session. The `orca-secret`
 * header is the whole of the authentication.
 *
 * Three things about the order of checks below, each learned the hard way:
 *
 *  1. The secret is checked first, and a bad one gets a flat 401 with nothing
 *     logged — an unauthenticated public endpoint should not be a way to write
 *     rows into our audit table.
 *
 *  2. The audit insert comes BEFORE the sheet-id check. The two sheet ids are
 *     learned *from* the first Test payload, so a receiver that rejects unknown
 *     ids up front would reject the one request that would have told us them.
 *     A valid secret with an unrecognised sheet id is audited and answered 200,
 *     and goes no further.
 *
 *  3. Orca's retry and timeout behaviour is undocumented, so assume an event
 *     can arrive twice, or late. Every write goes through orca_apply_row(),
 *     which is an upsert guarded on `Changed On` — replaying an event is
 *     harmless and a stale retry is refused.
 *
 * Env:
 *   ORCA_WEBHOOK_SECRET      the Secret set on BOTH sheets in Orca
 *   ORCA_INVENTORY_SHEET_ID  from the orca-sheet-id header of the Test payload
 *   ORCA_TRIM_SHEET_ID       likewise
 */
export async function POST(request: Request) {
  const secret = request.headers.get("orca-secret");
  const requestType = request.headers.get("orca-request-type");
  const sheetId = request.headers.get("orca-sheet-id") || "";

  if (requestType !== "webhook-out") {
    return NextResponse.json({ error: "Not a webhook-out request" }, { status: 401 });
  }
  if (!secretMatches(secret, process.env.ORCA_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const event = String(body.___orca_event || "");
  const supabase = getAdminClient();

  // Audit first — before the sheet-id check, see note 2 above.
  await supabase.from("orca_events").insert({
    sheet_id: sheetId || null,
    event: event || null,
    barcode: (body.Barcode as string) || null,
    payload: body,
  });

  const known = knownSheetIds();
  if (known.length > 0 && !known.includes(sheetId)) {
    // Audited, and deliberately not an error: the sheet is simply not one we
    // mirror. Returning 200 keeps Orca from retrying it forever.
    return NextResponse.json({ ok: true, ignored: "unknown sheet" });
  }
  if (known.length === 0) {
    // First run, before the ids are configured. The payload is in
    // orca_events — read orca-sheet-id off it and set the env vars.
    return NextResponse.json({ ok: true, bootstrap: true, sheetId });
  }

  // Row-shaped events only. `test`, `columns:*` and `sheet:*` are audit-only.
  if (event === "rows:delete") {
    const barcode = String(body.Barcode || "").trim();
    if (barcode) {
      await supabase
        .from("orca_rows")
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("sheet_id", sheetId)
        .eq("barcode", barcode);
    }
    return NextResponse.json({ ok: true });
  }

  if (event === "rows:add" || event === "rows:update") {
    const applied = await applyRow(supabase, sheetId, body);
    return NextResponse.json({ ok: true, applied });
  }

  if (event.startsWith("rows:import")) {
    // One request, many rows. `rows:import:replace` means the sheet was
    // wholesale replaced; the rows that arrive are the new truth, and anything
    // not in them is left alone rather than guessed at — a missing row is not
    // the same as a deleted one, and orca_events has the payload either way.
    const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
    let applied = 0;
    for (const row of rows) {
      if (await applyRow(supabase, sheetId, row)) applied++;
    }
    return NextResponse.json({ ok: true, applied, of: rows.length });
  }

  // test, columns:*, sheet:* — audited above, nothing to mirror.
  return NextResponse.json({ ok: true, audited: event });
}

/**
 * Hand one row to orca_apply_row(), which does the column extraction, the
 * order-number resolve, the renamed-barcode cleanup and the stale-retry guard
 * in one place. Returns whether the row was actually written.
 */
async function applyRow(
  supabase: ReturnType<typeof getAdminClient>,
  sheetId: string,
  row: Record<string, unknown>
): Promise<boolean> {
  const barcode = String(row.Barcode || "").trim();
  if (!barcode) return false;

  // The system fields are ours to interpret, not part of the row's data.
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith("___") && k !== "rows") data[k] = v;
  }

  const { data: applied, error } = await supabase.rpc("orca_apply_row", {
    p_sheet_id: sheetId,
    p_barcode: barcode,
    p_row_id: row.___orca_row_id ? String(row.___orca_row_id) : null,
    p_data: data,
  });

  if (error) {
    // Logged, not thrown: one bad row in an import should not cost us the
    // other ninety-nine, and the raw payload is already in orca_events.
    console.error("orca_apply_row failed", barcode, error.message);
    return false;
  }
  return applied === true;
}
