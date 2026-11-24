// Protocol rules for spec 2026-07-28: no handshake, so EVERY request
// must carry what the handshake used to establish.

import type { IncomingHttpHeaders } from "node:http";
import type { JsonRpcRequest } from "../shared/jsonrpc.ts";

export const PROTOCOL_VERSION = "2026-07-28";
export const SUPPORTED_VERSIONS = [PROTOCOL_VERSION];

// MCP-specific error codes. Values as given in the article's writeups;
// double-check them against the published spec before relying on them.
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const HEADER_MISMATCH = -32020;

// Key the client uses to send the version inside the request body.
const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

export type ProtocolError = { code: number; message: string };

/**
 * Step 2 of the migration: read the version from every request.
 * It arrives as an HTTP header AND (optionally) inside params._meta.
 */
export function checkVersion(msg: JsonRpcRequest, headers: IncomingHttpHeaders): ProtocolError | null {
  const headerVersion = headers["mcp-protocol-version"];
  const metaVersion = msg.params?._meta?.[META_VERSION_KEY];

  if (typeof headerVersion !== "string" || !SUPPORTED_VERSIONS.includes(headerVersion)) {
    return {
      code: UNSUPPORTED_PROTOCOL_VERSION,
      message: `Unsupported protocol version "${headerVersion}". Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
    };
  }
  if (metaVersion !== undefined && metaVersion !== headerVersion) {
    return { code: UNSUPPORTED_PROTOCOL_VERSION, message: "_meta protocol version disagrees with the header" };
  }
  return null;
}

// Methods whose target name must also appear in the Mcp-Name header.
const NAMED_METHODS: Record<string, string> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/**
 * Step 4 of the migration: validate the routing headers.
 *
 * Gateways route, rate-limit and authorize using Mcp-Method / Mcp-Name
 * WITHOUT reading the body. If we don't reject a mismatch, a request
 * labelled "add_note" in the header could actually call "publish_notes".
 */
export function checkRoutingHeaders(msg: JsonRpcRequest, headers: IncomingHttpHeaders): ProtocolError | null {
  if (headers["mcp-method"] !== msg.method) {
    return { code: HEADER_MISMATCH, message: "Mcp-Method header does not match the request body" };
  }

  const nameField = NAMED_METHODS[msg.method];
  if (nameField && headers["mcp-name"] !== msg.params?.[nameField]) {
    return { code: HEADER_MISMATCH, message: "Mcp-Name header does not match the request body" };
  }
  return null;
}
