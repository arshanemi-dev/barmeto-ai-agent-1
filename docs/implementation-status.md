# Implementation status — 2026-09-17

This is an implementation increment, not completion of the full roadmap.

## Implemented

- Desktop dashboard and responsive local UI.
- Next.js local API, authenticated worker service, persistent state, deterministic Playwright actions, queue/cancellation/history.
- node-cron registration, explicit timezone, five-field validation, upcoming occurrences, pinned workflow revision, overlap prevention, pause/resume, restart missed-run handling.
- Local domain/step-limit/scheduling rules enforced at enqueue and between actions.
- Local app identities and semantic release drafts.
- Optional email OTP sign-in with Supabase, without bundling privileged credentials.
- Separate hosted-admin code with MFA and current role checks, app status controls, release draft reservation, cloud rules and audit reads.
- Supabase SQL migrations for user data, application membership, private Storage download policies, MFA-gated admin access, audit triggers, and transactional release reservation.
- Desktop packaging scripts, browser cache reuse, and environment-file removal from packaged resources.

## Verification recorded

- Seven Node unit tests passed.
- Desktop Next.js production build passed with one build worker (higher concurrency exceeded this machine's available memory).
- Browser workflow execution, rule denial, cross-origin API rejection, and 390px responsive layout passed.
- Packaged runtime smoke check, actual cron firing, hosted admin production build, and installer assembly: see subsequent verification update below.

## Not deployed or verified against live cloud accounts

Supabase migrations, real OTP/SMTP delivery, administrator role bootstrap, RLS isolation in a live project, and cloud release data. Source is prepared; a successful frontend build is not proof of live cloud behavior.

## Remaining roadmap work

1. Durable device/account-specific cloud synchronization, revisions, conflict handling, and outbox.
2. Complete workflow actions: download/upload, file operations, assertions/branches/loops, condition waiting, pause/resume and richer recovery.
3. OS sleep/resume scheduling integration, tray mode, start-at-login, device assignment and policy leases.
4. Global rule propagation/acknowledgement, immutable full rule history, and administrative membership lifecycle.
5. Production email sender, transactional job queue, templates, delivery webhooks, retries, and rate-limited resend UX.
6. Trusted generated-tool build pipeline, signed artifacts, Supabase upload verification, publication and withdrawal.
7. Authenticated electron-updater feed, verified downloads, install-later/restart flow, and installed-version confirmation.
8. Clean Windows VM installer/uninstaller tests, upgrades from older releases, signing, support diagnostics, and production rollout.

## Design and implementation notes

The interface uses real local counts, not seeded activity. The website starter is a template the user explicitly saves/runs. Applications and updates label unimplemented cloud/build features instead of reporting false success. Master admin is isolated from the desktop; local users cannot promote themselves into a platform role.

No cloud infrastructure, email, or production release was created by this implementation increment.
