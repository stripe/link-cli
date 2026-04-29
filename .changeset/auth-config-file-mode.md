---
"@stripe/link-cli": patch
---

Restrict the auth config file (`config.json`) to mode `0o600`. The file holds OAuth access + refresh tokens and, during a pending login, a `device_code`. Previously it inherited `conf`'s default (`0o666` masked by umask, typically `0o644`), which let other local users read the credentials and, during a login, race the legitimate poll loop to `/device/token`. Existing files are remediated automatically on the next config write.
