// Tests for the stateless server. Each one maps to a claim in the article.
// Run with: npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createV2Server } from "../src/v2-stateless/server.ts";
import { createV1Server } from "../src/v1-stateful/server.ts";
import { MemoryStore } from "../src/v2-stateless/store.ts";
import { RecordingChannel } from "../src/shared/channel.ts";
import { startCluster, type Cluster } from "../demo/cluster.ts";
import { post, summary, v2 } from "../demo/client.ts";

let cluster: Cluster;
let channel: RecordingChannel;

// Every test hits 3 replicas through round robin, so consecutive calls land on different replicas.
before(async () => {
  const store = new MemoryStore();
  channel = new RecordingChannel();
  cluster = await startCluster([1, 2, 3].map(() => createV2Server({ store, channel })));
});
after(() => cluster.close());

/** Start a draft and return its handle. */
async function newDraft(token: string, text = "a note"): Promise<string> {
  const res = await v2(cluster.url, token, "tools/call", { name: "add_note", arguments: { text } });
  return /draft_id=([\w-]+)/.exec(summary(res))![1];
}

test("a draft built across different replicas keeps all its notes", async () => {
  const draftId = await newDraft("alice", "one");
  const res = await v2(cluster.url, "alice", "tools/call", {
    name: "add_note",
    arguments: { text: "two", draft_id: draftId },
  });
  assert.match(summary(res), /2 note\(s\)/);
});

test("retrying publish of the same draft posts only once", async () => {
  const draftId = await newDraft("alice");
  const before = channel.posts.length;
  const call = { name: "publish_notes", arguments: { draft_id: draftId } };

  // Fire two retries at once to prove the atomic claim works, then a late third one.
  await Promise.all([v2(cluster.url, "alice", "tools/call", call), v2(cluster.url, "alice", "tools/call", call)]);
  const late = await v2(cluster.url, "alice", "tools/call", call);

  assert.equal(channel.posts.length - before, 1);
  assert.match(summary(late), /Already published/);
});

test("a leaked draft_id does not let another user publish it", async () => {
  const draftId = await newDraft("alice");
  const res = await v2(cluster.url, "mallory", "tools/call", {
    name: "publish_notes",
    arguments: { draft_id: draftId },
  });
  assert.equal(res.body.result.isError, true);
});

test("Mcp-Name header that disagrees with the body is rejected", async () => {
  const res = await post(cluster.url, "tools/call", { name: "publish_notes", arguments: {} }, {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call",
    "Mcp-Name": "add_note",
    Authorization: "Bearer alice",
  });
  assert.equal(res.body.error.code, -32020);
});

test("an unsupported protocol version is rejected with -32022", async () => {
  const res = await post(cluster.url, "tools/list", {}, {
    "MCP-Protocol-Version": "2025-11-25",
    "Mcp-Method": "tools/list",
    Authorization: "Bearer alice",
  });
  assert.equal(res.body.error.code, -32022);
});

test("every result carries resultType, and tools/list carries cache hints", async () => {
  const res = await v2(cluster.url, "alice", "tools/list");
  assert.equal(res.body.result.resultType, "complete");
  assert.equal(typeof res.body.result.ttlMs, "number");
  assert.equal(res.body.result.cacheScope, "public");
});

test("initialize and ping no longer exist", async () => {
  for (const method of ["initialize", "ping"]) {
    const res = await v2(cluster.url, "alice", method);
    assert.equal(res.body.error.code, -32601, method);
  }
});

test("requests without credentials get 401", async () => {
  const res = await post(cluster.url, "tools/list", {}, {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/list",
  });
  assert.equal(res.status, 401);
});

test("for contrast: v1 breaks behind round robin", async () => {
  const v1 = await startCluster([1, 2, 3].map(() => createV1Server({ channel: new RecordingChannel() })));
  const init = await post(v1.url, "initialize");
  const sessionId = init.headers.get("mcp-session-id")!;
  const res = await post(v1.url, "tools/call", { name: "add_note", arguments: { text: "x" } }, {
    "Mcp-Session-Id": sessionId,
  });
  assert.equal(res.status, 404); // replica B has never heard of replica A's session
  await v1.close();
});
