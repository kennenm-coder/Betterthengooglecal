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
 *   3. (When a group is named) the person ticked that group to show in Chat,
 *      and their own GroupMe account is actually IN it. So nothing can be read
 *      or posted outside the chats they chose.
 *
 * Returns either everything the route needs, or a ready-made error response.
 */
export type ChatContext =
  | {
      ok: true;
      user: AuthenticatedUser;
      token: string;
      groupId: string | null;
      /** This user's groups -> name + newest message. See getMyGroupIndex. */
      myGroups: Map<string, MyGroup>;
    }
  | { ok: false; response: NextResponse };

export async function chatContext(groupId?: string): Promise<ChatContext> {
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

  let myGroups: Map<string, MyGroup>;
  try {
    myGroups = await getMyGroupIndex(user!.id, token);
  } catch (e) {
    return { ok: false, response: groupmeErrorResponse(e, "Could not reach GroupMe.") };
  }

  if (groupId === undefined) {
    return { ok: true, user: user!, token, groupId: null, myGroups };
  }

  if (!(await isPicked(user!.id, groupId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "That chat isn't one of yours. Choose it under Choose chats first." },
        { status: 404 }
      ),
    };
  }
  if (!myGroups.has(groupId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your GroupMe account isn't in that group any more." },
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
