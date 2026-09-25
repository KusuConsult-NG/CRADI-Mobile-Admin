// Server-only helpers for Next.js API routes. Never import from client code.
import { applicationDefault, cert, getApp, getApps, initializeApp, type App, type Credential } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { NextResponse, type NextRequest } from 'next/server';

const PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ewer-8f788';

const APP_NAME = 'cradi-admin-server';

class NotConfiguredError extends Error {}

interface ServiceAccountJson {
    project_id?: string;
    client_email?: string;
    private_key?: string;
}

function resolveCredential(): Credential {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
        let parsed: ServiceAccountJson;
        try {
            parsed = JSON.parse(raw) as ServiceAccountJson;
        } catch {
            throw new NotConfiguredError('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
        }
        if (!parsed.client_email || !parsed.private_key) {
            throw new NotConfiguredError('FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key');
        }
        return cert({
            projectId: parsed.project_id || PROJECT_ID,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        });
    }

    // Application Default Credentials: an explicit key file, or running on Google Cloud.
    if (
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.K_SERVICE ||
        process.env.FIREBASE_CONFIG ||
        process.env.GOOGLE_CLOUD_PROJECT
    ) {
        return applicationDefault();
    }

    throw new NotConfiguredError('No Firebase Admin credentials found');
}

let cachedApp: App | null = null;

/** Lazily initialises the firebase-admin app (only when a route is actually hit). */
export function getAdminApp(): App {
    if (cachedApp) return cachedApp;
    const existing = getApps().find((a) => a.name === APP_NAME);
    cachedApp = existing
        ? getApp(APP_NAME)
        : initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID }, APP_NAME);
    return cachedApp;
}

export function adminAuth(): Auth {
    return getAuth(getAdminApp());
}

export function adminDb(): Firestore {
    return getFirestore(getAdminApp());
}

export function jsonError(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

type AdminCheck = { ok: true; token: DecodedIdToken } | { ok: false; response: NextResponse };

/**
 * Verifies `Authorization: Bearer <Firebase ID token>` and requires an admin claim
 * (`admin == true` or `role == 'admin'`), matching the Firestore security rules.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminCheck> {
    let auth: Auth;
    try {
        auth = adminAuth();
    } catch (error) {
        if (error instanceof NotConfiguredError) {
            console.error('[firebase-admin] Server not configured:', error.message);
        } else {
            console.error('[firebase-admin] Initialisation failed:', error);
        }
        return {
            ok: false,
            response: jsonError(
                'Server not configured: set FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS) to enable admin actions.',
                500,
            ),
        };
    }

    const header = req.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return { ok: false, response: jsonError('Missing authentication token', 401) };
    }

    let token: DecodedIdToken;
    try {
        token = await auth.verifyIdToken(match[1], true);
    } catch {
        return { ok: false, response: jsonError('Invalid or expired authentication token', 401) };
    }

    if (token.admin !== true && token.role !== 'admin') {
        return { ok: false, response: jsonError('Admin privileges required', 403) };
    }

    return { ok: true, token };
}

/** Returns the Firebase Auth error code of an unknown error, if any. */
export function firebaseErrorCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}
