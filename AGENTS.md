# Suja work tools project

Use ChatGPT native image generation for new artwork. Do not use Runway without explicit user approval.

Preserve the shared Suja header, theme storage key `sujaTheme`, display-name/password login, and Master-only account/role administration. Keep the hub and dock icon/card versus list preferences independent. Do not copy the legacy games' trust-based anonymous nickname lookup as password authentication.

The user explicitly chose the direct realtime model: GitHub Pages + Firebase Authentication + Realtime Database security rules, with no Cloud Functions or Blaze requirement for core operation. Do not reintroduce a scheduled server or paid-service dependency without discussing the concrete need with the user.

`SujaLifeTools` is the authoritative shared source, rules, and tests. `SujaDockStatus` is a standalone frontend export. Update shared frontend code in both repositories together. Maintain rules only in the hub repository; do not publish a stale rules copy from the dock export.

Read SETUP.md and firebase-rules-status.json before changing Firebase behavior. Edit scripts/rules.mjs and generate database.rules.json together when changing generated rules. Keep source version and deployment evidence separate. GitHub Pages or the private review site's deployment does not prove that Firebase rules are live.

The namespace is toolsV2. Preserve any stored toolsV1 data; do not automatically migrate or delete it. The apps are live-only. Do not add demo mode, sample accounts, or sample operational records. Only a Console-set toolsV2/config/masterUid can establish Master; all client writes to that setting stay denied. Never make the first public registrant Master. New self-created accounts remain pending until approved.

Keep client permissions narrowly scoped in rules. Validate signed-in actor identity, active membership, role permissions, current revision, atomic current/audit linkage, and physical lock confirmation. Audit entries stay immutable until eligible for expired cleanup. A broad ancestor write must not bypass these checks. Profile/directory writes stay consistent and custom roles never gain Master administration.

History/messages are shown for a rolling 72 hours and expired records are removed while an authorized app is active. Preserve the latest current dock status outside that window. Do not claim scheduled physical deletion while every browser is closed.

Run meaningful unit/adapter tests, database rules emulator integration checks, syntax checks, static build, and applicable browser checks before publishing changes. Never commit passwords, admin credentials, or service-account keys.
