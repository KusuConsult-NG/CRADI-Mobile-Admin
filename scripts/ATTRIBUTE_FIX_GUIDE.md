# Fix Missing Database Attributes

## Problem
Admin portal shows error: `Invalid document structure: Unknown attribute: "isApproved"`

## Solution
Run the automated script to add missing attributes.

## Steps

### 1. Create API Key in Appwrite Console

1. Open https://cloud.appwrite.io/console/project-fra-6941cdb400050e7249d5/overview/keys
2. Click "Create API Key"
3. Name: `Database Schema Manager`
4. Scopes: Select `databases.*` (or select all for simplicity)
5. Expiration: Set to 1 hour (this is a one-time operation)
6. Click "Create"
7. **Copy the API key immediately** (it won't be shown again)

### 2. Run the Script

```bash
cd /Users/mac/cradi-admin

# Set your API key (replace YOUR_API_KEY with the key you copied)
export APPWRITE_API_KEY="YOUR_API_KEY"

# Run the script
node scripts/add-missing-attributes.js
```

### 3. Verify Success

You should see output like:
```
✅ Successfully created attribute: isApproved
✅ Successfully created attribute: isBlocked
✨ Script completed!
```

### 4. Test Admin Portal

1. Go to https://cradi-mobile-admin.vercel.app/dashboard/users
2. Click "Approve" on a user
3. Verify no errors appear
4. Check that toast notification shows "User approved successfully!"

## What the Script Does

- Adds `isApproved` (boolean, default: false)
- Adds `isBlocked` (boolean, default: false)
- Skips if attributes already exist
- Handles errors gracefully
