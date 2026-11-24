// `npm run demo:v1`: the stateful server, first alone, then behind a load balancer.

import { createV1Server } from "../src/v1-stateful/server.ts";
import { startCluster } from "./cluster.ts";
import { post, summary } from "./client.ts";

async function scenario(replicaCount: number) {
  console.log(`\n=== v1 (stateful) with ${replicaCount} replica(s) behind round robin ===`);
  const cluster = await startCluster(Array.from({ length: replicaCount }, () => createV1Server()));

  // Handshake: the server mints a session ID and we must send it back every time.
  const init = await post(cluster.url, "initialize", { protocolVersion: "2025-11-25" });
  const sessionId = init.headers.get("mcp-session-id")!;
  console.log(`[replica ${init.replica}] initialize -> session ${sessionId.slice(0, 8)}...`);

  const call = (params: object) =>
    post(cluster.url, "tools/call", params as Record<string, unknown>, { "Mcp-Session-Id": sessionId });

  for (const text of ["Fixed login bug", "Faster builds"]) {
    const res = await call({ name: "add_note", arguments: { text } });
    console.log(`[replica ${res.replica}] add_note "${text}" -> ${summary(res)}`);
  }

  await cluster.close();
}

await scenario(1); // works
await scenario(3); // 404: replica B never saw the session that replica A created

console.log(`
👆 With 3 replicas, the session lives only on the replica that handled
   initialize. Every other replica answers 404. The old fixes were sticky
   routing or a shared session store: lots of infra for a list of strings.
   Now run: npm run demo:v2
`);
