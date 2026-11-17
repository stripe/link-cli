# @stripe/link-integrations-mastra

## 0.2.0

### Minor Changes

- fb93282: Add `link.mpp` to the SDK so agents can buy from sellers over the Machine Payment Protocol:
  - `decode(request)` returns a URL's payment challenge
  - `pay(request, { spendRequestId, approvedChallenge })` pays the challenge with a shared payment token from an approved spend request, refusing a challenge whose terms changed since `decode`
  
  The Eve extension and Mastra integration add matching `mpp_decode` and `mpp_pay` tools. `link-cli mpp pay` and `mpp decode` now call the SDK interfaces rather than implementing their own logic.
  
  `link-cli mpp pay` now also checks the re-fetched challenge's amount, currency, and network against the spend request.
- 308a15a: Add native Mastra wallet tools with static or per-call authentication, configurable spend confirmation, wallet skills, and a local Studio example.

### Patch Changes

- Updated dependencies [fb93282]
  - @stripe/link-sdk@3.2.0
