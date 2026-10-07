import { Account, Client, Functions, Storage, TablesDB } from 'appwrite';

// NEXT_PUBLIC_* values are inlined at build time, so they must be set in the
// build environment (e.g. Railway service variables) as well as at runtime.
// The project id is public; all data access is enforced by Appwrite's
// collection, document and label permissions.
const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT?.trim() || '';
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID?.trim() || '';

export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID?.trim() || 'cradi';

/**
 * The one Function a client calls, and the routes within it.
 *
 * It was three — `write`, `auth` and `operation` — and the Cloud plan
 * allowed two Functions against the seven the backend needs, so they
 * share an entrypoint that routes on the execution's path. The plan was
 * upgraded on 7 October 2026; the merge stays, because this is what both
 * clients and every test are written against. See
 * `CRADI-mobile/functions/cradi/src/client.js`.
 */
export const CLIENT_FUNCTION =
    process.env.NEXT_PUBLIC_APPWRITE_FN_CLIENT?.trim() || 'client';

export const ROUTES = {
    WRITE: '/write',
    AUTH: '/auth',
    OPERATION: '/operation',
} as const;

/**
 * A value that is set but malformed is worse than one that is missing:
 * `setEndpoint` throws on a bad URL during the first render, which
 * white-screens the whole app with only a console message. Checking the shape
 * here means a wrong value reaches the same "Configuration required" screen a
 * missing one does, naming what is wrong with it.
 */
function endpointProblem(value: string): string | null {
    if (!value) return 'is not set';
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return `is not a valid URL ("${value}") — it must start with https://`;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return `must use http(s), not "${url.protocol}"`;
    }
    // Appwrite's REST base is `/v1`; without it every call 404s against the
    // console's HTML, which reads as "not found" rather than "misconfigured".
    if (!url.pathname.replace(/\/+$/, '').endsWith('/v1')) {
        return `must end in /v1 ("${value}")`;
    }
    return null;
}

const ENDPOINT_PROBLEM = endpointProblem(ENDPOINT);

export const isAppwriteConfigured = Boolean(!ENDPOINT_PROBLEM && PROJECT_ID);

export const MISSING_APPWRITE_ENV = [
    ENDPOINT_PROBLEM && `NEXT_PUBLIC_APPWRITE_ENDPOINT ${ENDPOINT_PROBLEM}`,
    !PROJECT_ID && 'NEXT_PUBLIC_APPWRITE_PROJECT_ID is not set',
].filter((v): v is string => Boolean(v));

export interface Appwrite {
    client: Client;
    account: Account;
    tables: TablesDB;
    functions: Functions;
    storage: Storage;
}

let cached: Appwrite | null = null;

function build(): Appwrite {
    const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
    return {
        client,
        account: new Account(client),
        tables: new TablesDB(client),
        functions: new Functions(client),
        storage: new Storage(client),
    };
}

/**
 * Browser Appwrite client (lazy singleton).
 *
 * The session is a cookie Appwrite sets on sign-in and the SDK sends on every
 * later call, so there is no token to persist ourselves. Only call this from
 * client code (effects / event handlers), never during server rendering.
 */
export function getAppwrite(): Appwrite {
    if (!isAppwriteConfigured) {
        throw new Error(`Appwrite is not configured. Missing: ${MISSING_APPWRITE_ENV.join(', ')}`);
    }
    if (!cached) cached = build();
    return cached;
}

/**
 * A throw-away client for the password-recovery page only.
 *
 * Recovery redeems a typed code for a session, and that session is only good
 * for the password change that follows. Keeping it on its own client means it
 * never replaces a signed-in admin's session and is never seen by the admin
 * guard in lib/auth-context.tsx (which signs out any session that does not
 * belong to an approved admin — that would abort a legitimate reset for a
 * non-admin staff member).
 */
export function createRecoveryClient(): Appwrite {
    if (!isAppwriteConfigured) {
        throw new Error(`Appwrite is not configured. Missing: ${MISSING_APPWRITE_ENV.join(', ')}`);
    }
    return build();
}

/**
 * Converts a stored image reference to a URL that a plain `<img>` can fetch.
 *
 * Appwrite's `/view` is refused without the project, so a bare file id has to
 * be expanded here rather than concatenated at the call site. A value that is
 * already a URL — an admin-set knowledge-base image on another host, or a
 * leftover Supabase URL from before the migration — is returned as it is.
 */
export function publicImageUrl(bucket: string, value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    const fileId = v.replace(/^\/+/, '');
    if (!fileId) return null;
    return `${ENDPOINT}/storage/buckets/${encodeURIComponent(bucket)}/files/${encodeURIComponent(fileId)}/view?project=${encodeURIComponent(PROJECT_ID)}`;
}

/** The configured endpoint, for the CSP's connect-src. */
export const APPWRITE_ENDPOINT = ENDPOINT;
