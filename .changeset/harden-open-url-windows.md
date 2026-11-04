---
"@stripe/link-cli": patch
---

Open browser URLs on Windows with the system `rundll32.exe` by absolute path instead of `cmd`, so an executable in the working directory is never launched and URLs are not parsed by the command shell.
