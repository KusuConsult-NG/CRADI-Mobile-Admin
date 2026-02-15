#!/usr/bin/env node

/**
 * Appwrite Platform Setup Script
 * 
 * This script adds the Vercel deployment domain to Appwrite platforms
 * to resolve CORS issues with the admin panel.
 * 
 * Usage:
 *   node scripts/add-platform.js
 * 
 * Required Environment Variables:
 *   APPWRITE_API_KEY - Your Appwrite API key with platform management permissions
 */

const https = require('https');

// Configuration
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6941cdb400050e7249d5';
const PLATFORM_NAME = 'EWER Admin Panel';
const PLATFORM_HOSTNAME = 'cradi-mobile-admin.vercel.app';

// Get API key from environment or prompt
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

if (!APPWRITE_API_KEY) {
    console.error('❌ Error: APPWRITE_API_KEY environment variable is required');
    console.error('');
    console.error('To get your API key:');
    console.error('1. Go to: https://cloud.appwrite.io/console/project-6941cdb400050e7249d5/overview/keys');
    console.error('2. Create a new API key with "Project" scope');
    console.error('3. Run: APPWRITE_API_KEY=your_key_here node scripts/add-platform.js');
    process.exit(1);
}

/**
 * Make HTTP request to Appwrite API
 */
function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, APPWRITE_ENDPOINT);
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': APPWRITE_PROJECT_ID,
                'X-Appwrite-Key': APPWRITE_API_KEY,
            },
        };

        const req = https.request(url, options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(`${response.message || 'Request failed'} (${res.statusCode})`));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${body}`));
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

/**
 * Check if platform already exists
 */
async function checkExistingPlatforms() {
    console.log('🔍 Checking existing platforms...');
    try {
        const response = await makeRequest('GET', '/projects/' + APPWRITE_PROJECT_ID + '/platforms');
        const platforms = response.platforms || [];

        const existing = platforms.find(p =>
            p.hostname === PLATFORM_HOSTNAME || p.name === PLATFORM_NAME
        );

        if (existing) {
            console.log('✅ Platform already exists:');
            console.log(`   Name: ${existing.name}`);
            console.log(`   Hostname: ${existing.hostname}`);
            console.log(`   Type: ${existing.type}`);
            console.log(`   ID: ${existing.$id}`);
            return existing;
        }

        return null;
    } catch (error) {
        console.error('❌ Failed to check platforms:', error.message);
        throw error;
    }
}

/**
 * Add web platform
 */
async function addPlatform() {
    console.log('➕ Adding new platform...');
    try {
        const response = await makeRequest('POST', '/projects/' + APPWRITE_PROJECT_ID + '/platforms', {
            type: 'web',
            name: PLATFORM_NAME,
            hostname: PLATFORM_HOSTNAME,
        });

        console.log('✅ Platform added successfully:');
        console.log(`   Name: ${response.name}`);
        console.log(`   Hostname: ${response.hostname}`);
        console.log(`   Type: ${response.type}`);
        console.log(`   ID: ${response.$id}`);
        return response;
    } catch (error) {
        console.error('❌ Failed to add platform:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('🚀 Appwrite Platform Setup');
    console.log('================================');
    console.log(`Project ID: ${APPWRITE_PROJECT_ID}`);
    console.log(`Platform: ${PLATFORM_NAME}`);
    console.log(`Hostname: ${PLATFORM_HOSTNAME}`);
    console.log('');

    try {
        // Check if platform already exists
        const existing = await checkExistingPlatforms();

        if (existing) {
            console.log('');
            console.log('ℹ️  No action needed - platform is already configured.');
            console.log('   The CORS error should be resolved.');
            return;
        }

        // Add platform if it doesn't exist
        await addPlatform();

        console.log('');
        console.log('🎉 Success! Platform added to Appwrite.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Wait a few seconds for Appwrite to update');
        console.log('2. Refresh your admin panel: https://cradi-mobile-admin.vercel.app');
        console.log('3. Try logging in - the CORS error should be gone!');
    } catch (error) {
        console.error('');
        console.error('❌ Script failed:', error.message);
        console.error('');
        console.error('Troubleshooting:');
        console.error('- Verify your API key has the correct permissions');
        console.error('- Check the project ID is correct');
        console.error('- You can also add the platform manually in the Appwrite console');
        process.exit(1);
    }
}

// Run the script
main();
