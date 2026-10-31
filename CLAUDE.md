# Certificate Expiry Monitor

Single-user Express + EJS app that watches TLS certificate expiry and emails a daily digest.
Stack: Node 20+, TypeScript (run with `tsx`, no build), Express 5, EJS, SQLite (`better-sqlite3`), `node-cron`, Nodemailer, Vitest + supertest.

## Before doing anything
- `docs/SPEC.md` is the source of truth for requirements.
- `docs/TASKS.md` holds the conventions, the decisions already made (don't revisit them), and the task list.
- Work is done **one task per session**. Do only the task you were asked for (or the first unchecked one). When its tests pass, tick its checkbox and add a short handover line under **Notes** if anything surprised you.
- Don't commit unless asked.

## Commands
- `npm run dev`: start with reload
- `npm start`: start
- `npm test`: Vitest (set `RUN_NETWORK_TESTS=1` to include the badssl.com tests)
- `npm run typecheck`: `tsc --noEmit`

## Rules of thumb
- Business logic goes in `src/services` or `src/core` (`core` is pure). Route handlers only parse input, call a service, and render or redirect.
- Plain functions that take `db` first; side effects (cert fetcher, mailer, clock) are injected through `deps`.
- Every POST form includes `_csrf`. Every page except `/login` requires login.
