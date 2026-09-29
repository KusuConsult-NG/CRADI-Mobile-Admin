'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Clock, Loader2, TrendingUp } from 'lucide-react';
import {
    FLOW_WEEKS,
    loadOperationsStats,
    type AgeBucket,
    type OperationsStats,
    type WeekPoint,
} from '@/lib/operations-stats';

/**
 * "Is the team keeping up?" — the operational half of the dashboard.
 *
 * Colours are the validated defaults: the backlog uses the fixed status
 * palette (a bar's age is a state, not a series) and the flow chart uses
 * categorical slots 1 and 2. Both were checked with the palette validator in
 * light mode, which is the only mode this app has; the dark steps are noted
 * beside each value so adding a dark theme later is a one-place swap.
 *
 * Every figure ships with a label, never colour alone, and the table view at
 * the bottom carries the same numbers for anyone who cannot read the marks.
 */

// status palette (fixed) — dark steps identical, they clear 3:1 on both surfaces
const BUCKET_COLOR: Record<AgeBucket['key'], string> = {
    under1d: '#0ca30c', // good
    d1to3: '#fab219', // warning
    d3to7: '#ec835a', // serious
    over7: '#d03b3b', // critical
};

const SUBMITTED = '#2a78d6'; // categorical slot 1 (dark: #3987e5)
const DECIDED = '#eb6834'; // categorical slot 2 (dark: #d95926)
const SURFACE = '#ffffff';

/** "1 day", not "1 days" — the tiles show single-digit values often. */
function plural(n: number, unit: string): string {
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function Tile({
    icon,
    label,
    value,
    hint,
    tone,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
    tone?: string;
}) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-3 text-gray-600">
                {icon}
                <p className="text-sm">{label}</p>
            </div>
            <h3 className="text-2xl font-bold mb-1" style={tone ? { color: tone } : undefined}>
                {value}
            </h3>
            <p className="text-gray-500 text-xs">{hint}</p>
        </div>
    );
}

function BacklogChart({ buckets }: { buckets: AgeBucket[] }) {
    const max = Math.max(1, ...buckets.map((b) => b.count ?? 0));
    return (
        <div className="space-y-3">
            {buckets.map((b) => {
                const count = b.count;
                const pct = count === null ? 0 : (count / max) * 100;
                return (
                    <div key={b.key}>
                        <div className="flex items-baseline justify-between mb-1">
                            <span className="text-sm text-gray-700">{b.label}</span>
                            <span className="text-sm font-semibold text-gray-900 tabular-nums">
                                {count === null ? '—' : count}
                            </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                            {/* 4px rounded data-end, anchored to the baseline at left */}
                            <div
                                className="h-full rounded-full transition-[width] duration-500"
                                style={{
                                    width: `${count === null ? 0 : Math.max(pct, count > 0 ? 3 : 0)}%`,
                                    backgroundColor: BUCKET_COLOR[b.key],
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function FlowChart({ weeks }: { weeks: WeekPoint[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const W = 520;
    const H = 180;
    const PAD = { top: 16, right: 16, bottom: 28, left: 32 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const max = Math.max(1, ...weeks.flatMap((w) => [w.submitted, w.decided]));
    const x = (i: number) => PAD.left + (weeks.length < 2 ? plotW / 2 : (i / (weeks.length - 1)) * plotW);
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
    const path = (pick: (w: WeekPoint) => number) =>
        weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(w)).toFixed(1)}`).join(' ');

    const label = (iso: string) =>
        new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const active = hover === null ? null : weeks[hover];

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-auto"
                role="img"
                aria-label={`Reports submitted and decided per week over the last ${FLOW_WEEKS} weeks`}
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = ((e.clientX - r.left) / r.width) * W;
                    let best = 0;
                    for (let i = 1; i < weeks.length; i++) {
                        if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
                    }
                    setHover(best);
                }}
            >
                {/* recessive gridlines */}
                {[0, 0.5, 1].map((t) => (
                    <line
                        key={t}
                        x1={PAD.left}
                        x2={W - PAD.right}
                        y1={PAD.top + plotH * t}
                        y2={PAD.top + plotH * t}
                        stroke="#e7e6e2"
                        strokeWidth={1}
                    />
                ))}
                <text x={4} y={PAD.top + 4} fontSize={10} fill="#8a8985">
                    {max}
                </text>
                <text x={4} y={PAD.top + plotH + 4} fontSize={10} fill="#8a8985">
                    0
                </text>

                {hover !== null && (
                    <line
                        x1={x(hover)}
                        x2={x(hover)}
                        y1={PAD.top}
                        y2={PAD.top + plotH}
                        stroke="#c9c8c3"
                        strokeWidth={1}
                    />
                )}

                <path d={path((w) => w.submitted)} fill="none" stroke={SUBMITTED} strokeWidth={2} />
                <path d={path((w) => w.decided)} fill="none" stroke={DECIDED} strokeWidth={2} />

                {weeks.map((w, i) => (
                    <g key={w.start}>
                        {/* 2px surface ring so overlapping markers stay separable */}
                        <circle cx={x(i)} cy={y(w.submitted)} r={4} fill={SUBMITTED} stroke={SURFACE} strokeWidth={2} />
                        <circle cx={x(i)} cy={y(w.decided)} r={4} fill={DECIDED} stroke={SURFACE} strokeWidth={2} />
                    </g>
                ))}

                {weeks.map((w, i) =>
                    (i % 2 === 0 && i < weeks.length - 2) || i === weeks.length - 1 ? (
                        <text
                            key={w.start}
                            x={x(i)}
                            y={H - 8}
                            fontSize={10}
                            fill="#8a8985"
                            textAnchor={i === weeks.length - 1 ? 'end' : 'middle'}
                        >
                            {label(w.start)}
                        </text>
                    ) : null,
                )}
            </svg>

            {active && (
                <div className="absolute top-0 right-0 bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs pointer-events-none">
                    <p className="font-medium text-gray-900 mb-1">Week of {label(active.start)}</p>
                    <p className="flex items-center gap-2 text-gray-700">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SUBMITTED }} />
                        Submitted <span className="font-semibold tabular-nums">{active.submitted}</span>
                    </p>
                    <p className="flex items-center gap-2 text-gray-700">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DECIDED }} />
                        Decided <span className="font-semibold tabular-nums">{active.decided}</span>
                    </p>
                </div>
            )}

            <div className="flex items-center gap-4 mt-2">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: SUBMITTED }} />
                    Submitted
                </span>
                <span className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: DECIDED }} />
                    Decided
                </span>
            </div>
        </div>
    );
}

export default function OperationsPanel() {
    const [stats, setStats] = useState<OperationsStats | null>(null);
    const [showTable, setShowTable] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadOperationsStats()
            .then((s) => {
                if (!cancelled) setStats(s);
            })
            .catch(() => {
                // loadOperationsStats settles every query itself; reaching here
                // means something outside them threw, so show the empty state.
                if (!cancelled) setStats(null);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const pendingTotal = useMemo(
        () => stats?.backlog.reduce((n, b) => n + (b.count ?? 0), 0) ?? 0,
        [stats],
    );

    if (!stats) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
                <div className="flex items-center justify-center py-8 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            </div>
        );
    }

    const overdue = stats.backlog.find((b) => b.key === 'over7')?.count ?? 0;

    return (
        <section aria-labelledby="operations-heading" className="mb-8">
            <h2 id="operations-heading" className="text-lg font-semibold text-gray-900 mb-4">
                Operations
            </h2>

            {stats.degraded && (
                <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
                    Some figures could not be loaded and show as “—”.
                </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <Tile
                    icon={<Clock className="w-5 h-5" />}
                    label="Oldest report still pending"
                    value={
                        stats.oldestPendingDays === null ? '—' : plural(stats.oldestPendingDays, 'day')
                    }
                    hint={pendingTotal === 0 ? 'Nothing waiting' : `${pendingTotal} pending in total`}
                    tone={
                        stats.oldestPendingDays !== null && stats.oldestPendingDays > 7
                            ? BUCKET_COLOR.over7
                            : undefined
                    }
                />
                <Tile
                    icon={<TrendingUp className="w-5 h-5" />}
                    label="Median time to decision"
                    value={
                        stats.medianDecisionHours === null
                            ? '—'
                            : stats.medianDecisionHours >= 48
                              ? plural(Math.round(stats.medianDecisionHours / 24), 'day')
                              : plural(Math.round(stats.medianDecisionHours), 'hour')
                    }
                    hint={`Decided in the last ${FLOW_WEEKS} weeks`}
                />
                <Tile
                    icon={<AlertOctagon className="w-5 h-5" />}
                    label="Escalated, still open"
                    value={stats.escalatedOpen === null ? '—' : String(stats.escalatedOpen)}
                    hint="Passed the escalation window, no decision yet"
                    tone={stats.escalatedOpen ? BUCKET_COLOR.over7 : undefined}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h3 className="font-semibold text-gray-900 mb-1">How long reports have been waiting</h3>
                    <p className="text-sm text-gray-600 mb-4">
                        {overdue > 0
                            ? `${overdue} have been pending more than a week.`
                            : 'Nothing has been pending more than a week.'}
                    </p>
                    <BacklogChart buckets={stats.backlog} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h3 className="font-semibold text-gray-900 mb-1">Arriving vs decided</h3>
                    <p className="text-sm text-gray-600 mb-4">
                        Decisions below arrivals for several weeks means the queue is growing.
                    </p>
                    <FlowChart weeks={stats.weeks} />
                </div>
            </div>

            <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                className="mt-4 text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
            >
                {showTable ? 'Hide the numbers' : 'Show these as a table'}
            </button>

            {showTable && (
                <div className="mt-3 overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-100">
                    <table className="w-full text-sm">
                        <caption className="sr-only">
                            Reports submitted and decided per week, and the pending backlog by age
                        </caption>
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th scope="col" className="text-left px-4 py-2 font-medium">
                                    Week
                                </th>
                                <th scope="col" className="text-right px-4 py-2 font-medium">
                                    Submitted
                                </th>
                                <th scope="col" className="text-right px-4 py-2 font-medium">
                                    Decided
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.weeks.map((w) => (
                                <tr key={w.start} className="border-t border-gray-100">
                                    <td className="px-4 py-2 text-gray-900">
                                        {new Date(w.start).toLocaleDateString(undefined, {
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums">{w.submitted}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{w.decided}</td>
                                </tr>
                            ))}
                            {stats.backlog.map((b) => (
                                <tr key={b.key} className="border-t border-gray-100 bg-gray-50/60">
                                    <td className="px-4 py-2 text-gray-900">Pending: {b.label}</td>
                                    <td className="px-4 py-2 text-right tabular-nums" colSpan={2}>
                                        {b.count === null ? '—' : b.count}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
