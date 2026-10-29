---
'@stripe/link-cli': patch
---

Fixed MPP payments being rejected after approval when mppx rotated its challenge issuance nonce. Kept payment terms and route metadata pinned while echoing the refreshed challenge unchanged.
