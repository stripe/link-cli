---
'@stripe/agent-identity': minor
---

Support Cloudflare Workers with `nodejs_compat`. Token keys are parsed with `asn1js` instead of `createPublicKey` and verified with Web Crypto, so Link's `id-RSASSA-PSS` token key imports there. Outbound fetches use `redirect: 'manual'` and refuse any 3xx, because Workers reject `redirect: 'error'`, and call `fetchImpl` unbound, because the Workers global `fetch` throws "Illegal invocation" otherwise. The public API and failure codes are unchanged.
