---
"@stripe/link-cli": minor
"@stripe/link-sdk": minor
---

Add `--attempt-trace` to `link-cli report` (and `attempt_trace` to the SDK's `CreateReportParams`): a step-by-step account of the path the agent took on a domain, written so another agent could follow it. Sent for successes and failures alike — the dead ends on a failed attempt are the useful part. The API truncates past 8000 characters rather than rejecting, so the flag carries no client-side length limit.
