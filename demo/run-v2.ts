// `npm run demo:v2`: the stateless server, 3 replicas, plain round robin.

import { createV2Server } from "../src/v2-stateless/server.ts";
import { MemoryStore } from "../src/v2-stateless/store.ts";
import { RecordingChannel } from "../src/shared/channel.ts";
import { startCluster } from "./cluster.ts";
import { post, summary, v2 } from "./client.ts";

// One shared store + one channel for all replicas (think: one Redis, one Slack).
const store = new MemoryStore();
const channel = new RecordingChannel();
const cluster = await startCluster([1, 2, 3].map(() => createV2Server({ store, channel })));
const url = cluster.url;

const log = (label: string, res: Awaited<ReturnType<typeof post>>) =>
  console.log(`[replica ${res.replica}] ${label.padEnd(38)} -> ${summary(res)}`);

console.log("\n=== v2 (stateless) with 3 replicas behind round robin ===\n");

// 1. No handshake. Discover is optional, a plain lookup.
log("server/discover", await v2(url, "alice", "server/discover"));

// 2. Build a draft. The draft_id handle replaces the session.
const first = await v2(url, "alice", "tools/call", { name: "add_note", arguments: { text: "Fixed login bug" } });
log("add_note (no draft_id)", first);
const draftId = /draft_id=([\w-]+)/.exec(summary(first))![1];

log("add_note (with draft_id)", await v2(url, "alice", "tools/call", {
  name: "add_note",
  arguments: { text: "Faster builds", draft_id: draftId },
}));

// 3. Gotcha #2: a leaked draft_id is not a key. Bob can't touch Alice's draft.
log("bob tries alice's draft_id", await v2(url, "bob", "tools/call", {
  name: "publish_notes",
  arguments: { draft_id: draftId, idempotency_key: "bob-1" },
}));

// 4. Publish, then RETRY with the same idempotency key (gotcha #1: dropped stream).
const publish = { name: "publish_notes", arguments: { draft_id: draftId, idempotency_key: "release-42" } };
log("publish_notes", await v2(url, "alice", "tools/call", publish));
log("publish_notes (retry, same key)", await v2(url, "alice", "tools/call", publish));

// 5. A lying header: says add_note, body says publish_notes. Rejected.
log("Mcp-Name header lies about the tool", await post(url, "tools/call", publish, {
  "MCP-Protocol-Version": "2026-07-28",
  "Mcp-Method": "tools/call",
  "Mcp-Name": "add_note",
  Authorization: "Bearer alice",
}));

// 6. An old client speaking the previous version.
log("old protocol version", await post(url, "tools/list", {}, {
  "MCP-Protocol-Version": "2025-11-25",
  "Mcp-Method": "tools/list",
  Authorization: "Bearer alice",
}));

console.log(`\n✅ Posts to the channel: ${channel.posts.length} (the retry did NOT post twice)`);
console.log(channel.posts.map((p) => `   ${p.replaceAll("\n", "\n   ")}`).join("\n"));

await cluster.close();
