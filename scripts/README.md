# CRADI Admin Scripts

## `set-admin.js`

Grants admin access to an existing Firebase Auth user in project `ewer-8f788`.

- Sets custom claims `{ role: 'admin', admin: true }` (other claims are preserved)
- Updates `users/{uid}` with `role: 'admin'` and `isApproved: true`

```bash
# with a key file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run set:admin -- admin@example.org

# or with the JSON in an env var
FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/set-admin.js admin@example.org
```

The user must sign out and back in for the new claims to apply. Never commit
service-account keys.
