# Sites hosting feasibility

Checked on 2026-10-24. Sites is the preferred hosting path to investigate for this product. A new paid external host is not the default. No Site, database, plugin, deployment, credentials or access policy was created or changed during this assessment.

## Conclusion

Sites has documented support for HTTP handlers, persistent D1 storage, hosted MCP tools and automatic creation of the associated plugin. These are the main building blocks for the bridge. It would be incorrect to claim that Sites categorically cannot receive Telegram webhooks or send HTTPS callbacks.

However, the current Node implementation cannot simply be published as a Site. A complete Sites-only implementation meeting the present callback security and durable retry requirements is **not yet verified**. The specific gaps below must be resolved without silently weakening those requirements. This is not proof that a supported future Sites implementation is impossible.

## Capability assessment

| Requirement | Evidence and current status |
| --- | --- |
| HTTP webhook handler | Sites supports HTTP/HTTPS; its Worker starter exposes `fetch(request, env, ctx)`. An application can route a POST to a secret-checked webhook handler. Actual Telegram reachability through Sites dispatch remains untested. |
| Private Site ingress | The official Sites skill says non-user callers need service access through `OAI-Sites-Authorization`. Telegram's `setWebhook` supports its own `X-Telegram-Bot-Api-Secret-Token`, not arbitrary custom headers. No documented per-route exception or automatic header mapping was found. Do not invent one. |
| Public Site ingress | Public Sites may accept anonymous requests, while server code enforces authorization. A newly approved public Site with a secret-authenticated webhook and owner-authorized MCP/data routes is a plausible supported design. It is not equivalent to making chat data public. Audience selection still needs explicit review; do not change an existing Site's audience to bypass access controls. |
| Durable records | D1 is supported for durable structured records and migrations. Use it for update deduplication, owner-bound messages, subscriptions, outbox and reply revisions. R2 is unnecessary for the initial text-only bridge. |
| MCP tools and plugin | A Site can expose `POST /mcp`; publishing with MCP support provisions its corresponding App/plugin. Reuse that identity, not an additional standalone wrapper. |
| MCP Events | The official protocol defines discovery, subscription, callback verification and signed HTTPS delivery. The Site must implement the same contract. Tool support alone does not demonstrate event delivery support. |
| HTTPS callback transport | HTTPS requests are supported. Connection-time DNS validation and pinning, preserving TLS hostname validation, are not currently implemented through a verified Sites-supported transport. See the concrete compatibility gap below. |
| Durable retries | A D1 outbox is feasible, but a process-local `setInterval` is not a durable Worker scheduler. A supported retry wake-up mechanism and cross-invocation concurrency controls must be established. Generic Workers Queues or Durable Objects are not automatically available as Sites bindings. |

Sources for the platform capabilities: [Sites overview](https://learn.chatgpt.com/docs/sites), [data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections), and [hosting a plugin with Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites). Internal official Sites skill references checked: `references/identity-and-secrets.md`, `references/storage.md`, `references/site-mcp-server.md`, and the Worker ESM starter README.

## Callback security is the concrete compatibility gap

The official [MCP Events contract](https://developers.openai.com/plugins/build/mcp-events) requires callback destinations to be checked at connection time, public destination addresses to be enforced, and redirects to be blocked. The connection must use the checked address while preserving hostname validation for TLS. These checks apply to the challenge as well as event delivery.

The current implementation achieves this in Node with `dns.lookup` and the HTTPS request's `lookup` option. Official Cloudflare documentation states that:

- Workers' [`node:dns`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/) does not implement `lookup`.
- Workers' [`node:http` client](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/) wraps `fetch` and does not support the `lookup` or `createConnection` options.
- [`resolveOverride`](https://developers.cloudflare.com/workers/runtime-apis/request/) is an alternate-hostname option with same-zone restrictions, not a general checked-IP pin for arbitrary external callbacks.
- [Sites](https://learn.chatgpt.com/docs/sites) does not support raw TCP connections. Generic Workers socket availability therefore does not establish a supported Sites escape hatch.

A DNS-over-HTTPS lookup followed by an ordinary hostname-based `fetch` would introduce a second resolution and would not establish the same connection guarantee. A hostname suffix allowlist, `redirect: error`, or use of an authenticated callback alone must not be presented as proof of that guarantee.

The next capability to establish is an official Sites-supported HTTP transport or documented platform egress guarantee that enforces the callback policy at the actual connection. Do not invent a service binding or deploy a weaker replacement while this remains unresolved.

## Durable execution and concurrency adaptation

Worker invocations can run concurrently and be replaced. Replace synchronous local SQLite and the process-wide promise queue with D1 constraints, atomic update acceptance and compare-and-set reply claims. Persist pending external writes before calling Telegram; recover an interrupted claim as uncertain rather than sending a duplicate message.

For event retries, an in-memory timer or unawaited promise is insufficient. Cloudflare documents a [30-second post-invocation limit for `waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/). This does not establish long-lived retry scheduling. Possible request-driven retry designs must be checked against actual webhook acknowledgement and retry semantics; do not claim that Telegram guarantees an independent scheduler for the Site. No compatible Sites scheduler/queue binding has been verified for the current retry policy.

## Minimum source-only work once those capabilities are established

1. Add a Worker handler for webhook and MCP routing with owner authorization supplied by the Sites dispatch identity. Anonymous callers must never read messages or invoke tools.
2. Add schema-only D1 migrations, owner-bound records, idempotency keys and atomic reply claims; test concurrent Worker invocations and restart recovery with synthetic data.
3. Port signing to a Worker-compatible library or Web Crypto without altering the published Standard Webhooks format.
4. Supply the verified callback transport and retry mechanism, and test private/mixed DNS answers, rebinding, redirects, expiration and key rotation.
5. Prepare Sites hosting metadata without inventing a project ID. Only after source checks and explicit publication/secret/access approval should the Site be created and published. Use the plugin created by Sites.

Other installers would deploy their own copy and configure their own Bot securely. Sharing a private repository does not install or share the owner's personal Site plugin.

## Current boundary

No Sites adapter is claimed complete. Node mock tests remain valid for the standalone implementation but do not demonstrate Worker compatibility, dispatch ingress, D1 behavior or live Dot execution. Preserve the existing Bot consumer until the new Site endpoint, plugin and subscription are verified and the separately approved cutover can be rolled back.
