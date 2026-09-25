# CRADI Admin Scripts

## `set-admin.mjs`

Promotes an existing Supabase user to an approved admin.

- Looks up the user by email (`profiles.email`, falling back to `auth.admin.listUsers`)
- Updates the `profiles` row: `role = 'admin'`, `is_approved = true`, `is_disabled = false`
- Clears any Auth ban so the account can sign in

Requires `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`.

```bash
node --env-file=.env.local scripts/set-admin.mjs admin@example.org

# or with the variables exported in the shell
npm run set:admin -- admin@example.org
```

The service role key bypasses Row Level Security: run this only from a trusted
machine and never commit the key.
