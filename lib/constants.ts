// Shared constants and helpers (safe for both client and server code).
// Values mirror the check constraints in the Supabase schema
// (CRADI-mobile/supabase/migrations/20260925000000_init.sql).

export const TABLES = {
    PROFILES: 'profiles',
    REPORTS: 'reports',
    KNOWLEDGE_BASE: 'knowledge_base',
    CONTACTS: 'contacts',
    ALERTS: 'alerts',
} as const;

export const REPORT_IMAGES_BUCKET = 'report-images';

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

export function isUserRole(value: unknown): value is UserRole {
    return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

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

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface KnowledgeCategory {
    /** Shown to users and stored in `knowledge_base.category`. */
    label: string;
    /** Stored in `knowledge_base.hazard_type`; what the mobile app filters on. */
    hazardType: string;
    /** Other (lower-case) spellings found in older rows. */
    aliases: readonly string[];
}

/**
 * Knowledge-base categories. Must stay identical to the mobile app's list in
 * CRADI-mobile/lib/features/knowledge_base/knowledge_categories.dart.
 */
export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
    { label: 'Flood', hazardType: 'flood', aliases: ['floods', 'flooding'] },
    { label: 'Fire', hazardType: 'fire', aliases: ['wildfire', 'wildfires'] },
    { label: 'Erosion', hazardType: 'erosion', aliases: [] },
    { label: 'Storm', hazardType: 'storm', aliases: ['storms', 'windstorm', 'windstorms'] },
    {
        label: 'Extreme Heat',
        hazardType: 'extreme_heat',
        aliases: ['extreme heat', 'heat', 'heatwave', 'drought'],
    },
    { label: 'Earthquake', hazardType: 'earthquake', aliases: [] },
    { label: 'Disease', hazardType: 'disease', aliases: ['epidemic', 'pest/disease'] },
    { label: 'Conflict', hazardType: 'conflict', aliases: [] },
    { label: 'Accident', hazardType: 'accident', aliases: [] },
    { label: 'Safety', hazardType: 'safety', aliases: [] },
    { label: 'General', hazardType: 'general', aliases: [] },
];

export const DEFAULT_KNOWLEDGE_CATEGORY: KnowledgeCategory =
    KNOWLEDGE_CATEGORIES[KNOWLEDGE_CATEGORIES.length - 1];

/** The category whose hazard type is exactly `hazardType`, or null. */
export function knowledgeCategoryByHazardType(hazardType: string): KnowledgeCategory | null {
    return KNOWLEDGE_CATEGORIES.find((c) => c.hazardType === hazardType) ?? null;
}

/** Extracts a human-readable message from an unknown error value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return fallback;
}

/** Parses a timestamptz string (or Date) into a Date, or null. */
export function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/**
 * Makes user input safe to embed in a PostgREST `or=(...)` / `ilike` filter by
 * removing characters that have syntactic meaning there.
 */
export function sanitizeSearch(value: string): string {
    return value.replace(/[%*,()\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
