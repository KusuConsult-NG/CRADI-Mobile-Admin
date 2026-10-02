#!/usr/bin/env node
/**
 * Seeds a real Appwrite project for `live.spec.ts`, and prints the
 * credentials that spec signs in with.
 *
 *   source ../CRADI-mobile/infra/appwrite/local/.env.local
 *   node e2e/live-seed.mjs
 *   node e2e/live-seed.mjs --clean     # remove what the last run made
 *
 * Everything it creates is prefixed `live-` and stamped with the run's
 * start time, so a second run does not collide with the first and the
 * rows a previous run left behind are harmless.
 *
 * `--clean` removes exactly the ids recorded in `e2e/.live.json` and
 * nothing else — never a prefix sweep. This is pointed at a real server,
 * and "delete everything matching `live-`" is one typo away from
 * deleting the wrong things. Run it after a Cloud run; on a throwaway
 * stack it does not matter.
 *
 * Writes `e2e/.live.json` (gitignored) for the spec to read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const EP = (process.env.APPWRITE_ENDPOINT || '').trim();
const PROJECT = (process.env.APPWRITE_PROJECT_ID || '').trim();
const KEY = (process.env.APPWRITE_API_KEY || '').trim();
const DB = (process.env.APPWRITE_DATABASE_ID || 'cradi').trim();
if (!EP || !PROJECT || !KEY) {
    console.error('Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY.');
    process.exit(2);
}

const H = { 'content-type': 'application/json', 'x-appwrite-project': PROJECT, 'x-appwrite-key': KEY };

async function call(path, { method = 'GET', body } = {}) {
    const r = await fetch(`${EP}${path}`, {
        method,
        headers: H,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = { message: text }; } }
    return { status: r.status, ok: r.ok, body: parsed };
}

const must = async (what, p) => {
    const r = await call(...p);
    if (!r.ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
};

const row = (table, id = '') => `/tablesdb/${DB}/tables/${table}/rows${id ? `/${id}` : ''}`;
const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, '.live.json');

if (process.argv.includes('--clean')) {
    let previous;
    try {
        previous = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
        console.error('Nothing to clean: e2e/.live.json is missing or unreadable.');
        process.exit(1);
    }
    // Only what that run recorded, by id. The panel's own writes during
    // the run (an alert, an article, a link, an authority) carry the same
    // stamp in their titles and are listed by it here rather than swept
    // by prefix, because a prefix match is a query and a query can be
    // wrong in ways a list of ids cannot.
    const stamped = previous.stamp;
    const targets = [
        ['users', previous.admin?.id],
        ['users', previous.pending?.id],
        ['profiles', previous.admin?.id],
        ['profiles', previous.pending?.id],
        ['reports', previous.reportId],
        ['reports', previous.verifiedId],
    ].filter(([, id]) => !!id);

    let removed = 0;
    const left = [];
    for (const [table, id] of targets) {
        const path = table === 'users' ? `/users/${encodeURIComponent(id)}` : row(table, id);
        const r = await call(path, { method: 'DELETE' });
        if (r.ok || r.status === 404) removed += 1;
        else left.push(`${table} ${id}: ${r.status} ${r.body?.message ?? ''}`);
    }
    console.log(`removed ${removed}/${targets.length} seeded rows from run ${stamped}`);
    for (const l of left) console.log(`  LEFT BEHIND — ${l}`);
    console.log(
        `\nThe panel's own writes during that run are not seeded rows and are left alone.\n` +
            `They carry "${stamped}" in their title: an alert, a knowledge article, a news\n` +
            'link and an authority. Remove them from the console if this was a real project.',
    );
    process.exit(left.length ? 1 : 0);
}

const stamp = Date.now().toString(36);
const id = (prefix) => `live-${prefix}-${stamp}`.slice(0, 36);

const PASSWORD = 'LivePanelPassword123';

async function account(userId, name, email) {
    const made = await call('/users', { method: 'POST', body: { userId, email, password: PASSWORD, name } });
    if (!made.ok && made.status !== 409) {
        throw new Error(`account ${userId}: ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`);
    }
    return userId;
}

async function profile(userId, data, labels) {
    await must(`profile ${userId}`, [row('profiles'), {
        method: 'POST',
        body: {
            rowId: userId,
            data: { state: 'Benue', lga: 'Makurdi', ward: 'North Bank I', isDisabled: false, ...data },
            permissions: [`read("user:${userId}")`, 'read("label:admin")', 'read("label:techSupport")'],
        },
    }]);
    await must(`labels ${userId}`, [`/users/${userId}/labels`, { method: 'PUT', body: { labels } }]);
}

// ── the admin the panel signs in as ──────────────────────────────────
const adminId = id('admin');
const adminEmail = `${adminId}@example.test`;
await account(adminId, 'Live Admin', adminEmail);
// Email confirmed, so this account could itself be approved by the panel.
await must('confirm admin', [`/users/${adminId}/verification`, { method: 'PATCH', body: { emailVerification: true } }]);
await profile(adminId, { name: 'Live Admin', role: 'admin', isApproved: true, isVerified: true }, ['admin', 'approved']);

// ── a pending user for the approval flow ─────────────────────────────
const pendingId = id('pending');
await account(pendingId, 'Live Pending', `${pendingId}@example.test`);
await must('confirm pending', [`/users/${pendingId}/verification`, { method: 'PATCH', body: { emailVerification: true } }]);
await profile(pendingId, { name: 'Live Pending', role: 'ewm', isApproved: false, isVerified: false }, []);

// ── a report the panel decides ───────────────────────────────────────
const reportId = id('report');
await must('report', [row('reports'), {
    method: 'POST',
    body: {
        rowId: reportId,
        data: {
            userId: adminId,
            reporterName: 'Live Reporter',
            hazardType: 'Flooding',
            severity: 'high',
            description: `Live panel report ${stamp}`,
            state: 'Benue', lga: 'Makurdi', ward: 'North Bank I',
            status: 'pending',
            verificationCount: 0,
            isAlert: false,
            escalated: false,
            autoValidated: false,
            submittedAt: new Date().toISOString(),
            imageUrls: [],
        },
        permissions: ['read("label:admin")'],
    },
}]);

// A second report, so reopening one leaves the other alone.
const verifiedId = id('verified');
await must('verified report', [row('reports'), {
    method: 'POST',
    body: {
        rowId: verifiedId,
        data: {
            userId: adminId,
            reporterName: 'Live Reporter',
            hazardType: 'Wildfires',
            severity: 'medium',
            description: `Live verified report ${stamp}`,
            state: 'Benue', lga: 'Makurdi', ward: 'North Bank I',
            status: 'verified',
            verificationCount: 2,
            verifiedAt: new Date().toISOString(),
            isAlert: false, escalated: false, autoValidated: false,
            submittedAt: new Date().toISOString(),
            imageUrls: [],
        },
        permissions: ['read("label:admin")'],
    },
}]);

const out = {
    endpoint: EP,
    project: PROJECT,
    database: DB,
    stamp,
    admin: { id: adminId, email: adminEmail, password: PASSWORD },
    pending: { id: pendingId, email: `${pendingId}@example.test` },
    reportId,
    verifiedId,
};
writeFileSync(statePath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`seeded run ${stamp}`);
console.log(`  admin    ${adminEmail} / ${PASSWORD}`);
console.log(`  pending  ${pendingId}`);
console.log(`  reports  ${reportId}, ${verifiedId}`);
console.log('wrote e2e/.live.json');
