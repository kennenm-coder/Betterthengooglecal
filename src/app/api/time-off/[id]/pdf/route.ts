import { NextResponse, type NextRequest } from "next/server";
import { requireRole, getAdminClient } from "@/lib/auth";

export const runtime = "nodejs";

/** How long the download link stays valid. Long enough to click, not to share. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Download the signed PDF for a kiosk time-off request.
 *
 * The PDF is produced by the office kiosk app (RBANWO-Kiosk) and lives in the
 * private `kiosk-signed` bucket of this same Supabase project. The bucket has
 * no storage policies, so it is reachable only with the service-role key —
 * this route is the one door, and it checks the caller's role first.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin", "payroll-admin");
  if (error) return error;

  const { id } = await params;

  try {
    const admin = getAdminClient();

    const { data: row, error: dbError } = await admin
      .from("time_off_requests")
      .select("signed_pdf_path, reference_code")
      .eq("id", id)
      .maybeSingle();

    if (dbError) throw new Error(dbError.message);
    if (!row?.signed_pdf_path) {
      return NextResponse.json(
        { error: "This request has no signed PDF — it was added by hand, not at the kiosk." },
        { status: 404 }
      );
    }

    const { data, error: storageError } = await admin.storage
      .from("kiosk-signed")
      .createSignedUrl(row.signed_pdf_path, SIGNED_URL_TTL_SECONDS);

    if (storageError || !data?.signedUrl) {
      return NextResponse.json(
        { error: "The stored PDF could not be reached." },
        { status: 502 }
      );
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (e) {
    console.error("[time-off] signed pdf fetch failed", e);
    return NextResponse.json(
      { error: "Could not fetch the signed PDF" },
      { status: 500 }
    );
  }
}
