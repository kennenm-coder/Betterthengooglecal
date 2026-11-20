import { NextResponse } from "next/server";
import { requireRole, type AuthenticatedUser } from "@/lib/auth";
import {
  getMyGroupIndex,
  getTokenForUser,
  isPicked,
  GroupMeError,
  type MyGroup,
} from "@/lib/groupme";

/**
 * The opening steps every chat route shares, in one place so none of them can
 * skip one:
 *
 *   1. Signed in, and allowed to use Chat (admin for now -- keep in step with
 *      canUseInstallerChat() in src/lib/roles.ts).
 *   2. Has connected THEIR OWN GroupMe account. 428 tells the page to show the
 *      connect screen.
 *   3. (When a group is named) the person ticked that group to show in Chat.
 *      Their GroupMe account being IN it is enforced by GroupMe itself (their
 *      token can't reach a group they're not in). So nothing can be read or
 *      posted outside the chats they chose.
 *
 * Returns either everything the route needs, or a ready-made error response.
 */
export type ChatContext =
  | {
      ok: true;
      user: AuthenticatedUser;
      token: string;
      groupId: string | null;
      /** This user's groups -> name + newest message. See getMyGroupIndex.
       *  Only filled when no group is named; empty for a single-chat call. */
      myGroups: Map<string, MyGroup>;
    }
  | { ok: false; response: NextResponse };

export async function chatContext(groupId?: string): Promise<ChatContext> {
  const { user, error } = await requireRole("admin");
  if (error) return { ok: false, response: error };

  // Named group: the token and "did they tick it?" are both quick database
  // reads, so ask at once. Membership is NOT re-checked against the full
  // GroupMe group list here -- that list is the slowest call we make, and
  // GroupMe itself refuses a group the token's account isn't in, which comes
  // back through groupmeErrorResponse. Skipping it is what makes a chat open
  // quickly.
  const [token, picked] = await Promise.all([
    getTokenForUser(user!.id),
    groupId === undefined ? Promise.resolve(true) : isPicked(user!.id, groupId),
  ]);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Connect your GroupMe account first." },
        { status: 428 }
      ),
    };
  }

  if (groupId !== undefined) {
    if (!picked) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "That chat isn't one of yours. Choose it under Choose chats first." },
          { status: 404 }
        ),
      };
    }
    return { ok: true, user: user!, token, groupId, myGroups: new Map() };
  }

  let myGroups: Map<string, MyGroup>;
  try {
    myGroups = await getMyGroupIndex(user!.id, token);
  } catch (e) {
    return { ok: false, response: groupmeErrorResponse(e, "Could not reach GroupMe.") };
  }
  return { ok: true, user: user!, token, groupId: null, myGroups };
}

/** Turn a thrown GroupMe error into a response, keeping GroupMe's status. */
export function groupmeErrorResponse(e: unknown, fallback: string): NextResponse {
  const status = e instanceof GroupMeError ? e.status : 500;
  const message = e instanceof GroupMeError ? e.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
