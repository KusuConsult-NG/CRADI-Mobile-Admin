# CRADI Admin Panel

> **Web-based administration panel for CRADI / EWER Mobile**
> Climate Risk & Disaster Intelligence Management

## Overview

A Next.js app for administrators of the CRADI Mobile ecosystem. It uses the same
Firebase project as the Flutter app (`ewer-8f788`): Firebase Auth for sign-in and
Cloud Firestore for data (`users`, `reports`, `knowledge_base`, `contacts`).

## Features

- **Dashboard**: live counts of users, reports (pending / approved + verified), contacts and knowledge articles
- **User management**: approve, change role, block/unblock, delete (Auth account + profile)
- **Report management**: filter by status, set approved / verified / rejected / pending, view images
- **Knowledge base**: create, edit and delete hazard guides
- **Admin-only access**: requires the Firebase custom claim `admin: true` or `role: 'admin'`

## Quick Start

Prerequisites: Node.js 22+, access to the `ewer-8f788` Firebase project.

```bash
npm install
cp .env.example .env.local   # add FIREBASE_SERVICE_ACCOUNT (see SETUP.md)
npm run dev                  # http://localhost:3000
```

The public Firebase web config is built into `lib/firebase.ts` (overridable with
`NEXT_PUBLIC_FIREBASE_*` variables). Server credentials are only needed for the
`/api/admin/*` routes (email verification, block, delete, role changes).

See [SETUP.md](./SETUP.md) for granting admin access and deployment.

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` | client | Optional overrides of the web config |
| `FIREBASE_SERVICE_ACCOUNT` | server | Service-account JSON for firebase-admin |
| `GOOGLE_APPLICATION_CREDENTIALS` | server | Alternative: path to a service-account key file |

## Project Structure

```
app/
├── api/admin/users/[uid]/route.ts  # Admin-only Auth operations (firebase-admin)
├── dashboard/                      # Dashboard, users, reports, knowledge
└── login/                          # Sign-in
lib/
├── firebase.ts                     # Client SDK init + shared constants
├── firebase-admin.ts               # Server SDK init + admin token verification
├── admin-api.ts                    # Authenticated fetch helper
└── auth-context.tsx                # Auth provider with admin-claim check
scripts/
└── set-admin.js                    # Grant admin claims to a user
```

## Security

- Admin access is enforced by Firebase custom claims, checked in the UI, in the
  Firestore security rules, and on every API route (`verifyIdToken` + admin claim).
- Service-account credentials are server-only; never commit them.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` – ESLint
- `npm run set:admin -- <email>` – grant admin to an existing user

## Related Projects

- [CRADI Mobile](https://github.com/KusuConsult-NG/CRADI-mobile) – Flutter mobile application

---

**Built with** Next.js 16 • React • TypeScript • Firebase • Tailwind CSS
