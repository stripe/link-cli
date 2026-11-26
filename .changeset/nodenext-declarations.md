---
'@stripe/link-sdk': patch
'@stripe/link-integrations-better-auth': patch
---

Publish declaration files that resolve under `module` and `moduleResolution` `nodenext`: relative imports now carry `.js` extensions, and the SDK no longer emits `@/*` path aliases or test declarations.
