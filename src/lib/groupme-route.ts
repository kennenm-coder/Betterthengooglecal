import { NextResponse } from "next/server";
import { requireRole, type AuthenticatedUser } from "@/lib/auth";
import {
  getMyGroupIndex,
  getTokenForUser,
  resolveGroupId,
  GroupMeError,
} from "@/lib/groupme";

/**
 * The opening steps every chat route shares, in one place so none of them can
 * skip one:
 *
 *   1. Signed in, and allowed to use Chat (admin for now -- keep in step with
 *      canUseInstallerChat() in src/lib/roles.ts).
 *   2. Has connected THEIR OWN GroupMe account. 428 tells the page to show the
 *      connect screen.
 *   3. (When a chat is named) the chat is linked to a group, and that person's
 *      own account is actually IN the group. The browser only ever sends a chat
 *      NAME; the group id is looked up here and never leaves the server.
 *
 * Returns either everything the route needs, or a ready-made error response.
 */
export type ChatContext =
  | {
      ok: true;
      user: AuthenticatedUser;
      token: string;
      groupId: string | null;
      /** This user's groups -> newest message id. See getMyGroupIndex. */
      myGroups: Map<string, string>;
    }
  | { ok: false; response: NextResponse };

export async function chatContext(chatName?: string): Promise<ChatContext> {
  const { user, error } = await requireRole("admin");
  if (error) return { ok: false, response: error };

  const token = await getTokenForUser(user!.id);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Connect your GroupMe account first." },
        { status: 428 }
      ),
    };
  }

  let myGroups: Map<string, string>;
  try {
    myGroups = await getMyGroupIndex(user!.id, token);
  } catch (e) {
    return { ok: false, response: groupmeErrorResponse(e, "Could not reach GroupMe.") };
  }

  if (chatName === undefined) {
    return { ok: true, user: user!, token, groupId: null, myGroups };
  }

  const groupId = await resolveGroupId(chatName);
  if (!groupId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `No GroupMe group is linked to ${chatName} yet.` },
        { status: 404 }
      ),
    };
  }
  if (!myGroups.has(groupId)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Your GroupMe account isn't in the ${chatName} group. Ask someone in it to add you.`,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user: user!, token, groupId, myGroups };
}

/** Turn a thrown GroupMe error into a response, keeping GroupMe's status. */
export function groupmeErrorResponse(e: unknown, fallback: string): NextResponse {
  const status = e instanceof GroupMeError ? e.status : 500;
  const message = e instanceof GroupMeError ? e.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
