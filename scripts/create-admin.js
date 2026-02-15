const sdk = require('node-appwrite');
const readline = require('readline');

// Configuration
const CONFIG = {
    endpoint: process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1',
    projectId: process.env.APPWRITE_PROJECT_ID || '6941cdb400050e7249d5',
    apiKey: process.env.APPWRITE_API_KEY, // Required: Your Appwrite API Key
    databaseId: process.env.APPWRITE_DATABASE_ID || '6941e2c2003705bb5a25',
};

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function question(query) {
    return new Promise((resolve) => rl.question(query, resolve));
}

async function createAdminUser() {
    if (!CONFIG.apiKey) {
        console.error('❌ Error: APPWRITE_API_KEY environment variable is required');
        console.log('\nUsage:');
        console.log('  APPWRITE_API_KEY=your_api_key node create-admin.js');
        console.log('\nGet your API key from: https://cloud.appwrite.io/console');
        process.exit(1);
    }

    console.log('👤 CRADI Admin - Create Admin User\n');
    console.log(`Project ID: ${CONFIG.projectId}\n`);

    // Initialize Appwrite SDK
    const client = new sdk.Client()
        .setEndpoint(CONFIG.endpoint)
        .setProject(CONFIG.projectId)
        .setKey(CONFIG.apiKey);

    const users = new sdk.Users(client);

    try {
        // Get user details
        console.log('Enter admin user details:');
        const name = await question('Name: ');
        const email = await question('Email: ');
        const password = await question('Password (min 8 characters): ');

        if (password.length < 8) {
            console.error('\n❌ Error: Password must be at least 8 characters');
            rl.close();
            process.exit(1);
        }

        console.log('\n🔄 Creating admin user...');

        // Create user
        const user = await users.create(
            sdk.ID.unique(),
            email,
            undefined, // phone
            password,
            name
        );

        console.log(`✅ User created with ID: ${user.$id}`);

        // Add admin label
        console.log('🏷️  Adding admin label...');
        await users.updateLabels(user.$id, ['admin']);

        console.log('✅ Admin label added successfully');

        // Verify email (optional but recommended)
        console.log('📧 Marking email as verified...');
        await users.updateEmailVerification(user.$id, true);

        console.log('\n✨ Admin user created successfully!\n');
        console.log('📋 User Details:');
        console.log(`   ID: ${user.$id}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Labels: admin\n`);
        console.log('🔐 You can now log in to the admin panel at:');
        console.log('   http://localhost:3000/login\n');
    } catch (error) {
        console.error('\n❌ Error creating admin user:', error.message);

        if (error.code === 409) {
            console.error('   A user with this email already exists.');
            console.log('\nTo add admin label to existing user:');
            console.log('   1. Go to Appwrite Console: https://cloud.appwrite.io/console');
            console.log('   2. Navigate to Auth → Users');
            console.log('   3. Find the user and click edit');
            console.log('   4. Add label: admin');
        }
    } finally {
        rl.close();
    }
}

// Run the script
createAdminUser().catch((error) => {
    console.error('\n❌ Fatal error:', error.message);
    rl.close();
    process.exit(1);
});
