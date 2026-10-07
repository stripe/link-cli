# Agent Identity in an MCP service

Use the verifier at the HTTP boundary of an MCP Streamable HTTP service. It checks Link bearer Agent Attestation Tokens (AATs) and identity presentations; your application decides which operations those credentials permit. Install [Agent Identity from npm](../../README.md#installation). This guide describes an integration pattern; it does not include a runnable MCP server. The [HTTP step-up example](../step-up/README.md) provides runnable session and interaction handling.

## Compatibility

This guide describes a custom Link credential exchange over MCP's HTTP transport. MCP's [standard authorization flow](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) uses OAuth. `PrivateToken` and `Identity-Presentation` challenges require a client or companion that implements this exchange; an arbitrary MCP client will not automatically answer them. The verifier does not implement an OAuth authorization server, protected resource metadata, or OAuth access-token validation. A Link bearer AAT has no resource audience binding and cannot substitute for an MCP OAuth access token.

The client behavior below was checked against `@modelcontextprotocol/sdk` 1.30.0, which supports MCP through `2025-11-25`. In [that MCP version](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), clients initialize the connection and servers can assign `Mcp-Session-Id`. [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) removes the initialization handshake, MCP transport sessions, and standalone GET streams. Use the transport rules for the version your client and server support. Application access checks and nonce association for identity presentations operate independently of those transport mechanisms.

## Choose the authorization policy

Decide whether your application requires an AAT on every request or verifies it when establishing an application session. A valid AAT proves issuance by Link, not the presenter's identity. A session established from an AAT must preserve that distinction.

Request identity claims only for operations that need them. Decide whether a successful disclosure authorizes one operation, one resource, or a longer session. A fresh disclosure is required when your policy requires verification again; the SDK does not mandate disclosure on every tool call.

Where supported, MCP initialization and a transport session ID do not establish an authenticated application session. Authenticate every protected HTTP request with the credentials required by your policy, including requests after initialization. If you establish an application session, define its permissions, expiry, revocation, and how clients authenticate subsequent requests. Associate any MCP transport session with that authenticated application context and check the association on each request. See [authorization scope](../../README.md#identity-claims).

Use one credential scheme in `Authorization` per request. Do not concatenate a `PrivateToken` credential with an OAuth `Bearer` token or an application session credential. If your MCP endpoint uses standard OAuth, preserve its OAuth validation and handle attestation in a separately defined exchange; the verifier does not provide that integration.

## Return HTTP challenges before MCP dispatch

Create one `LinkVerifier` per process. Configure its `origin` from trusted service configuration; this is the audience for identity presentations, such as `https://service.example`, without the `/mcp` path. Use HTTPS for credential-bearing endpoints, with explicit loopback HTTP origins for local development. Separately validate incoming HTTP `Origin` headers against your allowed client origins; reject a present, invalid origin with `403`. Setting the verifier's `origin` does not perform that check. Preserve normal body limits and duplicate credential-field rejection.

At the HTTP boundary, apply the application's access policy before dispatching a protected JSON-RPC operation or opening its response stream. Validate the requested tool and its arguments before issuing an operation-specific claims challenge. Inspect a bounded copy of the request body or pass the framework's parsed body to the MCP transport; do not leave it with an already-consumed body. Keep authorization state scoped to the request or an authenticated application session, rather than mutable state shared across clients. Pass the verified context to the handler so every handler sees the same authorization decision.

| Condition | HTTP response | Client action |
| --- | --- | --- |
| An AAT is required and is missing or rejected | `401` with `WWW-Authenticate: PrivateToken ...` | Obtain a supported Link bearer AAT and retry with the complete credential in `Authorization` |
| Required identity claims have not been verified for the operation or session | `401` with `WWW-Authenticate: Identity-Presentation` and the SDK's claims problem body | Obtain permission to disclose the requested claims and present them for the supplied audience and nonce |
| The required credentials are accepted and application authorization succeeds | Normal MCP response | Continue under the application's access policy |
| Credentials are accepted but application policy denies access | `403` at the HTTP access boundary | Surface the denial; do not repeatedly request the same disclosure |
| Issuer or application interaction-store outage | `503` | Retry when the service is available; do not treat it as a credential rejection |

Use `verifyAttestation` for the complete `Authorization` field value and inspect `result.valid`. For a rejected AAT, build the challenge with `attestationChallenge()` and preserve each `WWW-Authenticate` field. Use `isRejection` to distinguish credential failures from issuer failures. Handle exceptions from challenge creation separately; do not issue a challenge whose state your application could not save.

Authentication challenges must remain HTTP `401` responses through proxies and client wrappers. A JSON-RPC tool error inside HTTP `200` does not ask the HTTP client to answer a credential challenge. Once response headers or SSE events have been sent, a tool handler cannot change that response into an HTTP `401`. A website's connection action can request the protected endpoint directly. The SDK does not require a connection dialog or token-entry form; an agent or companion client obtains the credential and retries the MCP request.

For MCP versions with standalone GET streams, stream resumption, or DELETE session termination, apply the access policy to those requests too. They have no tool-call body to repeat an operation-specific disclosure against; use the application's established access context. Return the transport's method error for unsupported methods. Browser clients also need CORS configured to allow their transport, credential, and interaction headers and expose `WWW-Authenticate`, any interaction response header, and `Mcp-Session-Id` when used. Handle allowed preflight requests without requiring credentials on the preflight itself.

## Associate the nonce with an operation

Call `claimsChallenge()` with the required claim names, a purpose, and a nonce lifetime. The returned problem body describes the audience, nonce, claims, supported formats, and trusted issuers. Return it with the SDK's `WWW-Authenticate` field and `Content-Type: application/problem+json`. Use `Cache-Control: no-store` for credential challenges and protected responses.

The SDK does not record the nonce. Your application must associate it with the intended interaction and enforce the advertised expiry. If you already have an authenticated session, save the challenge under that session and operation. Otherwise, create an opaque interaction ID and a server-side record containing:

- The challenge's expected nonce, expiry, and required claim names.
- The intended tool, resource, and arguments relevant to authorization.
- The authorization scope that successful disclosure may grant.
- The authenticated caller context or an explicitly defined bearer continuation policy.

Return the interaction ID with the challenge and have the client echo it on retry using an application-defined field or header. The SDK does not prescribe that field. Treat the ID as a lookup key; do not grant access merely because a caller possesses it. A service without an authenticated caller must explicitly decide what a successful presentation for that pending interaction permits. Give concurrent interactions separate records so one challenge does not overwrite another's expected nonce.

On retry, check the record's expiry, caller context, and intended operation, including arguments relevant to authorization. Read the expected nonce and required claims from trusted server state, account for any change in application policy, and pass them to `verifyClaims`. Never derive the expected nonce from the unverified presentation or accept client-supplied values as the expected nonce or required-claims policy. Validate the disclosed values' types and business rules before authorizing the operation.

The application interaction record is the nonce state. Bound pending records, expire them with their challenges, and atomically mark them complete before authorizing an operation when your policy requires single use. Share this state across replicas when your deployment requires it. The SDK only compares the holder-signed nonce with the expected nonce supplied to `verifyClaims`.

## Handle challenges in the client

In `@modelcontextprotocol/sdk` 1.30.0, `StreamableHTTPClientTransport` surfaces a `401` as a transport error when no `authProvider` is configured. With an `authProvider`, it can start OAuth discovery even when the challenge uses `PrivateToken` or `Identity-Presentation`. Integrate Link credential handling through the transport's `fetch` option, before either behavior consumes the response. For an endpoint using only this custom exchange, omit the OAuth `authProvider`. If you support both flows, explicitly route challenges by scheme and stop a declined or failed Link exchange from falling through into OAuth.

The handler must:

1. Send the credentials required by your application's access policy to the configured endpoint.
2. Inspect the `401` challenge headers and parse the identity problem body before the transport applies its default authentication behavior. Preserve all advertised `PrivateToken` challenges; Fetch can combine repeated `WWW-Authenticate` fields, so use challenge-aware parsing rather than splitting on every comma. Keep issuer outages separate from credential rejection.
3. For an identity challenge, validate the expected audience, requested claims, supported format, trusted issuer, and association with the pending operation.
4. Obtain the user's disclosure permission and ask the identity client for a holder-signed presentation for that audience and nonce. Issuance and permission handling are application responsibilities, not verifier APIs.
5. Retry the rejected operation with `Identity-Presentation`, the application's interaction identifier, and any other credentials required by policy. Retain a replayable request body and preserve the JSON-RPC ID, arguments, cancellation signal, content negotiation, MCP metadata, and transport-session headers when applicable. Scope the presentation and interaction ID to that retry, not shared transport defaults or unrelated concurrent requests.
6. Bound automatic retries. Surface a declined disclosure or a rejected retry to the caller instead of retrying indefinitely.

Restrict credential attachment to the configured MCP endpoint, including its path. The custom fetch may also receive OAuth discovery or token requests, so do not add Link credentials to every URL it sees. Disable redirects for credential-bearing calls inside the custom fetch. In SDK 1.30.0, standalone GET requests do not inherit all `requestInit` options, including `redirect` and `credentials`; setting those options only on the transport is insufficient. Apply any required browser cookie mode there as well.

Return successful responses unchanged so the transport can process JSON, SSE streams, and `202` responses. A wrapper must not consume a successful stream while looking for a challenge. Do not log AATs, presentations, or disclosed personal information. Do not blindly repeat a tool call after a network failure or a response whose execution status is unknown; the operation may already have run. Use the application's idempotency policy and version-specific transport recovery rules.

## Complete the interaction

A presentation missing required claims can be corrected against the same unexpired application interaction when your policy permits it. Successful verification does not mutate nonce or interaction state. Apply the chosen authorization policy: permit the current operation or establish/update an application session with the intended scope. Verification itself does not create a session. The SDK does not issue session credentials or manage session permissions, expiry, or revocation.

For session access, associate the verified claims with the application's session and issue or update its credential. Subsequent MCP requests authenticate with that session credential and use the stored claims and permissions. Application nonce policy does not set the lifetime of the application's authorization or require disclosure on each request. An identity presentation is evidence for verification, not a reusable application session credential.

Persist the authorized session or operation-retry state before dispatching the operation, and remove or atomically mark the interaction record complete when your policy requires single use. Restrict access to stored outcomes using the same authorization policy; an idempotency key alone is not an authentication credential. A later request may use an authorized application session or obtain a fresh challenge, according to your policy. See [identity retry handling](../../README.md#identity-claims).

Identity verification binds a disclosure to an audience and expected nonce. It does not enforce nonce expiry or single use, authenticate the HTTP method, URL, or body, or bind a separate anonymous AAT to the identity holder. Preserve these distinctions and the [production limits](../../README.md#configuration-and-operations) in your integration.
