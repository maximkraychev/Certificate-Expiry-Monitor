# Certificate Expiry Monitor

A small single-user web app that watches the TLS certificates of your sites and servers, and emails a daily digest when one gets close to expiry, expires, or can't be reached.

Server-rendered Express + EJS, SQLite storage, a daily cron job, and Nodemailer for mail. There is one login, set in `.env`.

## Requirements

- Node.js 22 or newer
- In development, TypeScript runs directly with `tsx`

## Setup

```sh
npm install --ignore-scripts
cp .env.example .env   # then edit it
npm run dev            # http://localhost:3000
```

`--ignore-scripts` stops npm from compiling `better-sqlite3`, which ships prebuilt binaries and would otherwise need a C++ toolchain.

Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Add the hosts to monitor on the dashboard, and the people to alert on the **Recipients** page.

## Building a release

`npm run build` writes a ready-to-run copy of the app to `release/cert-monitor/`, about 19 MB. Zip that folder and hand it over. Whoever receives it needs only Node.js 22 or newer: they edit `.env` and run `node server.mjs`. The folder has its own `README.md` covering HTTPS, backups and upgrades.

- Each build replaces `release/cert-monitor/`, so don't run the app from there with data you want to keep.
- The release's `.env` is a copy of `.env.example`, never your local `.env`.
- It includes SQLite binaries for Linux, macOS and Windows, so one folder works on any of them.

## Configuration (`.env`)

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | yes | | Login user name |
| `ADMIN_PASSWORD` | yes | | Login password |
| `SESSION_SECRET` | yes | | Secret that signs the session cookie. Use a long random string. |
| `PORT` | | `3000` | HTTP port |
| `DATABASE_PATH` | | `./data/certs.db` | SQLite file. A relative path is resolved against the project root. |
| `SMTP_HOST` | | *(empty)* | SMTP server. Leave it empty to use an [Ethereal](https://ethereal.email) test inbox (see below). |
| `SMTP_PORT` | | `587` | `465` uses implicit TLS; other ports upgrade with STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | | | SMTP login. Leave the user empty for a server without auth. |
| `MAIL_FROM` | | `Cert Monitor <certs@localhost>` | Sender of the digest |

The app won't start if `ADMIN_USERNAME`, `ADMIN_PASSWORD` or `SESSION_SECRET` is missing.

A built release, or any run with `NODE_ENV=production`, also refuses to start if `ADMIN_PASSWORD` or `SESSION_SECRET` still has its `.env.example` value, or if `SMTP_HOST` is empty. It lists everything to fix.

**HTTPS.** The app serves plain HTTP. To use HTTPS, put one reverse proxy in front of it that sends `X-Forwarded-Proto: https`, and set `NODE_ENV=production` so the session cookie is marked `secure`. Leave `NODE_ENV` unset when serving plain HTTP, because login doesn't work over plain HTTP in production mode.

**Ethereal for development.** With `SMTP_HOST` empty, the first email creates a throwaway Ethereal account. Nothing is delivered. Each message's preview URL is printed to the console instead (`Ethereal preview for …: https://ethereal.email/message/…`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start and restart on file changes |
| `npm start` | Start |
| `npm run build` | Build the release folder |
| `npm test` | Run the tests (no network, no SMTP) |
| `RUN_NETWORK_TESTS=1 npm test` | Also run the live checks against badssl.com |
| `npm run typecheck` | `tsc --noEmit` |

The database schema is created and migrated on startup. `Ctrl+C` (SIGINT) or SIGTERM shuts down cleanly. A job that is running gets to finish before the server and the database close.

## How alerts work

Every check connects to `host:port`, reads the certificate even when it isn't trusted, and gets a status from the days left until it expires:

| Status | Days left |
| --- | --- |
| OK | more than 30 |
| WARNING | 30 or fewer |
| CRITICAL | 7 or fewer (the expiry day itself counts as 0) |
| EXPIRED | below 0 |
| ERROR | connection or handshake failed, or timed out after 10 s |

A certificate that doesn't verify (self-signed, wrong host name, unknown issuer) still gets a status from its dates. The dashboard marks it **untrusted**.

**Check now** on the dashboard only stores a new result. It never sends mail.

**The daily job** runs at **08:00 Europe/Sofia**. It checks every target, one at a time, and works out which ones need an alert:

- A target alerts when its status is **worse than the last status it alerted for** (OK < WARNING < CRITICAL < EXPIRED). It then remembers that status, so it alerts again only if things get worse. For example, a certificate moving WARNING → CRITICAL → EXPIRED sends three alerts over time, and staying CRITICAL for a week sends one.
- A target in **ERROR** is included in every run while it keeps failing, and that doesn't change its remembered status.
- When a certificate is back to **OK** (renewed), the remembered status is cleared without sending mail.
- When it gets better but isn't OK (say it was renewed with a short lifetime), the remembered status is lowered without sending mail, so a later escalation alerts again.

If anything triggered, one digest listing all of those targets (host, status, days left, expiry date, or the error) goes to **each recipient as a separate email**. One failed address doesn't stop the others. The remembered statuses are saved only once at least one email went out. With no recipients, or if every send fails, the next run tries again.

Every run is logged in the `notifications` table, with the number of emails sent and a short summary: the triggered targets, "nothing triggered" or "no recipients", plus any failed addresses.
