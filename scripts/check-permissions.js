const sdk = require('node-appwrite');

// Configuration
const CONFIG = {
    endpoint: process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1',
    projectId: process.env.APPWRITE_PROJECT_ID || '6941cdb400050e7249d5',
    apiKey: process.env.APPWRITE_API_KEY,
    databaseId: process.env.APPWRITE_DATABASE_ID || '6941e2c2003705bb5a25',
};

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

async function checkPermissions() {
    if (!CONFIG.apiKey) {
        console.error('❌ Error: APPWRITE_API_KEY environment variable is required');
        process.exit(1);
    }

    console.log('🔍 CRADI Admin - Permission Audit\n');
    console.log(`Project ID: ${CONFIG.projectId}`);
    console.log(`Database ID: ${CONFIG.databaseId}\n`);

    const client = new sdk.Client()
        .setEndpoint(CONFIG.endpoint)
        .setProject(CONFIG.projectId)
        .setKey(CONFIG.apiKey);

    const databases = new sdk.Databases(client);

    for (const [name, collectionId] of Object.entries(COLLECTIONS)) {
        try {
            const collection = await databases.getCollection(
                CONFIG.databaseId,
                collectionId
            );

            console.log(`\n📁 Collection: ${name} (${collectionId})`);
            console.log(`   Document Security: ${collection.documentSecurity ? 'Enabled' : 'Disabled'}`);
            console.log(`   Permissions:`);

            if (collection.$permissions && collection.$permissions.length > 0) {
                collection.$permissions.forEach((perm) => {
                    console.log(`      - ${perm}`);
                });
            } else {
                console.log('      ⚠️  No permissions set (open access)');
            }
        } catch (error) {
            if (error.code === 404) {
                console.log(`\n📁 Collection: ${name}`);
                console.log(`   ⚠️  Not found - collection may not exist yet`);
            } else {
                console.error(`   ❌ Error: ${error.message}`);
            }
        }
    }

    console.log('\n✅ Audit complete\n');
}

checkPermissions().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
});
