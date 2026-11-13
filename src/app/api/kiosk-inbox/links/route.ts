import { NextResponse } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";
import {
  BUILT_IN_LINK_TITLES,
  SHARE_LINK_ROLES,
  type ShareLinkView,
} from "@/lib/kiosk-inbox";
import { isMissingRelation, kioskAppUrl } from "@/lib/kiosk-inbox-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILT_IN_ORDER = ["time_off", "time_card", "recognition"];

/**
 * Every live kiosk share link, for the Copy and QR buttons on the Time Off
 * screen. "Live" = turned on and not past its expiry.
 *
 * Making, replacing, turning off and setting expiries stay in the kiosk at
 * /admin/links; this is read-only. The token is a secret (anyone holding the
 * URL can submit), so it is only handed to the roles the kiosk's own RLS
 * policy allows to read the table.
 */
export async function GET() {
  const { error } = await requireRole(...SHARE_LINK_ROLES);
  if (error) return error;

  const base = kioskAppUrl();
  const manageUrl = base ? `${base}/admin/links` : null;

  try {
    const admin = getAdminClient();
    const { data, error: linksError } = await admin
      .from("kiosk_share_links")
      .select("option_key, kind, template_id, token, is_active, expires_at")
      .eq("is_active", true);

    if (linksError) {
      if (isMissingRelation(linksError)) {
        return NextResponse.json({ links: [], manageUrl, notSetUp: true });
      }
      throw new Error(linksError.message);
    }

    const now = Date.now();
    const live = (data ?? []).filter(
      (l) => !l.expires_at || Date.parse(l.expires_at) > now
    );

    // Forms are titled by their template. A template that has been turned
    // off is not offered by the kiosk either, so its link is left out.
    const templateIds = live
      .map((l) => l.template_id)
      .filter((v): v is string => Boolean(v));
    const names = new Map<string, string>();
    if (templateIds.length) {
      const { data: templates, error: tError } = await admin
        .from("kiosk_form_templates")
        .select("id, name, is_active")
        .in("id", templateIds);
      if (tError) throw new Error(tError.message);
      for (const t of templates ?? []) {
        if (t.is_active) names.set(t.id, t.name);
      }
    }

    const links: ShareLinkView[] = [];
    for (const l of live) {
      let title: string | undefined;
      if (l.kind === "form") {
        title = l.template_id ? names.get(l.template_id) : undefined;
        if (!title) continue;
      } else {
        title = BUILT_IN_LINK_TITLES[l.kind] ?? l.kind;
      }
      links.push({
        option_key: l.option_key,
        kind: l.kind,
        title,
        url: base ? `${base}/l/${l.token}` : "",
        expires_at: l.expires_at,
      });
    }

    links.sort((a, b) => {
      const ai = BUILT_IN_ORDER.indexOf(a.kind);
      const bi = BUILT_IN_ORDER.indexOf(b.kind);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.title.localeCompare(b.title);
    });

    return NextResponse.json({
      links: base ? links : [],
      manageUrl,
      missingKioskUrl: !base,
    });
  } catch (e) {
    console.error("[kiosk-inbox] share links load failed", e);
    return NextResponse.json(
      { error: "Could not load the share links" },
      { status: 500 }
    );
  }
}
