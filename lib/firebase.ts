import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Public Firebase web config for project `ewer-8f788` (same project as the
// CRADI mobile app). These values are not secrets; access is enforced by
// Firebase Auth + Firestore security rules. Env vars can override them.
const firebaseConfig: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBLBBkjPb8zMACJWHpzKTiUpGjnaJMnZ4k',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:689251502200:web:1697afa7d602215e7e458d',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '689251502200',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ewer-8f788',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'ewer-8f788.firebaseapp.com',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ewer-8f788.firebasestorage.app',
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

export const COLLECTIONS = {
    USERS: 'users',
    REPORTS: 'reports',
    KNOWLEDGE_BASE: 'knowledge_base',
    CONTACTS: 'contacts',
} as const;

export const USER_ROLES = [
    'user',
    'ewm',
    'ewv',
    'ewr',
    'ldp_coordinator',
    'project_staff',
    'admin',
    'techSupport',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
    user: 'User',
    ewm: 'EW Monitor',
    ewv: 'EW Verifier',
    ewr: 'EW Responder',
    ldp_coordinator: 'LDP Coordinator',
    project_staff: 'Project Staff',
    admin: 'Admin',
    techSupport: 'Tech Support',
};

export const REPORT_STATUSES = ['pending', 'verified', 'approved', 'rejected'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const KNOWLEDGE_CATEGORIES = [
    'Flood',
    'Drought',
    'Erosion',
    'Storm',
    'Earthquake',
    'Disease',
    'Conflict',
    'General',
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** Extracts a human-readable message from an unknown error value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return fallback;
}

/** Firestore stores dates either as ISO strings (mobile app) or Timestamps. */
export function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
        const fn = (value as { toDate: unknown }).toDate;
        if (typeof fn === 'function') return (fn as () => Date).call(value);
    }
    return null;
}
