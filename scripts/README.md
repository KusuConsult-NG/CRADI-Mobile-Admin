# CRADI Admin Scripts

This directory contains utility scripts for managing the CRADI Admin Panel's database permissions and admin users.

## Scripts Overview

### 1. `setup-permissions.js`
**Purpose**: Configure Appwrite collection permissions with role-based access control.

**What it does**:
- Sets read/write/update/delete permissions for all CRADI collections
- Implements admin-only restrictions for sensitive operations
- Uses Appwrite's label system for admin users

**Usage**:
```bash
APPWRITE_API_KEY=your_api_key npm run setup:permissions
```

**Requirements**:
- Appwrite API Key with `databases.read` and `databases.write` scopes

---

### 2. `create-admin.js`
**Purpose**: Create admin users with proper labels and permissions.

**What it does**:
- Prompts for admin user details (name, email, password)
- Creates user account in Appwrite
- Adds `admin` label to user
- Marks email as verified

**Usage**:
```bash
APPWRITE_API_KEY=your_api_key npm run create:admin
```

**Interactive Prompts**:
- Name: Admin's full name
- Email: Admin's email address
- Password: Minimum 8 characters

**Requirements**:
- Appwrite API Key with `users.read` and `users.write` scopes

---

### 3. `check-permissions.js`
**Purpose**: Audit current collection permissions.

**What it does**:
- Lists all CRADI collections
- Displays current permission settings
- Shows document security status
- Identifies collections without permissions

**Usage**:
```bash
APPWRITE_API_KEY=your_api_key npm run check:permissions
```

**Output Example**:
```
📁 Collection: USERS (users)
   Document Security: Disabled
   Permissions:
      - read("any")
      - create("users")
      - update("users", "label:admin")
      - delete("label:admin")
```

---

## Getting API Key

1. Go to [Appwrite Console](https://cloud.appwrite.io/console)
2. Select CRADI Mobile project
3. Navigate to **Overview** → **API Keys**
4. Create new API key with these scopes:
   - `databases.read`
   - `databases.write`
   - `users.read`
   - `users.write`
5. Copy the generated API key

## Permission Rules

### Collections & Access Levels

| Collection | Read | Create | Update | Delete |
|-----------|------|--------|--------|--------|
| **users** | Any | Users | Users + Admin | Admin |
| **reports** | Any | Users | Users + Admin | Admin |
| **emergency_contacts** | Users + Admin | Users | Users + Admin | Users + Admin |
| **chats** | Users + Admin | Users | Users + Admin | Admin |
| **messages** | Users + Admin | Users | Users + Admin | Admin |
| **knowledge_base** | Any | Admin | Admin | Admin |
| **trusted_devices** | Users | Users | Users | Users + Admin |
| **login_history** | Users + Admin | Users | Admin | Admin |

**Legend**:
- **Any**: Anyone (including unauthenticated)
- **Users**: Any authenticated user
- **Admin**: Users with `admin` label only
- **Users + Admin**: Users (own data) + Admins (all data)

## Security Notes

> [!WARNING]
> Never commit API keys to version control. Always use environment variables.

> [!IMPORTANT]
> The `admin` label can only be set via:
> - Appwrite Console (manual)
> - Server SDK with API key (these scripts)
> 
> Client applications cannot add admin labels, preventing privilege escalation.

## Troubleshooting

### "Collection not found"
**Solution**: Collections are created by CRADI Mobile. Ensure the app has run at least once, or skip missing collections.

### "Insufficient permissions"
**Solution**: Verify your API key has the required scopes (`databases.write`, `users.write`).

### "Admin label not working"
**Solution**: 
1. Verify label was added in Appwrite Console
2. Check case sensitivity (`admin` not `Admin`)
3. Restart admin panel to reload session

## Manual Alternative

If you prefer not to use scripts, you can set permissions manually:

1. Log in to Appwrite Console
2. Go to Database → CRADI Database
3. For each collection:
   - Click Settings → Permissions
   - Add permissions according to the table above
4. Create admin users:
   - Go to Auth → Users
   - Create user
   - Edit user and add label: `admin`

