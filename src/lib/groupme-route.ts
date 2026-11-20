import { NextResponse } from "next/server";
import { CHAT_ROLES, isAdmin } from "@/lib/roles";
import { requireRole, type AuthenticatedUser } from "@/lib/auth";
import {
  getConnection,
  getMyGroupIndex,
  getPick,
  getTokenForUser,
  GroupMeError,
  type MyGroup,
} from "@/lib/groupme";
import {
  getOffice,
  getOfficeGroups,
  sharedChatsFor,
  type OfficeAccount,
  type SharedChat,
} from "@/lib/groupme-office";

/**
 * The opening steps every chat route shares, in one place so none can skip one.
 *
 *   1. Signed in, still on the Duck Force allowlist, and allowed the Chat tab
 *      (admin or the GroupMe Chat role -- CHAT_ROLES). Remove someone's account
 *      or role and every chat route refuses them from that moment.
 *   2. Works out how they reach GroupMe:
 *        - the OFFICE account (migration 074), for the shared chats their
 *          roles allow -- everyone with Chat access, no GroupMe sign-in;
 *        - their OWN GroupMe, if they connected one -- ADMINS ONLY.
 *   3. When a chat is named: they ticked it, and the way it was ticked is
 *      still allowed -- an office chat must still be shared with one of their
 *      roles; a personal one needs them to be an admin with their own GroupMe
 *      connected. GroupMe itself refuses a group the account isn't in.
 *
 * Returns everything the route needs, or a ready-made error response.
 */
export type ChatContext =
  | {
      ok: true;
      user: AuthenticatedUser;
      admin: boolean;
      /** Their own GroupMe (admins only), or null. */
      personal: { token: string; me: string | null } | null;
      /** The office account, or null if none is connected. */
      office: OfficeAccount | null;
      /** Office chats their roles can see, by group id. */
      shared: Map<string, SharedChat>;
      /** Only when a chat was named. */
      groupId: string | null;
      source: "personal" | "office" | null;
      /** The token to use for the named chat. */
      token: string;
      /** The GroupMe account id that token belongs to (to spot "mine"). */
      me: string | null;
      /** List-level calls only: groups each account is in (else empty). */
      personalGroups: Map<string, MyGroup>;
      officeGroups: Map<string, MyGroup>;
    }
  | { ok: false; response: NextResponse };

function fail(error: string, status: number): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

export async function chatContext(groupId?: string): Promise<ChatContext> {
  const { user, error } = await requireRole(...CHAT_ROLES);
  if (error || !user) return { ok: false, response: error! };

  const admin = isAdmin(user.roles);
  const [office, shared, personalToken, connection, pick] = await Promise.all([
    getOffice(),
    sharedChatsFor(user.roles),
    admin ? getTokenForUser(user.id) : Promise.resolve(null),
    admin ? getConnection(user.id) : Promise.resolve(null),
    groupId === undefined ? Promise.resolve(null) : getPick(user.id, groupId),
  ]);
  const personal = personalToken ? { token: personalToken, me: connection?.groupmeUserId ?? null } : null;

  const base = { ok: true as const, user, admin, personal, office, shared };

  // --- One named chat ---
  if (groupId !== undefined) {
    if (!pick) return fail("That chat isn't one of yours. Choose it under Choose chats first.", 404);
    if (pick.source === "office") {
      if (!office) return fail("The office GroupMe account isn't connected right now.", 409);
      if (!shared.has(groupId)) return fail("That chat isn't shared with your role any more.", 403);
      return {
        ...base,
        groupId,
        source: "office",
        token: office.token,
        me: office.groupmeUserId,
        personalGroups: new Map(),
        officeGroups: new Map(),
      };
    }
    if (!personal) return fail("Connect your GroupMe account first.", 428);
    return {
      ...base,
      groupId,
      source: "personal",
      token: personal.token,
      me: personal.me,
      personalGroups: new Map(),
      officeGroups: new Map(),
    };
  }

  // --- Whole list: which groups each account is in ---
  if (!personal && !(office && (shared.size > 0 || admin))) {
    return fail(
      admin
        ? "Connect the office GroupMe account (Office setup) or your own GroupMe first."
        : "No GroupMe chats have been shared with your role yet.",
      428
    );
  }
  const empty = () => new Map<string, MyGroup>();
  const [personalGroups, officeGroups] = await Promise.all([
    personal ? getMyGroupIndex(user.id, personal.token).catch(empty) : empty(),
    office ? getOfficeGroups(office).catch(empty) : empty(),
  ]);
  return {
    ...base,
    groupId: null,
    source: null,
    token: personal?.token ?? office?.token ?? "",
    me: personal?.me ?? null,
    personalGroups,
    officeGroups,
  };
}

/** Turn a thrown GroupMe error into a response, keeping GroupMe's status. */
export function groupmeErrorResponse(e: unknown, fallback: string): NextResponse {
  const status = e instanceof GroupMeError ? e.status : 500;
  const message = e instanceof GroupMeError ? e.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
