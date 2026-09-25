# CRADI Admin Setup Guide

## Prerequisites

- Node.js 22+
- Access to the Firebase project `ewer-8f788` (the one used by CRADI Mobile)

## 1. Install

```bash
npm install
```

## 2. Server credentials (for admin API routes)

Approving (email verification), blocking, deleting users and changing roles use
`firebase-admin` in Next.js API routes. Provide a service account:

1. Firebase Console → Project settings → **Service accounts** → *Generate new private key*.
2. Put the JSON (as a single line) in `.env.local` / your hosting provider:

   ```env
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"ewer-8f788",...}
   ```

   or set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`.

Without credentials the dashboard, report and knowledge pages still work, but the
API routes return `500 Server not configured`.

> Never commit service-account keys. Rotate any key that has been exposed.

## 3. Grant admin access

The user must already exist in Firebase Auth (e.g. registered via the mobile app).

```bash
GOOGLE_APPLICATION_CREDENTIALS=./key.json npm run set:admin -- admin@example.org
```

This sets custom claims `{ role: 'admin', admin: true }` and updates
`users/{uid}` with `role: 'admin'`, `isApproved: true`. The user must sign out and
back in for the new claims to take effect.

## 4. Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the admin account.

## Deployment (Vercel)

1. Import the repository.
2. Add `FIREBASE_SERVICE_ACCOUNT` as an environment variable.
3. Add the deployed domain under Firebase Console → Authentication → Settings → **Authorized domains**.

## Troubleshooting

- **"Access denied. This account does not have admin privileges."** – run `set:admin`
  for that email, then sign in again.
- **Permission denied reading data** – the Firestore rules check the ID-token claims;
  make sure the account has `role: 'admin'` in its claims (set by `set:admin`).
- **"Server not configured"** – set `FIREBASE_SERVICE_ACCOUNT` or `GOOGLE_APPLICATION_CREDENTIALS`.
