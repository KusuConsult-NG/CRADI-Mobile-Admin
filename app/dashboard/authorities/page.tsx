'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import { TABLES, errorMessage, sanitizeSearch, toDate } from '@/lib/constants';
import { isLga } from '@/lib/lgas';
import { LOCATIONS, STATES, isLgaInState, lgasForState } from '@/lib/wards';
import { normalizeNigerianPhone } from '@/lib/phone';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { Landmark, Loader2, Plus, Search, Pencil, Trash2, AlertTriangle, Info } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 25;
/** PostgREST caps every response at max-rows (1000 on Supabase): read coverage in pages of this size. */
const COVERAGE_PAGE_SIZE = 1000;
const NAME_MAX = 120;
const ORGANIZATION_MAX = 120;

interface Authority {
    id: string;
    name: string;
    organization: string;
    phone: string;
    coverageLga: string;
    /** '' for legacy rows (coverage_state NULL): they match the LGA name in every state. */
    coverageState: string;
    updatedAt: Date | null;
}

interface AuthorityRow {
    id: string;
    name: string | null;
    organization: string | null;
    phone: string | null;
    coverage_lga: string | null;
    coverage_state: string | null;
    updated_at: string | null;
}

interface AuthorityForm {
    /** Set when editing an existing row. */
    id?: string;
    name: string;
    organization: string;
    phone: string;
    /**
     * Value of the LGA select: `${state}|${lga}` (see lgaKey). A legacy row whose
     * LGA name exists in several states starts as `|${lga}` until a state is chosen.
     */
    coverage: string;
}

const EMPTY_FORM: AuthorityForm = { name: '', organization: '', phone: '', coverage: '' };

/**
 * Unique key / select value for an LGA: names repeat across states (Obi is in
 * Benue and Nasarawa), so the state is part of it. `state` is '' for legacy rows.
 */
function lgaKey(state: string, lga: string): string {
    return `${state}|${lga}`;
}

function parseLgaKey(key: string): { state: string; lga: string } {
    const i = key.indexOf('|');
    return i < 0 ? { state: '', lga: key } : { state: key.slice(0, i), lga: key.slice(i + 1) };
}

/** States that have an LGA named `lga`. */
function statesWithLga(lga: string): string[] {
    return LOCATIONS.filter((l) => l.lga === lga).map((l) => l.state);
}

/** True when the authority's LGA (and state, when set) is one reports can carry. */
function isKnownCoverage(state: string, lga: string): boolean {
    return state ? isLgaInState(state, lga) : isLga(lga);
}

/** "Obi, Benue", or just the LGA for legacy rows without a state. */
function coverageLabel(state: string, lga: string): string {
    return state ? `${lga}, ${state}` : lga;
}

/** Double-quotes a value for a PostgREST `or=(...)` list (commas, dots and parens are reserved). */
function quoteFilterValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Initial select value when editing: legacy rows get their state filled in when the LGA name is unambiguous. */
function coverageForEdit(a: Authority): string {
    if (a.coverageState) return isLgaInState(a.coverageState, a.coverageLga) ? lgaKey(a.coverageState, a.coverageLga) : '';
    const states = statesWithLga(a.coverageLga);
    if (states.length === 1) return lgaKey(states[0], a.coverageLga);
    return states.length > 1 ? lgaKey('', a.coverageLga) : '';
}

const INPUT_CLASS =
    'w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none';

function toAuthority(row: AuthorityRow): Authority {
    return {
        id: row.id,
        name: row.name?.trim() ?? '',
        organization: row.organization?.trim() ?? '',
        phone: row.phone?.trim() ?? '',
        coverageLga: row.coverage_lga ?? '',
        coverageState: row.coverage_state?.trim() ?? '',
        updatedAt: toDate(row.updated_at),
    };
}

export default function AuthoritiesPage() {
    const { user, loading: authLoading } = useAuth();
    const [authorities, setAuthorities] = useState<Authority[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [lgaFilter, setLgaFilter] = useState('all');
    const [reloadKey, setReloadKey] = useState(0);

    /** (state, lga) of every authority (for the gaps panel); null while unknown. */
    const [coverage, setCoverage] = useState<{ state: string; lga: string }[] | null>(null);

    const [form, setForm] = useState<AuthorityForm | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Authority | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Debounce the search box; a new search starts again at the first page.
    useEffect(() => {
        const next = sanitizeSearch(searchInput);
        if (next === searchQuery) return;
        const handle = setTimeout(() => {
            setSearchQuery(next);
            setPage(0);
        }, 350);
        return () => clearTimeout(handle);
    }, [searchInput, searchQuery]);

    useEffect(() => {
        // Signed-out users are redirected by app/dashboard/layout.tsx.
        if (!user) return;

        let cancelled = false;
        async function load() {
            setLoading(true);
            let query = getSupabase()
                .from(TABLES.AUTHORITIES)
                .select('id, name, organization, phone, coverage_lga, coverage_state, updated_at', { count: 'exact' })
                .order('coverage_lga', { ascending: true })
                .order('coverage_state', { ascending: true })
                .order('name', { ascending: true })
                .order('id', { ascending: true })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (lgaFilter !== 'all') {
                // Everyone texted for that LGA: its state's contacts plus legacy rows without a state.
                const { state, lga } = parseLgaKey(lgaFilter);
                query = query
                    .eq('coverage_lga', lga)
                    .or(`coverage_state.eq.${quoteFilterValue(state)},coverage_state.is.null`);
            }
            if (searchQuery) {
                const p = `*${searchQuery}*`;
                query = query.or(
                    `name.ilike.${p},organization.ilike.${p},coverage_lga.ilike.${p},coverage_state.ilike.${p},phone.ilike.${p}`,
                );
            }
            const { data, count, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error fetching authorities:', error);
                toast.error('Failed to load authorities.');
                setAuthorities([]);
                setTotalCount(null);
            } else {
                const rows = (data ?? []) as AuthorityRow[];
                if (rows.length === 0 && page > 0) {
                    // Past the last page (rows changed elsewhere): step back.
                    const lastPage = count ? Math.ceil(count / PAGE_SIZE) - 1 : page - 1;
                    setPage(Math.max(0, Math.min(page - 1, lastPage)));
                    return;
                }
                setAuthorities(rows.map(toAuthority));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, lgaFilter, searchQuery, reloadKey]);

    // Coverage across all authorities, independent of the list's filters.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        async function loadCoverage() {
            // Page through every row: a single request is silently truncated at
            // max-rows, which would report covered LGAs as gaps.
            const rows: { coverage_lga: string | null; coverage_state: string | null }[] = [];
            for (let from = 0; ; from += COVERAGE_PAGE_SIZE) {
                const { data, error } = await getSupabase()
                    .from(TABLES.AUTHORITIES)
                    .select('coverage_lga, coverage_state')
                    .order('id', { ascending: true })
                    .range(from, from + COVERAGE_PAGE_SIZE - 1);
                if (cancelled) return;
                if (error) {
                    console.error('Error fetching authority coverage:', error);
                    setCoverage(null);
                    return;
                }
                const page = (data ?? []) as typeof rows;
                rows.push(...page);
                if (page.length < COVERAGE_PAGE_SIZE) break;
            }
            setCoverage(
                rows.map((r) => ({
                    lga: r.coverage_lga ?? '',
                    state: r.coverage_state?.trim() ?? '',
                })),
            );
        }
        void loadCoverage();
        return () => {
            cancelled = true;
        };
    }, [user, reloadKey]);

    const coverageInfo = useMemo(() => {
        if (!coverage) return null;
        // A contact with a state covers that (state, LGA) only; a legacy contact
        // without a state covers the LGA name in every state (the backend texts it for all).
        const withState = new Set<string>();
        const anyState = new Set<string>();
        for (const c of coverage) {
            if (c.state) withState.add(lgaKey(c.state, c.lga));
            else anyState.add(c.lga);
        }
        const covered = (state: string, lga: string) => anyState.has(lga) || withState.has(lgaKey(state, lga));
        const gapsByState = STATES.map((state) => ({
            state,
            lgas: lgasForState(state).filter((lga) => !covered(state, lga)),
        })).filter((g) => g.lgas.length > 0);
        const uncovered = gapsByState.reduce((n, g) => n + g.lgas.length, 0);
        const unknown = Array.from(
            new Set(coverage.filter((c) => !isKnownCoverage(c.state, c.lga)).map((c) => coverageLabel(c.state, c.lga))),
        ).sort();
        return { gapsByState, uncovered, unknown };
    }, [coverage]);

    function reload() {
        setReloadKey((k) => k + 1);
    }

    function updateForm<K extends keyof AuthorityForm>(key: K, value: AuthorityForm[K]) {
        setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    }

    const normalizedPhone = form ? normalizeNigerianPhone(form.phone) : null;
    const formLga = parseLgaKey(form?.coverage ?? '');
    /** Legacy row whose LGA name exists in several states: the admin must pick one. */
    const formNeedsState = !!form && !formLga.state && isLga(formLga.lga);

    async function saveAuthority(e: React.FormEvent) {
        e.preventDefault();
        if (!form || saving) return;
        const name = form.name.trim();
        const organization = form.organization.trim();
        const phone = normalizeNigerianPhone(form.phone);
        if (!name) {
            toast.error('Name is required.');
            return;
        }
        if (!phone) {
            toast.error('Enter a valid Nigerian phone number, e.g. 0803 123 4567 or +2348031234567.');
            return;
        }
        const { state, lga } = parseLgaKey(form.coverage);
        if (!isLga(lga)) {
            toast.error('Choose the LGA this contact covers.');
            return;
        }
        if (!isLgaInState(state, lga)) {
            toast.error(`Choose the state of ${lga}: the name exists in ${statesWithLga(lga).join(' and ')}.`);
            return;
        }
        const where = coverageLabel(state, lga);

        setSaving(true);
        try {
            const supabase = getSupabase();
            // The same number twice in one (state, LGA) would only be texted once; refuse the
            // duplicate. A legacy row without a state already covers this LGA in every state.
            // Stored phones may predate normalisation ("0803 123 4567"), so compare
            // the normalised forms of every contact for this LGA, not the raw column.
            let dup = supabase
                .from(TABLES.AUTHORITIES)
                .select('id, phone')
                .eq('coverage_lga', lga)
                .or(`coverage_state.eq.${quoteFilterValue(state)},coverage_state.is.null`);
            if (form.id) dup = dup.neq('id', form.id);
            const { data: dupRows, error: dupError } = await dup;
            if (dupError) throw dupError;
            const existing = (dupRows ?? []) as { id: string; phone: string | null }[];
            if (existing.some((r) => normalizeNigerianPhone(r.phone) === phone)) {
                toast.error(`${phone} is already listed for ${where}.`);
                return;
            }

            const values = {
                name,
                organization: organization || null,
                phone,
                coverage_lga: lga,
                coverage_state: state,
            };
            const { data, error } = form.id
                ? await supabase.from(TABLES.AUTHORITIES).update(values).eq('id', form.id).select('id')
                : await supabase.from(TABLES.AUTHORITIES).insert(values).select('id');
            if (error) throw error;
            // RLS filters rows silently: no row back means the write was not allowed.
            if (!data || data.length === 0) throw new Error('Not found or not permitted');
            toast.success(form.id ? 'Authority updated' : 'Authority added');
            setForm(null);
            reload();
        } catch (error) {
            console.error('Error saving authority:', error);
            toast.error(`Failed to save authority: ${errorMessage(error)}`);
        } finally {
            setSaving(false);
        }
    }

    async function confirmDelete() {
        if (!deleteTarget || deletingId) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        setDeletingId(target.id);
        try {
            const { data, error } = await getSupabase()
                .from(TABLES.AUTHORITIES)
                .delete()
                .eq('id', target.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Not found or not permitted');
            toast.success('Authority deleted');
            if (authorities.length === 1 && page > 0) setPage((p) => p - 1);
            else reload();
        } catch (error) {
            console.error('Error deleting authority:', error);
            toast.error(`Failed to delete authority: ${errorMessage(error)}`);
        } finally {
            setDeletingId(null);
        }
    }

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div>
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-lg flex items-center justify-center">
                            <Landmark className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Authorities</h1>
                            <p className="text-xs text-gray-600">SMS contacts for approved reports, per LGA</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
                <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <p>
                        Every number listed here receives an SMS when a report in its LGA is approved. The LGA and
                        state must match the report&apos;s exactly, so they are chosen from the fixed list (some LGA
                        names, such as Obi, exist in more than one state). Contacts saved before states were recorded
                        are texted for that LGA name in every state until edited. Per approved report
                        only the oldest contacts up to the <em>max SMS per alert event</em> setting are texted, and
                        each LGA is capped by <em>max SMS per LGA per day</em> (see Settings).
                    </p>
                </div>

                {/* Coverage gaps */}
                <section
                    aria-labelledby="coverage-heading"
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-6"
                >
                    <h2 id="coverage-heading" className="text-lg font-semibold text-gray-900 mb-1">
                        LGAs without an authority
                    </h2>
                    {!coverageInfo ? (
                        <p className="text-sm text-gray-500">Loading coverage…</p>
                    ) : coverageInfo.uncovered === 0 ? (
                        <p className="text-sm text-green-700">Every LGA has at least one authority.</p>
                    ) : (
                        <>
                            <p className="text-sm text-gray-600 mb-4">
                                {coverageInfo.uncovered} of {LOCATIONS.length} LGAs have no contact: approving a report
                                there sends no SMS to anyone.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {coverageInfo.gapsByState.map((g) => (
                                    <div key={g.state}>
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">
                                            {g.state} ({g.lgas.length})
                                        </h3>
                                        <ul className="flex flex-wrap gap-1.5">
                                            {g.lgas.map((lga) => (
                                                <li key={lga}>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setForm({ ...EMPTY_FORM, coverage: lgaKey(g.state, lga) })
                                                        }
                                                        title={`Add an authority for ${coverageLabel(g.state, lga)}`}
                                                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                                                    >
                                                        {lga}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {coverageInfo && coverageInfo.unknown.length > 0 && (
                        <p className="mt-4 flex gap-2 text-sm text-red-700">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                            <span>
                                Some contacts use an LGA name that matches no report and will never be texted:{' '}
                                {coverageInfo.unknown.map((l) => `“${l}”`).join(', ')}. Edit them and pick the LGA
                                from the list.
                            </span>
                        </p>
                    )}
                </section>

                {/* Search + filter */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, organisation, LGA or phone..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            aria-label="Search authorities"
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>
                    <select
                        value={lgaFilter}
                        onChange={(e) => {
                            setLgaFilter(e.target.value);
                            setPage(0);
                        }}
                        aria-label="Filter authorities by LGA"
                        className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        <option value="all">All LGAs</option>
                        {STATES.map((state) => (
                            <optgroup key={state} label={state}>
                                {lgasForState(state).map((lga) => (
                                    <option key={lgaKey(state, lga)} value={lgaKey(state, lga)}>
                                        {lga}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <button
                        onClick={() => setForm(EMPTY_FORM)}
                        className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-medium text-white bg-gradient-to-r from-[#E63946] to-[#9D0208] hover:opacity-90 transition-opacity"
                    >
                        <Plus className="w-5 h-5" />
                        Add Authority
                    </button>
                </div>

                {/* List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        {['Name', 'Organisation', 'Phone', 'LGA', 'Updated', 'Actions'].map((h) => (
                                            <th
                                                key={h}
                                                className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {authorities.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                                No authorities found
                                            </td>
                                        </tr>
                                    ) : (
                                        authorities.map((a) => {
                                            const phoneOk = normalizeNigerianPhone(a.phone) !== null;
                                            const lgaOk = isKnownCoverage(a.coverageState, a.coverageLga);
                                            const label = a.name || a.phone || 'authority';
                                            return (
                                                <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 font-medium text-gray-900">
                                                        {a.name || '—'}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {a.organization || '—'}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">
                                                        {a.phone}
                                                        {!phoneOk && (
                                                            <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                                                Invalid number
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {a.coverageLga || '—'}
                                                        {a.coverageState ? (
                                                            <span className="block text-xs text-gray-500">
                                                                {a.coverageState}
                                                            </span>
                                                        ) : (
                                                            a.coverageLga && (
                                                                <span className="block text-xs text-amber-700">
                                                                    State not set
                                                                </span>
                                                            )
                                                        )}
                                                        {!lgaOk && (
                                                            <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                                                Unknown LGA
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {a.updatedAt ? a.updatedAt.toLocaleDateString() : '—'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {deletingId === a.id ? (
                                                            <div className="p-2">
                                                                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() =>
                                                                        setForm({
                                                                            id: a.id,
                                                                            name: a.name,
                                                                            organization: a.organization,
                                                                            phone: a.phone,
                                                                            coverage: coverageForEdit(a),
                                                                        })
                                                                    }
                                                                    disabled={deletingId !== null}
                                                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Edit authority"
                                                                    aria-label={`Edit ${label}`}
                                                                >
                                                                    <Pencil className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setDeleteTarget(a)}
                                                                    disabled={deletingId !== null}
                                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Delete authority"
                                                                    aria-label={`Delete ${label}`}
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={totalCount}
                            itemCount={authorities.length}
                            noun="authorities"
                            disabled={loading}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>

            {/* Create / edit */}
            {form && (
                <Modal
                    title={form.id ? 'Edit Authority' : 'Add Authority'}
                    titleClassName="text-xl font-bold mb-2 text-gray-900"
                    onClose={() => setForm(null)}
                    closeDisabled={saving}
                    className="max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
                >
                    <form onSubmit={(e) => void saveAuthority(e)} noValidate>
                        <p className="text-sm text-gray-600 mb-4">
                            This number will receive an SMS whenever a report in the selected LGA is approved.
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="authority-name" className="block text-sm font-medium text-gray-700 mb-1">
                                    Name
                                </label>
                                <input
                                    id="authority-name"
                                    type="text"
                                    required
                                    maxLength={NAME_MAX}
                                    value={form.name}
                                    onChange={(e) => updateForm('name', e.target.value)}
                                    placeholder="e.g. LGA Emergency Desk"
                                    className={INPUT_CLASS}
                                />
                            </div>
                            <div>
                                <label
                                    htmlFor="authority-organization"
                                    className="block text-sm font-medium text-gray-700 mb-1"
                                >
                                    Organisation <span className="text-gray-400 font-normal">(optional)</span>
                                </label>
                                <input
                                    id="authority-organization"
                                    type="text"
                                    maxLength={ORGANIZATION_MAX}
                                    value={form.organization}
                                    onChange={(e) => updateForm('organization', e.target.value)}
                                    placeholder="e.g. SEMA Benue"
                                    className={INPUT_CLASS}
                                />
                            </div>
                            <div>
                                <label htmlFor="authority-phone" className="block text-sm font-medium text-gray-700 mb-1">
                                    Phone
                                </label>
                                <input
                                    id="authority-phone"
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="off"
                                    required
                                    maxLength={25}
                                    value={form.phone}
                                    onChange={(e) => updateForm('phone', e.target.value)}
                                    placeholder="0803 123 4567"
                                    aria-describedby="authority-phone-hint"
                                    aria-invalid={form.phone.trim() !== '' && !normalizedPhone}
                                    className={INPUT_CLASS}
                                />
                                <p
                                    id="authority-phone-hint"
                                    className={`mt-1 text-xs ${
                                        form.phone.trim() && !normalizedPhone ? 'text-red-600' : 'text-gray-500'
                                    }`}
                                >
                                    {!form.phone.trim()
                                        ? 'Nigerian number: 080…, 234… or +234… (10 digits after the leading 0).'
                                        : normalizedPhone
                                            ? `Will be saved as ${normalizedPhone}`
                                            : 'Not a valid Nigerian phone number.'}
                                </p>
                            </div>
                            <div>
                                <label htmlFor="authority-lga" className="block text-sm font-medium text-gray-700 mb-1">
                                    Coverage LGA
                                </label>
                                <select
                                    id="authority-lga"
                                    required
                                    value={form.coverage}
                                    onChange={(e) => updateForm('coverage', e.target.value)}
                                    aria-describedby={formNeedsState ? 'authority-lga-hint' : undefined}
                                    aria-invalid={formNeedsState || undefined}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Select an LGA…</option>
                                    {formNeedsState && (
                                        <option value={form.coverage}>{formLga.lga} (state not set)</option>
                                    )}
                                    {STATES.map((state) => (
                                        <optgroup key={state} label={state}>
                                            {lgasForState(state).map((lga) => (
                                                <option key={lgaKey(state, lga)} value={lgaKey(state, lga)}>
                                                    {lga}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                {formNeedsState && (
                                    <p id="authority-lga-hint" className="mt-1 text-xs text-amber-700">
                                        {formLga.lga} exists in {statesWithLga(formLga.lga).join(' and ')}. Choose the
                                        state this contact covers: until then it is texted for {formLga.lga} in every
                                        state.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end mt-6">
                            <button
                                type="button"
                                onClick={() => setForm(null)}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white bg-gradient-to-r from-[#e85d04] to-[#dc2f02] hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {form.id ? 'Save Changes' : 'Add Authority'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Delete confirmation */}
            {deleteTarget && (
                <Modal
                    title="Delete Authority"
                    titleClassName="text-xl font-bold mb-4 text-red-600"
                    onClose={() => setDeleteTarget(null)}
                >
                    <p className="text-gray-600 mb-6 leading-relaxed">
                        Delete {deleteTarget.name || deleteTarget.phone} ({deleteTarget.phone}) for{' '}
                        {deleteTarget.coverageLga
                            ? coverageLabel(deleteTarget.coverageState, deleteTarget.coverageLga)
                            : 'its LGA'}
                        ? This number will stop receiving SMS for approved
                        reports.
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => setDeleteTarget(null)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void confirmDelete()}
                            className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
