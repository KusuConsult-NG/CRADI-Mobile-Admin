# CRADI Admin Panel

> **Web-based administration panel for CRADI / EWER Mobile**
> Climate Risk & Disaster Intelligence Management

## Overview

A Next.js app for administrators of the CRADI Mobile ecosystem. It uses the same
Supabase project as the Flutter app: Supabase Auth for sign-in and Postgres (with
Row Level Security) for data (`profiles`, `reports`, `knowledge_base`, `alerts`,
`contacts`, `authorities`, `app_settings`). It is hosted on Railway.

The database schema lives in the mobile repo:
`CRADI-mobile/supabase/migrations/20260925000000_init.sql`.

## Features

- **Dashboard**: counts of users, reports (pending / approved + verified), contacts, knowledge articles and active alerts
- **User management**: search, filter, paginate; approve, revoke approval, change role, change location (state / LGA / ward from the INEC list), block/unblock, delete (Auth account + profile)
- **Report management**: filter by status and hazard (legacy spellings included), search, paginate; set approved / verified / rejected / pending; view images; canonical hazard names and a "Verification request" badge
- **Knowledge base**: create, edit and delete hazard guides
- **Community alerts**: publish alerts (title, message, severity, target LGA) — the backend pushes them to app users — and deactivate them
- **Authorities**: manage the SMS contacts texted when a report in their LGA is approved (name, organisation, phone normalised to `+234XXXXXXXXXX`, coverage LGA from the fixed list); search / filter by LGA; a panel lists LGAs with no contact
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
| `NEXT_PUBLIC_SUPABASE_URL` | client + server (build time) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client (build time) | Public anon key; access enforced by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Used by `/api/admin/*` routes and `scripts/set-admin.mjs` |

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
- `next.config.ts` sets a Content-Security-Policy (Supabase origin taken from
  `NEXT_PUBLIC_SUPABASE_URL` at build time — rebuild if it changes) plus
  X-Frame-Options, Referrer-Policy, X-Content-Type-Options and Permissions-Policy.
- The service role key is server-only; never commit it or prefix it with `NEXT_PUBLIC_`.

## Scripts

- `npm run dev` / `npm run build` / `npm start` (`npm start` honours `$PORT`)
- `npm run lint` – ESLint; `npm run typecheck` – TypeScript
- `npm run set:admin -- <email>` – promote an existing user to admin

## Related Projects

- [CRADI Mobile](https://github.com/KusuConsult-NG/CRADI-mobile) – Flutter mobile application, Supabase schema and Railway backend

---

**Built with** Next.js 16 • React • TypeScript • Supabase • Tailwind CSS • Railway
