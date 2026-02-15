const sdk = require('node-appwrite');

// Configuration
const CONFIG = {
    endpoint: process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1',
    projectId: process.env.APPWRITE_PROJECT_ID || '6941cdb400050e7249d5',
    apiKey: process.env.APPWRITE_API_KEY, // Required: Your Appwrite API Key
    databaseId: process.env.APPWRITE_DATABASE_ID || '6941e2c2003705bb5a25',
};

// Collection IDs
const COLLECTIONS = {
    USERS: 'users',
    REPORTS: 'reports',
    EMERGENCY_CONTACTS: 'emergency_contacts',
    CHATS: 'chats',
    MESSAGES: 'messages',
    KNOWLEDGE_BASE: 'knowledge_base',
    TRUSTED_DEVICES: 'trusted_devices',
    LOGIN_HISTORY: 'login_history',
};

// Permission configurations for each collection
const PERMISSIONS = {
    [COLLECTIONS.USERS]: {
        read: ['any'], // Anyone can read user profiles
        create: ['users'], // Any authenticated user can create (registration)
        update: ['users', 'label:admin'], // Users can update own, admins can update any
        delete: ['label:admin'], // Only admins can delete users
    },
    [COLLECTIONS.REPORTS]: {
        read: ['any'], // Everyone can view reports
        create: ['users'], // Any user can create reports
        update: ['users', 'label:admin'], // Report creator + admins can update
        delete: ['label:admin'], // Only admins can delete
    },
    [COLLECTIONS.EMERGENCY_CONTACTS]: {
        read: ['users', 'label:admin'], // Own contacts + admins
        create: ['users'],
        update: ['users', 'label:admin'],
        delete: ['users', 'label:admin'],
    },
    [COLLECTIONS.CHATS]: {
        read: ['users', 'label:admin'], // Participants + admins
        create: ['users'],
        update: ['users', 'label:admin'],
        delete: ['label:admin'],
    },
    [COLLECTIONS.MESSAGES]: {
        read: ['users', 'label:admin'],
        create: ['users'],
        update: ['users', 'label:admin'],
        delete: ['label:admin'],
    },
    [COLLECTIONS.KNOWLEDGE_BASE]: {
        read: ['any'], // Public knowledge base
        create: ['label:admin'], // Only admins create articles
        update: ['label:admin'],
        delete: ['label:admin'],
    },
    [COLLECTIONS.TRUSTED_DEVICES]: {
        read: ['users'],
        create: ['users'],
        update: ['users'],
        delete: ['users', 'label:admin'],
    },
    [COLLECTIONS.LOGIN_HISTORY]: {
        read: ['users', 'label:admin'], // Own history + admins
        create: ['users'],
        update: ['label:admin'], // Only admins can modify history
        delete: ['label:admin'],
    },
};

async function setupPermissions() {
    if (!CONFIG.apiKey) {
        console.error('❌ Error: APPWRITE_API_KEY environment variable is required');
        console.log('\nUsage:');
        console.log('  APPWRITE_API_KEY=your_api_key node setup-permissions.js');
        console.log('\nGet your API key from: https://cloud.appwrite.io/console');
        process.exit(1);
    }

    console.log('🔧 CRADI Admin - Database Permissions Setup\n');
    console.log(`Project ID: ${CONFIG.projectId}`);
    console.log(`Database ID: ${CONFIG.databaseId}\n`);

    // Initialize Appwrite SDK
    const client = new sdk.Client()
        .setEndpoint(CONFIG.endpoint)
        .setProject(CONFIG.projectId)
        .setKey(CONFIG.apiKey);

    const databases = new sdk.Databases(client);

    // Process each collection
    for (const [collectionId, permissions] of Object.entries(PERMISSIONS)) {
        try {
            console.log(`📝 Setting permissions for collection: ${collectionId}`);

            // Build permission strings
            const permissionStrings = [];

            // Read permissions
            if (permissions.read.includes('any')) {
                permissionStrings.push(sdk.Permission.read(sdk.Role.any()));
            } else if (permissions.read.includes('users')) {
                permissionStrings.push(sdk.Permission.read(sdk.Role.users()));
            }
            if (permissions.read.includes('label:admin')) {
                permissionStrings.push(sdk.Permission.read(sdk.Role.label('admin')));
            }

            // Create permissions
            if (permissions.create.includes('users')) {
                permissionStrings.push(sdk.Permission.create(sdk.Role.users()));
            }
            if (permissions.create.includes('label:admin')) {
                permissionStrings.push(sdk.Permission.create(sdk.Role.label('admin')));
            }

            // Update permissions
            if (permissions.update.includes('users')) {
                permissionStrings.push(sdk.Permission.update(sdk.Role.users()));
            }
            if (permissions.update.includes('label:admin')) {
                permissionStrings.push(sdk.Permission.update(sdk.Role.label('admin')));
            }

            // Delete permissions
            if (permissions.delete.includes('users')) {
                permissionStrings.push(sdk.Permission.delete(sdk.Role.users()));
            }
            if (permissions.delete.includes('label:admin')) {
                permissionStrings.push(sdk.Permission.delete(sdk.Role.label('admin')));
            }

            // Update collection with new permissions
            await databases.updateCollection(
                CONFIG.databaseId,
                collectionId,
                collectionId, // Keep same name
                permissionStrings,
                false, // documentSecurity - set to false for collection-level permissions
                true // enabled
            );

            console.log(`  ✅ Permissions set successfully`);
        } catch (error) {
            console.error(`  ❌ Error setting permissions: ${error.message}`);
            if (error.code === 404) {
                console.error(`  Collection "${collectionId}" not found. Skipping...`);
            }
        }
    }

    console.log('\n✨ Permission setup complete!');
    console.log('\n⚠️  Important Next Steps:');
    console.log('  1. Create an admin user: node scripts/create-admin.js');
    console.log('  2. Verify permissions: node scripts/check-permissions.js');
    console.log('  3. Test admin panel access\n');
}

// Run the setup
setupPermissions().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
});
