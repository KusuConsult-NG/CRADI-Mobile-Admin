import { getSupabase } from '@/lib/supabase';
import { TABLES } from '@/lib/constants';

/**
 * The numbers behind the dashboard's operations panel. Kept out of the
 * component so the arithmetic is testable without rendering anything.
 *
 * Everything here answers one question — "is the team keeping up?" — so the
 * shapes are deliberately about the queue rather than about the hazards.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const FLOW_WEEKS = 8;

/** One bucket of the pending backlog, oldest last. */
export interface AgeBucket {
    /** Stable key, also used to pick the status colour. */
    key: 'under1d' | 'd1to3' | 'd3to7' | 'over7';
    label: string;
    /** null when the count could not be read. */
    count: number | null;
}

export interface WeekPoint {
    /** Midnight UTC on the Monday that starts the week. */
    start: string;
    submitted: number;
    decided: number;
}

export interface OperationsStats {
    backlog: AgeBucket[];
    weeks: WeekPoint[];
    /** Age of the oldest report still pending, in whole days. */
    oldestPendingDays: number | null;
    /** Median submitted → decided, in hours, over the window. */
    medianDecisionHours: number | null;
    /** Escalated and still awaiting a decision. */
    escalatedOpen: number | null;
    /** True when at least one query failed, so the panel can say so. */
    degraded: boolean;
}

/** Midnight UTC on the Monday of the week containing `ms`. */
export function weekStart(ms: number): number {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    // getUTCDay: 0 = Sunday. Shift so Monday starts the week.
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime();
}

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rows as the flow query returns them. */
export interface FlowRow {
    submitted_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
}

/**
 * Buckets reports into weeks by when they arrived and when they were decided.
 * A report submitted before the window but decided inside it still counts as a
 * decision — that is the whole point of comparing the two lines.
 */
export function buildFlow(rows: FlowRow[], now: number, weeks = FLOW_WEEKS): WeekPoint[] {
    const firstWeek = weekStart(now) - (weeks - 1) * 7 * DAY;
    const points = new Map<number, WeekPoint>();
    for (let i = 0; i < weeks; i++) {
        const start = firstWeek + i * 7 * DAY;
        points.set(start, { start: new Date(start).toISOString(), submitted: 0, decided: 0 });
    }
    const bump = (iso: string | null, field: 'submitted' | 'decided') => {
        if (!iso) return;
        const t = Date.parse(iso);
        if (Number.isNaN(t)) return;
        const p = points.get(weekStart(t));
        if (p) p[field] += 1;
    };
    for (const r of rows) {
        bump(r.submitted_at, 'submitted');
        // A report is decided once; approved_at wins if somehow both are set.
        bump(r.approved_at ?? r.rejected_at, 'decided');
    }
    return [...points.values()];
}

/** Median hours from submission to decision, over the rows that were decided. */
export function decisionHours(rows: FlowRow[]): number | null {
    const spans: number[] = [];
    for (const r of rows) {
        const decided = r.approved_at ?? r.rejected_at;
        if (!r.submitted_at || !decided) continue;
        const a = Date.parse(r.submitted_at);
        const b = Date.parse(decided);
        if (Number.isNaN(a) || Number.isNaN(b) || b < a) continue;
        spans.push((b - a) / HOUR);
    }
    return median(spans);
}

async function countReports(
    apply: (q: ReturnType<typeof reportsQuery>) => ReturnType<typeof reportsQuery>,
): Promise<number> {
    const { count, error } = await apply(reportsQuery());
    if (error) throw error;
    return count ?? 0;
}

function reportsQuery() {
    return getSupabase().from(TABLES.REPORTS).select('*', { count: 'exact', head: true });
}

/**
 * Loads every figure the panel needs. Each query is settled independently so a
 * single failure blanks one number rather than the whole panel — the same rule
 * the stat cards above it follow.
 */
export async function loadOperationsStats(now = Date.now()): Promise<OperationsStats> {
    const iso = (ms: number) => new Date(ms).toISOString();
    const windowStart = iso(weekStart(now) - (FLOW_WEEKS - 1) * 7 * DAY);

    const results = await Promise.allSettled([
        countReports((q) => q.eq('status', 'pending').gte('submitted_at', iso(now - DAY))),
        countReports((q) =>
            q
                .eq('status', 'pending')
                .gte('submitted_at', iso(now - 3 * DAY))
                .lt('submitted_at', iso(now - DAY)),
        ),
        countReports((q) =>
            q
                .eq('status', 'pending')
                .gte('submitted_at', iso(now - 7 * DAY))
                .lt('submitted_at', iso(now - 3 * DAY)),
        ),
        countReports((q) => q.eq('status', 'pending').lt('submitted_at', iso(now - 7 * DAY))),
        countReports((q) => q.eq('status', 'pending').eq('escalated', true)),
        getSupabase()
            .from(TABLES.REPORTS)
            .select('submitted_at')
            .eq('status', 'pending')
            .order('submitted_at', { ascending: true })
            .limit(1),
        getSupabase()
            .from(TABLES.REPORTS)
            .select('submitted_at,approved_at,rejected_at')
            .or(
                `submitted_at.gte.${windowStart},approved_at.gte.${windowStart},rejected_at.gte.${windowStart}`,
            ),
    ]);

    let degraded = false;
    const num = (i: number): number | null => {
        const r = results[i];
        if (r.status === 'fulfilled') return r.value as number;
        degraded = true;
        return null;
    };

    const labels: [AgeBucket['key'], string][] = [
        ['under1d', 'Under a day'],
        ['d1to3', '1–3 days'],
        ['d3to7', '3–7 days'],
        ['over7', 'Over a week'],
    ];
    const backlog: AgeBucket[] = labels.map(([key, label], i) => ({ key, label, count: num(i) }));
    const escalatedOpen = num(4);

    let oldestPendingDays: number | null = null;
    const oldest = results[5];
    if (oldest.status === 'fulfilled') {
        const rows = (oldest.value as { data: { submitted_at: string }[] | null }).data;
        const at = rows?.[0]?.submitted_at;
        if (at) {
            const t = Date.parse(at);
            if (!Number.isNaN(t)) oldestPendingDays = Math.max(0, Math.floor((now - t) / DAY));
        }
    } else {
        degraded = true;
    }

    let weeks: WeekPoint[] = buildFlow([], now);
    let medianDecisionHours: number | null = null;
    const flow = results[6];
    if (flow.status === 'fulfilled') {
        const rows = (flow.value as { data: FlowRow[] | null }).data ?? [];
        weeks = buildFlow(rows, now);
        medianDecisionHours = decisionHours(rows);
    } else {
        degraded = true;
    }

    return { backlog, weeks, oldestPendingDays, medianDecisionHours, escalatedOpen, degraded };
}
