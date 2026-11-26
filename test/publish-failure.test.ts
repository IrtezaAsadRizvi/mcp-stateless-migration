// Regression tests from reader feedback: a channel that fails mid-post.
// Before the fix, a retry during the post heard "Already published",
// then the post threw and crashed the replica.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createV2Server } from "../src/v2-stateless/server.ts";
import { MemoryStore } from "../src/v2-stateless/store.ts";
import type { Channel } from "../src/shared/channel.ts";
import { startCluster, type Cluster } from "../demo/cluster.ts";
import { summary, v2 } from "../demo/client.ts";

/** Takes 300 ms per post, and the first post fails. */
class FlakyChannel implements Channel {
  posts: string[] = [];
  private failedOnce = false;
  async post(text: string): Promise<void> {
    await sleep(300);
    if (!this.failedOnce) {
      this.failedOnce = true;
      throw new Error("channel unavailable");
    }
    this.posts.push(text);
  }
}

let cluster: Cluster;
let channel: FlakyChannel;

before(async () => {
  const store = new MemoryStore();
  channel = new FlakyChannel();
  cluster = await startCluster([1, 2, 3].map(() => createV2Server({ store, channel })));
});
after(() => cluster.close());

test("a failed post is reported, never 'Already published', and a later retry posts once", async () => {
  const added = await v2(cluster.url, "alice", "tools/call", { name: "add_note", arguments: { text: "hi" } });
  const draftId = /draft_id=([\w-]+)/.exec(summary(added))![1];
  const call = { name: "publish_notes", arguments: { draft_id: draftId, idempotency_key: "k-flaky" } };

  // First call starts posting; a retry lands 100 ms later, while it's in flight.
  const first = v2(cluster.url, "alice", "tools/call", call);
  await sleep(100);
  const retry = await v2(cluster.url, "alice", "tools/call", call);
  assert.match(summary(retry), /in progress/i, "retry during the post must not claim success");

  // The first call fails cleanly: a tool error, not a crashed replica.
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  assert.equal(firstRes.body.result.isError, true);
  assert.equal(channel.posts.length, 0);

  // The key was released, so a later retry publishes exactly once.
  const later = await v2(cluster.url, "alice", "tools/call", call);
  assert.match(summary(later), /Published 1 note/);
  const again = await v2(cluster.url, "alice", "tools/call", call);
  assert.match(summary(again), /Already published/);
  assert.equal(channel.posts.length, 1);
});
