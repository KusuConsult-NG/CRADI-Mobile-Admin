# CRADI Admin Panel

> **Web-based administration panel for CRADI / EWER Mobile**
> Climate Risk & Disaster Intelligence Management

## Overview

A Next.js app for administrators of the CRADI Mobile ecosystem. It uses the same
Supabase project as the Flutter app: Supabase Auth for sign-in and Postgres (with
Row Level Security) for data (`profiles`, `reports`, `knowledge_base`, `alerts`,
`contacts`, `authorities`, `app_settings`). It is hosted on Railway.

The database schema lives in the mobile repo, under
`CRADI-mobile/supabase/migrations/` — with a consolidated, paste-into-the-SQL-
editor version at `CRADI-mobile/supabase/deploy/schema.sql`. First-time
deployment of the whole system: `CRADI-mobile/docs/DEPLOYMENT.md`.

## Features

- **Dashboard**: counts of users, reports (pending / approved + verified), contacts, knowledge articles and active alerts
- **User management**: search, filter, paginate; approve, revoke approval, change role, change location (state / LGA / ward from the INEC list), block/unblock, delete (Auth account + profile)
- **Report management**: filter by status and hazard (legacy spellings included), search, paginate; set approved / verified / rejected / pending; view images; canonical hazard names and a "Verification request" badge
- **Knowledge base**: create, edit and delete hazard guides
- **Community alerts**: publish alerts (title, message, severity, target state and LGA picked from the location list) — the backend pushes them to app users — and deactivate them. The state is required whenever an LGA is chosen: six LGA names belong to two states each (Obi is in both Benue and Nasarawa), so the LGA picker stays disabled until a state is picked, and the database rejects an LGA with no state
- **Authorities**: manage the SMS contacts texted when a report in their LGA is approved (name, organisation, phone normalised to `+234XXXXXXXXXX`, coverage state **and** LGA chosen together from the fixed list — LGA names such as Obi exist in two states, so the state is required and the database rejects a contact without one); search / filter by (state, LGA); a panel lists the (state, LGA) pairs with no contact
- **App settings**: edit the live `app_settings` keys (peer confirmations, escalation timeout, SMS caps, peer chat flag, minimum app version + message) with typed validation; other keys are ignored
- **Admin-only access**: the signed-in user's profile must have `role = 'admin'`, `is_approved = true` and `is_disabled = false`

## Quick Start

Prerequisites: Node.js 22+, a Supabase project with the CRADI schema applied.

```bash
npm install
cp .env.example .env.local   # fill in the three Supabase values (see SETUP.md)
npm run dev                  # http://localhost:3000
```

If the public Supabase variables are missing, the app shows a configuration error
screen instead of the login page.

See [SETUP.md](./SETUP.md) for granting admin access and deploying to Railway.

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server (build time) | Supabase project URL; also the Supabase origin in the CSP (`lib/csp.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client (build time) | Public anon key; access enforced by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (runtime) | Used by `/api/admin/*` routes and `scripts/set-admin.mjs`. Bypasses RLS — never prefix it with `NEXT_PUBLIC_` |

Both `NEXT_PUBLIC_*` values are inlined into the compiled bundle by
`next build`. Changing them requires a rebuild, not a restart.

## Project Structure

```
app/
├── api/admin/users/[uid]/route.ts  # Admin-only user operations (service role)
├── api/health/route.ts             # Railway healthcheck ({ ok: true })
├── dashboard/                      # Dashboard, users, reports, knowledge, alerts, authorities, settings
└── login/                          # Sign-in
components/
└── Pagination.tsx
lib/
├── supabase.ts                     # Browser client (anon key, RLS)
├── supabase-admin.ts               # Server-only service client + admin check
├── constants.ts                    # Tables, roles, statuses, hazards, helpers
├── lgas.ts / wards.ts              # LGA + ward lists (wards.ts generated from the mobile app's mvp_locations_data.dart)
├── phone.ts                        # Nigerian phone normalisation (same rules as the backend SMS sender)
├── admin-api.ts                    # Authenticated fetch helper
└── auth-context.tsx                # Auth provider with admin-profile check
scripts/
└── set-admin.mjs                   # Promote a user to approved admin
e2e/
├── playwright.config.ts            # Starts the mock + a production build, runs *.spec.ts
├── mock-supabase.mjs               # In-memory Supabase mock (auth, PostgREST subset, Storage)
├── fixtures.ts                     # Mock reset/request log, console/CSP guard, login helper
└── *.spec.ts                       # Auth, dashboard, users, reports, authorities, settings, knowledge, alerts
railway.json                        # Railway build/deploy config
```

## Security

- Reads and report / knowledge / alert writes go directly to Supabase with the
  user's session and are enforced by RLS (`public.app_role()` must be `admin`).
- User administration (approve / revoke, block, role, location, delete) goes through
  `/api/admin/users/[uid]`, which verifies the Supabase access token, re-checks
  the caller's profile, then uses the service role key. Admins cannot block,
  demote, revoke or delete themselves.
- Approval never confirms an email: it is refused (409) until the user has
  confirmed their email or phone, and the users list shows an "Email not
  confirmed" badge (from `POST /api/admin/users/confirmation`). Approve and role
  changes (and revoke / location changes) send the role / LGA / ward the admin
  reviewed and fail with 409 if the profile changed in the meantime. The database
  also refuses approving an unconfirmed account; its message is shown as is.
- Authorities and app settings are written directly with the admin's session;
  RLS allows writes only for admins.
- `proxy.ts` sets a Content-Security-Policy per request (`lib/csp.ts`): scripts
  need a fresh nonce (`'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'`), so
  pages are rendered per request rather than prerendered. The Supabase origin is
  taken from `NEXT_PUBLIC_SUPABASE_URL` at build time — rebuild if it changes; it
  is allowed for API calls, realtime and Storage images.
- `next.config.ts` adds Strict-Transport-Security (production builds:
  `max-age=63072000; includeSubDomains`), X-Frame-Options, Referrer-Policy,
  X-Content-Type-Options and Permissions-Policy.
- The service role key is server-only; never commit it or prefix it with `NEXT_PUBLIC_`.

## Scripts

- `npm run dev` / `npm run build` / `npm start` (`npm start` honours `$PORT`)
- `npm run lint` – ESLint; `npm run typecheck` – TypeScript
- `npm run set:admin -- <email>` – promote an existing user to admin
- `npm run test:e2e` – Playwright end-to-end tests against a mocked Supabase (below)

## End-to-end tests

`e2e/` holds Playwright tests that drive a production build in Chromium. Supabase
is replaced by `e2e/mock-supabase.mjs`, a small in-memory GoTrue + PostgREST mock
(tables seeded with an approved admin, pending / unconfirmed / approved / blocked
users, reports for all 9 hazards plus a legacy `Floods` row and a verification
request, authorities, settings, alerts, knowledge articles and contacts). It
serves both the browser and the Next.js API routes (service role), rejects
columns that are not in the real schema, and records every request so tests can
assert request bodies.

```bash
npx playwright install chromium        # once, if no Chromium matching @playwright/test is installed
npm run test:e2e                       # next build + next start on :3100, mock on :54321, run all tests
E2E_SKIP_BUILD=1 npm run test:e2e      # reuse .next from a previous test:e2e build
npm run test:e2e -- users.spec.ts      # one file
```

- The build is made with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and
  dummy keys (`test`); it overwrites `.next`, so rebuild with your real
  environment before deploying from the same checkout.
- `PW_CHROMIUM_EXECUTABLE=/path/to/chrome` launches a specific Chromium binary;
  `PLAYWRIGHT_BROWSERS_PATH` is honoured as usual. `MOCK_SUPABASE_PORT` /
  `E2E_APP_PORT` change the ports.
- Every test fails on unexpected console errors, uncaught exceptions or CSP
  violations. Failure screenshots and traces go to `test-results/` (git-ignored).

## Related Projects

- [CRADI Mobile](https://github.com/KusuConsult-NG/CRADI-mobile) – Flutter mobile application, Supabase schema and Railway backend

---

**Built with** Next.js 16 • React • TypeScript • Supabase • Tailwind CSS • Railway
