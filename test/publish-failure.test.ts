// Regression tests from reader feedback on publish_notes:
// 1. A retry during a failing post heard "Already published", then the replica crashed.
// 2. A channel that accepted the post and then timed out got posted to twice on retry.
// 3. A model that writes its own idempotency key can invent a new one on retry and post twice.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createV2Server } from "../src/v2-stateless/server.ts";
import { MemoryStore } from "../src/v2-stateless/store.ts";
import { ChannelRejectedError, RecordingChannel, type Channel } from "../src/shared/channel.ts";
import { startCluster } from "../demo/cluster.ts";
import { summary, v2 } from "../demo/client.ts";

/** Takes 300 ms per post. */
class SlowChannel extends RecordingChannel {
  override async post(text: string): Promise<void> {
    await sleep(300);
    await super.post(text);
  }
}

/** Takes 300 ms, and the first post is refused before anything is sent. */
class RejectsOnceChannel extends SlowChannel {
  private failed = false;
  override async post(text: string): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      await sleep(300);
      throw new ChannelRejectedError("channel unavailable"); // definitely not delivered
    }
    await super.post(text);
  }
}

/** Like a real Slack call that times out: the message lands, then the response is lost. */
class AcceptsThenTimesOutChannel extends RecordingChannel {
  private timedOut = false;
  override async post(text: string): Promise<void> {
    await super.post(text);
    if (!this.timedOut) {
      this.timedOut = true;
      throw new Error("ETIMEDOUT"); // we can't know whether it was delivered
    }
  }
}

/** 3 replicas sharing one store and channel. Shut down when the test ends, pass or fail. */
async function setup(t: TestContext, channel: Channel) {
  const store = new MemoryStore();
  const cluster = await startCluster([1, 2, 3].map(() => createV2Server({ store, channel })));
  t.after(() => cluster.close());

  const newDraft = async () => {
    const res = await v2(cluster.url, "alice", "tools/call", { name: "add_note", arguments: { text: "hi" } });
    return /draft_id=([\w-]+)/.exec(summary(res))![1];
  };
  // extra lets a test send arguments a confused model might add.
  const publish = (draftId: string, extra: Record<string, unknown> = {}) =>
    v2(cluster.url, "alice", "tools/call", { name: "publish_notes", arguments: { draft_id: draftId, ...extra } });
  return { newDraft, publish };
}

test("a post the channel refused is reported, never 'Already published', and a later retry posts once", async (t) => {
  const channel = new RejectsOnceChannel();
  const { newDraft, publish } = await setup(t, channel);
  const draftId = await newDraft();

  // First call starts posting; a retry lands 100 ms later, while it's in flight.
  const first = publish(draftId);
  await sleep(100);
  assert.match(summary(await publish(draftId)), /in progress/i, "retry during the post must not claim success");

  // The first call fails cleanly: a tool error, not a crashed replica.
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  assert.equal(firstRes.body.result.isError, true);
  assert.match(summary(firstRes), /nothing was posted/);

  // The channel said "not delivered", so the claim was released and a retry posts exactly once.
  assert.match(summary(await publish(draftId)), /Published 1 note/);
  assert.match(summary(await publish(draftId)), /Already published/);
  assert.equal(channel.posts.length, 1);
});

test("a post that may have been delivered is never retried", async (t) => {
  const channel = new AcceptsThenTimesOutChannel();
  const { newDraft, publish } = await setup(t, channel);
  const draftId = await newDraft();

  // The message landed, but we only saw a timeout. We must not claim "nothing was posted".
  const first = await publish(draftId);
  assert.equal(first.body.result.isError, true);
  assert.match(summary(first), /may or may not have been posted/);
  assert.doesNotMatch(summary(first), /nothing was posted/);

  // A retry must not post a second time, even if it shows up with a brand new key.
  assert.match(summary(await publish(draftId)), /outcome unknown/i);
  assert.match(summary(await publish(draftId, { idempotency_key: "fresh-key" })), /outcome unknown/i);
  assert.equal(channel.posts.length, 1);

  // To post anyway, a person (or the model) deliberately starts a new draft.
  assert.match(summary(await publish(await newDraft())), /Published 1 note/);
  assert.equal(channel.posts.length, 2);
});

test("a model that invents a new idempotency key on retry still can't post twice", async (t) => {
  const channel = new SlowChannel();
  const { newDraft, publish } = await setup(t, channel);
  const draftId = await newDraft();

  // The stream drops mid-post; the model re-plans and calls again with a key of its own.
  const first = publish(draftId, { idempotency_key: "model-key-1" });
  await sleep(100);
  const retry = await publish(draftId, { idempotency_key: "model-key-2" });
  assert.match(summary(retry), /in progress/i);

  await first;
  assert.equal(channel.posts.length, 1, "the draft, not the model, decides what counts as a retry");
});
