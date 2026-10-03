import { countRows, listRows, Query } from '@/lib/data';
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
    submittedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
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
        bump(r.submittedAt, 'submitted');
        // A report is decided once; approvedAt wins if somehow both are set.
        bump(r.approvedAt ?? r.rejectedAt, 'decided');
    }
    return [...points.values()];
}

/** Median hours from submission to decision, over the rows that were decided. */
export function decisionHours(rows: FlowRow[]): number | null {
    const spans: number[] = [];
    for (const r of rows) {
        const decided = r.approvedAt ?? r.rejectedAt;
        if (!r.submittedAt || !decided) continue;
        const a = Date.parse(r.submittedAt);
        const b = Date.parse(decided);
        if (Number.isNaN(a) || Number.isNaN(b) || b < a) continue;
        spans.push((b - a) / HOUR);
    }
    return median(spans);
}

const countReports = (queries: string[]) => countRows(TABLES.REPORTS, queries);

/**
 * Loads every figure the panel needs. Each query is settled independently so a
 * single failure blanks one number rather than the whole panel — the same rule
 * the stat cards above it follow.
 */
/**
 * Rejects if `work` has not settled within `ms`.
 *
 * Promise.allSettled waits for every query, and the browser Appwrite client
 * sets no timeout — so one request that hangs rather than failing leaves the
 * panel loading indefinitely, which reads as "the section isn't there". A
 * bounded wait turns that into a visible error.
 */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    return Promise.race([
        work,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms),
        ),
    ]);
}

export const LOAD_TIMEOUT_MS = 15_000;

/**
 * Most rows the flow query will read.
 *
 * Appwrite's own cap is 5,000 per page; PostgREST had no limit here and the
 * query asked for none. Eight weeks of reports is far below this, and
 * `degraded` does not cover a truncated page — so if it is ever reached the
 * numbers are quietly low rather than visibly wrong, which is the argument
 * for keeping it generous.
 */
export const FLOW_ROW_LIMIT = 5000;

export async function loadOperationsStats(now = Date.now()): Promise<OperationsStats> {
    const iso = (ms: number) => new Date(ms).toISOString();
    const windowStart = iso(weekStart(now) - (FLOW_WEEKS - 1) * 7 * DAY);

    const results = await withDeadline(
        Promise.allSettled([
        countReports([
            Query.equal('status', 'pending'),
            Query.greaterThanEqual('submittedAt', iso(now - DAY)),
        ]),
        countReports([
            Query.equal('status', 'pending'),
            Query.greaterThanEqual('submittedAt', iso(now - 3 * DAY)),
            Query.lessThan('submittedAt', iso(now - DAY)),
        ]),
        countReports([
            Query.equal('status', 'pending'),
            Query.greaterThanEqual('submittedAt', iso(now - 7 * DAY)),
            Query.lessThan('submittedAt', iso(now - 3 * DAY)),
        ]),
        countReports([
            Query.equal('status', 'pending'),
            Query.lessThan('submittedAt', iso(now - 7 * DAY)),
        ]),
        countReports([Query.equal('status', 'pending'), Query.equal('escalated', true)]),
        listRows<{ submittedAt: string | null }>(TABLES.REPORTS, [
            Query.equal('status', 'pending'),
            Query.orderAsc('submittedAt'),
            Query.limit(1),
            Query.select(['submittedAt']),
        ]),
        listRows<FlowRow>(TABLES.REPORTS, [
            // Submitted in the window, or decided in it: a report submitted
            // before the window but decided inside it is exactly what the
            // two lines exist to compare.
            Query.or([
                Query.greaterThanEqual('submittedAt', windowStart),
                Query.greaterThanEqual('approvedAt', windowStart),
                Query.greaterThanEqual('rejectedAt', windowStart),
            ]),
            Query.select(['submittedAt', 'approvedAt', 'rejectedAt']),
            // Appwrite pages at 25 rows unless told otherwise, and a silently
            // truncated window would quietly understate the whole panel.
            Query.limit(FLOW_ROW_LIMIT),
        ]),
        ]),
        LOAD_TIMEOUT_MS,
        'Loading the operations figures',
    );

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
        const { rows } = oldest.value as { rows: { submittedAt: string | null }[] };
        const at = rows[0]?.submittedAt;
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
        const { rows } = flow.value as { rows: FlowRow[] };
        weeks = buildFlow(rows, now);
        medianDecisionHours = decisionHours(rows);
    } else {
        degraded = true;
    }

    return { backlog, weeks, oldestPendingDays, medianDecisionHours, escalatedOpen, degraded };
}
