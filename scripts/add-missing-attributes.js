#!/usr/bin/env node

/**
 * Script to add missing attributes to Appwrite users collection
 * 
 * This fixes the production error:
 * "Invalid document structure: Unknown attribute: 'isApproved'"
 * 
 * Adds:
 * - isApproved (boolean, default: false)
 * - isBlocked (boolean, default: false)
 */

const { Client, Databases } = require('node-appwrite');

// Configuration
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6941cdb400050e7249d5'; // The actual project ID (without fra- prefix)
const DATABASE_ID = '6941e2c2003705bb5a25';
const COLLECTION_ID = 'users'; // Update if different

// You need to set this environment variable with your Appwrite API key
// Get it from: https://cloud.appwrite.io/console/project-fra-6941cdb400050e7249d5/overview/keys
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

if (!APPWRITE_API_KEY) {
    console.error('❌ Error: APPWRITE_API_KEY environment variable is required');
    console.log('\nGet your API key from:');
    console.log('https://cloud.appwrite.io/console/project-fra-6941cdb400050e7249d5/overview/keys');
    console.log('\nThen run:');
    console.log('export APPWRITE_API_KEY="your-api-key-here"');
    console.log('node scripts/add-missing-attributes.js');
    process.exit(1);
}

// Initialize Appwrite
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

const databases = new Databases(client);

// Attributes to create
const attributesToCreate = [
    {
        key: 'isApproved',
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether the user has been approved by admin'
    },
    {
        key: 'isBlocked',
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether the user has been blocked by admin'
    }
];

async function createAttribute(attrConfig) {
    try {
        console.log(`\n📝 Creating attribute: ${attrConfig.key}...`);

        const result = await databases.createBooleanAttribute(
            DATABASE_ID,
            COLLECTION_ID,
            attrConfig.key,
            attrConfig.required,
            attrConfig.default
        );

        console.log(`✅ Successfully created attribute: ${attrConfig.key}`);
        console.log(`   Type: ${result.type}, Default: ${result.default}, Required: ${result.required}`);

        return result;
    } catch (error) {
        if (error.code === 409) {
            console.log(`ℹ️  Attribute "${attrConfig.key}" already exists - skipping`);
            return null;
        }

        console.error(`❌ Error creating attribute "${attrConfig.key}":`, error.message);
        throw error;
    }
}

async function listExistingAttributes() {
    try {
        console.log('\n🔍 Checking existing attributes...');
        const collection = await databases.getCollection(DATABASE_ID, COLLECTION_ID);
        const existingKeys = collection.attributes.map(attr => attr.key);
        console.log('   Existing attributes:', existingKeys.join(', '));
        return existingKeys;
    } catch (error) {
        console.error('❌ Error listing attributes:', error.message);
        throw error;
    }
}

async function main() {
    console.log('🚀 Starting attribute creation script...');
    console.log(`   Database: ${DATABASE_ID}`);
    console.log(`   Collection: ${COLLECTION_ID}`);

    try {
        // List existing attributes first
        const existingKeys = await listExistingAttributes();

        // Create each attribute
        let created = 0;
        let skipped = 0;

        for (const attrConfig of attributesToCreate) {
            if (existingKeys.includes(attrConfig.key)) {
                console.log(`\nℹ️  Attribute "${attrConfig.key}" already exists - skipping`);
                skipped++;
            } else {
                await createAttribute(attrConfig);
                created++;

                // Wait a bit between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log('\n✨ Script completed!');
        console.log(`   Created: ${created} attributes`);
        console.log(`   Skipped: ${skipped} attributes (already exist)`);

        if (created > 0) {
            console.log('\n⚠️  Note: Attribute indexing may take a few seconds.');
            console.log('   Test the admin portal in ~30 seconds.');
        }

        process.exit(0);
    } catch (error) {
        console.error('\n💥 Script failed:', error.message);
        process.exit(1);
    }
}

// Run the script
main();
