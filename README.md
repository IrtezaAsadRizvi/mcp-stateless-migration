# Stateless MCP Server Example (spec 2026-07-28)

[![Read the article](https://img.shields.io/badge/Read%20the%20article-MCP%20went%20stateless-D97757?style=for-the-badge)](ARTICLE_URL)

[![MCP spec](https://img.shields.io/badge/MCP%20spec-2026--07--28-6E56CF?style=flat-square&logo=modelcontextprotocol&logoColor=white)](https://modelcontextprotocol.io)
[![Stateless](https://img.shields.io/badge/architecture-stateless-2EA44F?style=flat-square)](#what-is-stateless-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.18-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-2EA44F?style=flat-square)](package.json)
[![No SDK](https://img.shields.io/badge/MCP%20SDK-none%2C%20written%20by%20hand-F08C00?style=flat-square)](#faq)
[![Tests](https://img.shields.io/badge/tests-12%20passing-2EA44F?style=flat-square&logo=nodedotjs&logoColor=white)](test)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2EA44F?style=flat-square)](#contributing)
[![GitHub stars](https://img.shields.io/github/stars/IrtezaAsadRizvi/mcp-stateless-migration?style=flat-square&logo=github)](https://github.com/IrtezaAsadRizvi/mcp-stateless-migration/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/IrtezaAsadRizvi/mcp-stateless-migration?style=flat-square)](https://github.com/IrtezaAsadRizvi/mcp-stateless-migration/commits)
[![License: MIT](https://img.shields.io/github/license/IrtezaAsadRizvi/mcp-stateless-migration?style=flat-square)](LICENSE)

**Learn stateless MCP by reading one small server, written by hand in TypeScript with no SDK, then migrating it from the old stateful protocol to the new stateless one.**

This repository is the companion code for the article **[MCP Went Stateless. Here's How I'd Migrate a Server.](ARTICLE_URL)** It's for developers who want to understand what the Model Context Protocol (MCP) `2026-07-28` revision changed, why it matters for running MCP servers behind a load balancer, and how to migrate an existing server safely.

- ✅ Runnable in under a minute: Node 22.18+, no build step, zero runtime dependencies
- ✅ Before and after: a stateful MCP server (spec `2025-11-25`) and its stateless rewrite (spec `2026-07-28`)
- ✅ A live demo with 3 replicas behind a round-robin load balancer, showing the old server fail and the new one work
- ✅ Fixes for the "silent" stateless bugs: server-side idempotency keys for retries, owner-bound handles, header validation
- ✅ 12 tests, each one checking a claim from the article (plus three reader-reported failure cases)

---

## Table of contents

- [What is stateless MCP?](#what-is-stateless-mcp)
- [Stateful vs stateless MCP at a glance](#stateful-vs-stateless-mcp-at-a-glance)
- [Quick start](#quick-start)
- [Step-by-step walkthrough](#step-by-step-walkthrough)
- [Talk to the server with curl](#talk-to-the-server-with-curl)
- [How to migrate your own MCP server](#how-to-migrate-your-own-mcp-server)
- [The gotchas: bugs that pass your tests](#the-gotchas-bugs-that-pass-your-tests)
- [Taking this to production](#taking-this-to-production)
- [Project layout](#project-layout)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

---

## What is stateless MCP?

**Stateless MCP is the `2026-07-28` revision of the Model Context Protocol, where every request carries everything the server needs, so there is no session, no `initialize` handshake, and no `Mcp-Session-Id`.** The protocol version, client capabilities and client identity travel with each request, in HTTP headers and in the request's `_meta` field.

Why it changed: with sessions, a client was pinned to the one server instance that created its session. Scaling out meant sticky routing, a shared session store, or a gateway that parsed JSON bodies. Stateless MCP removes that, so an MCP server can run as several replicas behind a plain load balancer, like any other HTTP API.

The catch: **the protocol stopped managing state, but the state didn't go away.** It moves into your application: handles the model passes back, a shared store, and idempotency keys. This repo shows each of those in working code.

## Stateful vs stateless MCP at a glance

| | Stateful MCP (`2025-11-25`) | Stateless MCP (`2026-07-28`) |
|---|---|---|
| Starting a conversation | `initialize` + `notifications/initialized` handshake | None. Optional `server/discover` lookup |
| Where the version lives | Negotiated once in the handshake | `MCP-Protocol-Version` header on every request |
| Per-user state | Server memory, keyed by `Mcp-Session-Id` | Shared store, keyed by a handle the model can see (e.g. `draft_id`) |
| Running 3 replicas | Needs sticky sessions or a session store | Works with plain round robin |
| Health checks | `ping` method | Ordinary HTTP health checks |
| Routing at a gateway | Gateway must parse the JSON body | `Mcp-Method` and `Mcp-Name` headers |
| Dropped stream | Resumed with `Last-Event-ID` | Lost. Client retries, so side effects need idempotency keys |
| Every result | Plain result | Stamped with `resultType` (`"complete"` for normal results) |
| List results | No cache hints | `ttlMs` and `cacheScope` |

## Quick start

**Prerequisite:** Node.js **22.18 or newer** (check with `node --version`). Node runs the `.ts` files directly using built-in type stripping, so there is no compile step.

```bash
git clone https://github.com/IrtezaAsadRizvi/mcp-stateless-migration.git
cd mcp-stateless-migration
npm install
```

`npm install` only installs TypeScript and Node type definitions, which are used for type checking. The servers themselves use nothing but Node's standard library.

Now run the two demos and the tests:

```bash
npm run demo:v1   # the stateful server breaking behind a load balancer
npm run demo:v2   # the stateless server working behind the same load balancer
npm test          # 12 tests: the claims from the article, plus three failure cases
```

All available commands:

| Command | What it does |
|---|---|
| `npm run demo:v1` | Starts 3 replicas of the **stateful** server behind a round-robin load balancer and makes a few calls. |
| `npm run demo:v2` | Same setup with the **stateless** server: drafts, retries, a leaked handle and a lying header. |
| `npm test` | Runs the test suite with Node's built-in test runner. |
| `npm run typecheck` | Type-checks everything with `tsc` (nothing is emitted). |
| `npm run start:v1` | Runs the stateful server alone on port 3000 (`PORT=4000` to change it). |
| `npm run start:v2` | Runs the stateless server alone on port 3000. |

## Step-by-step walkthrough

The best way to learn from this repo is in this order.

### 1. Read the stateful server

Open [`src/v1-stateful/server.ts`](src/v1-stateful/server.ts). It's a release-notes server with two tools:

- `add_note` appends a line to the current draft.
- `publish_notes` posts the draft to a channel and clears it. This tool has a **side effect**, which matters later.

Look for the `sessions` map. The draft lives in that process's memory, keyed by the session ID from `initialize`. The model never sees the draft; it's hidden in transport metadata.

### 2. Watch it break

```bash
npm run demo:v1
```

The demo (see [`demo/cluster.ts`](demo/cluster.ts)) starts 3 copies of the server and a load balancer that sends each request to the next copy in turn. Expected output:

```
=== v1 (stateful) with 1 replica(s) behind round robin ===
[replica A] initialize -> session b8dce88b...
[replica A] add_note "Fixed login bug" -> Draft has 1 notes
[replica A] add_note "Faster builds" -> Draft has 2 notes

=== v1 (stateful) with 3 replica(s) behind round robin ===
[replica A] initialize -> session 6c89d893...
[replica B] add_note "Fixed login bug" -> HTTP 404
[replica C] add_note "Faster builds" -> HTTP 404
```

**What's happening:** replica A created the session, so only replica A knows about it. Replicas B and C have never seen that session ID, so they answer 404.

### 3. Read the stateless server

Open [`src/v2-stateless/server.ts`](src/v2-stateless/server.ts). It reads top to bottom as a list of checks every request goes through. The comments are numbered to match the article's migration steps. The logic is split into small files:

- [`protocol.ts`](src/v2-stateless/protocol.ts): protocol version and routing header checks
- [`tools.ts`](src/v2-stateless/tools.ts): the two tools, the `draft_id` handle and the idempotency key
- [`store.ts`](src/v2-stateless/store.ts): the shared store all replicas talk to

### 4. Watch it work

```bash
npm run demo:v2
```

Expected output:

```
[replica A] server/discover                     -> {"resultType":"complete","supportedVersions":["2026-07-28"],...}
[replica B] add_note (no draft_id)              -> draft_id=1f3a15ae-..., 1 note(s)
[replica C] add_note (with draft_id)            -> draft_id=1f3a15ae-..., 2 note(s)
[replica A] bob tries alice's draft_id          -> No draft "1f3a15ae-..." found.
[replica B] publish_notes                       -> Published 2 note(s)
[replica C] publish_notes (retry)                -> Already published. Nothing posted again.
[replica A] Mcp-Name header lies about the tool -> error -32020: Mcp-Name header does not match the request body
[replica B] old protocol version                -> error -32022: Unsupported protocol version "2025-11-25". ...

✅ Posts to the channel: 1 (the retry did NOT post twice)
```

**Line by line:**

1. **`server/discover`** replaces `initialize`. It's a lookup, not a handshake: nothing is stored.
2. **`add_note` without a `draft_id`** starts a draft and returns a handle. Replica B stores it in the shared store.
3. **`add_note` with the `draft_id`** lands on replica C, which finds the draft in the same store. No sticky sessions needed.
4. **Bob uses Alice's `draft_id`** and gets "not found". Handles show up in prompts and logs, so they can't be treated as permission.
5. **`publish_notes`** posts once.
6. **The retry** of the same draft is recognised, and nothing is posted twice. The draft itself is the idempotency key, so even a model that invents new arguments can't cause a duplicate.
7. **A lying `Mcp-Name` header** (says `add_note`, body says `publish_notes`) is rejected, so a gateway can't be tricked.
8. **An old client** speaking `2025-11-25` gets a clear version error.

### 5. Read the tests

[`test/v2.test.ts`](test/v2.test.ts) has one test per claim, named in plain English, for example *"retrying publish of the same draft posts only once"*. It fires two retries at the same time to prove the guard holds under a race. [`test/publish-failure.test.ts`](test/publish-failure.test.ts) uses misbehaving channels (one that refuses a post, one that accepts it and then times out, one that is just slow) to check that failures are reported honestly, never crash the server, and never cause a double post, even when the model retries with a new key.

## Talk to the server with curl

Seeing the raw HTTP is the fastest way to understand the new protocol. Start the server in one terminal:

```bash
npm run start:v2
```

In a second terminal, define a small helper. Every stateless MCP request carries the same headers, so the helper fills them in:

```bash
# Usage: mcp <user> <method> <tool-name> '<params-json>'
mcp() {
  curl -s localhost:3000 \
    -H 'Content-Type: application/json' \
    -H 'MCP-Protocol-Version: 2026-07-28' \
    -H "Mcp-Method: $2" \
    -H "Mcp-Name: $3" \
    -H "Authorization: Bearer $1" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":$4}"
  echo
}
```

What each header is for:

| Header | Why it's there |
|---|---|
| `MCP-Protocol-Version` | Replaces version negotiation in the old handshake. Sent on every request. |
| `Mcp-Method` | Lets a gateway route or rate-limit without reading the body. Must match the body's `method`. |
| `Mcp-Name` | The tool being called. Must match `params.name` for `tools/call`. |
| `Authorization` | Who is calling. In this demo, the token is simply the user name. |

Now walk through a full flow. Notice there is **no `initialize` call first** and **no session header anywhere**:

```bash
# 1. List the tools (the result includes ttlMs and cacheScope cache hints)
mcp alice tools/list '' '{}'

# 2. Start a draft. Copy the draft_id from the reply.
mcp alice tools/call add_note '{"name":"add_note","arguments":{"text":"Fixed login bug"}}'

# 3. Add to the same draft (replace DRAFT_ID)
mcp alice tools/call add_note '{"name":"add_note","arguments":{"text":"Faster builds","draft_id":"DRAFT_ID"}}'

# 4. Publish. Watch the server terminal: the notes are posted once.
mcp alice tools/call publish_notes '{"name":"publish_notes","arguments":{"draft_id":"DRAFT_ID"}}'

# 5. Run step 4 again. This is what a client does after a dropped connection.
#    You get "Already published", and nothing is posted a second time.
```

Try breaking it too: change `Mcp-Name` to something that doesn't match the body, set `MCP-Protocol-Version` to `2025-11-25`, or leave out the `Authorization` header.

## How to migrate your own MCP server

These are the six steps from the article, in the order the article recommends, with where each one lives in this repo:

| # | Step | What to change | In this repo |
|---|---|---|---|
| 1 | **Delete the handshake, add `server/discover`** | Remove the `initialize` and `notifications/initialized` handlers. Add `server/discover`, which returns supported versions, capabilities and server info. | [`server.ts`](src/v2-stateless/server.ts) |
| 2 | **Read the version from every request** | Check `MCP-Protocol-Version` (and `_meta`) on each request. Reject unknown versions with `-32022`. | `checkVersion` in [`protocol.ts`](src/v2-stateless/protocol.ts) |
| 3 | **Turn the session into a handle** | Anything you kept per session becomes a handle your tool returns and accepts back, with the data in a shared store. | `addNote` in [`tools.ts`](src/v2-stateless/tools.ts) |
| 4 | **Validate the routing headers** | Reject any request where `Mcp-Method` or `Mcp-Name` disagrees with the body. | `checkRoutingHeaders` in [`protocol.ts`](src/v2-stateless/protocol.ts) |
| 5 | **Stamp every result** | Add `resultType: "complete"`. Add `ttlMs` and `cacheScope` to list results. Return tools in a fixed order. | `reply` in [`server.ts`](src/v2-stateless/server.ts) |
| 6 | **Delete `ping`** | Use your load balancer's HTTP health check instead. | (it's just gone) |

Only step 3 touches business logic. The rest is mechanical.

## The gotchas: bugs that pass your tests

The stateless spec makes some failures silent. The article's v2 code left two of them unfixed on purpose; this repo fixes both.

### Retries can run side effects twice

Stream resumability (`Last-Event-ID`) was removed. If a connection drops mid-request, the request is lost, and the client sends it again with a new ID. Your tests pass, but in production `publish_notes` can post twice.

**The fix:** an idempotency key, created by the **server**, not the model.

**Who creates the key matters.** If the model writes the key as a tool argument, nothing makes it reuse the same one. After a dropped stream, an agent that re-plans can call `publish_notes` again with a brand new key, and the server sees a "new" request and posts twice. So `publish_notes` takes no key at all. A draft is published at most once, so **the draft itself is the key**: the server derives it from `draft_id`, and whatever the model does, a second publish of the same draft is a retry.

> **Rule of thumb:** derive the idempotency key from something the operation naturally owns (a draft, an order, a cart). If there's no natural ID, have your *client code* (not the model) mint the key and send it in `_meta`, where a re-planning model can't change it.

For each draft, the server:

1. Checks whether that draft was already published. The key records one of three states:
   - `done`: the post succeeded, so the retry gets "Already published".
   - `pending`: another call is posting right now, so the retry gets "Still in progress".
   - `unknown`: an earlier attempt failed in a way that means the post *may* have landed, so the retry gets "Outcome unknown, check the channel" and nothing is posted.
2. Claims the key as `pending` with an atomic `setIfAbsent`, so two retries racing each other can't both post.
3. Posts. If posting fails, what happens next depends on *how* it failed (see below).
4. Only after a successful post does it mark the key `done`.

Keys are scoped per user, so one user can't learn about or block another user's drafts.

**A failed call doesn't mean nothing happened.** There are two kinds of failure, and they need opposite handling:

| How the post failed | Did it land? | What the server does |
|---|---|---|
| The channel refused it (e.g. a 4xx, connection refused). The channel throws `ChannelRejectedError`. | **No**, definitely | Releases the key and says "nothing was posted". Publishing the draft again posts once. |
| Anything else: a timeout, a dropped connection after sending | **Maybe** | Marks the key `unknown` and says the notes "may or may not have been posted". Publishing the same draft again won't post. To post anyway, someone deliberately starts a new draft. |

Only the channel can tell these apart, which is why the [`Channel`](src/shared/channel.ts) interface asks implementations to throw `ChannelRejectedError` *only* when they know nothing was sent. Every other error is treated as "maybe".

**How this design got here.** Readers found three problems in earlier versions:

1. A single "claimed" flag let a retry landing *while* the first call was still posting hear "Already published", even if that post then failed. Worse, the failure escaped as an unhandled rejection and crashed the replica. Fixed by the `pending`/`done` split and a `try/catch` around every tool call in [`server.ts`](src/v2-stateless/server.ts).
2. A fake Slack that accepted the message and then timed out was told "nothing was posted", and the retry posted a second time. Fixed by the `unknown` state above.
3. The model supplied the `idempotency_key`, so a re-planned retry could arrive with a fresh key and post twice. Fixed by deriving the key from the draft on the server.

[`test/publish-failure.test.ts`](test/publish-failure.test.ts) reproduces all three scenarios.

**Known limit:** if a replica crashes mid-post, its key stays `pending` and that key can't be used again. Same reasoning as `unknown`: we can't tell whether the post went out, and not posting is safer than posting twice. In production, give `pending` keys an expiry (Redis `EX`) so a stuck key eventually clears, and pick the expiry with your channel's own duplicate tolerance in mind. If your channel supports its own idempotency key (many payment APIs do), pass yours through and most of this ambiguity disappears.

### Handles leak

A `draft_id` ends up in prompts, transcripts and logs. Anyone who sees it shouldn't be able to use it.

**The fix:** every draft records its `owner`. Only that user can add to it or publish it. "Not yours" and "doesn't exist" get the same reply, so nobody can probe for valid IDs.

**Should handles be signed?** Often, yes. A signed handle (an HMAC over the ID, the owner and an expiry, using a secret every replica shares) lets any replica reject a forged, expired or someone-else's handle *without touching the store*. This repo doesn't sign `draft_id`, for one reason: the handle points at data (the notes) that lives in the store, so every valid call reads the store anyway, and the ownership check comes free with that read. Signing earns its keep when:

- the handle *carries* the state itself (a pagination cursor, a small piece of workflow state), so there's nothing to look up, or
- you want to turn away junk and expired handles before they cost a database round trip.

If you do sign, keep the owner check on use: a signature proves the server issued the handle, not that the caller is allowed to use it.

### Headers can disagree with the body

Gateways make decisions from `Mcp-Method` and `Mcp-Name` without reading the body. If the server doesn't check them, a request labelled as a harmless tool could run a dangerous one.

**The fix:** `checkRoutingHeaders` rejects any mismatch with error `-32020`.

### Not covered here

The article also covers these, but they would double the size of this example: elicitation as `input_required` retries, `subscriptions/listen`, per-request log levels, and per-client tool catalogs.

## Taking this to production

This repo is built for learning. Before using the pattern in a real server:

- **Use a real shared store.** Replace `MemoryStore` with Redis, Postgres or similar. Every replica must talk to the same one. The only tricky method is `setIfAbsent`, which must be atomic. A sketch with [ioredis](https://github.com/redis/ioredis):

  ```ts
  // Sketch: a Redis-backed Store. NX = only set if the key doesn't exist.
  async setIfAbsent(key: string, value: unknown): Promise<boolean> {
    return (await redis.set(key, JSON.stringify(value), "NX")) === "OK";
  }
  ```

  Also set an expiry (`EX`) on drafts and publish keys so they don't live forever.

- **Use real authentication.** `getPrincipal` in [`server.ts`](src/v2-stateless/server.ts) trusts the bearer token as the user name. Verify an OAuth or JWT token there instead.
- **Use the official MCP SDK.** The v2 TypeScript SDK handles steps 1, 2, 4 and 5 for you. Handles (step 3) and idempotency keys are still your job.
- **Check field names against the spec.** This code follows the article, which was written from spec writeups. `supportedVersions` and the `-32020` error code in particular are worth confirming in the published `2026-07-28` schema.

## Project layout

```
src/
  shared/
    jsonrpc.ts       JSON-RPC types and helpers (MCP is JSON-RPC over HTTP)
    channel.ts       Where notes are published; a recording version for tests
  v1-stateful/
    server.ts        BEFORE: session map, initialize, ping
    main.ts          Runs v1 alone (npm run start:v1)
  v2-stateless/
    server.ts        AFTER: one self-contained request at a time
    protocol.ts      Version and routing header checks
    tools.ts         add_note and publish_notes logic
    store.ts         Shared store interface + in-memory version
    main.ts          Runs v2 alone (npm run start:v2)
demo/
  cluster.ts         N replicas behind a round-robin load balancer
  client.ts          A small raw MCP client using fetch()
  run-v1.ts          The v1 demo
  run-v2.ts          The v2 demo
test/
  v2.test.ts                One test per claim in the article
  publish-failure.test.ts   Channels that fail mid-post (reader-reported bugs)
```

## FAQ

### What does "stateless MCP" mean?

It means each MCP request stands on its own. Since the `2026-07-28` spec, there's no session and no `initialize` handshake. The protocol version, capabilities and identity travel with every request, so any server instance can answer any request.

### Which MCP spec version removed sessions?

The `2026-07-28` revision. It removed `Mcp-Session-Id`, the `initialize`/`initialized` handshake, SSE stream resumability (`Last-Event-ID`), `ping` and `logging/setLevel`.

### What replaces the `initialize` handshake?

`server/discover`. Servers must implement it; clients may call it to learn the supported versions and capabilities, or skip it and call tools directly. Nothing is negotiated or stored.

### How do I keep state between tool calls in stateless MCP?

Return a handle (such as `draft_id`) from the tool, keep the data in a store every replica shares, and have the model pass the handle back on later calls. It's the same pattern HTTP shopping carts have used for decades. See [`tools.ts`](src/v2-stateless/tools.ts).

### Can I run an MCP server behind a load balancer now?

Yes. With stateless MCP, plain round robin works without sticky sessions, as long as all replicas share the same store. `npm run demo:v2` shows this with 3 replicas.

### Why do I need idempotency keys in stateless MCP?

Because dropped streams can no longer be resumed. The client retries with a new request ID, so any tool with a side effect (posting a message, charging a card) can run twice unless it recognises the retry.

### Who should create the idempotency key, the model or the server?

Not the model. If the key is a tool argument the model writes, a model that re-plans after a dropped stream can send a fresh key and trigger a duplicate. Derive the key on the server from something the operation owns (here, the `draft_id`), or have the client code mint it and send it in `_meta`.

### Should MCP handles be signed?

Signing a handle with the owner and an expiry lets any replica reject forged or expired handles without a database lookup. It's most useful when the handle carries state itself. If the handle points at data in a shared store, you read the store anyway, so a plain random ID plus an owner check is enough. Either way, still check the caller is allowed to use it.

### What are the `Mcp-Method` and `Mcp-Name` headers?

New required headers on every Streamable HTTP POST. They let gateways route, authorize and rate-limit per tool without parsing the JSON body. Servers must reject requests where the headers don't match the body.

### Will my old stateful MCP server stop working?

Not right away. The Tier 1 SDKs (TypeScript, Python, Go, C#) kept backward compatibility, and deprecated features are guaranteed for at least twelve months after `2026-07-28`.

### Why is this written without the MCP SDK?

SDKs hide the wire format, and the wire format is what changed. Writing it by hand shows exactly which lines are deleted, which move, and which are new. For production servers, use the SDK.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Unknown file extension ".ts"` or a syntax error on a type annotation | Your Node is older than 22.18. Upgrade with `nvm install 22`. (On Node 22.6 to 22.17 you can instead run files with `node --experimental-strip-types`.) |
| `EADDRINUSE: address already in use :::3000` | Another process is on port 3000. Use `PORT=4000 npm run start:v2` and point curl at port 4000. |
| curl returns nothing and the status is 401 | The `Authorization: Bearer <name>` header is missing. |
| `error -32020: ... header does not match` | `Mcp-Method` or `Mcp-Name` doesn't match the JSON body. Check for typos. |
| `error -32022: Unsupported protocol version` | Send `MCP-Protocol-Version: 2026-07-28`. |

## Further reading

- **Article:** [MCP Went Stateless. Here's How I'd Migrate a Server.](ARTICLE_URL)
- WorkOS, [MCP went stateless: What changed in the 2026-07-28 spec](https://workos.com/blog/mcp-stateless-spec-2026-07-28): full change list, error codes, deprecations
- The New Stack, [MCP's biggest update removes the machinery many servers were built around](https://thenewstack.io/mcp-release-candidate-rewrite/): why sessions were removed, handles, header validation
- [Model Context Protocol](https://modelcontextprotocol.io): official spec and SDKs

## Contributing

Issues and pull requests are welcome, especially corrections against the published `2026-07-28` spec. Please keep the code SDK-free and easy to read: this repo is for learning.

## License

[MIT](LICENSE) © 2026 Irteza Asad Rizvi

You're free to copy, modify and reuse this code in your own projects, including commercial ones. Keep the copyright notice in copies of the code.

---

**Keywords:** stateless MCP, Model Context Protocol, MCP 2026-07-28, MCP server example, MCP migration guide, Mcp-Session-Id removed, server/discover, MCP load balancing, MCP idempotency, Streamable HTTP, TypeScript MCP server, MCP without SDK
