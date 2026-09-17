# Barmeto

A local-first, **non-AI** automation workspace built with Next.js, Electron, Playwright, Tailwind CSS, and node-cron. JavaScript throughout.

## Run locally

Use Node 24 and npm for development. End users of the packaged desktop build do not need Node.

```sh
npm ci
npm run browser:install
npm run dev
```

`npm run dev:web` starts the dashboard at `http://127.0.0.1:3000` without Electron. Use one development server at a time. The launch script starts both the Next.js interface/backend and the authenticated local worker service. Starting only `next dev` is not sufficient for workflows.

## Working features

- Responsive dashboard with real local metrics and empty/error states.
- Workflow creation/editing: navigation, click, fill, bounded wait, text extraction, and screenshots.
- Supervised local runtime, serialized run queue, progress, cancellation, history, and output paths.
- Approved navigation origins and live local rules: blocked domains, maximum steps, scheduled-run prohibition.
- node-cron schedules with timezone preview, revision snapshots, pause/resume, and restart catch-up policy.
- Local application registry and semantic release drafts (first/patch/minor/major).
- Optional Supabase email OTP sign-in, memory-only sessions.
- Separate hosted-admin source with OTP + authenticator verification, role-checked management endpoints, application availability, draft version reservation, cloud rule records, and audit history.
- Production Next.js standalone output and Windows Electron packaging scripts that bundle Chromium.

The app does **not** currently publish installers, self-update, synchronize cloud workflows/rules, send transactional notifications, or expose arbitrary native desktop controls. Version drafts are not executable builds. These capabilities remain on the roadmap; the UI labels them accordingly.

## Scheduling

Keep the app running and the computer awake. Closing the app exits the scheduler. Tray mode/start-with-Windows are not implemented. Choose skip missed runs (default) or one catch-up occurrence within one hour when restarting. Schedules pin the current workflow revision. One run executes at a time, and duplicate occurrences or an overlapping run of the same schedule are rejected.

The scheduling engine does not provide exactly-once external side effects. Review interrupted runs before retrying forms or other actions. Schedule recovery after OS sleep without restarting still needs a dedicated lifecycle integration/test.

## Data and permissions

Development state is in `.barmeto/`. Packaged state uses Electron's application user-data directory. JSON writes are serialized and atomic with a previous snapshot backup. Failed/active runs are marked interrupted on restart. Screenshots go in the local `outputs/` folder.

Workflow fill values are stored in plain local JSON in this build: **do not store passwords or tokens in steps**. Browser sessions are temporary. Navigation must match approved origins; domain rules also block subresources. This is a local personal tool, not a hostile-user isolation sandbox.

Local API requests use per-launch authentication in Electron. The browser development mode permits same-origin requests with the app client header and must remain bound to loopback. Do not expose development ports publicly.

## Supabase setup

1. Copy `.env.example` to `.env.local` and provide the project URL and publishable key.
2. Review/apply SQL migrations in `supabase/migrations/` to a development Supabase project, in filename order.
3. Configure a verified custom SMTP sender and an email template that includes the OTP token in Supabase Auth. Existing-user sign-in is used; create/invite the intended account through a trusted operator flow.
4. Restart Next.js after environment changes. Public configuration is baked into production builds.

Never put a service-role key, SMTP password, or signing certificate into a desktop environment file. Packaging strips environment files from Next standalone output. The migrations have not been applied or tested against a live project in this implementation session.

## Master admin application

The admin surface is a separate deployment; it is not a privileged mode unlocked on the desktop.

```sh
# Configure admin/.env.local using admin/.env.example first.
npm run admin:dev
npm run admin:build
```

The admin UI runs at `http://127.0.0.1:3200`. To deploy independently, use `admin/` as the project root and install its manifest dependencies. Bootstrap a master admin using a trusted SQL session:

```sql
insert into public.platform_roles(user_id, role)
values ('YOUR_EXISTING_AUTH_USER_UUID', 'master_admin');
```

Sign in by email, enroll/verify a TOTP authenticator, then open management. The hosted API verifies the user, MFA assurance, and current role on every request; RLS also requires MFA for master-admin mutations. Role changes, release publication, notification delivery, and device policy propagation need further implementation. Cloud rules are explicitly shown as not yet enforced on desktop devices.

## Build and package

```sh
npm run build
npm run package:dir
npm run test:desktop
npm run package
```

`package:dir` creates `dist/win-unpacked/`. `package` additionally generates a Windows NSIS installer. Packaging stages the standalone Next.js server, worker dependencies, and the Playwright browser. It reuses the installed matching browser cache where available, or downloads required binaries. It does not sign production releases or upload anything to Supabase.

Production requires Windows code signing, installer clean-machine/upgrade testing, a trusted artifact publisher, and an authenticated update feed. Keep the platform app identity stable across versions.

## Verification

```sh
npm test
npm run test:e2e
npm run test:desktop
```

Unit tests cover workflow restrictions, schedule validation, policy matching, atomic storage, and corruption recovery. Browser tests use an isolated `.barmeto/e2e-*` directory and a local fixture, create and execute a workflow, test scheduling and rules, reject cross-origin requests, and verify narrow-screen layout. Desktop smoke tests run the unpacked executable with isolated user data and a hidden window, then execute a browser task through the packaged interface.

Use `docs/implementation-status.md` for verified results and remaining work. The complete product roadmap lives in the parent workspace's `plans/end-to-end-development-plan.md`.
