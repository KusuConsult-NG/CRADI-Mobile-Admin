# CRADI Admin Setup Guide

## Prerequisites

- Node.js 22+
- A Supabase project with the CRADI schema applied
  (`CRADI-mobile/supabase/deploy/schema.sql`, or the migrations under
  `CRADI-mobile/supabase/migrations/`)

For a first-time deployment of the whole system, follow
`CRADI-mobile/docs/DEPLOYMENT.md`; this file covers the admin panel alone.

## 1. Install

```bash
npm install
```

## 2. Configure Supabase

From Supabase → **Project Settings → API**, copy the values into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # server only, never commit
```

Without the two `NEXT_PUBLIC_*` values the app shows a configuration error screen.
Without `SUPABASE_SERVICE_ROLE_KEY` the pages still load, but approve / block /
role change / delete return `500 Server is not configured for admin actions.`

In Supabase → **Authentication → Providers**, make sure Email sign-in is enabled.

## 3. Grant admin access

The user must already exist in Supabase Auth (signed up in the mobile app, or
created under Authentication → Users). Then:

```bash
node --env-file=.env.local scripts/set-admin.mjs admin@example.org
# or, with the variables exported in your shell:
npm run set:admin -- admin@example.org
```

This sets `role = 'admin'`, `is_approved = true`, `is_disabled = false` on the
user's `profiles` row (and clears any ban). Sign in with that account.
The script refuses accounts whose email (or phone) has not been confirmed.

## 4. Run locally

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the admin account.

## Deployment (Railway)

`railway.json` configures the service: Nixpacks builder, `npm run build`,
`npm start` (listens on Railway's `$PORT`), healthcheck `GET /api/health`.

1. Create a Railway service from this repository
   (`KusuConsult-NG/CRADI-Mobile-Admin`), branch `supabase-migration`, root
   directory = repository root.
2. Add the variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY` **before the first deploy**. The
   `NEXT_PUBLIC_*` values are inlined into the bundle at build time, so setting
   or changing them later does nothing until you trigger a new deploy — a
   restart re-uses the same bundle. Note that `GET /api/health` returns
   `{"ok": true}` unconditionally, so the Railway healthcheck passes even when
   the app is misconfigured; verify by opening the site and signing in.
3. Generate a public domain under the service's **Networking** settings.
4. Optionally add that domain to Supabase → Authentication → URL Configuration
   (only needed for auth emails / redirects; password sign-in works without it).

## Troubleshooting

- **"Access denied. This account is not an approved, active administrator."** –
  run `set:admin` for that email (or set `role`, `is_approved`, `is_disabled`
  in the `profiles` table), then sign in again.
- **"This account has been disabled."** – the Auth user is banned (blocked in the
  panel); unblock it from another admin account or rerun `set:admin`.
- **Empty lists / failed counts** – RLS only returns data to approved admins;
  check the profile row, and that the migration has been applied.
- **"Configuration required" screen instead of the login page** – the
  `NEXT_PUBLIC_*` variables were missing when the bundle was built. Set them and
  redeploy (not restart). If only the URL is wrong, the Content-Security-Policy
  built from it (`lib/csp.ts`) blocks every request to Supabase and sign-in
  fails with no visible error — check the browser console.
- **"Server is not configured for admin actions."** – set `SUPABASE_SERVICE_ROLE_KEY`.
