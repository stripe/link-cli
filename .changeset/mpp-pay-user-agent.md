---
"@stripe/link-cli": patch
---

Send `User-Agent: link-cli/<version>` on `mpp pay` merchant probes and paid retries. `-H User-Agent` still overrides; `LINK_HTTP_PROXY` now applies to those requests too.
