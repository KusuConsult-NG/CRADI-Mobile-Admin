// An in-memory Appwrite, enough for the admin panel's end-to-end tests.
//
// It speaks the slice of Appwrite's REST API the panel uses — accounts,
// `tablesdb` rows, Function executions and the server-side Users API — and
// keeps the control surface the Supabase mock had, so the fixtures and the
// specs did not have to be rewritten around it:
//
//   POST /__mock/reset      restore the seed data and clear the request log
//   GET  /__mock/requests   request log [{ method, path, query, prefer, body, status }]
//   GET  /__mock/table/:t   current rows of a table
//   GET  /__mock/health     liveness
//
// What it deliberately does NOT do is re-implement the `write` Function's
// authorisation. The Supabase mock did not implement RLS either: the rules
// live in the server and are tested there (CRADI-mobile's 154 Function unit
// tests, and four end-to-end suites against a real Appwrite). Duplicating
// them here would make this a second source of truth that drifts, and the
// drift would show up as tests that pass while the product is broken. What
// it does implement is the *contract* the panel depends on: which fields the
// server stamps, and the 409 an `expect` clause produces.
//
// Attributes are validated against the schema below, the way the real server
// does — "Attribute not found in schema" is a mistake worth catching here
// rather than in production (it shipped once; see CRADI-mobile Phase 19).
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const HOST = process.env.MOCK_APPWRITE_HOST || '127.0.0.1';
const PORT = Number(process.env.MOCK_APPWRITE_PORT || 54321);
const PROJECT = process.env.MOCK_APPWRITE_PROJECT || 'cradi';
const DATABASE = process.env.MOCK_APPWRITE_DATABASE || 'cradi';
const API_KEY = process.env.MOCK_APPWRITE_KEY || 'test';

// Appwrite ids, not UUIDs: accounts made through the `auth` Function use
// `unique()`, which answers with a 20-character id.
const IDS = {
    admin: 'adminaccount00000001',
    pendingConfirmed: 'pendingconfirmed0002',
    pendingUnconfirmed: 'pendingunconfirm0003',
    approved: 'approvedaccount00004',
    blocked: 'blockedaccount000005',
};

// Columns per collection, from CRADI-mobile/infra/appwrite/columns.json.
// Unknown attributes in queries, selects and bodies are rejected the way
// Appwrite rejects them.
const SCHEMA = {
    profiles: {
        columns: ['email', 'name', 'role', 'address', 'state', 'lga', 'ward', 'phone', 'isVerified', 'isApproved', 'isDisabled', 'biometricsEnabled', 'profileImageUrl', 'monitoringZone', 'registrationCode', 'lastLoginAt', 'legacyFirebaseUid', 'createdAt', 'updatedAt'],
        defaults: { name: 'User', role: 'user', address: '', state: '', lga: '', ward: '', phone: '', isVerified: false, isApproved: false, isDisabled: false },
    },
    reports: {
        columns: ['userId', 'reporterName', 'hazardType', 'severity', 'latitude', 'longitude', 'locationDetails', 'location', 'address', 'ward', 'lga', 'state', 'description', 'submittedAt', 'imageUrls', 'status', 'type', 'isAlert', 'verificationCount', 'verifiedAt', 'autoValidated', 'approvedAt', 'rejectedAt', 'rejectionReason', 'escalated', 'escalatedAt', 'escalationReason', 'escalationScheduledAt', 'escalationStatus', 'updatedBy', 'syncedAt', 'legacyFirebaseId', 'createdAt', 'updatedAt'],
        defaults: { severity: 'medium', locationDetails: '', location: '', address: '', ward: '', state: '', description: '', imageUrls: [], status: 'pending', isAlert: false, verificationCount: 0, autoValidated: false, escalated: false },
    },
    contacts: {
        columns: ['userId', 'name', 'role', 'phone', 'organization', 'lga', 'category', 'isAvailable', 'createdAt', 'updatedAt'],
        defaults: { role: '', category: 'other', isAvailable: true },
    },
    knowledge_base: {
        columns: ['title', 'content', 'source', 'category', 'hazardType', 'imageUrl', 'legacyFirebaseId', 'createdAt', 'updatedAt'],
        defaults: { content: '', source: '', category: 'General', hazardType: 'general', imageUrl: null },
    },
    alerts: {
        columns: ['title', 'message', 'severity', 'targetLga', 'targetLgaCanonical', 'targetState', 'reportId', 'createdBy', 'isActive', 'createdAt', 'updatedAt'],
        defaults: { message: '', severity: 'info', targetLga: 'All', targetState: null, isActive: true },
    },
    authorities: {
        columns: ['name', 'organization', 'phone', 'coverageLga', 'coverageState', 'createdAt', 'updatedAt'],
        defaults: { name: '', organization: null },
    },
    app_settings: { columns: ['key', 'value', 'updatedAt'], defaults: {} },
    news_links: {
        columns: ['title', 'url', 'source', 'sortOrder', 'isActive', 'createdAt', 'updatedAt'],
        defaults: { source: '', sortOrder: 0, isActive: true },
    },
};

/** Appwrite's own fields, usable in queries and never in a body. */
const SYSTEM = ['$id', '$createdAt', '$updatedAt', '$permissions', '$sequence'];

const REQUIRED = {
    reports: ['hazardType', 'lga'],
    alerts: ['title'],
    // coverageState is required: an LGA name alone can mean two states, so a
    // contact must always name its own.
    authorities: ['phone', 'coverageLga', 'coverageState'],
    knowledge_base: ['title'],
    app_settings: ['value'],
    news_links: ['title', 'url', 'source', 'sortOrder', 'isActive'],
};

function iso(daysAgo, minutes = 0) {
    return new Date(Date.UTC(2026, 8, 20) - daysAgo * 86400000 - minutes * 60000).toISOString();
}

/** Appwrite stamps these on every row; the panel reads `$id`. */
function stamp(id, data, createdAt = iso(10)) {
    return {
        $id: id,
        $createdAt: createdAt,
        $updatedAt: createdAt,
        $permissions: [],
        $sequence: 0,
        ...data,
    };
}

function profile(id, fields, createdAt) {
    return stamp(
        id,
        {
            email: null, name: 'User', role: 'user', address: '', state: '', lga: '', ward: '', phone: '',
            isVerified: false, isApproved: false, isDisabled: false, biometricsEnabled: false,
            profileImageUrl: '', monitoringZone: '', registrationCode: null, lastLoginAt: null,
            legacyFirebaseUid: null, createdAt: createdAt ?? iso(10), updatedAt: createdAt ?? iso(10),
            ...fields,
        },
        createdAt ?? iso(10),
    );
}

function report(n, fields) {
    const at = iso(0, n * 10);
    return stamp(
        `report0000000000${String(n).padStart(4, '0')}`,
        {
            userId: IDS.approved, reporterName: 'Bola Approved', hazardType: 'Flooding', severity: 'medium',
            latitude: null, longitude: null, locationDetails: '', location: '', address: '', ward: 'Obi Ward',
            lga: 'Obi', state: 'Benue', description: '', submittedAt: at, imageUrls: [],
            status: 'pending', type: null, isAlert: false, verificationCount: 0, verifiedAt: null,
            autoValidated: false, approvedAt: null, rejectedAt: null, rejectionReason: null, escalated: false,
            escalatedAt: null, escalationReason: null, escalationScheduledAt: null, escalationStatus: null,
            updatedBy: null, syncedAt: null, legacyFirebaseId: null, createdAt: at, updatedAt: at,
            ...fields,
        },
        at,
    );
}

function seed() {
    const users = [
        { $id: IDS.admin, email: 'admin@cradi.test', password: 'admin-pass', name: 'Grace Admin', emailVerification: true, phoneVerification: false, status: true },
        { $id: IDS.pendingConfirmed, email: 'ada@cradi.test', password: 'ada-pass', name: 'Ada Confirmed', emailVerification: true, phoneVerification: false, status: true },
        { $id: IDS.pendingUnconfirmed, email: 'uche@cradi.test', password: 'uche-pass', name: 'Uche Unconfirmed', emailVerification: false, phoneVerification: false, status: true },
        { $id: IDS.approved, email: 'bola@cradi.test', password: 'bola-pass', name: 'Bola Approved', emailVerification: true, phoneVerification: false, status: true },
        { $id: IDS.blocked, email: 'chidi@cradi.test', password: 'chidi-pass', name: 'Chidi Blocked', emailVerification: true, phoneVerification: false, status: false },
    ];
    const rows = {
        profiles: [
            profile(IDS.admin, { email: 'admin@cradi.test', name: 'Grace Admin', role: 'admin', isApproved: true, isVerified: true, state: 'Benue', lga: 'Makurdi', ward: 'Agan' }, iso(30)),
            profile(IDS.pendingConfirmed, { email: 'ada@cradi.test', name: 'Ada Confirmed', role: 'ewm', phone: '+2348030000002', state: 'Benue', lga: 'Ado', ward: 'Apa' }, iso(1)),
            profile(IDS.pendingUnconfirmed, { email: 'uche@cradi.test', name: 'Uche Unconfirmed', role: 'ewv' }, iso(2)),
            profile(IDS.approved, { email: 'bola@cradi.test', name: 'Bola Approved', role: 'ewv', isApproved: true, isVerified: true, state: 'Benue', lga: 'Obi', ward: 'Obi Ward' }, iso(3)),
            profile(IDS.blocked, { email: 'chidi@cradi.test', name: 'Chidi Blocked', role: 'ewm', isApproved: true, isDisabled: true, state: 'Plateau', lga: "Qua'an Pan", ward: 'Bwall' }, iso(4)),
        ],
        reports: [
            report(1, { hazardType: 'Flooding', description: 'River Benue overflowing', severity: 'high', imageUrls: ['reports/flood-1.jpg', 'https://images.example/flood-2.jpg'] }),
            report(2, { hazardType: 'Extreme Temperatures', description: 'Heatwave in the market' }),
            report(3, { hazardType: 'Drought', description: 'Wells running dry', status: 'approved', approvedAt: iso(0) }),
            report(4, { hazardType: 'Windstorms', description: 'Roofs blown off' }),
            report(5, { hazardType: 'Wildfires', description: 'Bush burning near farms', status: 'verified', verificationCount: 2 }),
            report(6, { hazardType: 'Erosion', description: 'Gully widening on the road' }),
            report(7, { hazardType: 'Pest Outbreak', description: 'Locusts on millet' }),
            report(8, { hazardType: 'Crop Disease', description: 'Cassava mosaic' }),
            report(9, { hazardType: 'Conflict', description: 'Herder clash reported', status: 'rejected', rejectionReason: 'Duplicate' }),
            report(10, { hazardType: 'Floods', description: 'Legacy flood row' }),
            report(11, { hazardType: 'Windstorms', type: 'verification_request', description: 'Please verify: storm damage' }),
        ],
        authorities: [
            stamp(randomUUID(), { name: 'Ado Emergency Desk', organization: 'SEMA Benue', phone: '+2348031234567', coverageLga: 'Ado', coverageState: 'Benue', createdAt: iso(9), updatedAt: iso(9) }, iso(9)),
            stamp(randomUUID(), { name: "Qua'an Pan Desk", organization: null, phone: '+2348039999999', coverageLga: "Qua'an Pan", coverageState: 'Plateau', createdAt: iso(8), updatedAt: iso(8) }, iso(8)),
            // An LGA the panel does not know: the list flags it rather than
            // showing it as normal.
            stamp(randomUUID(), { name: 'Old Contact', organization: null, phone: '12345', coverageLga: 'Nowhere', coverageState: 'Benue', createdAt: iso(7), updatedAt: iso(7) }, iso(7)),
        ],
        app_settings: [
            stamp('minimum_peer_confirmations', { key: 'minimum_peer_confirmations', value: 2, updatedAt: iso(6) }, iso(6)),
            stamp('escalation_timeout_minutes', { key: 'escalation_timeout_minutes', value: '30', updatedAt: iso(6) }, iso(6)),
            stamp('feature_flag_peer_chat', { key: 'feature_flag_peer_chat', value: true, updatedAt: iso(6) }, iso(6)),
            stamp('app_min_version', { key: 'app_min_version', value: '1.0.0', updatedAt: iso(6) }, iso(6)),
            stamp('support_email', { key: 'support_email', value: 'support@cradi.org', updatedAt: iso(6) }, iso(6)),
            stamp('unrelated_key', { key: 'unrelated_key', value: 'ignored', updatedAt: iso(6) }, iso(6)),
        ],
        alerts: [
            stamp(randomUUID(), { title: 'Flood warning', message: 'Move to higher ground', severity: 'warning', targetLga: 'Makurdi', targetState: null, reportId: null, createdBy: IDS.admin, isActive: true, createdAt: iso(1), updatedAt: iso(1) }, iso(1)),
            stamp(randomUUID(), { title: 'Old drill', message: 'Past exercise', severity: 'info', targetLga: 'All', targetState: null, reportId: null, createdBy: IDS.admin, isActive: false, createdAt: iso(5), updatedAt: iso(5) }, iso(5)),
        ],
        knowledge_base: [
            stamp(randomUUID(), { title: 'Flood safety basics', content: 'Stay away from flood water.', source: 'NEMA', category: 'Flood', hazardType: 'flood', imageUrl: null, legacyFirebaseId: null, createdAt: iso(4), updatedAt: iso(4) }, iso(4)),
            stamp(randomUUID(), { title: 'Legacy floods guide', content: 'Old article with a legacy category.', source: 'NiMet', category: 'Floods', hazardType: 'flooding', imageUrl: null, legacyFirebaseId: null, createdAt: iso(6), updatedAt: iso(6) }, iso(6)),
        ],
        contacts: [
            stamp(randomUUID(), { userId: IDS.admin, name: 'Police', role: '', phone: '112', organization: null, lga: null, category: 'police', isAvailable: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp(randomUUID(), { userId: IDS.admin, name: 'Fire', role: '', phone: '113', organization: null, lga: null, category: 'fire', isAvailable: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp(randomUUID(), { userId: IDS.approved, name: 'Clinic', role: '', phone: '114', organization: null, lga: 'Obi', category: 'health', isAvailable: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
        ],
        news_links: [
            stamp('news0000000000000001', { title: 'Flood Safety: What to do before, during, and after', url: 'https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/flood.html', source: 'Safety Guide', sortOrder: 10, isActive: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp('news0000000000000002', { title: 'NiMet Seasonal Climate Prediction', url: 'https://nimet.gov.ng/', source: 'NiMet', sortOrder: 20, isActive: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp('news0000000000000003', { title: 'Emergency Contact Directory: Nigeria', url: 'https://www.redcrossnigeria.org/', source: 'Red Cross', sortOrder: 30, isActive: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp('news0000000000000004', { title: 'Understanding Early Warning Systems', url: 'https://www.undrr.org/terminology/early-warning-system', source: 'UNDRR', sortOrder: 40, isActive: true, createdAt: iso(3), updatedAt: iso(3) }, iso(3)),
            stamp(randomUUID(), { title: 'Archived bulletin', url: 'http://example.org/old-bulletin', source: '', sortOrder: 50, isActive: false, createdAt: iso(2), updatedAt: iso(2) }, iso(2)),
        ],
    };
    return {
        users,
        rows,
        sessions: new Map(),
        jwts: new Map(),
        // Codes the `auth` Function would have emailed. Single use.
        recoveryCodes: new Map([
            ['A1B2C3', { userId: IDS.admin, expiresAt: Date.now() + 3600_000 }],
            ['D4E5F6', { userId: IDS.approved, expiresAt: Date.now() + 3600_000 }],
            ['EXPIRE', { userId: IDS.admin, expiresAt: Date.now() - 1000 }],
        ]),
    };
}

/** Appwrite's default page size, and its ceiling. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 5000;

let state = seed();
let requestLog = [];

class AppwriteError extends Error {
    constructor(status, type, message) {
        super(message);
        this.status = status;
        this.type = type;
    }
}

/**
 * The origin is reflected rather than `*`, and credentials are allowed.
 *
 * The Appwrite SDK sends its session cookie on every call, and a browser
 * refuses a credentialed response whose `Allow-Origin` is the wildcard —
 * which fails as a CORS error in the console rather than as a 4xx, so it
 * reads like the panel is broken rather than the mock.
 */
function cors(req) {
    return {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers':
            'content-type,x-appwrite-project,x-appwrite-key,x-appwrite-jwt,x-appwrite-session,x-appwrite-response-format,x-sdk-name,x-sdk-platform,x-sdk-language,x-sdk-version,x-appwrite-locale',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-expose-headers': 'x-appwrite-session,x-fallback-cookies',
        'access-control-max-age': '86400',
        vary: 'Origin',
    };
}

function send(res, status, body, headers = {}) {
    const payload = body === null ? '' : JSON.stringify(body);
    res.writeHead(status, {
        // No content-type on an empty body. The SDK parses anything it is
        // told is JSON, so claiming it on a 204 makes `deleteSession`
        // fail with `Unexpected ''` — a parse error where the real server
        // sends no body and no type.
        ...(body === null ? {} : { 'content-type': 'application/json' }),
        'content-length': Buffer.byteLength(payload),
        ...res.corsHeaders,
        ...headers,
    });
    res.end(payload);
    return status;
}

function fail(res, error) {
    return send(res, error.status, {
        message: error.message,
        code: error.status,
        type: error.type,
        version: 'mock',
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > 5_000_000) reject(new Error('body too large'));
            else chunks.push(c);
        });
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text) return resolve(undefined);
            try {
                resolve(JSON.parse(text));
            } catch {
                resolve(text);
            }
        });
        req.on('error', reject);
    });
}

// ───────────────────────────── queries ──────────────────────────────────

function knownAttribute(table, attribute) {
    if (SYSTEM.includes(attribute)) return true;
    return SCHEMA[table].columns.includes(attribute);
}

function assertAttribute(table, attribute) {
    if (!knownAttribute(table, attribute)) {
        throw new AppwriteError(
            400,
            'general_query_invalid',
            `Invalid query: Attribute not found in schema: ${attribute}`,
        );
    }
}

function valueOf(row, attribute) {
    return attribute in row ? row[attribute] : null;
}

/** One Appwrite query object against one row. */
function matches(table, row, query) {
    const { method, attribute, values } = query;
    if (method === 'or') return values.some((q) => matches(table, row, parseQuery(q)));
    if (method === 'and') return values.every((q) => matches(table, row, parseQuery(q)));

    assertAttribute(table, attribute);
    const actual = attribute === '$id' ? row.$id : valueOf(row, attribute);

    switch (method) {
        case 'equal':
            return values.some((v) => (Array.isArray(actual) ? actual.includes(v) : actual === v));
        case 'notEqual':
            return !values.some((v) => actual === v);
        case 'isNull':
            return actual === null || actual === undefined;
        case 'isNotNull':
            return actual !== null && actual !== undefined;
        case 'contains':
            // Case-insensitive substring on a string, membership on a list —
            // which is what the real server does, and what the panel's search
            // relies on.
            if (Array.isArray(actual)) return values.every((v) => actual.includes(v));
            return values.some((v) => String(actual ?? '').toLowerCase().includes(String(v).toLowerCase()));
        case 'startsWith':
            return values.some((v) => String(actual ?? '').toLowerCase().startsWith(String(v).toLowerCase()));
        case 'greaterThan':
            return values.some((v) => actual !== null && actual > v);
        case 'greaterThanEqual':
            return values.some((v) => actual !== null && actual >= v);
        case 'lessThan':
            return values.some((v) => actual !== null && actual < v);
        case 'lessThanEqual':
            return values.some((v) => actual !== null && actual <= v);
        default:
            throw new AppwriteError(400, 'general_query_invalid', `Invalid query: unsupported method ${method}`);
    }
}

/**
 * The `queries` parameters of a request, however they are spelled.
 *
 * The SDK sends them indexed — `queries[0]=…&queries[1]=…` — while
 * `curl` and the docs use `queries[]=…`. Reading only `queries[]` found
 * none of the SDK's, so this returned every row unfiltered, unordered
 * and unpaged, and the panel's tests passed against data that had been
 * silently ignored. Anything else that looks like a query parameter is
 * an error rather than a third spelling nobody notices.
 */
function queriesFrom(url) {
    const out = [];
    for (const [key, value] of url.searchParams) {
        if (!key.startsWith('queries')) continue;
        if (key === 'queries[]' || /^queries\[\d+\]$/.test(key)) {
            out.push(value);
            continue;
        }
        throw new AppwriteError(400, 'general_argument_invalid', `Unrecognised query parameter: ${key}`);
    }
    return out;
}

function parseQuery(raw) {
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        throw new AppwriteError(400, 'general_query_invalid', `Invalid query: ${raw}`);
    }
}

function compare(a, b) {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return String(a).localeCompare(String(b));
}

/**
 * Applies a query list to a table: filters, orders, pages and projects.
 *
 * Returns the page *and* the total matching the filters, which is what
 * Appwrite answers with and what the panel's paging reads.
 */
function applyQueries(table, rows, rawQueries) {
    const queries = (rawQueries ?? []).map(parseQuery);
    const filters = [];
    const order = [];
    let limit = DEFAULT_LIMIT;
    let offset = 0;
    let select = null;

    for (const q of queries) {
        switch (q.method) {
            case 'limit':
                limit = Math.min(Number(q.values[0]), MAX_LIMIT);
                break;
            case 'offset':
                offset = Number(q.values[0]);
                break;
            case 'orderAsc':
            case 'orderDesc':
                assertAttribute(table, q.attribute);
                order.push({ attribute: q.attribute, descending: q.method === 'orderDesc' });
                break;
            case 'select':
                for (const attribute of q.values) assertAttribute(table, attribute);
                select = q.values;
                break;
            default:
                filters.push(q);
        }
    }

    let out = rows.filter((row) => filters.every((q) => matches(table, row, q)));
    for (const { attribute, descending } of [...order].reverse()) {
        out = [...out].sort((a, b) => {
            const d = compare(
                attribute === '$id' ? a.$id : valueOf(a, attribute),
                attribute === '$id' ? b.$id : valueOf(b, attribute),
            );
            return descending ? -d : d;
        });
    }
    const total = out.length;
    out = out.slice(offset, offset + limit);
    if (select) {
        out = out.map((row) => {
            const picked = { $id: row.$id, $createdAt: row.$createdAt, $updatedAt: row.$updatedAt, $permissions: row.$permissions, $sequence: row.$sequence };
            for (const attribute of select) if (!attribute.startsWith('$')) picked[attribute] = valueOf(row, attribute);
            return picked;
        });
    }
    return { total, rows: out };
}

// ───────────────────────────── writes ───────────────────────────────────

function assertWritable(table, data) {
    for (const key of Object.keys(data)) {
        if (!SCHEMA[table].columns.includes(key)) {
            throw new AppwriteError(
                400,
                'row_invalid_structure',
                `Invalid document structure: Unknown attribute: "${key}"`,
            );
        }
    }
}

function assertRequired(table, row) {
    for (const key of REQUIRED[table] ?? []) {
        if (row[key] === null || row[key] === undefined || row[key] === '') {
            throw new AppwriteError(
                400,
                'row_invalid_structure',
                `Invalid document structure: Missing required attribute "${key}"`,
            );
        }
    }
}

function tableOf(name) {
    if (!SCHEMA[name]) throw new AppwriteError(404, 'table_not_found', `Table with the requested ID could not be found.`);
    state.rows[name] ??= [];
    return state.rows[name];
}

function createRow(table, rowId, data) {
    const rows = tableOf(table);
    assertWritable(table, data);
    const id = !rowId || rowId === 'unique()' ? randomUUID() : rowId;
    if (rows.some((r) => r.$id === id)) {
        throw new AppwriteError(409, 'document_already_exists', 'Document with the requested ID already exists.');
    }
    const now = new Date().toISOString();
    const row = stamp(id, { ...SCHEMA[table].defaults, ...data }, now);
    assertRequired(table, row);
    rows.push(row);
    return row;
}

function updateRowById(table, rowId, data) {
    const rows = tableOf(table);
    assertWritable(table, data);
    const index = rows.findIndex((r) => r.$id === rowId);
    if (index < 0) throw new AppwriteError(404, 'row_not_found', 'Row with the requested ID could not be found.');
    const next = { ...rows[index], ...data, $updatedAt: new Date().toISOString() };
    assertRequired(table, next);
    rows[index] = next;
    return next;
}

/** `updateRows`: the compare-and-set the `write` Function's `expect` uses. */
function updateRowsWhere(table, queries, data) {
    const rows = tableOf(table);
    assertWritable(table, data);
    const parsed = (queries ?? []).map(parseQuery);
    const hits = rows.filter((row) => parsed.every((q) => matches(table, row, q)));
    const now = new Date().toISOString();
    for (const row of hits) Object.assign(row, data, { $updatedAt: now });
    return { total: hits.length, rows: hits };
}

function deleteRowById(table, rowId) {
    const rows = tableOf(table);
    const index = rows.findIndex((r) => r.$id === rowId);
    if (index < 0) throw new AppwriteError(404, 'row_not_found', 'Row with the requested ID could not be found.');
    rows.splice(index, 1);
}

// ───────────────────────────── sessions ─────────────────────────────────

function userById(id) {
    return state.users.find((u) => u.$id === id) ?? null;
}

function publicUser(user) {
    return {
        $id: user.$id,
        $createdAt: iso(30),
        $updatedAt: iso(30),
        name: user.name,
        email: user.email,
        phone: '',
        status: user.status,
        emailVerification: user.emailVerification,
        phoneVerification: user.phoneVerification,
        labels: [],
        prefs: {},
    };
}

/** The account a request speaks for: a session cookie, or a JWT. */
function caller(req) {
    const jwt = req.headers['x-appwrite-jwt'];
    if (jwt) {
        const id = state.jwts.get(jwt);
        return id ? userById(id) : null;
    }
    const header = req.headers['x-appwrite-session'];
    if (header) {
        const id = state.sessions.get(header);
        return id ? userById(id) : null;
    }
    const cookie = /a_session_[^=]+=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (cookie) {
        const id = state.sessions.get(decodeURIComponent(cookie));
        return id ? userById(id) : null;
    }
    return null;
}

function requireCaller(req) {
    const user = caller(req);
    if (!user) {
        throw new AppwriteError(401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)');
    }
    return user;
}

function isServer(req) {
    return req.headers['x-appwrite-key'] === API_KEY;
}

const MIN_PASSWORD_LENGTH = 8;

// ───────────────────────────── functions ────────────────────────────────

/**
 * What the `write` Function does to a payload, as far as the panel can
 * tell: the server-owned fields it stamps, and the 409 an `expect` clause
 * produces. Its authorisation rules are the server's and are tested there.
 */
function runWrite(user, payload) {
    const { op, collection, documentId, data = {}, expect } = payload;
    if (!SCHEMA[collection]) {
        return { status: 403, body: { message: `${collection} is not writable through this Function` } };
    }
    try {
        if (op === 'delete') {
            deleteRowById(collection, documentId);
            return { status: 200, body: {} };
        }
        if (op === 'update') {
            if (expect && Object.keys(expect).length > 0) {
                const queries = [
                    JSON.stringify({ method: 'equal', attribute: '$id', values: [documentId] }),
                    ...Object.entries(expect).map(([attribute, value]) =>
                        value === null
                            ? JSON.stringify({ method: 'isNull', attribute })
                            : JSON.stringify({ method: 'equal', attribute, values: [value] }),
                    ),
                ];
                const applied = updateRowsWhere(collection, queries, data);
                if (applied.total === 0) {
                    const exists = tableOf(collection).some((r) => r.$id === documentId);
                    if (!exists) {
                        return { status: 404, body: { message: 'That no longer exists', type: 'row_not_found' } };
                    }
                    return {
                        status: 409,
                        body: {
                            message: 'That changed since you loaded it — reload and try again.',
                            type: 'document_already_exists',
                        },
                    };
                }
                return { status: 200, body: { document: applied.rows[0] } };
            }
            return { status: 200, body: { document: updateRowById(collection, documentId, data) } };
        }
        // create / upsert
        const stamped = { ...data };
        if (collection === 'reports') {
            // Server-owned at creation, whatever the client sent.
            Object.assign(stamped, {
                userId: user.$id,
                status: 'pending',
                verificationCount: 0,
                escalated: false,
            });
        }
        if (collection === 'alerts') stamped.createdBy = user.$id;
        const existing = tableOf(collection).find((r) => r.$id === documentId);
        if (existing && op === 'upsert') {
            return { status: 200, body: { document: updateRowById(collection, documentId, stamped) } };
        }
        return { status: 200, body: { document: createRow(collection, documentId, stamped) } };
    } catch (error) {
        if (error instanceof AppwriteError) {
            return { status: error.status, body: { message: error.message, type: error.type } };
        }
        throw error;
    }
}

/** `reopen_report`, as far as the panel can tell. */
function runOperation(user, payload) {
    if (payload.operation !== 'reopen_report') {
        return { status: 400, body: { message: `Unknown operation: ${payload.operation}`, type: 'general_argument_invalid' } };
    }
    const id = payload.params?.p_report_id;
    const row = tableOf('reports').find((r) => r.$id === id);
    if (!row) return { status: 404, body: { message: 'That report no longer exists', type: 'row_not_found' } };
    if (row.status === 'pending') {
        return { status: 400, body: { message: 'That report is already pending', type: 'general_argument_invalid' } };
    }
    Object.assign(row, {
        status: 'pending',
        verificationCount: 0,
        verifiedAt: null,
        autoValidated: false,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        escalated: false,
        escalatedAt: null,
        escalationReason: null,
        escalationStatus: 'pending',
        updatedBy: user.$id,
        $updatedAt: new Date().toISOString(),
    });
    return { status: 200, body: { document: row } };
}

function runAuth(payload) {
    const { action } = payload;
    if (action === 'sendRecoveryCode') {
        // Answers the same whether or not the address exists.
        return { status: 200, body: {} };
    }
    if (action === 'verifyRecovery') {
        const entry = state.recoveryCodes.get(String(payload.code ?? '').toUpperCase());
        const user = entry ? userById(entry.userId) : null;
        if (!entry || !user || entry.expiresAt < Date.now() || user.email !== String(payload.email ?? '').trim()) {
            return { status: 401, body: { message: 'That code is invalid or has expired.', type: 'user_invalid_token' } };
        }
        state.recoveryCodes.delete(String(payload.code).toUpperCase());
        const secret = `recovery-${randomUUID()}`;
        state.sessions.set(secret, user.$id);
        return { status: 200, body: { sessionSecret: secret, userId: user.$id } };
    }
    if (action === 'setPassword') {
        return { status: 200, body: {} };
    }
    return { status: 400, body: { message: `Unknown action: ${action}`, type: 'general_argument_invalid' } };
}

/** An execution, shaped the way a 1.9 server answers. */
function execution(functionId, result) {
    return {
        $id: randomUUID(),
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
        $permissions: [],
        functionId,
        deploymentId: 'mock',
        trigger: 'http',
        status: 'completed',
        requestMethod: 'POST',
        requestPath: '/',
        requestHeaders: [],
        responseStatusCode: result.status,
        responseBody: JSON.stringify(result.body),
        responseHeaders: [],
        logs: '',
        errors: '',
        duration: 0.01,
    };
}

// ───────────────────────────── routing ──────────────────────────────────

/** `/v1/...` as the SDK sends it, with the prefix removed. */
function routePath(pathname) {
    return pathname.startsWith('/v1/') ? pathname.slice(3) : pathname;
}

async function route(req, res, url, body) {
    const path = routePath(url.pathname);
    const method = req.method ?? 'GET';
    const queries = queriesFrom(url);

    // ── account ──────────────────────────────────────────────────────
    if (path === '/account' && method === 'GET') {
        return send(res, 200, publicUser(requireCaller(req)));
    }
    if (path === '/account/sessions/email' && method === 'POST') {
        const email = String(body?.email ?? '').trim().toLowerCase();
        const user = state.users.find((u) => u.email.toLowerCase() === email);
        if (!user || user.password !== body?.password) {
            throw new AppwriteError(401, 'user_invalid_credentials', 'Invalid credentials. Please check the email and password.');
        }
        if (!user.status) {
            throw new AppwriteError(401, 'user_blocked', 'The current user has been blocked.');
        }
        const secret = `session-${randomUUID()}`;
        state.sessions.set(secret, user.$id);
        return send(
            res,
            201,
            { $id: randomUUID(), userId: user.$id, secret, expire: iso(-30), current: true },
            { 'set-cookie': `a_session_${PROJECT}=${encodeURIComponent(secret)}; Path=/; SameSite=None; Secure=false` },
        );
    }
    if (path === '/account/sessions/current' && method === 'DELETE') {
        const header = req.headers['x-appwrite-session'];
        const cookie = /a_session_[^=]+=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        const key = header ?? (cookie ? decodeURIComponent(cookie) : null);
        if (!key || !state.sessions.has(key)) {
            throw new AppwriteError(401, 'general_unauthorized_scope', 'User (role: guests) missing scope (account)');
        }
        state.sessions.delete(key);
        return send(res, 204, null, { 'set-cookie': `a_session_${PROJECT}=; Path=/; Max-Age=0` });
    }
    if (path === '/account/jwts' && method === 'POST') {
        const user = requireCaller(req);
        const jwt = `jwt-${randomUUID()}`;
        state.jwts.set(jwt, user.$id);
        return send(res, 201, { jwt });
    }
    if (path === '/account/password' && method === 'PATCH') {
        const user = requireCaller(req);
        if (String(body?.password ?? '').length < MIN_PASSWORD_LENGTH) {
            throw new AppwriteError(400, 'general_password_weak', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        user.password = body.password;
        return send(res, 200, publicUser(user));
    }

    // ── rows ─────────────────────────────────────────────────────────
    const rows = path.match(/^\/tablesdb\/([^/]+)\/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
    if (rows) {
        const [, database, table, rowId] = rows;
        if (database !== DATABASE) {
            throw new AppwriteError(404, 'database_not_found', 'Database with the requested ID could not be found.');
        }
        const all = tableOf(table);
        if (method === 'GET' && rowId) {
            const row = all.find((r) => r.$id === decodeURIComponent(rowId));
            if (!row) throw new AppwriteError(404, 'row_not_found', 'Row with the requested ID could not be found.');
            return send(res, 200, row);
        }
        if (method === 'GET') {
            return send(res, 200, applyQueries(table, all, queries));
        }
        if (method === 'POST') {
            return send(res, 201, createRow(table, body?.rowId, body?.data ?? {}));
        }
        if (method === 'PATCH' && rowId) {
            return send(res, 200, updateRowById(table, decodeURIComponent(rowId), body?.data ?? {}));
        }
        if (method === 'PATCH') {
            // Queries belong in the body. The real server ignores them in the
            // query string and updates *every* row, which is a footgun worth
            // not reproducing here — this refuses instead.
            if (queries.length > 0) {
                throw new AppwriteError(400, 'general_argument_invalid', 'Bulk update queries belong in the body, not the query string.');
            }
            return send(res, 200, updateRowsWhere(table, body?.queries, body?.data ?? {}));
        }
        if (method === 'PUT' && rowId) {
            const id = decodeURIComponent(rowId);
            const existing = all.find((r) => r.$id === id);
            return existing
                ? send(res, 200, updateRowById(table, id, body?.data ?? {}))
                : send(res, 201, createRow(table, id, body?.data ?? {}));
        }
        if (method === 'DELETE' && rowId) {
            deleteRowById(table, decodeURIComponent(rowId));
            return send(res, 204, null);
        }
    }

    // ── functions ────────────────────────────────────────────────────
    const fn = path.match(/^\/functions\/([^/]+)\/executions$/);
    if (fn && method === 'POST') {
        const id = fn[1];
        const payload = typeof body?.body === 'string' ? JSON.parse(body.body) : (body?.body ?? {});
        // `auth` runs for a guest: recovery starts before there is a session.
        if (id === 'auth') return send(res, 201, execution(id, runAuth(payload)));

        const user = requireCaller(req);
        let result;
        if (id === 'write') result = runWrite(user, payload);
        else if (id === 'operation') result = runOperation(user, payload);
        else throw new AppwriteError(404, 'function_not_found', 'Function with the requested ID could not be found.');
        return send(res, 201, execution(id, result));
    }

    // ── users (server, API key) ──────────────────────────────────────
    const user = path.match(/^\/users\/([^/]+)(\/status)?$/);
    if (user) {
        if (!isServer(req)) {
            throw new AppwriteError(401, 'general_unauthorized_scope', 'app.current (role: applications) missing scope (users.read)');
        }
        const target = userById(decodeURIComponent(user[1]));
        if (!target) throw new AppwriteError(404, 'user_not_found', 'User with the requested ID could not be found.');
        if (user[2] === '/status' && method === 'PATCH') {
            target.status = body?.status === true;
            return send(res, 200, publicUser(target));
        }
        if (method === 'GET') return send(res, 200, publicUser(target));
        if (method === 'DELETE') {
            state.users = state.users.filter((u) => u.$id !== target.$id);
            return send(res, 204, null);
        }
    }

    if (path === '/health' || path === '/health/version') {
        return send(res, 200, { version: 'mock' });
    }

    throw new AppwriteError(404, 'general_route_not_found', `The requested route was not found. (${method} ${path})`);
}

// ───────────────────────────── server ───────────────────────────────────

const server = createServer((req, res) => {
    void (async () => {
        const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
        res.corsHeaders = cors(req);
        if (req.method === 'OPTIONS') {
            res.writeHead(204, res.corsHeaders);
            res.end();
            return;
        }

        // Control surface.
        if (url.pathname === '/__mock/health') {
            send(res, 200, { ok: true });
            return;
        }
        if (url.pathname === '/__mock/reset' && req.method === 'POST') {
            state = seed();
            requestLog = [];
            send(res, 200, { ok: true });
            return;
        }
        if (url.pathname === '/__mock/requests') {
            send(res, 200, requestLog);
            return;
        }
        if (url.pathname.startsWith('/__mock/table/')) {
            const table = url.pathname.slice('/__mock/table/'.length);
            send(res, 200, state.rows[table] ?? []);
            return;
        }

        const body = await readBody(req).catch(() => undefined);
        let status;
        try {
            status = await route(req, res, url, body);
        } catch (error) {
            status =
                error instanceof AppwriteError
                    ? fail(res, error)
                    : fail(res, new AppwriteError(500, 'general_unknown', String(error?.message ?? error)));
        }
        requestLog.push({
            method: req.method ?? 'GET',
            path: routePath(url.pathname),
            query: url.search.replace(/^\?/, ''),
            // Kept for the fixtures' shape; Appwrite has no `Prefer` header.
            prefer: null,
            body: body ?? null,
            status,
        });
    })();
});

server.listen(PORT, HOST, () => {
    console.log(`mock Appwrite on http://${HOST}:${PORT} (project ${PROJECT}, database ${DATABASE})`);
});
