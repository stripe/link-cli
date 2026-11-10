---
'@stripe/link-cli': patch
---

Fix the standalone Linux ARM64 executable's injected ELF segments so their load mappings support 4, 16, and 64 KiB kernel pages. Keep the program-header table on separate pages from writable runtime data.
