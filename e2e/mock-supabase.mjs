// Minimal in-memory Supabase mock (GoTrue auth + PostgREST subset) for the
// Playwright end-to-end tests. Serves both the browser client (anon key) and
// the Next.js API routes (service role). Not a general-purpose emulator: it
// implements only what this admin panel uses.
//
//   node e2e/mock-supabase.mjs            # listens on 127.0.0.1:54321
//
// Test-control endpoints (not part of Supabase):
//   POST /__mock/reset      restore the seed data and clear the request log
//   GET  /__mock/requests   request log [{ method, path, query, prefer, body }]
//   GET  /__mock/table/:t   current rows of a table
//   GET  /__mock/health     liveness
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

const HOST = process.env.MOCK_SUPABASE_HOST || '127.0.0.1';
const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54321);

const IDS = {
    admin: '00000000-0000-4000-8000-000000000001',
    pendingConfirmed: '00000000-0000-4000-8000-000000000002',
    pendingUnconfirmed: '00000000-0000-4000-8000-000000000003',
    approved: '00000000-0000-4000-8000-000000000004',
    blocked: '00000000-0000-4000-8000-000000000005',
};

// Columns per table (from CRADI-mobile/supabase/migrations). Unknown columns
// in select / filters / order / bodies are rejected like PostgREST does (42703).
const SCHEMA = {
    profiles: {
        pk: 'id',
        columns: ['id', 'email', 'name', 'role', 'address', 'state', 'lga', 'ward', 'phone', 'is_verified', 'is_approved', 'is_disabled', 'biometrics_enabled', 'profile_image_url', 'monitoring_zone', 'registration_code', 'last_login_at', 'legacy_firebase_uid', 'created_at', 'updated_at'],
        defaults: { name: 'User', role: 'user', address: '', state: '', lga: '', ward: '', phone: '', is_verified: false, is_approved: false, is_disabled: false },
    },
    reports: {
        pk: 'id',
        columns: ['id', 'user_id', 'reporter_name', 'hazard_type', 'severity', 'latitude', 'longitude', 'location_details', 'location', 'address', 'ward', 'lga', 'state', 'description', 'submitted_at', 'image_urls', 'status', 'type', 'is_alert', 'verification_count', 'verified_at', 'auto_validated', 'approved_at', 'rejected_at', 'rejection_reason', 'escalated', 'escalated_at', 'escalation_reason', 'escalation_scheduled_at', 'escalation_status', 'updated_by', 'synced_at', 'legacy_firebase_id', 'created_at', 'updated_at'],
        defaults: { severity: 'medium', location_details: '', location: '', address: '', ward: '', state: '', description: '', image_urls: [], status: 'pending', is_alert: false, verification_count: 0, auto_validated: false, escalated: false },
    },
    contacts: {
        pk: 'id',
        columns: ['id', 'user_id', 'name', 'role', 'phone', 'organization', 'lga', 'category', 'is_available', 'created_at', 'updated_at'],
        defaults: { role: '', category: 'other', is_available: true },
    },
    knowledge_base: {
        pk: 'id',
        columns: ['id', 'title', 'content', 'source', 'category', 'hazard_type', 'image_url', 'legacy_firebase_id', 'created_at', 'updated_at'],
        defaults: { content: '', source: '', category: 'General', hazard_type: 'general', image_url: null },
    },
    alerts: {
        pk: 'id',
        columns: ['id', 'title', 'message', 'severity', 'target_lga', 'report_id', 'created_by', 'is_active', 'created_at', 'updated_at'],
        defaults: { message: '', severity: 'info', target_lga: 'All', is_active: true },
    },
    authorities: {
        pk: 'id',
        columns: ['id', 'name', 'organization', 'phone', 'coverage_lga', 'created_at', 'updated_at'],
        defaults: { name: '', organization: null },
    },
    app_settings: {
        pk: 'key',
        columns: ['key', 'value', 'updated_at'],
        defaults: {},
    },
};

const NOT_NULL = {
    reports: ['hazard_type', 'lga'],
    alerts: ['title'],
    authorities: ['phone', 'coverage_lga'],
    knowledge_base: ['title'],
    app_settings: ['value'],
};

function iso(daysAgo, minutes = 0) {
    return new Date(Date.UTC(2026, 8, 20) - daysAgo * 86400000 - minutes * 60000).toISOString();
}

function profile(id, fields) {
    return {
        id, email: null, name: 'User', role: 'user', address: '', state: '', lga: '', ward: '', phone: '',
        is_verified: false, is_approved: false, is_disabled: false, biometrics_enabled: false,
        profile_image_url: '', monitoring_zone: '', registration_code: null, last_login_at: null,
        legacy_firebase_uid: null, created_at: iso(10), updated_at: iso(10), ...fields,
    };
}

function report(n, fields) {
    const id = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    return {
        id, user_id: IDS.approved, reporter_name: 'Bola Approved', hazard_type: 'Flooding', severity: 'medium',
        latitude: null, longitude: null, location_details: '', location: '', address: '', ward: 'Obi Ward',
        lga: 'Obi', state: 'Benue', description: '', submitted_at: iso(0, n * 10), image_urls: [],
        status: 'pending', type: null, is_alert: false, verification_count: 0, verified_at: null,
        auto_validated: false, approved_at: null, rejected_at: null, rejection_reason: null, escalated: false,
        escalated_at: null, escalation_reason: null, escalation_scheduled_at: null, escalation_status: null,
        updated_by: null, synced_at: null, legacy_firebase_id: null, created_at: iso(0, n * 10),
        updated_at: iso(0, n * 10), ...fields,
    };
}

function seed() {
    const authUsers = [
        { id: IDS.admin, email: 'admin@cradi.test', password: 'admin-pass', email_confirmed_at: iso(30), phone_confirmed_at: null, banned_until: null },
        { id: IDS.pendingConfirmed, email: 'ada@cradi.test', password: 'ada-pass', email_confirmed_at: iso(5), phone_confirmed_at: null, banned_until: null },
        { id: IDS.pendingUnconfirmed, email: 'uche@cradi.test', password: 'uche-pass', email_confirmed_at: null, phone_confirmed_at: null, banned_until: null },
        { id: IDS.approved, email: 'bola@cradi.test', password: 'bola-pass', email_confirmed_at: iso(20), phone_confirmed_at: null, banned_until: null },
        { id: IDS.blocked, email: 'chidi@cradi.test', password: 'chidi-pass', email_confirmed_at: iso(20), phone_confirmed_at: null, banned_until: '2126-01-01T00:00:00Z' },
    ];
    const profiles = [
        profile(IDS.admin, { email: 'admin@cradi.test', name: 'Grace Admin', role: 'admin', is_approved: true, is_verified: true, state: 'Benue', lga: 'Makurdi', ward: 'Agan', created_at: iso(30) }),
        profile(IDS.pendingConfirmed, { email: 'ada@cradi.test', name: 'Ada Confirmed', role: 'ewm', phone: '+2348030000002', state: 'Benue', lga: 'Ado', ward: 'Apa', created_at: iso(1) }),
        profile(IDS.pendingUnconfirmed, { email: 'uche@cradi.test', name: 'Uche Unconfirmed', role: 'ewv', created_at: iso(2) }),
        profile(IDS.approved, { email: 'bola@cradi.test', name: 'Bola Approved', role: 'ewv', is_approved: true, is_verified: true, state: 'Benue', lga: 'Obi', ward: 'Obi Ward', created_at: iso(3) }),
        profile(IDS.blocked, { email: 'chidi@cradi.test', name: 'Chidi Blocked', role: 'ewm', is_approved: true, is_disabled: true, state: 'Plateau', lga: "Qua'an Pan", ward: 'Bwall', created_at: iso(4) }),
    ];
    const reports = [
        report(1, {
            hazard_type: 'Flooding',
            description: 'River Benue overflowing',
            severity: 'high',
            image_urls: ['reports/flood-1.jpg', 'https://images.example/flood-2.jpg'],
        }),
        report(2, { hazard_type: 'Extreme Temperatures', description: 'Heatwave in the market' }),
        report(3, { hazard_type: 'Drought', description: 'Wells running dry', status: 'approved', approved_at: iso(0) }),
        report(4, { hazard_type: 'Windstorms', description: 'Roofs blown off' }),
        report(5, { hazard_type: 'Wildfires', description: 'Bush burning near farms', status: 'verified', verification_count: 2 }),
        report(6, { hazard_type: 'Erosion', description: 'Gully widening on the road' }),
        report(7, { hazard_type: 'Pest Outbreak', description: 'Locusts on millet' }),
        report(8, { hazard_type: 'Crop Disease', description: 'Cassava mosaic' }),
        report(9, { hazard_type: 'Conflict', description: 'Herder clash reported', status: 'rejected', rejection_reason: 'Duplicate' }),
        report(10, { hazard_type: 'Floods', description: 'Legacy flood row' }),
        report(11, { hazard_type: 'Windstorms', type: 'verification_request', description: 'Please verify: storm damage' }),
    ];
    const authorities = [
        { id: randomUUID(), name: 'Ado Emergency Desk', organization: 'SEMA Benue', phone: '+2348031234567', coverage_lga: 'Ado', created_at: iso(9), updated_at: iso(9) },
        { id: randomUUID(), name: "Qua'an Pan Desk", organization: null, phone: '+2348039999999', coverage_lga: "Qua'an Pan", created_at: iso(8), updated_at: iso(8) },
        { id: randomUUID(), name: 'Old Contact', organization: null, phone: '12345', coverage_lga: 'Nowhere', created_at: iso(7), updated_at: iso(7) },
    ];
    const app_settings = [
        { key: 'minimum_peer_confirmations', value: 2, updated_at: iso(6) },
        { key: 'escalation_timeout_minutes', value: '30', updated_at: iso(6) },
        { key: 'feature_flag_peer_chat', value: true, updated_at: iso(6) },
        { key: 'app_min_version', value: '1.0.0', updated_at: iso(6) },
        { key: 'unrelated_key', value: 'ignored', updated_at: iso(6) },
    ];
    const alerts = [
        { id: randomUUID(), title: 'Flood warning', message: 'Move to higher ground', severity: 'warning', target_lga: 'Makurdi', report_id: null, created_by: IDS.admin, is_active: true, created_at: iso(1), updated_at: iso(1) },
        { id: randomUUID(), title: 'Old drill', message: 'Past exercise', severity: 'info', target_lga: 'All', report_id: null, created_by: IDS.admin, is_active: false, created_at: iso(5), updated_at: iso(5) },
    ];
    const knowledge_base = [
        { id: randomUUID(), title: 'Flood safety basics', content: 'Stay away from flood water.', source: 'NEMA', category: 'Flood', hazard_type: 'flood', image_url: null, legacy_firebase_id: null, created_at: iso(4), updated_at: iso(4) },
        { id: randomUUID(), title: 'Legacy floods guide', content: 'Old article with a legacy category.', source: 'NiMet', category: 'Floods', hazard_type: 'flooding', image_url: null, legacy_firebase_id: null, created_at: iso(6), updated_at: iso(6) },
    ];
    const contacts = [
        { id: randomUUID(), user_id: IDS.admin, name: 'Police', role: '', phone: '112', organization: null, lga: null, category: 'police', is_available: true, created_at: iso(3), updated_at: iso(3) },
        { id: randomUUID(), user_id: IDS.admin, name: 'Fire', role: '', phone: '113', organization: null, lga: null, category: 'fire', is_available: true, created_at: iso(3), updated_at: iso(3) },
        { id: randomUUID(), user_id: IDS.approved, name: 'Clinic', role: '', phone: '114', organization: null, lga: 'Obi', category: 'health', is_available: true, created_at: iso(3), updated_at: iso(3) },
    ];
    return { authUsers, tables: { profiles, reports, authorities, app_settings, alerts, knowledge_base, contacts }, sessions: new Map(), refresh: new Map() };
}

// 1×1 transparent PNG served for every Storage object.
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

let state = seed();
let requestLog = [];

// ── HTTP helpers ────────────────────────────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, prefer, range, range-unit, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
    'Access-Control-Max-Age': '600',
};

function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
        ...CORS,
        ...(payload ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...headers,
    });
    res.end(res.req.method === 'HEAD' ? undefined : payload);
}

function pgError(res, status, code, message) {
    send(res, status, { code, message, details: null, hint: null });
}

function authError(res, status, code, msg) {
    send(res, status, { code, error_code: code, msg }, { 'x-supabase-api-version': '2024-01-01' });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text) return resolve(undefined);
            try {
                resolve(JSON.parse(text));
            } catch {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

// ── Auth (GoTrue subset) ────────────────────────────────────────────────────

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function publicUser(u) {
    return {
        id: u.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        phone: '',
        phone_confirmed_at: u.phone_confirmed_at,
        confirmed_at: u.email_confirmed_at ?? u.phone_confirmed_at,
        banned_until: u.banned_until,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
    };
}

function newSession(u) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;
    const accessToken = [
        b64url({ alg: 'HS256', typ: 'JWT' }),
        b64url({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + expiresIn, session_id: randomUUID() }),
        randomBytes(16).toString('base64url'),
    ].join('.');
    const refreshToken = randomBytes(12).toString('hex');
    state.sessions.set(accessToken, u.id);
    state.refresh.set(refreshToken, u.id);
    return {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: now + expiresIn,
        refresh_token: refreshToken,
        user: publicUser(u),
    };
}

function isBanned(u) {
    return !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
}

function bearer(req) {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
    return m ? m[1] : null;
}

const SERVICE_KEY = process.env.MOCK_SUPABASE_SERVICE_KEY || 'test';

async function handleAuth(req, res, url, body) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    if (path === '/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
            const u = state.authUsers.find((x) => x.email === String(body?.email ?? '').toLowerCase());
            if (!u || u.password !== body?.password) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
            if (!u.email_confirmed_at) return authError(res, 400, 'email_not_confirmed', 'Email not confirmed');
            if (isBanned(u)) return authError(res, 400, 'user_banned', 'User is banned');
            return send(res, 200, newSession(u));
        }
        if (grant === 'refresh_token') {
            const uid = state.refresh.get(body?.refresh_token);
            const u = uid && state.authUsers.find((x) => x.id === uid);
            if (!u) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
            state.refresh.delete(body.refresh_token);
            return send(res, 200, newSession(u));
        }
        return authError(res, 400, 'validation_failed', 'Unsupported grant type');
    }
    if (path === '/user' && req.method === 'GET') {
        const uid = state.sessions.get(bearer(req));
        const u = uid && state.authUsers.find((x) => x.id === uid);
        if (!u) return authError(res, 403, 'bad_jwt', 'invalid JWT');
        return send(res, 200, publicUser(u));
    }
    if (path === '/logout' && req.method === 'POST') {
        state.sessions.delete(bearer(req));
        return send(res, 204);
    }
    const admin = path.match(/^\/admin\/users\/([^/]+)$/);
    if (admin) {
        if (bearer(req) !== SERVICE_KEY) return authError(res, 403, 'not_admin', 'User not allowed');
        const u = state.authUsers.find((x) => x.id === admin[1]);
        if (!u) return authError(res, 404, 'user_not_found', 'User not found');
        if (req.method === 'GET') return send(res, 200, publicUser(u));
        if (req.method === 'PUT') {
            if (body && 'ban_duration' in body) {
                u.banned_until = body.ban_duration === 'none' ? null : '2126-01-01T00:00:00Z';
            }
            return send(res, 200, publicUser(u));
        }
        if (req.method === 'DELETE') {
            state.authUsers = state.authUsers.filter((x) => x !== u);
            state.tables.profiles = state.tables.profiles.filter((p) => p.id !== u.id); // ON DELETE CASCADE
            return send(res, 200, {});
        }
    }
    return authError(res, 404, 'not_found', `Mock: no auth route ${req.method} ${path}`);
}

// ── PostgREST subset ────────────────────────────────────────────────────────

class RestError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function checkColumn(table, column) {
    if (!SCHEMA[table].columns.includes(column)) {
        throw new RestError(400, '42703', `column ${table}.${column} does not exist`);
    }
}

/** Splits on commas not inside quotes or parentheses. */
function splitTopLevel(text) {
    const out = [];
    let depth = 0;
    let quoted = false;
    let cur = '';
    for (const ch of text) {
        if (ch === '"') quoted = !quoted;
        if (!quoted && ch === '(') depth += 1;
        if (!quoted && ch === ')') depth -= 1;
        if (!quoted && depth === 0 && ch === ',') {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    if (cur !== '') out.push(cur);
    return out;
}

function unquote(v) {
    return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function likeRegex(pattern, flags) {
    const re = pattern
        .split('')
        .map((c) => (c === '*' || c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
        .join('');
    return new RegExp(`^${re}$`, flags);
}

function asText(value) {
    if (value === null || value === undefined) return null;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Returns a predicate for `column` + `op.value` (PostgREST filter syntax). */
function makeFilter(table, column, expr) {
    checkColumn(table, column);
    let negate = false;
    let rest = expr;
    if (rest.startsWith('not.')) {
        negate = true;
        rest = rest.slice(4);
    }
    const dot = rest.indexOf('.');
    if (dot < 0) throw new RestError(400, 'PGRST100', `failed to parse filter (${expr})`);
    const op = rest.slice(0, dot);
    const raw = rest.slice(dot + 1);
    let pred;
    switch (op) {
        case 'eq':
            pred = (row) => asText(row[column]) === raw;
            break;
        case 'neq':
            pred = (row) => row[column] !== null && asText(row[column]) !== raw;
            break;
        case 'is':
            if (raw === 'null') pred = (row) => row[column] === null || row[column] === undefined;
            else if (raw === 'true' || raw === 'false') pred = (row) => row[column] === (raw === 'true');
            else throw new RestError(400, 'PGRST100', `failed to parse filter (${expr})`);
            break;
        case 'in': {
            if (!raw.startsWith('(') || !raw.endsWith(')')) throw new RestError(400, 'PGRST100', `failed to parse filter (${expr})`);
            const values = splitTopLevel(raw.slice(1, -1)).map(unquote);
            pred = (row) => values.includes(asText(row[column]));
            break;
        }
        case 'like':
        case 'ilike': {
            const re = likeRegex(raw, op === 'ilike' ? 'is' : 's');
            pred = (row) => row[column] !== null && re.test(asText(row[column]));
            break;
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            pred = (row) => {
                const a = row[column];
                if (a === null) return false;
                const b = typeof a === 'number' ? Number(raw) : raw;
                return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
            };
            break;
        default:
            throw new RestError(400, 'PGRST100', `mock: unsupported operator ${op}`);
    }
    return negate ? (row) => !pred(row) : pred;
}

function parseOr(table, expr) {
    if (!expr.startsWith('(') || !expr.endsWith(')')) throw new RestError(400, 'PGRST100', `failed to parse logic tree (${expr})`);
    const preds = splitTopLevel(expr.slice(1, -1)).map((item) => {
        const dot = item.indexOf('.');
        return makeFilter(table, item.slice(0, dot), item.slice(dot + 1));
    });
    return (row) => preds.some((p) => p(row));
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseQuery(table, params) {
    const filters = [];
    for (const [key, value] of params) {
        if (RESERVED.has(key)) continue;
        if (key === 'or') filters.push(parseOr(table, value));
        else if (key === 'and') throw new RestError(400, 'PGRST100', 'mock: and= not supported');
        else filters.push(makeFilter(table, key, value));
    }
    let select = null;
    const rawSelect = params.get('select');
    if (rawSelect !== null) {
        select = rawSelect === '*' ? null : rawSelect.split(',').map((c) => c.trim()).filter(Boolean);
        for (const c of select ?? []) {
            if (/[():!]/.test(c)) throw new RestError(400, 'PGRST100', `mock: unsupported select ${c}`);
            checkColumn(table, c);
        }
    }
    const order = (params.get('order') || '')
        .split(',')
        .filter(Boolean)
        .map((part) => {
            const [column, dir = 'asc', nulls] = part.split('.');
            checkColumn(table, column);
            const desc = dir === 'desc';
            return { column, desc, nullsFirst: nulls ? nulls === 'nullsfirst' : desc };
        });
    const limit = params.has('limit') ? Number(params.get('limit')) : null;
    const offset = params.has('offset') ? Number(params.get('offset')) : 0;
    return { match: (row) => filters.every((f) => f(row)), select, order, limit, offset };
}

function compare(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
    const sa = asText(a);
    const sb = asText(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0; // byte order, like the C collation
}

function sortRows(rows, order) {
    return [...rows].sort((x, y) => {
        for (const { column, desc, nullsFirst } of order) {
            const a = x[column] ?? null;
            const b = y[column] ?? null;
            if (a === null || b === null) {
                if (a === b) continue;
                return (a === null) === nullsFirst ? -1 : 1;
            }
            const c = compare(a, b);
            if (c !== 0) return desc ? -c : c;
        }
        return 0;
    });
}

function project(row, select) {
    if (!select) return { ...row };
    return Object.fromEntries(select.map((c) => [c, row[c] ?? null]));
}

function checkBody(table, row) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new RestError(400, 'PGRST102', 'Invalid body');
    for (const key of Object.keys(row)) checkColumn(table, key);
}

function checkNotNull(table, row) {
    for (const c of NOT_NULL[table] ?? []) {
        if (row[c] === null || row[c] === undefined) {
            throw new RestError(400, '23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`);
        }
    }
}

/** Database triggers / constraints that matter for the admin panel. */
function beforeUpdate(table, oldRow, newRow) {
    if (table === 'profiles' && newRow.is_approved && !oldRow.is_approved) {
        const u = state.authUsers.find((x) => x.id === newRow.id);
        if (!u || (!u.email_confirmed_at && !u.phone_confirmed_at)) {
            throw new RestError(403, '42501', 'This account has not confirmed its email or phone yet, so it cannot be approved');
        }
    }
    if (table === 'reports') {
        if (newRow.status === 'pending' && oldRow.status !== 'pending') {
            throw new RestError(403, '42501', 'Use reopen_report() to move a report back to pending');
        }
        if (!['pending', 'verified', 'approved', 'rejected'].includes(newRow.status)) {
            throw new RestError(400, '23514', 'new row for relation "reports" violates check constraint "reports_status_check"');
        }
    }
    if (table === 'alerts' && !['info', 'warning', 'critical'].includes(newRow.severity)) {
        throw new RestError(400, '23514', 'new row for relation "alerts" violates check constraint "alerts_severity_check"');
    }
    if (table === 'profiles' && !['user', 'ewm', 'ewv', 'ewr', 'ldp_coordinator', 'project_staff', 'admin', 'techSupport'].includes(newRow.role)) {
        throw new RestError(400, '23514', 'new row for relation "profiles" violates check constraint "profiles_role_check"');
    }
}

function contentRange(offset, count, total) {
    const range = count === 0 ? '*' : `${offset}-${offset + count - 1}`;
    return `${range}/${total ?? '*'}`;
}

function wantsCount(req) {
    return /count=exact/.test(req.headers.prefer || '');
}

function wantsRepresentation(req) {
    return /return=representation/.test(req.headers.prefer || '');
}

function reply(req, res, status, rows, select, total) {
    const accept = req.headers.accept || '';
    const projected = rows.map((r) => project(r, select));
    const headers = { 'Content-Range': contentRange(0, projected.length, total) };
    if (accept.includes('application/vnd.pgrst.object+json')) {
        if (projected.length !== 1) return pgError(res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
        return send(res, status, projected[0], headers);
    }
    return send(res, status, projected, headers);
}

function nowIso() {
    return new Date().toISOString();
}

function handleRpc(req, res, fn, body) {
    if (fn === 'reopen_report') {
        const r = state.tables.reports.find((x) => x.id === body?.p_report_id);
        if (!r) return pgError(res, 400, 'P0002', 'Report not found');
        if (r.status === 'pending') return pgError(res, 400, '22023', 'Report is already pending');
        Object.assign(r, {
            status: 'pending', verification_count: 0, verified_at: null, auto_validated: false, approved_at: null,
            rejected_at: null, rejection_reason: null, escalated: false, escalated_at: null, escalation_reason: null,
            escalation_status: 'pending', updated_at: nowIso(),
        });
        return send(res, 204);
    }
    return pgError(res, 404, 'PGRST202', `Could not find the function public.${fn}`);
}

function handleRest(req, res, url, body) {
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) return handleRpc(req, res, rpc[1], body);

    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !SCHEMA[m[1]]) return pgError(res, 404, '42P01', `relation "public.${m ? m[1] : url.pathname}" does not exist`);
    const table = m[1];
    const schema = SCHEMA[table];
    const q = parseQuery(table, url.searchParams);
    const rows = state.tables[table];

    if (req.method === 'GET' || req.method === 'HEAD') {
        const matched = sortRows(rows.filter(q.match), q.order);
        const page = matched.slice(q.offset, q.limit === null ? undefined : q.offset + q.limit);
        const total = wantsCount(req) ? matched.length : null;
        const headers = { 'Content-Range': contentRange(q.offset, page.length, total) };
        if (req.method === 'HEAD') return send(res, 200, undefined, headers);
        return send(res, 200, page.map((r) => project(r, q.select)), headers);
    }

    if (req.method === 'POST') {
        const items = Array.isArray(body) ? body : [body];
        items.forEach((item) => checkBody(table, item));
        const prefer = req.headers.prefer || '';
        const merge = /resolution=merge-duplicates/.test(prefer);
        const conflict = url.searchParams.get('on_conflict') || schema.pk;
        const written = [];
        for (const item of items) {
            const existing = merge ? rows.find((r) => r[conflict] === item[conflict]) : null;
            if (existing) {
                const next = { ...existing, ...item };
                if (schema.columns.includes('updated_at') && !('updated_at' in item)) next.updated_at = nowIso();
                checkNotNull(table, next);
                beforeUpdate(table, existing, next);
                Object.assign(existing, next);
                written.push(existing);
                continue;
            }
            if (!merge && item[schema.pk] !== undefined && rows.some((r) => r[schema.pk] === item[schema.pk])) {
                throw new RestError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
            }
            const row = Object.fromEntries(schema.columns.map((c) => [c, null]));
            Object.assign(row, schema.defaults);
            if (schema.pk === 'id') row.id = randomUUID();
            if ('created_at' in row) row.created_at = nowIso();
            if ('updated_at' in row) row.updated_at = nowIso();
            if (table === 'reports') row.submitted_at = nowIso();
            Object.assign(row, item);
            checkNotNull(table, row);
            rows.push(row);
            written.push(row);
        }
        if (!wantsRepresentation(req)) return send(res, 201);
        return reply(req, res, 201, written, q.select, null);
    }

    if (req.method === 'PATCH') {
        checkBody(table, body);
        const matched = rows.filter(q.match);
        for (const row of matched) {
            const next = { ...row, ...body };
            if (schema.columns.includes('updated_at')) next.updated_at = nowIso(); // touch_updated_at trigger
            checkNotNull(table, next);
            beforeUpdate(table, row, next);
        }
        for (const row of matched) {
            Object.assign(row, body);
            if (schema.columns.includes('updated_at')) row.updated_at = nowIso();
        }
        if (!wantsRepresentation(req)) return send(res, 204);
        return reply(req, res, 200, matched, q.select, null);
    }

    if (req.method === 'DELETE') {
        const matched = rows.filter(q.match);
        state.tables[table] = rows.filter((r) => !matched.includes(r));
        if (!wantsRepresentation(req)) return send(res, 204);
        return reply(req, res, 200, matched, q.select, null);
    }

    return pgError(res, 405, 'PGRST117', `Unsupported HTTP method: ${req.method}`);
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
    }

    let body;
    try {
        body = await readBody(req);
    } catch {
        return pgError(res, 400, 'PGRST102', 'Invalid JSON body');
    }

    if (url.pathname.startsWith('/__mock/')) {
        if (url.pathname === '/__mock/health') return send(res, 200, { ok: true });
        if (url.pathname === '/__mock/reset' && req.method === 'POST') {
            state = seed();
            requestLog = [];
            return send(res, 200, { ok: true });
        }
        if (url.pathname === '/__mock/requests') return send(res, 200, requestLog);
        const t = url.pathname.match(/^\/__mock\/table\/([a-z_]+)$/);
        if (t && state.tables[t[1]]) return send(res, 200, state.tables[t[1]]);
        // PATCH /__mock/table/:t/:id — change a row behind the app's back (concurrent edits).
        const r = url.pathname.match(/^\/__mock\/table\/([a-z_]+)\/([^/]+)$/);
        if (r && req.method === 'PATCH' && state.tables[r[1]]) {
            const target = state.tables[r[1]].find((x) => x[SCHEMA[r[1]].pk] === decodeURIComponent(r[2]));
            if (!target) return send(res, 404, { error: 'row not found' });
            Object.assign(target, body);
            return send(res, 200, target);
        }
        return send(res, 404, { error: 'unknown mock endpoint' });
    }

    const entry = {
        method: req.method,
        path: url.pathname,
        query: url.search.replace(/^\?/, ''),
        prefer: req.headers.prefer ?? null,
        body: body ?? null,
        status: 0,
    };
    requestLog.push(entry);
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, ...rest) => {
        entry.status = status;
        return origWriteHead(status, ...rest);
    };

    try {
        if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url, body);
        if (url.pathname.startsWith('/rest/v1/')) return handleRest(req, res, url, body);
        if (url.pathname.startsWith('/storage/v1/object/public/') && (req.method === 'GET' || req.method === 'HEAD')) {
            res.writeHead(200, { ...CORS, 'Content-Type': 'image/png', 'Content-Length': PNG_1PX.length });
            return res.end(req.method === 'HEAD' ? undefined : PNG_1PX);
        }
        return send(res, 404, { message: `Mock: unknown path ${url.pathname}` });
    } catch (error) {
        if (error instanceof RestError) return pgError(res, error.status, error.code, error.message);
        console.error('[mock-supabase]', error);
        return pgError(res, 500, 'XX000', String(error));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[mock-supabase] listening on http://${HOST}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
