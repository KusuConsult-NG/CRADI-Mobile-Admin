// Shared constants and helpers (safe for both client and server code).
// Values mirror the schema in CRADI-mobile/infra/appwrite (columns.json for
// the columns, plan.mjs for how they are provisioned); the enumerations
// below were Postgres check constraints before the Appwrite migration and
// are enforced by the `write` Function now.

export const TABLES = {
    PROFILES: 'profiles',
    REPORTS: 'reports',
    KNOWLEDGE_BASE: 'knowledge_base',
    CONTACTS: 'contacts',
    ALERTS: 'alerts',
    AUTHORITIES: 'authorities',
    APP_SETTINGS: 'app_settings',
    NEWS_LINKS: 'news_links',
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
    /** Stored in `knowledge_base.hazardType`; what the mobile app filters on. */
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
        aliases: ['extreme heat', 'heat', 'heatwave', 'drought', 'extreme temperatures', 'extreme temperature'],
    },
    { label: 'Earthquake', hazardType: 'earthquake', aliases: [] },
    { label: 'Disease', hazardType: 'disease', aliases: ['epidemic', 'pest/disease', 'pest outbreak', 'crop disease'] },
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

export interface ReportHazard {
    /** Canonical value written to `reports.hazardType` by the mobile app. */
    name: string;
    /** Other spellings found in older rows (matched case-insensitively for display, exactly for filtering). */
    aliases: readonly string[];
}

/**
 * Report hazard types. Mirrors CRADI-mobile lib/core/constants/hazards.dart
 * (storedName + aliases); the aliases here are the legacy stored spellings.
 */
export const REPORT_HAZARDS: readonly ReportHazard[] = [
    { name: 'Flooding', aliases: ['Flood', 'Floods', 'flood', 'floods', 'flooding', 'Flash Flood', 'flash flood'] },
    {
        name: 'Extreme Temperatures',
        aliases: ['Extreme Heat', 'Extreme Temperature', 'Heat', 'Heatwave', 'extreme heat', 'extreme temperature', 'extreme temperatures', 'heat', 'heatwave', 'heat wave', 'temp'],
    },
    { name: 'Drought', aliases: ['drought'] },
    { name: 'Windstorms', aliases: ['Windstorm', 'Storm', 'Storms', 'windstorm', 'windstorms', 'storm', 'high winds', 'high wind', 'wind'] },
    { name: 'Wildfires', aliases: ['Wildfire', 'Fire', 'Bush Fire', 'wildfire', 'wildfires', 'fire', 'bush fire', 'bushfire'] },
    { name: 'Erosion', aliases: ['erosion', 'Gully Erosion', 'gully erosion', 'landslide'] },
    { name: 'Pest Outbreak', aliases: ['Pests', 'Pest', 'pest', 'pests', 'pest outbreak', 'pest/disease', 'Pest/Disease'] },
    { name: 'Crop Disease', aliases: ['Crop Diseases', 'Disease', 'crop disease', 'crop diseases', 'disease'] },
    { name: 'Conflict', aliases: ['Conflicts', 'Violence', 'conflict', 'conflicts', 'violence'] },
];

/** Canonical hazard name for a stored (possibly legacy) value, or the value itself when unknown. */
export function canonicalHazardName(raw: string): string {
    const value = raw.trim().toLowerCase();
    const hit = REPORT_HAZARDS.find(
        (h) => h.name.toLowerCase() === value || h.aliases.some((a) => a.toLowerCase() === value),
    );
    return hit ? hit.name : raw;
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
 * Normalises a search box's value before it becomes a query.
 *
 * Nothing is stripped for safety any more: an Appwrite query is JSON, so
 * `%`, `(` and an apostrophe carry no syntax, where in a PostgREST
 * `or=(...)` / `ilike` filter they did and had to go. Removing them is now
 * only destructive — six LGAs and plenty of names have apostrophes, and
 * searching "Qua'an Pan" found nothing.
 *
 * What is left is whitespace collapsing and a length cap, so a pasted
 * paragraph does not become the query.
 */
export function sanitizeSearch(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
