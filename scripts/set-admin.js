#!/usr/bin/env node
/**
 * Grant admin access to an existing Firebase Auth user.
 *
 * Sets custom claims {role: 'admin', admin: true} (preserving other claims) and
 * updates users/{uid} with role='admin', isApproved=true.
 *
 * Credentials (one of):
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'   (JSON string)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   npm run set:admin -- admin@example.org
 *   node scripts/set-admin.js admin@example.org
 */
const { applicationDefault, cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ewer-8f788';

function credential() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
        let json;
        try {
            json = JSON.parse(raw);
        } catch {
            throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
        }
        if (json.private_key) json.private_key = json.private_key.replace(/\\n/g, '\n');
        return cert(json);
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return applicationDefault();
    }
    throw new Error(
        'No credentials. Set FIREBASE_SERVICE_ACCOUNT (JSON) or GOOGLE_APPLICATION_CREDENTIALS (path to key file).'
    );
}

async function main() {
    const email = (process.argv[2] || '').trim();
    if (!email || !email.includes('@')) {
        console.error('Usage: node scripts/set-admin.js <email>');
        process.exit(1);
    }

    initializeApp({ credential: credential(), projectId: PROJECT_ID });
    const auth = getAuth();
    const db = getFirestore();

    const user = await auth.getUserByEmail(email);
    const claims = { ...(user.customClaims || {}), role: 'admin', admin: true };
    await auth.setCustomUserClaims(user.uid, claims);

    await db.collection('users').doc(user.uid).set(
        { role: 'admin', isApproved: true, email: user.email || email },
        { merge: true }
    );

    console.log(`Granted admin to ${email} (uid: ${user.uid}).`);
    console.log('The user must sign out and back in (or wait up to 1 hour) for the new claims to apply.');
}

main().catch((error) => {
    const code = error && error.code ? ` [${error.code}]` : '';
    console.error(`Failed to set admin${code}: ${error && error.message ? error.message : error}`);
    process.exit(1);
});
