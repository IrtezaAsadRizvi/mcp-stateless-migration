// A bare-bones MCP client: just fetch() and JSON-RPC. No SDK, so you see the wire.

let nextId = 1;

export type RpcResponse = { status: number; replica: string | null; headers: Headers; body: any };

/** POST one JSON-RPC request and return the raw-ish response. */
export async function post(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<RpcResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const text = await res.text();
  return {
    status: res.status,
    replica: res.headers.get("x-replica"),
    headers: res.headers,
    body: text ? JSON.parse(text) : null,
  };
}

/**
 * The headers a 2026-07-28 client sends on EVERY request.
 * Mcp-Method / Mcp-Name let a gateway route without parsing the body.
 */
export function v2Headers(method: string, params: Record<string, any>, token: string): Record<string, string> {
  const headers: Record<string, string> = {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
    Authorization: `Bearer ${token}`,
  };
  if (method === "tools/call") headers["Mcp-Name"] = params.name;
  return headers;
}

/** Convenience: a v2 request with all the right headers filled in. */
export function v2(url: string, token: string, method: string, params: Record<string, any> = {}) {
  return post(url, method, params, v2Headers(method, params, token));
}

/** Pull the text out of a tool result, or the error message. */
export function summary(res: RpcResponse): string {
  if (res.status !== 200) return `HTTP ${res.status}`;
  if (res.body?.error) return `error ${res.body.error.code}: ${res.body.error.message}`;
  const text = res.body?.result?.content?.[0]?.text;
  return text ?? JSON.stringify(res.body?.result);
}
