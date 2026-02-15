# Email Verification Fix

## Problem
When approving users from the admin portal, they still show as "unverified" in Appwrite Console.

## Root Cause
There are **TWO separate verification systems**:

1. **Custom Fields** (in users collection document):
   - `verified` (boolean)
   - `isApproved` (boolean)
   - ✅ These WERE being updated correctly

2. **Appwrite's Built-in Email Verification** (in Auth system):
   - Separate from custom fields
   - Shown in Appwrite Console user details
   - ❌ This was NOT being updated

## Solution
Created a server-side API route to update Appwrite's built-in email verification status using the Users API.

### Files Changed

#### 1. Created `/app/api/users/verify-email/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Client, Users } from 'node-appwrite';

const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6941cdb400050e7249d5')
    .setKey(process.env.APPWRITE_API_KEY || '');

const users = new Users(client);

export async function POST(request: NextRequest) {
    const { userId } = await request.json();
    
    // Update Appwrite's built-in email verification status
    await users.updateEmailVerification(userId, true);
    
    return NextResponse.json({ success: true });
}
```

#### 2. Updated `handleApproveUser` in `/app/dashboard/users/page.tsx`
```typescript
async function handleApproveUser(userId: string) {
    // Update custom fields in database
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, userId, {
        isApproved: true,
        verified: true,
    });

    // Update Appwrite's built-in email verification status
    await fetch('/api/users/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
    });
}
```

## Production Deployment

### 1. Add API Key to Vercel

The API route requires `APPWRITE_API_KEY` environment variable.

**Steps:**
1. Go to https://vercel.com/kusuconsult-ngs-projects/cradi-mobile-admin/settings/environment-variables
2. Add new environment variable:
   - **Name**: `APPWRITE_API_KEY`
   - **Value**: `standard_363605f23a8f9643259352ca7f67a50813d5e7691a01d3648d86b39bc83162502ac8abe13aead2ead4c10a3f4abac303cc5dd7e69774862fb46a24811c0c8c96297ef862eedf43573b919c3d84a3c20539d63a6ea88db39cf56ebcfa16c1e35c492dc289adba74074ad878d6761272d43f9fcf0062b0393466942ba26be005f2`
   - **Environments**: Production, Preview, Development (select all)
3. Click "Save"
4. Redeploy the application (Vercel should auto-deploy from the git push)

### 2. Wait for Deployment
The code is already pushed to GitHub. Vercel should auto-deploy.

### 3. Test
1. Go to https://cradi-mobile-admin.vercel.app/dashboard/users
2. Click "Approve" on a user
3. Go to Appwrite Console → Auth → Users → Select the user
4. Verify that **"Email Verification"** shows as **"Verified"** (not "Unverified")

## What Happens Now

When you approve a user:
1. ✅ Custom `verified` field → `true`
2. ✅ Custom `isApproved` field → `true`
3. ✅ **Appwrite's built-in email verification status** → `true`
4. ✅ User shows as "Verified" in Appwrite Console
