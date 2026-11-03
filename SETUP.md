# Suja Life Tools — direct Firebase setup

This version uses **Firebase Authentication and Realtime Database directly from the browser**, protected by database rules. It requires no Cloud Functions deployment, scheduled server, Cloudflare account, or Blaze upgrade for its core features. Firebase's usage limits still apply.

The frontend configuration is already included for project **`suja-life-tools`** and database:

`https://suja-life-tools-default-rtdb.firebaseio.com`

The optional analytics measurement ID is retained in configuration, but Analytics collection is not initialized. Public configuration identifies the project; it does not grant administrator access. Never share or commit a password, private key, or service-account credential.

## 1. Confirm Authentication

The owner reports already enabling **Email/Password** and **Anonymous** under Firebase Authentication. The apps use **Email/Password**; they do not use anonymous login for workplace identity.

- Check **Authentication → Sign-in method → Email/Password** if sign-in reports that the provider is disabled.
- Add `sujalife.github.io` to authorized domains when required. Add the private review site's hostname separately if it will be used for live access.
- Keep the hub and tool on the same origin for seamless sign-in. Both GitHub Pages paths share `sujalife.github.io`.

Users enter a **display name**, not an email address. The app normalizes the name, lowercases it, and hashes it into an internal synthetic email address for Firebase Authentication. Names are unique without regard to capitalization or extra spaces. Names contain 2–48 characters; passphrases contain 8–128 characters and may include letters, numbers, and spaces.

## 2. Publish the matching rules

Use **`database.rules.json` from this version**, or its identical downloadable text copy. The earlier version 1 rules were written for the Functions prototype and do not enable this direct model.

1. In Firebase Console, select project **suja-life-tools**.
2. Open **Realtime Database → Rules** for the database above.
3. Replace the rules with the complete version 2 file and choose **Publish**.

Alternatively, an authenticated project administrator can publish the same source with the Firebase CLI:

```sh
npx firebase-tools deploy --project suja-life-tools --only database
```

If the rules generator is changed, run `node scripts/rules.mjs` and test the generated file before publishing. GitHub Pages deployment is not evidence that these rules are live. Keep the rules in Firebase Console and this repository synchronized.

## 3. Create the owner's account and pin Master

The first public visitor never becomes Master automatically.

1. Open [Suja Life Tools](https://sujalife.github.io/SujaLifeTools/), choose **Sign in**, then **Create account**.
2. Enter the desired display name, for example **Sean**, and choose a private passphrase. Keep that passphrase private.
3. The app creates a pending account and displays its Firebase **UID**. Copy the UID. The same UID is also visible in **Firebase Console → Authentication → Users**.
4. In **Realtime Database → Data**, create the following path and set its string value to that exact UID:

   ```text
   toolsV2/config/masterUid = YOUR_FIREBASE_AUTH_UID
   ```

   In the Console's JSON tree, this means `toolsV2` contains `config`, which contains the string field `masterUid`. Do not replace the entire database with this one field.

5. The open app watches that setting. Once it matches the signed-in UID, the app initializes the Master profile and default roles. Signing out and in again can also reload setup if needed.
6. Use **Team** to create teammates, approve pending accounts, and assign their roles.

Only a Firebase project administrator can set or change `toolsV2/config/masterUid`: all application-client writes to this path are denied. Knowing a display name or visiting first cannot claim Master. To transfer ownership, use a deliberate project-administrator migration and keep account/profile rules consistent.

If an account was already created with the internal synthetic address for its display name, sign in with that same name and passphrase rather than creating it again. An unrelated Auth email address does not map automatically to a display-name login. The helper `node scripts/login-address.mjs Sean` prints the internal address when a Console-created account is needed; it never prints a password.

## 4. Add the team

Default roles are **Master**, **Supervisor**, **Lead**, **Forklift Driver**, **NetSuite Operator**, and **Viewer**. The operational roles can update docks and send messages. Viewer can read operational data. Only the pinned Master administers accounts and roles.

A person may create an account in the app, but the initial profile is inactive/pending with no operational access. The Master approves access and assigns a role in **Team**. The Master may also create a teammate directly. A separate, memory-only Auth client creates that identity so the Master's signed-in session stays intact; profile and directory records are then written together with the Master's authorized session.

Custom roles can contain the operational permissions **Update dock status** and **Send team messages**. Master administration cannot be granted through a custom role. Disabling membership revokes the person's application data access through rules. It does not delete the Auth identity or reset the password. Those Auth administration actions remain Firebase Console tasks. Synthetic addresses do not receive password-recovery emails.

## Realtime records and audit

The shared namespace is **`toolsV2`**. Its `profiles` and `directory` records mirror `{uid, displayName, roleId, active, createdAt}`. The Master pin is separate under `config/masterUid`. Roles store operational permissions as a map with `dockUpdate` and `messageSend` keys; the adapter exposes the existing UI permission names.

Each dock update writes current status and an audit event in one atomic multi-location update. The current record links its `auditId` to that event. Rules validate the next revision, matching current/audit fields, the signed-in actor and assigned role, server timestamp, status, and physical lock confirmation when marking ready. An old form cannot overwrite a newer revision. Existing audit events cannot be rewritten; expired history may be removed by authorized maintenance.

Statuses are `no_trailer`, `empty`, `loading`, and `ready`. No current record means **Unconfirmed**. Trailer number is optional. Reopening a locked/ready trailer to loading requires a note. No live production status is seeded from the demo.

Manual messages are stored in separate team, role, and personal channels, with rules restricting channel access. The inbox subscribes to the current person's permitted channels. Dock notices are derived from committed audit events. Personal read receipts belong to the signed-in user. There is no global read that exposes other people's private channels, and no external email, SMS, or push notification is sent.

## Retention

The interface shows history and messages created within the last **72 hours**. An authorized open app removes expired records shortly after opening and approximately every minute while it is active. Old records may remain physically stored until an authorized app runs again if all browsers are closed. This is the deliberate tradeoff for avoiding a scheduled server.

The latest current dock status stays available until changed, even if its last update is older than 72 hours. Do not delete current status as part of history cleanup.

## Existing prototype data

This version uses `toolsV2` so it does not overwrite or automatically migrate any stored `toolsV1` prototype data. The replacement rules leave the old namespace inaccessible to clients. If prior production data exists, a project administrator should review and deliberately migrate it before team rollout. No previous Functions deployment is needed for the new model.

## Verification

Run the project's unit/adapter tests, syntax checks, static build, and database rules emulator integration checks before publishing a source change. The important rules cases include inactive users, Master pin protection, role escalation, stale revisions, separate current/audit writes, actor/time forgery, immutable audit records, lock confirmation, expired cleanup, and channel privacy.

Before workplace use, publish the matching rules and verify the real project with two different accounts: confirm an authorized user sees a dock update, a Viewer cannot update, a pending user cannot view operational data, role/personal messages stay within their channels, and the Master can approve or disable access. Source preparation and local test results do not prove that live rules were published.

## Shared adapter

```js
import { createPlatform, hasPermission } from './shared/platform.js';
const platform = await createPlatform(firebaseConfig);
const unsubscribe = platform.subscribe(state => { /* render */ });
```

Methods include `createAccount(displayName, passphrase)`, `login`, `logout`, `updateDock`, `getDockHistory`, `sendMessage`, `markRead`, `createUser`, `saveRole`, `assignRole`, `getSnapshot`, and `destroy`.

The snapshot exposes `account` for a signed-in pending/setup identity, including its UID; `user` is present only after application access is active. Existing `docks`, `history`, `messages`, `users`, and `roles` collections keep the UI's shared shape. Demo mode is an explicit **Explore demo** choice, stays local to that browser, and never stores a passphrase.

## Primary Firebase references

- [Password authentication](https://firebase.google.com/docs/auth/web/password-auth)
- [Direct reads, writes, and atomic updates](https://firebase.google.com/docs/database/web/read-and-write)
- [Realtime Database rule conditions](https://firebase.google.com/docs/database/security/rules-conditions)
- [Multiple Firebase app instances](https://firebase.google.com/docs/projects/multiprojects)
