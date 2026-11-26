// The business logic. Step 3 of the migration lives here:
// the hidden session becomes a visible `draft_id` handle.

import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import { ChannelRejectedError, type Channel } from "../shared/channel.ts";
import { textContent } from "../shared/jsonrpc.ts";

/** Everything a tool needs. Note: nothing here is per-connection. */
export type ToolContext = {
  store: Store;
  channel: Channel;
  principal: string; // who is calling (from the Authorization header)
};

/** What we keep in the store for each draft. */
type Draft = { owner: string; notes: string[] };

// Fixed array, fixed order: a stable tools/list keeps client prompt caches warm.
export const toolDefinitions = [
  {
    name: "add_note",
    description: "Add a line to a release notes draft. Omit draft_id to start a new draft; pass it back to keep adding.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, draft_id: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "publish_notes",
    description: "Publish a draft. A draft is published at most once, so calling this again is always safe.",
    inputSchema: {
      type: "object",
      properties: { draft_id: { type: "string" } },
      required: ["draft_id"],
    },
  },
];

/** A tool-level error: the model sees it and can fix its own input. */
function toolError(text: string) {
  return { ...textContent(text), isError: true };
}

const draftKey = (id: string) => `draft:${id}`;

/**
 * Load a draft, but only if the caller owns it.
 * Gotcha #2 from the article: handles leak into prompts and logs,
 * so a draft_id must never be treated as proof of access.
 */
async function loadOwnDraft(ctx: ToolContext, draftId: string): Promise<Draft | undefined> {
  const draft = await ctx.store.get<Draft>(draftKey(draftId));
  // Same answer for "missing" and "not yours", so we don't leak which IDs exist.
  return draft?.owner === ctx.principal ? draft : undefined;
}

async function addNote(args: Record<string, any>, ctx: ToolContext) {
  if (typeof args.text !== "string" || args.text.trim() === "") return toolError("`text` must be a non-empty string");

  // The handle replaces the session. The model sees it and passes it back.
  const draftId: string = args.draft_id ?? randomUUID();
  let draft: Draft = { owner: ctx.principal, notes: [] };

  if (args.draft_id !== undefined) {
    const existing = await loadOwnDraft(ctx, draftId);
    if (!existing) return toolError(`No draft "${draftId}" found. Omit draft_id to start a new one.`);
    draft = existing;
  }

  draft.notes.push(args.text);
  await ctx.store.set(draftKey(draftId), draft);
  return textContent(`draft_id=${draftId}, ${draft.notes.length} note(s)`);
}

/**
 * Who makes the idempotency key? Not the model. If the model writes it, a re-planned
 * retry can arrive with a fresh key and post twice. A draft is published at most once,
 * so the draft itself is the key: the server derives it, and the model can't get it wrong.
 *
 * What the key records:
 *   "pending" = a call is posting this draft right now
 *   "done"    = the post succeeded
 *   "unknown" = the post failed in a way that means it MAY have landed (e.g. a timeout)
 * We never re-post an "unknown" draft: a duplicate is worse than asking a human to check.
 */
type PublishStatus = { status: "pending" | "done" | "unknown" };

const RETRY_REPLIES = {
  done: "Already published. Nothing posted again.",
  pending: "Still in progress: this draft is being published right now. Check again shortly.",
  unknown:
    "Outcome unknown: an earlier attempt to publish this draft failed after the notes may have been posted. " +
    "Nothing posted again. Check the channel; to post anyway, start a new draft.",
};

/** The reply a retry gets, based on what the key says. */
function retryReply(record: PublishStatus) {
  return record.status === "unknown" ? toolError(RETRY_REPLIES.unknown) : textContent(RETRY_REPLIES[record.status]);
}

async function publishNotes(args: Record<string, any>, ctx: ToolContext) {
  const { draft_id: draftId } = args;
  if (typeof draftId !== "string") return toolError("`draft_id` is required");

  // The key comes from the draft, never from the caller. Scoped per user so one
  // user can't learn about, or block, another user's drafts.
  const publishKey = `publish:${ctx.principal}:${draftId}`;

  // 1. Already tried this draft? Then this is a retry: report, don't post.
  //    Checked FIRST, because the draft is deleted after a success.
  const existing = await ctx.store.get<PublishStatus>(publishKey);
  if (existing) return retryReply(existing);

  // 2. Check the caller can actually publish this draft.
  const draft = await loadOwnDraft(ctx, draftId);
  if (!draft) return toolError(`No draft "${draftId}" found.`);

  // 3. Claim the key atomically as "pending". If two retries race, only one wins.
  const claimed = await ctx.store.setIfAbsent(publishKey, { status: "pending" });
  if (!claimed) {
    const winner = await ctx.store.get<PublishStatus>(publishKey);
    if (winner) return retryReply(winner);
    // The winner already failed and released the key. Let the client try again.
    return toolError("A concurrent publish of this draft just failed. Call publish_notes again.");
  }

  // 4. Do the side effect. A failure is one of two very different things.
  try {
    await ctx.channel.post(draft.notes.join("\n"));
  } catch (err) {
    console.error(`publish_notes failed for draft "${draftId}":`, err);

    // The channel says it never sent anything: release the key so a retry can post.
    if (err instanceof ChannelRejectedError) {
      await ctx.store.delete(publishKey);
      return toolError("Publishing failed and nothing was posted. Call publish_notes again to retry.");
    }

    // Anything else (a timeout, a dropped connection) may have landed. Don't guess:
    // mark it so no retry can post twice, and keep the draft so a human can decide.
    await ctx.store.set(publishKey, { status: "unknown" });
    return toolError(
      "Publishing failed, and the notes may or may not have been posted. " +
        "Check the channel before doing anything else. Retrying this draft will not post.",
    );
  }

  // 5. Only now mark it done. A crash before this line leaves the key "pending",
  //    which blocks re-posting: we'd rather not post than post twice.
  await ctx.store.set(publishKey, { status: "done" });
  await ctx.store.delete(draftKey(draftId));
  return textContent(`Published ${draft.notes.length} note(s)`);
}

const handlers: Record<string, (args: Record<string, any>, ctx: ToolContext) => Promise<object>> = {
  add_note: addNote,
  publish_notes: publishNotes,
};

/** Run a tool by name. Returns undefined if no such tool exists. */
export async function callTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<object | undefined> {
  const handler = handlers[name];
  return handler ? handler(args, ctx) : undefined;
}
