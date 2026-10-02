# CRADI Admin Setup Guide

## Prerequisites

- Node.js 22+
- An Appwrite project with the CRADI schema provisioned
  (`CRADI-mobile/infra/appwrite/plan.mjs` creates the tables, columns,
  indexes, buckets, permissions and Functions; `columns.json` beside it is
  the extracted column list it works from)

For a first-time deployment of the whole system, follow
`CRADI-mobile/docs/DEPLOYMENT.md`; this file covers the admin panel alone.
The migration from Supabase is written up in
`CRADI-mobile/docs/APPWRITE-MIGRATION.md`.

## 1. Install

```bash
npm install
```

## 2. Configure Appwrite

From the Appwrite console, copy the project's API endpoint and ID into
`.env.local`, and create an API key under **Overview → Integrations → API
keys**:

```env
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=<project id>
NEXT_PUBLIC_APPWRITE_DATABASE_ID=cradi        # optional; this is the default
APPWRITE_API_KEY=<api key>                    # server only, never commit
```

The endpoint **must end in `/v1`** — it is Appwrite's REST base, and without
it every call 404s against the console's HTML. The panel refuses to start
with a clear message rather than white-screening, but it still will not work.

The API key needs `users.read`, `users.write`, `tables.read` and
`tables.write` (named `documents.read` / `documents.write` on older servers).

Without the two `NEXT_PUBLIC_*` values the app shows a configuration error
screen. Without `APPWRITE_API_KEY` the pages still load, but approve / block /
role change / delete return `500 Server is not configured for admin actions.`

Add the panel's origin as a **Web platform** in the Appwrite project's
settings (`localhost` for development, the Railway domain in production).
Appwrite refuses browser requests from an origin it does not know, and the
failure reads as a CORS error rather than as a misconfiguration.

Make sure Email/Password is enabled under **Auth → Settings**.

## 3. Grant admin access

The user must already exist in Appwrite (signed up in the mobile app, or
created under **Auth → Users**). Then:

```bash
node --env-file=.env.local scripts/set-admin.mjs admin@example.org
# or, with the variables exported in your shell:
npm run set:admin -- admin@example.org
```

This sets `role = 'admin'`, `isApproved = true`, `isDisabled = false` on the
user's `profiles` row (and re-enables a blocked account). Sign in with that
account. The script refuses an account whose email (or phone) has not been
confirmed, and refuses to guess when more than one account has that address.

> The `admin` **label** on the Appwrite account is what grants read access to
> `profiles` and `reports` (`read("label:admin")`); the `write` Function sets
> it from the profile row. If an admin can sign in but every list is empty,
> the label is missing — re-save their role through the panel, or add the
> label under **Auth → Users → the user → Labels**.

## 4. Run locally

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the admin account.

## Deployment (Railway)

`railway.json` configures the service: Nixpacks builder, `npm run build`,
`npm start` (listens on Railway's `$PORT`), healthcheck `GET /api/health`.

1. Create a Railway service from this repository
   (`KusuConsult-NG/CRADI-Mobile-Admin`), root directory = repository root.
2. Add `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID` and
   `APPWRITE_API_KEY` **before the first deploy**. The `NEXT_PUBLIC_*` values
   are inlined into the bundle at build time, so setting or changing them
   later does nothing until you trigger a new deploy — a restart re-uses the
   same bundle. Note that `GET /api/health` returns `{"ok": true}`
   unconditionally, so the Railway healthcheck passes even when the app is
   misconfigured; verify by opening the site and signing in.
3. Generate a public domain under the service's **Networking** settings.
4. Add that domain as a Web platform in the Appwrite project (step 2), or
   every request from it is refused by CORS.

## Troubleshooting

- **"Access denied. This account is not an approved, active administrator."** –
  run `set:admin` for that email (or set `role`, `isApproved`, `isDisabled`
  in the `profiles` table), then sign in again.
- **"This account has been disabled."** – the Appwrite account is blocked
  (blocked in the panel); unblock it from another admin account or rerun
  `set:admin`.
- **Empty lists / failed counts** – `profiles` and `reports` are readable only
  with the `admin` label on the account (see step 3), and the rest of the
  data needs the schema to have been provisioned.
- **"Configuration required" screen instead of the login page** – the
  `NEXT_PUBLIC_*` variables were missing, or the endpoint did not end in
  `/v1`, when the bundle was built. Set them and redeploy (not restart).
- **Every request fails with a CORS error** – the origin is not registered as
  a Web platform in the Appwrite project.
- **A write fails with "Your role does not allow…"** – the `write` Function
  re-checks the caller's profile; the panel's own guard is a convenience, not
  the enforcement. Check `role`, `isApproved` and `isDisabled` on the row.
- **"Server is not configured for admin actions."** – set `APPWRITE_API_KEY`.
