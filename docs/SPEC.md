# Project: Certificate Expiry Monitor

A small single-user web app that monitors TLS certificates of websites/servers and emails a list of recipients when certificates approach expiry. There is exactly one login, configured in `.env` (username + password). Server-side rendered, no SPA, no REST API, no CLI.

## Tech stack
- Node.js 22+, TypeScript (use `tsx` for dev; releases are bundled with esbuild)
- Express + EJS templates (server-side rendering)
- Plain CSS (single `public/style.css`, no CSS frameworks)
- SQLite via `better-sqlite3`
- Auth: `express-session` (sessions stored in SQLite via `better-sqlite3-session-store`), `csrf-sync`, `helmet`
- Scheduler: `node-cron`
- Email: Nodemailer (SMTP config from `.env`; Ethereal for dev)
- Tests: Vitest + `supertest`, `selfsigned` for test certificates

## Architecture
Thin routes over a shared service layer. Business logic must NOT live in route handlers.
```
src/
  core/        # cert fetching/parsing, status calculation (pure, no DB)
  db/          # connection, numbered SQL migrations, repositories
  services/    # targets, checks, recipients, notifications, auth
  web/         # Express routes, middleware, EJS views
  scheduler/   # cron job
  mail/        # Nodemailer transport + email templates
tests/
```

## Modules
1. **Cert Parser** – connect with `tls.connect` to host:port (default 443) using `rejectUnauthorized: false` so expired/invalid certs can still be read; record `authorized` and `authorizationError` separately. Extract subject, issuer, SANs, validFrom, validTo, daysLeft. Status:
   - `OK` (> 30 days), `WARNING` (≤ 30), `CRITICAL` (≤ 7), `EXPIRED` (< 0), `ERROR` (connection/parse failure)
   - Thresholds are fixed constants. Add a timeout for connections.
2. **Storage** – SQLite with numbered migration files run on startup. Enable `PRAGMA foreign_keys = ON`. Use `ON DELETE CASCADE`.
3. **Authentication (single user)** – keep it minimal.
   - Credentials come from `.env`: `ADMIN_USERNAME`, `ADMIN_PASSWORD`. No account table, no registration, no setup page.
   - Login compares the submitted values with `crypto.timingSafeEqual`. Logout destroys the session.
   - All pages except `/login` require an authenticated session.
   - CSRF protection on all forms. Session secret from `.env`.
   - App refuses to start if `ADMIN_USERNAME`, `ADMIN_PASSWORD` or `SESSION_SECRET` is missing.
4. **Web UI** – pages: login, dashboard (table of targets with colored status, days left, last checked), add/delete target, "Check now" button, per-target check history, recipients management page.
5. **Scheduler & Email** – daily cron job at 08:00 Europe/Sofia.
6. **Testing** – unit + integration tests (see below).

## Database schema
```
notification_recipients (id, email UNIQUE, created_at)
targets                 (id, host, port, last_notified_status NULL, created_at, UNIQUE(host, port))
check_results           (id, target_id FK, status, days_left, valid_to, error, checked_at)
notifications           (id, sent_at, recipients_count, summary)  -- log only
```

## Business rules
- **Single user:** there is no user ownership of data. Requesting a non-existent target returns 404.
- **Recipients are global**: all alerts go to all recipients. Recipients are plain email addresses (no account needed). The list starts empty; the dashboard shows a hint to add at least one recipient while the list is empty.
- **"Check now"** only updates status and stores a check result. It never sends email.
- **Notifications (scheduler only):**
  - Check all targets.
  - Severity order: OK < WARNING < CRITICAL < EXPIRED. ERROR is reported but doesn't change `last_notified_status`.
  - Notify for a target only if its current status is worse than `last_notified_status`; then update `last_notified_status`.
  - If a target returns to `OK` (certificate renewed), reset `last_notified_status` to NULL without sending email.
  - Send ONE digest email per run listing all targets that triggered (host, status, days left, expiry date). If nothing triggered, send nothing.
  - Send a separate email to each recipient (not BCC). One failed recipient must not block the others. Log each run in `notifications`.
  - If there are no recipients, skip sending and log the run with `recipients_count = 0`.

## Testing requirements
- Unit tests for status calculation (boundaries: 31, 30, 8, 7, 0, -1 days).
- Parser tests with generated self-signed certs (valid and expired).
- Notification logic tests: escalation, no duplicate on same status, reset on OK, digest grouping, no recipients.
- Route tests with supertest:
  - login succeeds with correct credentials, fails with wrong username or password
  - unauthenticated requests to protected pages redirect to `/login`
  - CSRF token required on all POST forms
  - viewing/deleting a non-existent target returns 404
- Optional integration tests against `expired.badssl.com`, `self-signed.badssl.com`, `wrong.host.badssl.com`.

## Config (.env.example)
`PORT, SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, DATABASE_PATH, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM`

## Out of scope (future improvements)
Multiple users, hashed password storage, change password page, login rate limiting, recipient email verification, unsubscribe links, configurable thresholds, REST API.

## How to work
Work incrementally. First propose the plan and file structure, then build in this order, with tests for each step before moving on:
1. Project setup + migrations
2. Cert parser + tests
3. Auth (login/logout from `.env` credentials)
4. Targets + dashboard UI
5. Recipients page
6. Scheduler + email digest
Keep the code simple and readable. Prefer working solutions over premature abstraction.
