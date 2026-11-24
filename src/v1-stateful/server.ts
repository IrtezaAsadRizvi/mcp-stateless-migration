// ─────────────────────────────────────────────────────────────
// v1: the OLD, stateful way (MCP spec 2025-11-25)
//
// The draft lives in this process's memory, keyed by Mcp-Session-Id.
// Works on one instance. Breaks behind a load balancer, because
// another replica has never seen your session. Run `npm run demo:v1`.
// ─────────────────────────────────────────────────────────────

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readJsonRpc, sendJson, textContent, METHOD_NOT_FOUND, PARSE_ERROR } from "../shared/jsonrpc.ts";
import { ConsoleChannel, type Channel } from "../shared/channel.ts";

const PROTOCOL_VERSION = "2025-11-25";

const tools = [
  {
    name: "add_note",
    description: "Add a line to the release notes draft",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "publish_notes",
    description: "Publish the draft and clear it",
    inputSchema: { type: "object", properties: {} },
  },
];

export function createV1Server(options: { channel?: Channel; name?: string } = {}): Server {
  const channel = options.channel ?? new ConsoleChannel();

  // ⚠️ THE PROBLEM: state lives in this one process.
  const sessions = new Map<string, { notes: string[] }>();

  return createServer(async (req, res) => {
    const msg = await readJsonRpc(req);
    if (!msg) return sendJson(res, { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });

    const reply = (result: unknown, headers: Record<string, string> = {}) =>
      sendJson(res, { jsonrpc: "2.0", id: msg.id, result }, 200, headers);

    // Step 1: handshake. Mint a session and hand its ID back in a header.
    if (msg.method === "initialize") {
      const sessionId = randomUUID();
      sessions.set(sessionId, { notes: [] });
      return reply(
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: options.name ?? "release-notes", version: "1.0.0" },
        },
        { "Mcp-Session-Id": sessionId },
      );
    }
    if (msg.method === "notifications/initialized") {
      res.writeHead(202);
      return res.end();
    }

    // Every later request must carry the session ID, or we have no draft.
    // On a different replica, this lookup fails -> 404.
    const session = sessions.get(req.headers["mcp-session-id"] as string);
    if (!session) {
      res.writeHead(404);
      return res.end();
    }

    if (msg.method === "ping") return reply({});
    if (msg.method === "tools/list") return reply({ tools });

    if (msg.method === "tools/call") {
      const { name, arguments: args = {} } = msg.params ?? {};

      if (name === "add_note") {
        session.notes.push(String(args.text));
        return reply(textContent(`Draft has ${session.notes.length} notes`));
      }

      if (name === "publish_notes") {
        await channel.post(session.notes.join("\n")); // the side effect
        session.notes = [];
        return reply(textContent("Published"));
      }
    }

    sendJson(res, { jsonrpc: "2.0", id: msg.id, error: { code: METHOD_NOT_FOUND, message: `Unknown: ${msg.method}` } });
  });
}
