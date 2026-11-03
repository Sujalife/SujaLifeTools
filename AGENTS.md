# Suja work tools project

Use ChatGPT native image generation for new artwork; do not use Runway without explicit user approval.

Preserve the shared Suja header, theme storage key `sujaTheme`, display-name login, and Master-only account/role administration. Do not copy the legacy games' anonymous nickname lookup as password authentication.

`SujaLifeTools` is the authoritative shared source and Firebase backend. `SujaDockStatus` is a standalone frontend export. Update shared frontend code in both repositories together. Keep Firebase backend source only in the hub repository; never deploy a stale rules copy from the dock export.

Read SETUP.md and firebase-rules-status.json before changing Firebase behavior. Never claim rules/functions are live because GitHub Pages or the private preview deployed. Keep deployment evidence separate from source.

Preserve all current dock state outside the rolling72-hour history. Client writes stay denied; server functions enforce actor identity, role permissions, current revision, and lock confirmation.

Run the domain/adapter tests, syntax checks, static asset build, and applicable browser checks before publishing changes. Never seed demo data into Firebase. Demo labels must remain visible whenever sample data is shown.
