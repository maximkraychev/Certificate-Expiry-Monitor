# Tasks: Certificate Expiry Monitor

Full spec: [SPEC.md](SPEC.md). Each task below runs in its own fresh session.

## How to use this file
- Do **one task per session**, in order. Before starting, read `docs/SPEC.md`, this file's *Conventions* and *Decisions*, and skim the code earlier tasks produced.
- A task is done when the tests it lists (and its "Done when" items, if any) are written and pass, `npm test` and `npm run typecheck` pass, and its checkbox is ticked here. Add 1–3 lines under **Notes** for the next session only if you deviated or found something surprising.
- Don't start the next task and don't commit unless asked.

## Conventions
- **Modules:** ESM (`"type": "module"`), TypeScript `strict`, `moduleResolution: "Bundler"`, `noEmit`. Run with `tsx` in dev and in prod (no build step). Imports have no file extension. Resolve paths with `import.meta.dirname`.
- **Style:** plain functions, no classes or DI containers. Repositories and services are functions that take `db: Database` as their first argument. Side-effecting dependencies (cert fetcher, mail sender, clock) come in through a `deps` parameter so tests can swap in fakes.
- **Layers:** `core/` is pure (no DB, no Express). Route handlers in `web/` only parse input, call a service, and render or redirect.
- **Time:** store ISO-8601 UTC strings (`new Date().toISOString()`). Display them in `Europe/Sofia` through one helper (`web/format.ts`, using `Intl.DateTimeFormat`).
- **App factory:** `createApp({ db, config, deps })` returns the Express app without listening. `src/index.ts` is the only place that opens the real DB, listens, and starts cron.
- **Tests:** Vitest, with `tests/` mirroring `src/`. Use an in-memory DB (`:memory:`) with migrations applied. No real network or SMTP in the default run. The badssl tests run only when `RUN_NETWORK_TESTS=1`.
- **Scripts:** `dev` (`tsx watch src/index.ts`), `start` (`tsx src/index.ts`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`).

## Decisions (already made; don't revisit)
1. `daysLeft = Math.floor((validTo - now) / 86_400_000)`. Status rules: `< 0` EXPIRED, `≤ 7` CRITICAL, `≤ 30` WARNING, otherwise OK. This puts day 0 in CRITICAL. The thresholds are exported constants in `core/status.ts`.
2. The TLS connect timeout is the constant `CONNECT_TIMEOUT_MS = 10_000`. SNI `servername` is the host, unless the host is an IP (`net.isIP`).
3. `check_results` gets two extra columns beyond the spec: `authorized INTEGER` (0/1) and `authorization_error TEXT`. Status comes from dates only. The UI shows "untrusted (reason)" when `authorized = 0`.
4. Adding a target runs one check on it right away, so the dashboard isn't blank.
5. Host input: trim, lowercase, strip any `scheme://` and path, then validate as a hostname or IP. Port is its own field, 1–65535, default 443. A duplicate `(host, port)` shows a friendly error instead of a 500.
6. Notification rules (pure function in `core/notificationRules.ts`). A NULL `last_notified_status` counts as OK.
   - `OK`: set `last_notified_status` to NULL, no email.
   - `ERROR`: include the target in the digest **on every run** while it keeps failing; `last_notified_status` doesn't change.
   - Worse than last: include it and set `last_notified_status` to the current status.
   - Same as last: do nothing.
   - Better than last but not OK (cert renewed with a short lifetime): silently lower `last_notified_status` to the current status, so a later escalation alerts again.
7. `last_notified_status` is written only after **at least one** recipient email succeeds. With no recipients, or when every send fails, nothing is updated, so the next run tries again.
8. Every scheduler run writes one `notifications` row. `recipients_count` is the number of successful sends. `summary` is a short text: the triggered targets, or "nothing triggered", or "no recipients", plus any failed addresses.
9. Mail: when `SMTP_HOST` is empty, use an Ethereal test account and log each message's preview URL.
10. Sessions live in the same SQLite DB (`better-sqlite3-session-store`). In tests, set `expired.clear: false` so no timer is left open. Session cookie: `httpOnly`, `sameSite: 'lax'`, `secure` in production. Call `req.session.regenerate` on login.
11. CSRF: `csrf-sync`, token taken from the `_csrf` body field, and every form includes it. An invalid token gets a 403 error page.
12. Every redirect after a POST carries one session-based flash message (`req.session.flash`).

## Steps and tasks

### Step 1: Project setup + migrations
- [x] **1.1 Scaffold the project**
  - Create `package.json` (engines `node >=20.12`), `tsconfig.json`, `vitest.config.ts`, `.env.example` (all spec keys, with sample values `DATABASE_PATH=./data/certs.db` and `PORT=3000`), the empty `src/{core,db,services,web,scheduler,mail}` folders, and add `data/` to `.gitignore`.
  - Install the runtime deps (express@5, ejs, express-session, better-sqlite3, better-sqlite3-session-store, csrf-sync, helmet, node-cron, nodemailer) and the dev deps (typescript, tsx, vitest, supertest, selfsigned, plus the @types packages).
  - **Check that `better-sqlite3` loads on Node 26** (`node -e "new (require('better-sqlite3'))(':memory:')"`). If there's no prebuilt binary and the native build fails, **stop and ask the user**. Options: install VS Build Tools, or switch to Node 22/24 LTS.
  - `src/config.ts`: `loadConfig(env = process.env)` returns a typed config and throws a clear error naming the missing variable when `ADMIN_USERNAME`, `ADMIN_PASSWORD` or `SESSION_SECRET` is absent. `src/index.ts` calls `process.loadEnvFile()` (only if `.env` exists) before `loadConfig`.
  - Tests: `tests/config.test.ts` (missing vars throw; defaults for PORT and DATABASE_PATH).
  - Done when: `npm test` and `npm run typecheck` pass, and `npm start` without `.env` exits with the missing-variable error.
- [x] **1.2 Database + migrations**
  - `src/db/connection.ts`: `openDatabase(path)` creates the parent directory, sets `PRAGMA foreign_keys = ON`, and sets `journal_mode = WAL` for file databases.
  - `src/db/migrate.ts`: `runMigrations(db)` applies every `src/db/migrations/NNN_*.sql` file whose number is greater than `PRAGMA user_version`, one transaction per file, then bumps `user_version`.
  - `001_init.sql`: the 4 tables from the spec plus decision 3. Constraints: `UNIQUE(email)`, `UNIQUE(host, port)`, `check_results.target_id REFERENCES targets(id) ON DELETE CASCADE`, `CHECK(status IN (...))`, and an index on `check_results(target_id, checked_at DESC)`.
  - Wire both into `index.ts`.
  - Tests: migrations are idempotent (running twice is fine), `user_version` is correct, foreign keys are on (deleting a target cascades to its check_results), and the unique constraints hold.

### Step 2: Cert parser
- [x] **2.1 Status calculation (pure)**
  - `src/core/status.ts`: `Status` type, threshold constants, `SEVERITY` order, `calculateDaysLeft(validTo, now)`, `calculateStatus(daysLeft)`.
  - Tests: boundaries 31→OK, 30→WARNING, 8→WARNING, 7→CRITICAL, 0→CRITICAL, −1→EXPIRED, plus daysLeft rounding just before and after a full day.
- [x] **2.2 TLS certificate fetcher**
  - `src/core/certFetcher.ts`: `fetchCertificate(host, port = 443, { timeoutMs, now })` returns `Promise<CertCheck>`. The `CertCheck` type covers: status, daysLeft, subject, issuer, sans[], validFrom, validTo, authorized, authorizationError, error.
  - Use `tls.connect` with `rejectUnauthorized: false` and SNI per decision 2. Read `getPeerCertificate()` on `secureConnect`. Parse SANs out of the `subjectaltname` string. Always destroy the socket.
  - Never throw. A connect error, timeout, or empty certificate returns `status: 'ERROR'` with a message.
  - Tests (`tests/core/certFetcher.test.ts`): start a local `tls.createServer` on port 0 with certs from `selfsigned`, and cover:
    - a valid cert gives OK, the right SAN and dates, and `authorized: false` with "self signed" in the error
    - an expired cert (notBefore/notAfter set in the past) gives EXPIRED
    - a closed port gives ERROR
    - a plain TCP server that never answers gives ERROR within the timeout (use a short `timeoutMs`)
  - Check the `selfsigned` version's API for setting past dates. If it can't do that, build the expired cert with `node-forge`.
  - `tests/integration/badssl.test.ts`: `describe.skipIf(!process.env.RUN_NETWORK_TESTS)` for expired., self-signed. and wrong.host.badssl.com.

### Step 3: Auth
- [ ] **3.1 App shell + login/logout**
  - `src/web/app.ts` with `createApp`: helmet (default CSP; no inline scripts anywhere), `express.urlencoded`, static `public/`, the session store (decision 10), csrf-sync (decision 11), flash middleware, `res.locals` (csrfToken, flash, isAuthenticated), the EJS view engine, a 404 handler, and an error handler that sends a 403 for CSRF errors and a 500 page otherwise.
  - `src/services/auth.ts`: `checkCredentials(config, username, password)`. Hash both submitted values and both expected values with SHA-256, compare with `crypto.timingSafeEqual` (equal-length buffers), and combine the two results without short-circuiting.
  - `src/web/middleware/requireAuth.ts` redirects to `/login`. Routes: `GET/POST /login` (on success, regenerate the session and redirect to `/`; on failure, re-render with status 401 and a generic message), `POST /logout` (destroy the session and redirect to `/login`). `GET /` is a placeholder dashboard for now.
  - Views: `partials/header.ejs` (nav plus a logout form), `partials/footer.ejs`, `login.ejs`, `error.ejs`. Basic `public/style.css`.
  - `tests/helpers.ts`: `createTestApp()` (in-memory DB, fixed config, fake deps), `getCsrfToken(agent, path)` (pulls it from the HTML), `loginAgent()`.
  - Tests: correct login works; wrong username fails; wrong password fails; unauthenticated `GET /` redirects to `/login`; POST without a token gets 403; logout ends the session.

### Step 4: Targets + dashboard
- [ ] **4.1 Targets & checks services**
  - `src/db/repositories/{targets,checkResults}.ts`: the SQL functions (insert, list with latest check, get by id, delete, insert result, history by target, update last_notified_status).
  - `src/services/targets.ts`: `parseTargetInput` (decision 5), `addTarget` (returns a validation error for duplicates), `deleteTarget`, `getTarget`, `listTargetsWithLatestCheck`.
  - `src/services/checks.ts`: `checkTarget(db, targetId, deps)` calls `deps.fetchCertificate`, stores the result, returns it, and never sends mail. Add `getHistory(db, targetId)`.
  - Tests: input normalization and validation cases, duplicate handling, checkTarget stores a row (fake fetcher), and delete cascades.
- [ ] **4.2 Dashboard & target pages**
  - Routes:
    - `GET /`: dashboard table with host:port, a colored status badge, days left, expiry date, last checked, an "untrusted" marker, and per-row Check now / History / Delete forms. Add-target form above the table.
    - `POST /targets`: add, then run the first check (decision 4).
    - `POST /targets/:id/check`
    - `POST /targets/:id/delete`
    - `GET /targets/:id`: details plus check history.
  - A non-numeric or unknown id returns a 404 page.
  - Status CSS classes: `.status-ok`, `-warning`, `-critical`, `-expired`, `-error`.
  - Tests (supertest, fake fetcher): add, then it's listed; check now adds a history row and sends no mail (the fake mailer isn't called); delete works; view or delete of an unknown id is 404; every POST without CSRF gets 403; validation error shows a flash.

### Step 5: Recipients
- [ ] **5.1 Recipients page**
  - `src/db/repositories/recipients.ts` and `src/services/recipients.ts`: `list`, `add` (trim, lowercase, simple email check, friendly error for duplicates), `remove`.
  - Routes: `GET /recipients`, `POST /recipients`, `POST /recipients/:id/delete` (404 for an unknown id). Add a nav link.
  - The dashboard shows a hint linking to /recipients while the list is empty.
  - Tests: add, list, delete; duplicate and invalid addresses rejected; the hint shows only when the list is empty; CSRF on both POSTs; unknown delete is 404.

### Step 6: Scheduler + email digest
- [ ] **6.1 Notification logic**
  - `src/core/notificationRules.ts`: `evaluate(lastNotified, current)` returns `{ trigger: boolean, newLastNotified }` following decision 6.
  - `src/mail/digest.ts`: `buildDigest(items, now)` returns `{ subject, text, html }`, a table of host:port, status, days left and expiry date, with ERROR rows showing the error.
  - `src/services/notifications.ts`: `runNotificationJob(db, deps: { fetchCertificate, sendMail, now })`:
    1. check every target sequentially, storing results
    2. evaluate each one
    3. if nothing triggered, log the run and stop
    4. if there are no recipients, log with `recipients_count = 0` and stop
    5. otherwise send one digest per recipient with `Promise.allSettled`
    6. apply the `last_notified_status` updates if at least one send succeeded (decision 7)
    7. log the run (decision 8)
  - Tests: pure rule table; escalation WARNING→CRITICAL triggers; the same status twice doesn't; OK resets to NULL with no mail; ERROR triggers each run and leaves the status unchanged; several triggered targets give one digest per recipient; no recipients gives no send and a logged run with 0; one failing recipient doesn't block the others.
- [ ] **6.2 Mail transport, cron, wiring, README**
  - `src/mail/transport.ts`: `createMailer(config)` uses SMTP from config, or Ethereal (decision 9). It returns `sendMail(to, digest)` and uses `MAIL_FROM`.
  - `src/scheduler/index.ts`: `startScheduler(run)` sets up `cron.schedule('0 8 * * *', …, { timezone: 'Europe/Sofia' })`, guards against overlapping runs, and catches and logs errors.
  - Wire it all into `index.ts`, with clean shutdown on SIGINT/SIGTERM (stop cron, close the server and DB).
  - README: setup, `.env`, scripts, how alerts work.
  - Tests: the scheduler registers the right expression and timezone (mock `node-cron`), and the overlap guard works.
  - Manual check: a one-off scratch script runs `runNotificationJob` against the dev DB with Ethereal and prints the preview URL.

## Notes
(Sessions add short handover notes here.)
- 1.1: better-sqlite3 13 ships N-API prebuilds (incl. win32-x64) and loads on Node 26 with no native build. npm 11 warns its `node-gyp` install script isn't in `allowScripts`. That's harmless. Versions are newer than you might expect: TypeScript 7, Vitest 5, ejs 7, nodemailer 10, node-cron 4 (ships its own types, so there's no `@types/node-cron`).
- 1.1: tsconfig sets `"types": ["node"]` explicitly (newer TS defaults `types` to `[]`) and `verbatimModuleSyntax`, so use `import type` / `type` modifiers for type-only imports. `config.isProduction` (from `NODE_ENV`) is there for the secure cookie in decision 10. `.gitignore` already had `.env.*`, so I added `!.env.example`.
- 1.2: The `Database` type comes from `src/db/connection.ts`. `tests/helpers.ts` already exists with `createTestDb()` (in-memory DB, migrated), so 3.1 should add to it, not replace it. `runMigrations(db, dir?)` takes an optional folder (the tests use it) and returns the new version.
- 1.2: The `created_at` / `checked_at` / `sent_at` columns default to the current time in `toISOString()` format, but repositories should still pass `deps.now()` explicitly so tests can control the clock. `targets.last_notified_status` has a CHECK that allows only NULL, WARNING, CRITICAL or EXPIRED (decision 6 never stores OK or ERROR). `index.ts` resolves a relative `DATABASE_PATH` against the project root.
- 2.1: `calculateStatus` returns `DateStatus` (`Status` minus ERROR), and `SEVERITY` is a `Record<DateStatus, number>`, so ERROR can't be compared by accident. Both functions throw `RangeError` on an invalid date or non-finite daysLeft instead of falling through to OK. The fetcher (2.2) must catch that and return ERROR. `calculateDaysLeft` takes `Date`s, so parse `valid_to` first.
- 2.2: `selfsigned` 5 is async-only and takes `notBeforeDate`/`notAfterDate`, so `node-forge` wasn't needed. `authorizationError` holds Node's code (`DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_TLS_CERT_ALTNAME_INVALID`), not a sentence, so the UI should map or show it as is. The hostname check still runs with `rejectUnauthorized: false`, which is why wrong.host comes back `authorized: false`. `now` is a function (`() => Date`), and `FetchCertificate` is exported as the type for `deps`. `sans` holds values only (no `DNS:` prefix).
