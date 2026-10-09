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

## Deployment (Appwrite Sites)

The panel needs a Node runtime, not static hosting: `app/api/admin/*` and
`app/api/health` are server routes, `proxy.ts` is middleware, and
`APPWRITE_API_KEY` must never reach the browser.

Appwrite Sites detects the framework as `nextjs` from `package.json` and
`next.config.ts` on its own. **Detection does not set the adapter**, and the
adapter is what decides whether your app runs. Every route in this app builds
as `ƒ` — dynamic, server-rendered on demand — and there is no statically
exportable page, not even `/`:

```
Route (app)
┌ ƒ /                              ├ ƒ /dashboard/knowledge
├ ƒ /_not-found                    ├ ƒ /dashboard/news
├ ƒ /api/admin/users/[uid]         ├ ƒ /dashboard/reports
├ ƒ /api/admin/users/confirmation  ├ ƒ /dashboard/settings
├ ƒ /api/health                    ├ ƒ /dashboard/users
├ ƒ /dashboard                     ├ ƒ /login
├ ƒ /dashboard/alerts              └ ƒ /reset-password
├ ƒ /dashboard/authorities
ƒ Proxy (Middleware)
```

So **`adapter` must be `ssr`**. Under `adapter: static` Appwrite serves
`./.next` as a folder of files, finds no `index.html`, and returns its own 404
on every path — with a green build, all 15 routes compiled, and correct
variables. That was the state of this site for most of a day.

1. Appwrite console → **Sites** → create a site from this repository
   (`KusuConsult-NG/CRADI-Mobile-Admin`), framework **Next.js**, branch `main`,
   root directory = repository root.
2. Build settings, all confirmed working: adapter **SSR**, install command
   `npm install`, build command `npm run build`, output directory `./.next`,
   build runtime `node-22`. Leave `next.config.ts` alone — this app does not
   set `output`, and the default (non-standalone) mode is what `./.next` plus
   the SSR adapter expects.
3. Add the three variables **before the first build**:

   | variable | value |
   | --- | --- |
   | `NEXT_PUBLIC_APPWRITE_ENDPOINT` | `https://fra.cloud.appwrite.io/v1` |
   | `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | the project id |
   | `APPWRITE_API_KEY` | server key, marked secret |

   `next build` inlines every `NEXT_PUBLIC_*` value into the client bundle, so
   one set afterwards changes nothing until the site is rebuilt. This is not
   hypothetical: the Railway deployment served a "Configuration required"
   screen for exactly this reason. `APPWRITE_API_KEY` must keep its
   server-only name — prefixing it `NEXT_PUBLIC_` would publish a key that
   bypasses every permission.

   Set and read these **in the console**. `appwrite sites list-variables`
   prints every value in full, the API key included; the `secret: [hidden]`
   line in its output is decoration, not redaction.
4. Add the site's domain as a **Web platform** in the same Appwrite project, or
   every request from the browser is refused by CORS. The server side works
   regardless, so a missing platform shows up as a network error on sign-in
   rather than "invalid credentials".
5. Verify by opening the site and signing in — not by the healthcheck.
   `GET /api/health` returns `{"ok": true}` unconditionally, so it passes while
   the app is completely misconfigured. It is still the fastest way to tell an
   SSR site that is running from a static one that is only serving files.
6. Only once sign-in works, decommission Railway: delete the service, then
   remove its domain from the Appwrite project's Web platforms. A stale,
   misconfigured admin panel left on a public URL is worse than none. Keep
   `railway.json` in the repo until then — it is the way back if the move
   stalls.

### Redeploying from the CLI

Two traps, both hit in practice:

`appwrite sites update` is a **full replace**. Omitting the VCS flags clears
the GitHub connection, and the next deployment fails with "Installation with
the requested ID could not be found". Read the current values out of
`appwrite sites get` first and pass all four back:

```sh
appwrite sites update --site-id "$SITE" --name 'CRADI-Mobile-Admin' \
  --framework nextjs --adapter ssr \
  --install-command 'npm install' --build-command 'npm run build' \
  --output-directory './.next' --build-runtime node-22 \
  --installation-id "$INSTALLATION_ID" --provider-repository-id "$REPO_ID" \
  --provider-branch main --provider-root-directory './'
```

Deploy **from the repository**, never by uploading the working tree:

```sh
appwrite sites create-vcs-deployment --site-id "$SITE" \
  --type branch --reference main --activate true
```

A manual deployment ships `node_modules` as source and reports
`buildDuration: 0` — nothing compiles, no `NEXT_PUBLIC_*` is inlined, and it
still reads `status: ready`. Two of those sat active during the cutover looking
healthy.

To tell a real build from an empty one, check the deployment rather than the
site:

```sh
appwrite sites get-deployment --site-id "$SITE" --deployment-id "$DEPLOYMENT"
```

- `buildSize` non-zero (~245 MB here); `0` means nothing was produced.
- `buildDuration` in tens of seconds (~88s here), never `0`.
- `Bundling for SSR started` / `finished` in the logs. This line is absent
  under the static adapter and is the clearest proof the adapter took effect.
- `Edge distribution finished successfully (6/6)`. A partial count such as
  `(1/6)` is a symptom of distributing a large wrong payload, not an Appwrite
  fault — check the adapter before reporting it upstream.
- `live` is derived, not settable: it reads `false` whenever the active
  deployment is not servable under the current adapter.

## Deployment (Railway — the previous host)

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
- **Every path 404s, including `/`** – the Site's `adapter` is `static`. Every
  route in this app is server-rendered on demand, so there are no files to
  serve and Appwrite's router answers all of them. The build is green and the
  variables are irrelevant to it. `curl .../api/health` returning a 404 rather
  than `{"ok": true}` confirms no Node server is running. Set the adapter to
  `ssr` and redeploy — see "Redeploying from the CLI" above, and pass the VCS
  flags in the same call.
- **"Configuration required" screen instead of the login page** – the
  `NEXT_PUBLIC_*` variables were missing, or the endpoint did not end in
  `/v1`, when the bundle was built. Set them and **rebuild**. On Railway a
  restart re-uses the same bundle and changes nothing; on Appwrite Sites
  trigger a new deployment. Setting the variables is never enough on its own,
  on either host.
- **Every request fails with a CORS error** – the origin is not registered as
  a Web platform in the Appwrite project.
- **A write fails with "Your role does not allow…"** – the `write` Function
  re-checks the caller's profile; the panel's own guard is a convenience, not
  the enforcement. Check `role`, `isApproved` and `isDisabled` on the row.
- **"Server is not configured for admin actions."** – set `APPWRITE_API_KEY`.
