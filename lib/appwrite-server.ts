// Server-only Appwrite helpers for Next.js API routes. Never import from client code.
import 'server-only';
import { Account, Client, TablesDB, Users } from 'node-appwrite';
import { NextResponse, type NextRequest } from 'next/server';
import { TABLES } from '@/lib/constants';

class NotConfiguredError extends Error {}

export interface AdminClients {
    /** Full access, bypassing collection and document permissions. */
    tables: TablesDB;
    users: Users;
}

let cached: AdminClients | null = null;

const ENDPOINT = () =>
    (process.env.APPWRITE_ENDPOINT || process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || '').trim();
const PROJECT = () =>
    (process.env.APPWRITE_PROJECT_ID || process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '').trim();

export const DATABASE_ID = () =>
    (process.env.APPWRITE_DATABASE_ID || process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || 'cradi').trim();

/**
 * Lazily creates the API-key clients, which bypass every permission the way
 * the Supabase service-role key bypassed RLS. Only initialised when an API
 * route is actually hit, so builds work without the secret.
 */
export function appwriteAdmin(): AdminClients {
    if (cached) return cached;
    const endpoint = ENDPOINT();
    const project = PROJECT();
    const apiKey = (process.env.APPWRITE_API_KEY || '').trim();
    if (!endpoint || !project || !apiKey) {
        throw new NotConfiguredError(
            'NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID and APPWRITE_API_KEY are required',
        );
    }
    const client = new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
    cached = { tables: new TablesDB(client), users: new Users(client) };
    return cached;
}

export function jsonError(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

type AdminCheck =
    | { ok: true; callerId: string; admin: AdminClients }
    | { ok: false; response: NextResponse };

/**
 * Verifies `Authorization: Bearer <Appwrite JWT>` and requires the caller's
 * profile to be an approved, non-disabled admin (the same rule the `write`
 * Function applies, and the same one `public.app_role()` applied before it).
 *
 * A JWT rather than a session cookie: the panel's own calls are
 * cross-origin to Appwrite, and `account.createJWT()` is the credential
 * Appwrite provides for handing a browser session to a server.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminCheck> {
    let admin: AdminClients;
    try {
        admin = appwriteAdmin();
    } catch (error) {
        console.error('[appwrite-server] Server not configured:', errorText(error));
        return { ok: false, response: jsonError('Server is not configured for admin actions.', 500) };
    }

    const header = req.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
        return { ok: false, response: jsonError('Missing authentication token', 401) };
    }

    let callerId: string;
    try {
        // A JWT-scoped client acts as the user it was minted for, so
        // `account.get()` is how the server learns who that is.
        const asCaller = new Client().setEndpoint(ENDPOINT()).setProject(PROJECT()).setJWT(match[1]);
        const user = await new Account(asCaller).get();
        callerId = user.$id;
    } catch {
        return { ok: false, response: jsonError('Invalid or expired authentication token', 401) };
    }

    let profile: Record<string, unknown>;
    try {
        profile = await admin.tables.getRow({
            databaseId: DATABASE_ID(),
            tableId: TABLES.PROFILES,
            rowId: callerId,
        });
    } catch (error) {
        if (isNotFoundError(error)) {
            return { ok: false, response: jsonError('Admin privileges required', 403) };
        }
        console.error('[appwrite-server] Failed to load caller profile:', errorText(error));
        return { ok: false, response: jsonError('Could not verify permissions', 500) };
    }

    if (profile.role !== 'admin' || profile.isApproved !== true || profile.isDisabled === true) {
        return { ok: false, response: jsonError('Admin privileges required', 403) };
    }

    return { ok: true, callerId, admin };
}

export function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const e = error as { code?: unknown; type?: unknown };
    return e.code === 404 || e.type === 'user_not_found' || e.type === 'document_not_found' || e.type === 'row_not_found';
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
