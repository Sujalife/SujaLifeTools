# Suja Life Tools — live Firebase setup

The interface and clearly labeled browser demo can be reviewed before Firebase is connected. No production dock statuses have been created. Live docks remain **Unconfirmed** until an authorized teammate records their first update.

## Required project information

The supplied public Firebase web app configuration has been added to both frontends, including the API key, app ID, and database URL:

`https://suja-life-tools-default-rtdb.firebaseio.com`

The public `firebaseConfig` supplied for the Web app is now included in both apps' `dist/shared/config.js`. The optional analytics measurement ID is retained as configuration; Analytics collection is not initialized. This configuration identifies the project but does not grant administrative access or prove that Authentication, backend functions, rules, or the scheduler are activated. Never commit a service-account key, account password, or private key.

The project ID is expected to be `suja-life-tools`; verify it against Project settings before deployment.

## Enable authenticated accounts

1. Open **Authentication → Sign-in method** and enable **Email/Password**. There is no email-address input in the apps: the display name is normalized, lowercased, and SHA-256 hashed into an internal synthetic login address.
2. Add the deployed app hostname to **Authentication → Settings → Authorized domains** when required. Keep the hub and tool on the same origin for seamless shared login. The two repositories on `sujalife.github.io` share an origin even with different project paths. Different hostnames have separate browser sessions.
3. Display names must be unique without regard to capitalization or extra spaces. They contain 2–48 characters. Passphrases may include spaces, letters, and numbers and must contain 8–128 characters.
4. Only the configured Master can provision team profiles. Unprovisioned Firebase identities have no application access. The app has no public registration screen.

## Bootstrap the single Master account

The first person who visits never becomes Master automatically.

1. Decide the initial Master display name, for example `Sean`.
2. In a trusted terminal, run `node scripts/login-address.mjs Sean`. This prints the **public synthetic login address**, not a password.
3. In **Firebase Authentication → Users → Add user**, create the Master account using that synthetic email and your chosen private passphrase. Do not publish or send the passphrase.
4. Copy that account's Firebase **UID**. Set the Cloud Functions parameter `SUJA_MASTER_UID` to that UID during deployment. The UID is an identifier, not a credential.
5. Sign into the app with the display name `Sean` and the private passphrase. The callable `bootstrapMaster` verifies that this signed-in UID exactly matches `SUJA_MASTER_UID` and that its synthetic email matches the display name, then creates the protected Master profile and default roles. No other account can bootstrap.
6. Use the Master account panel to create teammates and assign their roles.

The Master cannot be reassigned or disabled through the app. To transfer ownership, use a deliberate administrator migration and change the configured UID. Password recovery does not send email to synthetic addresses; a project administrator can reset credentials through Firebase Authentication. A future Master reset flow can be added if needed.

## Deploy trusted server operations and rules

Cloud Functions and the scheduled cleanup require a Firebase **Blaze billing project** and its Google Cloud APIs. Review the project's billing settings before deploying.

From the repository that owns the backend:

```sh
cd functions
npm install
cd ..
npx firebase-tools login
npx firebase-tools deploy --project suja-life-tools --only functions,database
```

The CLI prompts for `SUJA_MASTER_UID` if no local parameter value exists. Keep any CLI-generated `.env.<project>` files untracked. Never commit a service-account credential. Deploy this shared backend from **one authoritative repository**; both apps call the same functions.

The Realtime Database rules deny all browser writes. Reads require an active provisioned profile. Dock history and messages are available only through authenticated server functions, which enforce role/audience access and the 72-hour expiration. Anonymous, inactive, and unprovisioned accounts cannot view operational data.

Each dock update runs a transaction that atomically records its current state and audit event. It requires the revision the user actually reviewed. Audit names, roles, timestamps, and expiration are supplied by the server. UI clients cannot impersonate another actor or overwrite an audit record.

Default roles: Master, Supervisor, Lead, Forklift Driver, NetSuite Operator, Viewer. Supervisor, Lead, Forklift Driver, and NetSuite Operator may update docks and send messages. Viewer may read. Only Master creates accounts and roles. The Master can create further named roles with either operational permission.

## Retention and notifications

Dock history and messages use a rolling **72-hour window**. Server reads exclude expired entries at the exact 72-hour boundary. The scheduled job physically removes expired history, messages, and read receipts every five minutes; dock updates also prune expired history for that dock. The latest current status stays available until replaced, even when its last update is older than 72 hours.

Every dock audit event is also presented as a team notification in the Message Center. These notifications are derived from the same committed transaction, so an update cannot succeed while losing its associated notification. Manual messages support the team, an assigned role, or one teammate. Message timestamps and sender identity are assigned on the server. No external email, SMS, or push notifications are sent.

## Shared adapter API

```js
import { createPlatform, hasPermission } from './shared/platform.js';
const platform = await createPlatform(firebaseConfig);
const unsubscribe = platform.subscribe(state => { /* render */ });
```

Use `createPlatform(firebaseConfig, {demo:true})` only after an explicit **Explore demo** action. Demo data is local to that browser and marked `mode: 'demo'`; it is never uploaded. No passphrase is stored in demo data.

Methods: `login(displayName,passphrase)`, `logout()`, `updateDock({dockId,status,trailerId,note,expectedRevision,lockedConfirmed})`, `getDockHistory(dockId)`, `sendMessage({body,audienceType,audienceId})`, `markRead(messageId)`, `createUser({displayName,passphrase,roleId})`, `saveRole({id,name,permissions})`, `assignRole({uid,roleId,active})`, `getSnapshot()`, `destroy()`.

Snapshot collections: `docks` keyed by dock number; `history` keyed by dock number with newest-first event arrays; `messages` array; `users` keyed by UID; `roles` keyed by role ID. `user` has `uid`, `displayName`, `roleId`, `roleName`, `permissions`, and `active`. Status values are `no_trailer`, `empty`, `loading`, `ready`; an absent live dock record means **Unconfirmed**. The trailer number is optional. A `ready` update requires `lockedConfirmed: true` to record that the trailer is physically locked and ready for pickup. Reopening it to loading requires a reason.

## Verification performed and remaining

Run `node --test tests/*.test.mjs` for the domain and adapter tests. They cover audit integrity, role permissions, revisions, retention boundaries, message audiences, protected role administration, demo isolation, and identical username hashing between browser and backend. `node --check functions/index.mjs` validates server syntax.

These are local tests, not a claim that the backend, Authentication provider, scheduler, or security rules have been deployed. Before team use, deploy and verify with two separate active accounts, confirm a Viewer cannot update, check history and role-directed messages, and run Firebase Emulator Suite rules/callable integration tests.

## Primary Firebase documentation

- [Callable Functions](https://firebase.google.com/docs/functions/callable)
- [Admin user creation](https://firebase.google.com/docs/auth/admin/manage-users)
- [Parameterized configuration](https://firebase.google.com/docs/functions/config-env)
- [Realtime Database rules](https://firebase.google.com/docs/database/security/rules-conditions)
- [Scheduled Functions](https://firebase.google.com/docs/functions/schedule-functions)
