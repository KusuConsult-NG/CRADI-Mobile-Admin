# CRADI Admin Setup Guide

## Prerequisites

- Node.js 20+ installed
- Appwrite Cloud account
- Access to CRADI Mobile Appwrite project

## 1. Install Dependencies

```bash
cd /Users/mac/cradi-admin
npm install
```

## 2. Configure Environment Variables

The `.env.local` file should already contain:

```env
NEXT_PUBLIC_APP_NAME=CRADI Admin Panel
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT=6941cdb400050e7249d5
NEXT_PUBLIC_DATABASE_ID=6941e2c2003705bb5a25
```

## 3. Set Up Database Permissions

### Get API Key

1. Go to [Appwrite Console](https://cloud.appwrite.io/console)
2. Select CRADI Mobile project
3. Navigate to **Overview** → **API Keys**
4. Create new API key with scopes:
   - `databases.read`
   - `databases.write`
   - `users.read`
   - `users.write`

### Run Permission Setup Script

```bash
cd /Users/mac/cradi-admin
APPWRITE_API_KEY=your_api_key npm run setup:permissions
```

This will configure permissions for all collections according to the defined rules.

### Verify Permissions

```bash
APPWRITE_API_KEY=your_api_key npm run check:permissions
```

## 4. Create Admin User

### Option A: Using Script (Recommended)

```bash
APPWRITE_API_KEY=your_api_key npm run create:admin
```

Follow the prompts to enter:
- Name
- Email
- Password (min 8 characters)

The script will:
- Create the user account
- Add `admin` label
- Mark email as verified

### Option B: Manual Creation

1. Go to Appwrite Console → Auth → Users
2. Click "Create User"
3. Enter email, password, and name
4. After creation, click the user to edit
5. Add label: `admin`
6. MarkEmail as verified

## 5. Start Admin Panel

```bash
npm run dev
```

Access at: http://localhost:3000

## 6. Login

Use the admin credentials created in step 4.

The admin panel will:
- ✅ Verify `admin` label on login
- ✅ Reject non-admin users
- ✅ Provide access to all admin features

## Troubleshooting

### "Access denied. Admin privileges required"

**Cause**: User account doesn't have the `admin` label.

**Solution**:
1. Go to Appwrite Console
2. Navigate to Auth → Users
3. Find the user account
4. Edit and add label: `admin`

### "Collection not found" in permission setup

**Cause**: Collection doesn't exist in the database yet.

**Solution**: 
- Collections are created by CRADI Mobile app
- Ensure CRADI Mobile has run at least once
- Or skip missing collections (script will continue)

### Permission script errors

**Cause**: Invalid or insufficient API key permissions.

**Solution**:
- Verify API key has `databases.write` and `users.write` scopes
- Create new API key with all required permissions

## Security Notes

> [!WARNING]
> **API Key Security**
> 
> - Never commit API keys to version control
> - Use environment variables for API keys
> - Revoke API keys when no longer needed

> [!IMPORTANT]
> **Admin Label Protection**
> 
> - Admin labels can only be set via Appwrite Console or Server SDK
> - Client applications (mobile app) cannot add admin labels
> - This prevents privilege escalation attacks

## Next Steps

After setup:
1. Test login with admin credentials
2. Verify dashboard loads with statistics
3. Test user management features
4. Test report verification workflow
5. Review walkthrough document for usage guide
