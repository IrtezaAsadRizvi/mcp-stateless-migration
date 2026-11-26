// Tiny JSON-RPC 2.0 helpers shared by both servers.
// MCP is just JSON-RPC over HTTP, so this is all the "framework" we need.

import type { IncomingMessage, ServerResponse } from "node:http";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number; // no id = notification (no reply expected)
  method: string;
  params?: Record<string, any>;
};

// Standard JSON-RPC error codes.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** Read the whole request body and parse it as JSON-RPC. Returns null if it isn't valid. */
export async function readJsonRpc(req: IncomingMessage): Promise<JsonRpcRequest | null> {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const msg = JSON.parse(body);
    if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return null;
    return msg;
  } catch {
    return null;
  }
}

/** Send a JSON body with a status code and optional extra headers. */
export function sendJson(
  res: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** Build a tool result with a single text block (what most tools return). */
export function textContent(text: string) {
  return { content: [{ type: "text", text }] };
}
