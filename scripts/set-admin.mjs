#!/usr/bin/env node
/**
 * Promote an existing Appwrite user to an approved admin.
 *
 * Updates their `profiles` row: role = 'admin', isApproved = true,
 * isDisabled = false. Uses an API key (bypasses every permission) — run it
 * locally or in a trusted shell only.
 *
 * Env:
 *   APPWRITE_ENDPOINT (or NEXT_PUBLIC_APPWRITE_ENDPOINT)
 *   APPWRITE_PROJECT_ID (or NEXT_PUBLIC_APPWRITE_PROJECT_ID)
 *   APPWRITE_API_KEY
 *   APPWRITE_DATABASE_ID (optional; defaults to `cradi`)
 *
 * Usage:
 *   npm run set:admin -- admin@example.org
 *   node --env-file=.env.local scripts/set-admin.mjs admin@example.org
 */
import { Client, Query, TablesDB, Users } from 'node-appwrite';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/set-admin.mjs <email>');
    process.exit(1);
}

const endpoint = (process.env.APPWRITE_ENDPOINT || process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || '').trim();
const project = (process.env.APPWRITE_PROJECT_ID || process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '').trim();
const apiKey = (process.env.APPWRITE_API_KEY || '').trim();
const databaseId = (process.env.APPWRITE_DATABASE_ID || process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'cradi').trim();
if (!endpoint || !project || !apiKey) {
    console.error('Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY.');
    process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
const tables = new TablesDB(client);
const users = new Users(client);

/**
 * The account id for an exact email: the profile row first, then the
 * account list. Exact matches only, and ambiguity is refused rather than
 * guessed — granting admin to the wrong account is not recoverable by
 * running this again.
 */
async function findUserId() {
    const profiles = await tables.listRows({
        databaseId,
        tableId: 'profiles',
        queries: [Query.equal('email', email), Query.limit(2)],
    });
    if (profiles.total > 1) throw new Error(`More than one profile has email ${email}; refusing to guess.`);
    if (profiles.rows.length === 1) return profiles.rows[0].$id;

    const matches = [];
    const perPage = 100;
    for (let offset = 0; ; offset += perPage) {
        const page = await users.list({ queries: [Query.limit(perPage), Query.offset(offset)] });
        matches.push(...page.users.filter((u) => (u.email || '').trim().toLowerCase() === email));
        if (page.users.length < perPage) break;
    }
    if (matches.length > 1) throw new Error(`More than one account has email ${email}; refusing to guess.`);
    return matches[0]?.$id ?? null;
}

async function main() {
    const userId = await findUserId();
    if (!userId) {
        throw new Error(`No user with email ${email}. The user must sign up (mobile app or Appwrite console) first.`);
    }

    // Only promote an account whose owner has proven control of the email or
    // phone; otherwise anyone could pre-register a victim's address and
    // inherit admin.
    const account = await users.get({ userId }).catch((error) => {
        throw new Error(`Could not load account ${userId}: ${error?.message ?? 'not found'}`);
    });
    if (account.emailVerification !== true && account.phoneVerification !== true) {
        throw new Error(
            `User ${email} (id: ${userId}) has not confirmed their email address or phone. ` +
                'Ask them to confirm it first; refusing to grant admin to an unconfirmed account.',
        );
    }
    if ((account.email || '').trim().toLowerCase() !== email) {
        throw new Error(`Account ${userId} has email ${account.email || '(none)'}, not ${email}; refusing.`);
    }

    try {
        await tables.updateRow({
            databaseId,
            tableId: 'profiles',
            rowId: userId,
            data: { role: 'admin', isApproved: true, isDisabled: false },
        });
    } catch (error) {
        if (error?.code === 404) {
            throw new Error(`User ${userId} has no profile row (was the schema provisioned before sign-up?).`);
        }
        throw new Error(`Profile update failed: ${error?.message ?? error}`);
    }

    // Make sure a previously blocked account can sign in again.
    try {
        await users.updateStatus({ userId, status: true });
    } catch (error) {
        console.warn(`Warning: could not re-enable the account: ${error?.message ?? error}`);
    }

    console.log(`Granted admin to ${email} (id: ${userId}). Sign in to the admin panel with this account.`);
}

main().catch((error) => {
    console.error(`Failed to set admin: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
