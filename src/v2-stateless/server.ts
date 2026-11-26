// ─────────────────────────────────────────────────────────────
// v2: the NEW, stateless way (MCP spec 2026-07-28)
//
// Every request stands on its own. No session map, no handshake,
// no ping. Any replica can answer any request, as long as they
// all share the same Store. Run `npm run demo:v2` to see it.
// ─────────────────────────────────────────────────────────────

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { readJsonRpc, sendJson, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR, PARSE_ERROR } from "../shared/jsonrpc.ts";
import { ConsoleChannel, type Channel } from "../shared/channel.ts";
import { checkRoutingHeaders, checkVersion, SUPPORTED_VERSIONS } from "./protocol.ts";
import { callTool, toolDefinitions } from "./tools.ts";
import { MemoryStore, type Store } from "./store.ts";

export type V2Options = {
  store?: Store; // pass the SAME store to every replica
  channel?: Channel;
  name?: string;
};

/**
 * Who is calling? DEMO ONLY: we trust the bearer token as the user name.
 * In production, verify a real OAuth/JWT token here.
 */
function getPrincipal(headers: IncomingHttpHeaders): string | null {
  const match = /^Bearer (.+)$/.exec(headers.authorization ?? "");
  return match ? match[1] : null;
}

export function createV2Server(options: V2Options = {}): Server {
  const store = options.store ?? new MemoryStore();
  const channel = options.channel ?? new ConsoleChannel();

  return createServer(async (req, res) => {
    const msg = await readJsonRpc(req);
    if (!msg) return sendJson(res, { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });

    // Small helpers so every reply has the same shape.
    const send = (payload: object) => sendJson(res, { jsonrpc: "2.0", id: msg.id, ...payload });
    // Step 5: every result is stamped with resultType.
    const reply = (result: object) => send({ result: { resultType: "complete", ...result } });
    const fail = (code: number, message: string) => send({ error: { code, message } });

    // Notifications have no id and expect no reply.
    if (msg.id === undefined) {
      res.writeHead(202);
      return res.end();
    }

    // Step 4: headers must match the body, or a gateway could be fooled.
    const headerError = checkRoutingHeaders(msg, req.headers);
    if (headerError) return fail(headerError.code, headerError.message);

    // Step 1: server/discover replaces initialize. It's a lookup, not a handshake:
    // nothing is negotiated and nothing is stored. Left open (no version/auth check)
    // because its job is to tell clients which versions we speak.
    if (msg.method === "server/discover") {
      return reply({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        serverInfo: { name: options.name ?? "release-notes", version: "2.0.0" },
      });
    }

    // Step 2: the version travels with every request. No handshake to remember it.
    const versionError = checkVersion(msg, req.headers);
    if (versionError) return fail(versionError.code, versionError.message);

    // Identity also travels with every request.
    const principal = getPrincipal(req.headers);
    if (!principal) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" });
      return res.end();
    }

    // Step 5 (cont.): list results say how long clients may cache them.
    if (msg.method === "tools/list") {
      return reply({ tools: toolDefinitions, ttlMs: 3_600_000, cacheScope: "public" });
    }

    if (msg.method === "tools/call") {
      const { name, arguments: args = {} } = msg.params ?? {};

      // Safety net: an unexpected error must become a JSON-RPC error,
      // never an unhandled rejection that takes the whole replica down.
      let result: object | undefined;
      try {
        result = await callTool(name, args, { store, channel, principal });
      } catch (err) {
        console.error(`tools/call ${name} threw:`, err);
        return fail(INTERNAL_ERROR, "Internal error");
      }

      if (!result) return fail(INVALID_PARAMS, `Unknown tool: ${name}`);
      return reply(result);
    }

    // Step 6: `ping` is gone, along with initialize. Use an HTTP health check.
    return fail(METHOD_NOT_FOUND, `Unknown method: ${msg.method}`);
  });
}
