# CRADI Admin Panel

> **Web-based administration panel for CRADI / EWER Mobile**
> Climate Risk & Disaster Intelligence Management

## Overview

A Next.js app for administrators of the CRADI Mobile ecosystem. It uses the same
Appwrite project as the Flutter app: Appwrite Account for sign-in and Appwrite
TablesDB for data (`profiles`, `reports`, `knowledge_base`, `alerts`,
`contacts`, `authorities`, `app_settings`). It is hosted on Railway.

Reads go straight to the database with the admin's session; **every write goes
through the `write` Appwrite Function**, because the collections are closed to
clients (the same rule that stops a reporter approving their own report stops
this panel writing a row directly). The Function re-checks the caller's role
from their profile, so the panel's own admin guard is a convenience, not the
enforcement.

The schema and the Functions live in the mobile repo, under
`CRADI-mobile/infra/appwrite/` (`plan.mjs` provisions tables, buckets,
permissions and Functions; `columns.json` is the extracted column list) and
`CRADI-mobile/functions/cradi/`. The migration itself is written up in
`CRADI-mobile/docs/APPWRITE-MIGRATION.md`; first-time deployment of the whole
system: `CRADI-mobile/docs/DEPLOYMENT.md`.

## Features

- **Dashboard**: counts of users, reports (pending / approved + verified), contacts, knowledge articles and active alerts
- **User management**: search, filter, paginate; approve, revoke approval, change role, change location (state / LGA / ward from the INEC list), block/unblock, delete (Auth account + profile)
- **Report management**: filter by status and hazard (legacy spellings included), search, paginate; set approved / verified / rejected / pending; view images; canonical hazard names and a "Verification request" badge
- **Knowledge base**: create, edit and delete hazard guides
- **Community alerts**: publish alerts (title, message, severity, target state and LGA picked from the location list) — the backend pushes them to app users — and deactivate them. The state is required whenever an LGA is chosen: six LGA names belong to two states each (Obi is in both Benue and Nasarawa), so the LGA picker stays disabled until a state is picked, and the `write` Function rejects an LGA with no state (`assertTarget`)
- **Authorities**: manage the SMS contacts texted when a report in their LGA is approved (name, organisation, phone normalised to `+234XXXXXXXXXX`, coverage state **and** LGA chosen together from the fixed list — LGA names such as Obi exist in two states, so the state is required and the `write` Function rejects a contact without one (`assertCoverage`)); search / filter by (state, LGA); a panel lists the (state, LGA) pairs with no contact
- **App settings**: edit the live `app_settings` keys (peer confirmations, escalation timeout, SMS caps, peer chat flag, minimum app version + message) with typed validation; other keys are ignored. `app_settings.value` is a string column, so a number or flag is stored as its text (`"45"`, `"false"`) — which is what the backend and the mobile app parse
- **Admin-only access**: the signed-in user's profile must have `role = 'admin'`, `isApproved = true` and `isDisabled = false`

## Quick Start

Prerequisites: Node.js 22+, an Appwrite project provisioned with the CRADI
schema (`CRADI-mobile/infra/appwrite/plan.mjs`).

```bash
npm install
cp .env.example .env.local   # fill in the Appwrite values (see SETUP.md)
npm run dev                  # http://localhost:3000
```

If the public Appwrite variables are missing — or the endpoint does not end in
`/v1` — the app shows a configuration error screen naming what is wrong,
instead of the login page.

See [SETUP.md](./SETUP.md) for granting admin access and deploying to Railway.

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | client + server (build time) | Appwrite REST base, including `/v1`; also the origin in the CSP (`lib/csp.ts`) |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | client (build time) | Project id; public, access enforced by permissions |
| `NEXT_PUBLIC_APPWRITE_DATABASE_ID` | client (build time) | Optional; defaults to `cradi` |
| `NEXT_PUBLIC_APPWRITE_FN_CLIENT` | client (build time) | Optional; defaults to `client`, the merged Function the panel calls |
| `NEXT_PUBLIC_APPWRITE_REPORT_IMAGES_BUCKET` | client (build time) | Optional; defaults to `report-images`. Only for a one-bucket tier, where it must match the Flutter client's `REPORT_IMAGES_BUCKET` define |
| `APPWRITE_API_KEY` | server only (runtime) | Used by `/api/admin/*` routes and `scripts/set-admin.mjs`. Bypasses every permission — never prefix it with `NEXT_PUBLIC_` |
| `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_DATABASE_ID` | server only (runtime) | Optional overrides; each falls back to the `NEXT_PUBLIC_` value |

The `NEXT_PUBLIC_*` values are inlined into the compiled bundle by
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
├── appwrite.ts                     # Browser client (session cookie) + image URLs
├── appwrite-server.ts              # Server-only API-key clients + JWT admin check
├── data.ts                         # Reads (TablesDB) and writes (the `write` Function)
├── function-call.ts                # Function execution → JSON, refusals → BackendError
├── constants.ts                    # Tables, roles, statuses, hazards, helpers
├── lgas.ts / wards.ts              # LGA + ward lists (wards.ts generated from the mobile app's mvp_locations_data.dart)
├── phone.ts                        # Nigerian phone normalisation (same rules as the backend SMS sender)
├── admin-api.ts                    # Authenticated fetch helper
└── auth-context.tsx                # Auth provider with admin-profile check
scripts/
└── set-admin.mjs                   # Promote a user to approved admin
e2e/
├── playwright.config.ts            # Starts the mock + a production build, runs *.spec.ts
├── mock-appwrite.mjs               # In-memory Appwrite mock (account, TablesDB, Functions, Storage)
├── fixtures.ts                     # Mock reset/request log, console/CSP guard, login helper
└── *.spec.ts                       # Auth, dashboard, users, reports, authorities, settings, knowledge, alerts
railway.json                        # Railway build/deploy config
```

## Security

- Reads go directly to Appwrite with the user's session and are enforced by the
  collections' permissions (`profiles` and `reports` are `read("label:admin")`;
  the rest are `read("any")`).
- Every write goes through the `write` Appwrite Function, which re-checks the
  caller's role, approval and disabled flag from their profile and refuses
  fields the caller may not set. The collections themselves grant no client
  writes, so a tampered panel cannot write a row the Function would refuse.
- User administration (approve / revoke, block, role, location, delete) goes through
  `/api/admin/users/[uid]`, which verifies the caller's Appwrite JWT, re-checks
  the caller's profile, then uses the API key. Admins cannot block,
  demote, revoke or delete themselves.
- Approval never confirms an email: it is refused (409) until the user has
  confirmed their email or phone, and the users list shows an "Email not
  confirmed" badge (from `POST /api/admin/users/confirmation`). Approve and role
  changes (and revoke / location changes) send the role / LGA / ward the admin
  reviewed and fail with 409 if the profile changed in the meantime. The database
  also refuses approving an unconfirmed account; its message is shown as is.
- Authorities and app settings go through the same `write` Function, which
  allows those collections only for admins.
- `proxy.ts` sets a Content-Security-Policy per request (`lib/csp.ts`): scripts
  need a fresh nonce (`'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'`), so
  pages are rendered per request rather than prerendered. The Appwrite origin is
  taken from `NEXT_PUBLIC_APPWRITE_ENDPOINT` at build time — rebuild if it
  changes; it is allowed for API calls, realtime (`wss://`) and Storage images.
- `next.config.ts` adds Strict-Transport-Security (production builds:
  `max-age=63072000; includeSubDomains`), X-Frame-Options, Referrer-Policy,
  X-Content-Type-Options and Permissions-Policy.
- The Appwrite API key is server-only; never commit it or prefix it with `NEXT_PUBLIC_`.

## Scripts

- `npm run dev` / `npm run build` / `npm start` (`npm start` honours `$PORT`)
- `npm run lint` – ESLint; `npm run typecheck` – TypeScript
- `npm run set:admin -- <email>` – promote an existing user to admin
- `npm run test:e2e` – Playwright end-to-end tests against a mocked Appwrite (below)
- `npm run test:e2e:live` – the same browser, against a **real** Appwrite (below)

## End-to-end tests

`e2e/` holds Playwright tests that drive a production build in Chromium. Appwrite
is replaced by `e2e/mock-appwrite.mjs`, a small in-memory Account + TablesDB +
Functions + Storage mock (tables seeded with an approved admin, pending /
unconfirmed / approved / blocked users, reports for all 9 hazards plus a legacy
`Floods` row and a verification request, authorities, settings, alerts,
knowledge articles and contacts). It serves both the browser and the Next.js API
routes (API key), rejects columns that are not in the real schema and values
missing a required one, and records every request so tests can assert request
bodies.

What it deliberately does *not* re-implement is the `write` Function's
authorisation: those rules live in the Function and are tested there
(`CRADI-mobile/functions/cradi/test`, plus four end-to-end suites against a real
Appwrite). Duplicating them here would make a second source of truth that
drifts, and the drift would show up as tests that pass while the product is
broken.

```bash
npx playwright install chromium        # once, if no Chromium matching @playwright/test is installed
npm run test:e2e                       # next build + next start on :3100, mock on :54321, run all tests
E2E_SKIP_BUILD=1 npm run test:e2e      # reuse .next from a previous test:e2e build
npm run test:e2e -- users.spec.ts      # one file
```

- The build is made with `NEXT_PUBLIC_APPWRITE_ENDPOINT=http://127.0.0.1:54321/v1`
  and a dummy API key (`test`); it overwrites `.next`, so rebuild with your real
  environment before deploying from the same checkout.
- `PW_CHROMIUM_EXECUTABLE=/path/to/chrome` launches a specific Chromium binary;
  `PLAYWRIGHT_BROWSERS_PATH` is honoured as usual. `MOCK_APPWRITE_PORT` /
  `E2E_APP_PORT` change the ports.
- Every test fails on unexpected console errors, uncaught exceptions or CSP
  violations. Failure screenshots and traces go to `test-results/` (git-ignored).

## Against a real Appwrite

The mock answers the *shape* of Appwrite. It deliberately implements
neither document permissions nor the `write` Function's authorisation,
so everything that lives in that gap is unverified until something
drives the real server. `e2e/live.spec.ts` does, in the same browser:

```bash
# in the CRADI-mobile checkout, bring a real Appwrite up first:
#   ./infra/appwrite/local/up.sh && node infra/appwrite/local/bootstrap.mjs
#   source infra/appwrite/local/.env.local
#   node infra/appwrite/provision.mjs && node infra/appwrite/local/deploy.mjs
source ../CRADI-mobile/infra/appwrite/local/.env.local
npm run test:e2e:live:seed          # creates this run's admin, users and reports
NEXT_PUBLIC_APPWRITE_ENDPOINT=$APPWRITE_ENDPOINT NEXT_PUBLIC_APPWRITE_PROJECT_ID=$APPWRITE_PROJECT_ID npm run build && npm start -- -p 3100 &
npm run test:e2e:live
```

It signs in through the form and then checks the server, with the API
key, for what the panel actually wrote: the `write` Function's stamps
and refusals, the optimistic lock, the `operation` Function, the string
`app_settings.value`, and the account labels an approval has to carry.
The seeder only adds rows — pointed at a real server, a seeder that
clears tables is one typo from clearing the wrong ones.

`npm run test:e2e:live:clean` removes the seeded rows afterwards, by id
rather than by prefix — run it after a Cloud run. The panel's own writes
during the run (an alert, an article, a link, an authority) are not
seeded rows and are left alone; the script prints the stamp they carry.

The project needs a **web platform** registered for the panel's hostname
(`localhost` locally, the real domain in production), or Appwrite refuses
every request from the browser as an unknown origin.

Against **Cloud** rather than the local stack, follow
`CRADI-mobile/docs/CLOUD-VERIFICATION.md`: same two commands, plus the
steps that must come first and the three questions only Cloud answers.

### How the session is held

Appwrite and the panel are different sites — `appwrite.local` and
`localhost` here, Cloud and the panel's domain in production — so the
session cookie is third-party and the browser drops it. The Web SDK
falls back to `localStorage.cookieFallback` and an `X-Fallback-Cookies`
header, and that is what carries every authenticated call. Measured:
after signing in, the browser holds **no cookies at all**.

Two consequences worth knowing before launch:

- The session is readable by any script on the panel's origin, where an
  HttpOnly cookie would not be. That is why `lib/csp.ts` allows no
  inline script and no `unsafe-eval` in production — the CSP is the
  thing standing between an injected script and an admin session.
- Serving Appwrite from the same site as the panel (a custom domain such
  as `api.example.org` beside `admin.example.org`) would make the cookie
  first-party again, and HttpOnly. Worth doing if the domain is
  available.

## Related Projects

- [CRADI Mobile](https://github.com/KusuConsult-NG/CRADI-mobile) – Flutter mobile application, Appwrite schema (`infra/appwrite/`) and Appwrite Functions (`functions/cradi/`)

---

**Built with** Next.js 16 • React • TypeScript • Appwrite • Tailwind CSS • Railway
