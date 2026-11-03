# Suja Life Tools

A shared work-tools hub and **Suja Dock Status** for docks **16, 17, 18, and 19**.

The interface follows the existing Suja Game Center: shared header, app launch cards, account menu, message center, and synchronized green/white/purple light and dark themes. Theme uses the established `sujaTheme` preference.

## Included

- One display-name and password/passphrase login across tools on the same origin.
- Protected Master account; Master creates people, custom roles, and role assignments.
- Supervisor, Lead, Forklift Driver, NetSuite Operator, and Viewer starter roles.
- Four visual dock states: No trailer, Empty trailer, Loading, Locked / ready.
- Optional trailer number, update note, and physical lock confirmation when marking ready.
- Server-recorded person, role, and Pacific timestamp for every change.
- Per-dock history for the last 72 hours; current status is retained until changed.
- Revision checks prevent a stale update from overwriting a newer change.
- Shared inbox with dock notices and team/role/person messages, unread receipts.
- New hero/share artwork, app icons, installation icons, and shared background art.

## Current activation state

The hosted first version is an **interactive preview**. **The Firebase web app configuration is included; live backend activation remains pending.** Choose **Explore demo** for browser-only sample data. The demo is clearly labeled and never writes to Firebase. Live mode starts with unconfirmed docks; it does not seed production status from sample data.

The supplied public Firebase web app configuration is included in `dist/shared/config.js`. Analytics is not initialized. Authentication, Cloud Functions, security rules, and the first Master UID must still be set up as described in [SETUP.md](SETUP.md). No admin key or passphrase belongs in the repository.

## Work on this project

This is a buildless static frontend with a separate Firebase backend:

- `dist/` — web frontend, ready for static hosting.
- `dist/shared/` — the shared account, theme, app UI, and platform adapter.
- `functions/` — trusted Firebase callable functions and scheduled cleanup.
- `database.rules.json` — deny-by-default rules; only server functions write operational data.
- `tests/` — domain, identity, permission, revision, expiry, and demo tests.
- `scripts/` — build verification and safe account-address generation.

```sh
npm test
npm run check
npm run build
```

Run a static server against `dist/` to develop locally. Live authentication requires HTTPS (localhost development is supported by Firebase where applicable). `SETUP.md` covers Firebase deployment.

## GitHub Pages

The repository includes a Pages Actions workflow. Set **Settings → Pages → Source → GitHub Actions**, then run the **Publish site** workflow if needed. Pages publication serves the frontend; it does **not** deploy Firebase rules or functions.

Both repository builds use the same Firebase project and origin (`sujalife.github.io`), so Firebase local persistence shares sign-in across their paths. Hosting the tools on separate origins requires a deliberate sign-in handoff; passphrases are never included in URLs.

## Verification

Domain and adapter tests plus browser checks cover the preview workflows. Firebase Emulator integration, real two-account live updates, deployed rules, and scheduled cleanup verification remain pending until Firebase activation. Source files in GitHub are not evidence of a live rules deployment.

## Artwork

Original images were generated with ChatGPT's native image generator. See [ARTWORK.md](ARTWORK.md) for asset briefs. No Runway was used. Illustrated trailer scenes are decorative; current status comes from the dock board.
