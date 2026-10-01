import { getSupabase } from "@/lib/supabase";

/**
 * Reads/writes the installer -> GroupMe group mapping (migration 025).
 *
 * This is the only part of the GroupMe feature the browser talks to directly.
 * It holds no secrets: just which existing group belongs to which installer.
 * Everything that needs the actual GroupMe token goes through /api/groupme/*.
 *
 * RLS restricts the table to admins, so a non-admin read returns zero rows
 * rather than an error -- the Chat tab is hidden from them anyway.
 */

export interface InstallerChat {
  /** Display label AND lookup key. Matches the calendar's spelling exactly
   *  when isInstaller is true; free text otherwise. See migration 027. */
  installerName: string;
  groupId: string;
  groupName: string | null;
  /** false for chats that aren't about one installer -- office, vendors, etc. */
  isInstaller: boolean;
}

/**
 * Postgres "column does not exist" -- i.e. migration 027 hasn't been applied
 * to whichever database this build is pointed at.
 *
 * Five apps share this database and migrations are applied by hand, so code
 * routinely reaches an environment a migration hasn't. Asking for a column
 * that isn't there fails the WHOLE query, which took the Chat tab's linking
 * out entirely the first time this shipped. Degrade instead: fall back to the
 * pre-027 shape and treat every row as an installer, which is what they all
 * were before the column existed.
 */
const MISSING_COLUMN = "42703";

const BASE_COLUMNS = "installer_name, groupme_group_id, groupme_group_name";

interface ChatRow {
  installer_name: string;
  groupme_group_id: string;
  groupme_group_name: string | null;
  is_installer?: boolean | null;
}

export async function fetchInstallerChats(): Promise<InstallerChat[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let { data, error } = await supabase
    .from("installer_chats")
    .select(`${BASE_COLUMNS}, is_installer`);

  if (error?.code === MISSING_COLUMN) {
    ({ data, error } = await supabase
      .from("installer_chats")
      .select(BASE_COLUMNS));
  }

  if (error || !data) return [];
  return (data as ChatRow[]).map((r) => ({
    installerName: r.installer_name,
    groupId: r.groupme_group_id,
    groupName: r.groupme_group_name,
    // Absent column or null: rows predate 027, so they are installers.
    isInstaller: r.is_installer !== false,
  }));
}

export async function upsertInstallerChat(
  installerName: string,
  groupId: string,
  groupName: string | null,
  updatedBy?: string,
  isInstaller = true
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const base = {
    installer_name: installerName,
    groupme_group_id: groupId,
    groupme_group_name: groupName,
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("installer_chats")
    .upsert({ ...base, is_installer: isInstaller }, { onConflict: "installer_name" });

  if (error?.code !== MISSING_COLUMN) return !error;

  // Pre-027 database. An installer link still works; a non-installer chat does
  // not, because there is nowhere to record that it isn't one -- and silently
  // writing it as an installer would put it in the wrong list. Fail honestly.
  if (!isInstaller) return false;

  const { error: retryError } = await supabase
    .from("installer_chats")
    .upsert(base, { onConflict: "installer_name" });
  return !retryError;
}

export async function deleteInstallerChat(
  installerName: string
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from("installer_chats")
    .delete()
    .eq("installer_name", installerName);
  return !error;
}
