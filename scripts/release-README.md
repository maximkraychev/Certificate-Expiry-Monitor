# Certificate Expiry Monitor

Watches TLS certificates and emails a daily digest when one gets close to expiry, expires, or can't be reached.

## Start it

You need Node.js 22 or newer. There is nothing to install.

1. Edit `.env`. Set `ADMIN_PASSWORD`, `SESSION_SECRET` (a long random string), `SMTP_HOST`, the other `SMTP_*` values if your server needs them, and `MAIL_FROM`.
2. Run `node server.mjs`.
3. Open `http://<server>:3000` and sign in. Add the hosts to monitor on the dashboard, and the people to alert on the **Recipients** page.

If `.env` still has a sample password or secret, or `SMTP_HOST` is empty, the app exits and lists what to fix.

## Run it for real

- **Keep it running.** Use systemd or similar, so it restarts after a crash or reboot. It shuts down cleanly on SIGTERM. The job runs daily at 08:00 Europe/Sofia, and if the app is down at that moment, that day's run is skipped.
- **HTTPS.** The app itself serves plain HTTP. To use HTTPS, put one reverse proxy in front of it that sends `X-Forwarded-Proto: https`, and set `NODE_ENV=production` in `.env`. Leave `NODE_ENV` unset when serving plain HTTP, because login doesn't work over plain HTTP in production mode.
- **Check that mail works.** There is no test-email button. Mail goes out only when a certificate triggers an alert, and failures show up in the log as `Notification job: ... failed: <address> (<reason>)`.
- **Back up** the `data/` folder, with the app stopped. It holds the SQLite database, including the `-wal` and `-shm` files.
- **Upgrade** by replacing everything in this folder except `.env` and `data/`. The database is migrated on startup.
