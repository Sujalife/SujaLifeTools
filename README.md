# Suja Life Tools

A shared work-tools hub and **Suja Dock Status** for docks **16, 17, 18, and 19**.

The apps use the same basic hosting and realtime model as the Game Center: **GitHub Pages + Firebase Authentication + direct Realtime Database access protected by security rules**. Core operation does not require Cloud Functions, a scheduled server, or a Firebase Blaze upgrade. Firebase's service limits still apply.

- [Suja Life Tools](https://sujalife.github.io/SujaLifeTools/)
- [Suja Dock Status](https://sujalife.github.io/SujaDockStatus/)

## Included

- One display-name and password/passphrase login across tools on the same origin.
- Account creation with pending access until the Master approves a team role.
- A protected Master account that creates people, custom roles, and role assignments; its displayed job title is NetSuite Operator.
- Supervisor, Lead, Forklift Driver, NetSuite Operator, and Viewer starter roles.
- Four visual dock states: No trailer, Empty trailer, Loading, Locked / ready.
- Optional trailer number, update note, and physical lock confirmation when marking ready.
- Rule-validated person and role plus a Firebase server timestamp for each dock change.
- Atomic current-status and audit updates, with revision checks to reject stale edits.
- Per-dock history for the last 72 hours; current status remains until changed.
- Shared inbox with dock notices and team, role, and personal messages; unread receipts.
- Icon/card and list views for the hub and dock board, with separate saved preferences.
- The shared Suja header, green/white/purple light and dark themes, and `sujaTheme` preference.
- New hero/share artwork, app icons, installation icons, and background art.

## Activate the live workspace

The supplied public Firebase configuration is included in both builds. Live use still requires the **matching version 2 database rules** to be published and the owner's Auth UID to be set at **`toolsV2/config/masterUid`** in Firebase Console. See [SETUP.md](SETUP.md).

The owner can create an account in the app and copy the displayed UID. Creating an account does not grant Master automatically. The pinned UID initializes the Master profile and starter roles; all other new accounts remain pending until approved. The user reports enabling Email/Password and Anonymous providers; these apps use **Email/Password only**.

Both apps always use the live Firebase workspace. Previously saved sample sessions are retired automatically. Docks start unconfirmed until a teammate records their first update. Analytics is not initialized. No passphrase, admin key, or service-account credential belongs in this repository.

## Retention

The interface shows a rolling **72-hour** window of history and messages. An authorized open app removes expired entries at startup and periodically while it stays open. It does **not** guarantee physical deletion while every app is closed. The latest current dock state is stored separately and is retained until changed.

## Work on this project

This is a buildless static web app:

- `dist/` — ready-to-host frontend and assets.
- `dist/shared/` — shared authentication, realtime adapter, UI, and themes.
- `database.rules.json` — authorization and validation for direct Firebase access.
- `scripts/rules.mjs` — source generator for the database rules.
- `tests/` — account, permission, audit, revision, retention, and adapter checks.
- `scripts/` — static verification, exports, and internal login-address helper.

```sh
npm test
npm run check
npm run build
```

Use a static server against `dist/` for development. Live authentication requires HTTPS; local emulator development has separate setup. Run the applicable database rules emulator tests before publishing a rules change. Test results do not establish that live rules have been published.

## Hosting and shared source

GitHub Actions publishes `dist/` to GitHub Pages. Website publication does **not** publish Realtime Database rules. The same backend rules serve both frontends and are maintained only in **SujaLifeTools**; **SujaDockStatus** is a standalone frontend export.

Both GitHub repository paths share the origin `sujalife.github.io`, so Firebase's local persistence shares sign-in between the hub and dock tool. Different hostnames have separate sessions; passwords are never passed in URLs.

The direct model uses the **`toolsV2`** database namespace. Existing `toolsV1` data is not deleted or automatically migrated, and the new rules do not grant client access to that old namespace. The previous Functions-based prototype is not required for this version.

## Account administration limits

The Master can approve accounts, assign roles, create teammates, and disable application access. Disabling membership blocks operational access through database rules. Resetting another person's Auth password or deleting an Auth identity remains a Firebase Console task; this browser-only app does not impersonate Firebase Admin.

## Artwork

Original images were generated with ChatGPT's native image generator. See [ARTWORK.md](ARTWORK.md) for asset briefs. No Runway was used. Illustrated trailer scenes are decorative; live status comes from the dock board.

Personal alert preferences let each person choose dock status notices and team, role, or direct messages. Choices filter only the personal inbox/unread count; all dock data and permissions remain available. The version 2.1 rules enable account sync, with UID-scoped device fallback until updated rules are published. Phone dock layouts and editing actions are compact. See [SETUP.md](SETUP.md#personal-alert-preferences).
