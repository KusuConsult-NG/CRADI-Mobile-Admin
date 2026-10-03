'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { deleteRow, listRows, Query, upsertRow } from '@/lib/data';
import { TABLES, errorMessage, toDate } from '@/lib/constants';
import { Settings as SettingsIcon, Loader2, Save, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

type SettingDef =
    | { key: string; label: string; help: string; kind: 'int'; min: number; max: number; defaultValue: number; unit?: string }
    | { key: string; label: string; help: string; kind: 'bool'; defaultValue: boolean }
    | { key: string; label: string; help: string; kind: 'semver'; defaultValue: string }
    | { key: string; label: string; help: string; kind: 'text'; maxLength: number; defaultValue: string }
    | { key: string; label: string; help: string; kind: 'email'; defaultValue: string };

/**
 * The live app_settings keys (read by the database, the backend or the mobile
 * app). Any other key in the table is ignored. Defaults are the fallbacks the
 * readers use when a key is missing.
 */
const SETTINGS: readonly SettingDef[] = [
    {
        key: 'minimum_peer_confirmations',
        label: 'Minimum peer confirmations',
        help: 'How many other monitors must confirm a report before it is automatically marked verified. Higher values mean fewer false reports but slower verification.',
        kind: 'int',
        min: 1,
        max: 10,
        defaultValue: 2,
    },
    {
        key: 'escalation_timeout_minutes',
        label: 'Escalation timeout',
        help: 'A pending report that has not been verified within this many minutes is escalated to staff. Applies to reports submitted (or reopened) after the change.',
        kind: 'int',
        min: 5,
        max: 1440,
        defaultValue: 30,
        unit: 'minutes',
    },
    {
        key: 'max_sms_per_alert_event',
        label: 'Max SMS per alert event',
        help: 'When a report is approved, at most this many authorities in its LGA (oldest entries first) receive an SMS.',
        kind: 'int',
        min: 1,
        max: 200,
        defaultValue: 20,
        unit: 'SMS',
    },
    {
        key: 'max_sms_per_lga_per_day',
        label: 'Max SMS per LGA per day',
        help: 'Daily cap on authority SMS for one LGA (Nigerian time). Once reached, further approvals in that LGA send no SMS until the next day.',
        kind: 'int',
        min: 1,
        max: 1000,
        defaultValue: 50,
        unit: 'SMS',
    },
    {
        key: 'feature_flag_peer_chat',
        label: 'Peer chat enabled',
        help: 'Shows the peer chat feature in the mobile app. Turn off to hide it for everyone (apps pick up the change on their next settings refresh).',
        kind: 'bool',
        defaultValue: true,
    },
    {
        key: 'app_min_version',
        label: 'Minimum app version',
        help: 'App builds older than this version (e.g. 1.0.14) are blocked with an "update required" screen. Raise it only after the new version is live in the stores.',
        kind: 'semver',
        defaultValue: '1.0.0',
    },
    {
        key: 'app_min_version_message',
        label: 'Update required message',
        help: 'Text shown on the "update required" screen. Leave empty to use the app’s built-in (translated) message.',
        kind: 'text',
        maxLength: 200,
        defaultValue: '',
    },
    {
        key: 'support_email',
        label: 'Support email',
        help: 'The address shown in the mobile app’s Help & Support screen for users to contact support.',
        kind: 'email',
        defaultValue: 'support@cradi.org',
    },
];

const SETTING_KEYS = SETTINGS.map((s) => s.key);
/**
 * 1 to 3 numeric parts ("2", "1.2", "1.0.14"). The mobile app
 * (RemoteConfigService.compareVersions) compares part by part and treats
 * missing parts as 0, so "1.2" means 1.2.0.
 */
const SEMVER_RE = /^\d{1,4}(?:\.\d{1,4}(?:\.\d{1,6})?)?$/;
/** One address, no spaces, a dot in the domain (what a mail app can open). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

/** Form value per key: text for int / semver / email / text fields, boolean for toggles. */
type Draft = Record<string, string | boolean>;

interface SettingRow {
    key: string;
    value: unknown;
    updatedAt: string | null;
}

interface Loaded {
    /** Draft built from the stored values (or defaults when a key is missing). */
    values: Draft;
    present: Record<string, boolean>;
    updatedAt: Record<string, Date | null>;
}

/** Converts a stored value into the form value for `def` (it is stored as text). */
function toDraftValue(def: SettingDef, value: unknown): string | boolean {
    switch (def.kind) {
        case 'bool':
            if (typeof value === 'boolean') return value;
            if (value === 'true') return true;
            if (value === 'false') return false;
            return def.defaultValue;
        case 'int':
            if (typeof value === 'number' || typeof value === 'string') return String(value);
            return String(def.defaultValue);
        default:
            return typeof value === 'string' ? value : def.defaultValue;
    }
}

/** Validates a form value; returns the JSON value to store, or an error message. */
function parseValue(def: SettingDef, raw: string | boolean): { value: number | boolean | string } | { error: string } {
    switch (def.kind) {
        case 'bool':
            return { value: raw === true };
        case 'int': {
            const text = String(raw).trim();
            if (!/^-?\d+$/.test(text)) return { error: 'Enter a whole number.' };
            const n = Number.parseInt(text, 10);
            if (n < def.min || n > def.max) return { error: `Must be between ${def.min} and ${def.max}.` };
            return { value: n };
        }
        case 'semver': {
            const text = String(raw).trim();
            if (!SEMVER_RE.test(text)) return { error: 'Use numbers separated by dots, e.g. 1.0.14 or 1.2.' };
            return { value: text };
        }
        case 'email': {
            const text = String(raw).trim();
            if (!text) return { error: 'Enter an email address.' };
            if (text.length > EMAIL_MAX || !EMAIL_RE.test(text)) return { error: 'Enter a valid email address, e.g. support@cradi.org.' };
            return { value: text };
        }
        case 'text': {
            const text = String(raw).trim();
            if (text.length > def.maxLength) return { error: `At most ${def.maxLength} characters.` };
            return { value: text };
        }
    }
}

/**
 * The string a valid setting is stored as.
 *
 * `app_settings.value` is a plain string column in Appwrite, where it was
 * `jsonb` in Postgres — so the number 45 and the boolean false are stored
 * as "45" and "false". Every reader already parses them that way (the
 * backend's `positiveInt`, the app's `_getInt` / `_getBool`), and writing
 * them untyped sent `Invalid document structure` instead.
 */
function storedString(value: number | boolean | string): string {
    return typeof value === 'string' ? value : String(value);
}

function sameStored(def: SettingDef, a: string | boolean, b: string | boolean): boolean {
    const pa = parseValue(def, a);
    const pb = parseValue(def, b);
    if ('value' in pa && 'value' in pb) return pa.value === pb.value;
    return a === b;
}

const INPUT_CLASS =
    'w-full px-4 py-2.5 rounded-lg border bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none';

export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [draft, setDraft] = useState<Draft>({});
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        // Signed-out users are redirected by app/dashboard/layout.tsx.
        if (!user) return;
        let cancelled = false;
        async function load() {
            setLoadError(false);
            let loadedRows: SettingRow[];
            try {
                const result = await listRows<SettingRow>(TABLES.APP_SETTINGS, [
                    Query.equal('key', SETTING_KEYS),
                    Query.select(['key', 'value', 'updatedAt']),
                    Query.limit(SETTING_KEYS.length),
                ]);
                loadedRows = result.rows;
            } catch (error) {
                if (cancelled) return;
                console.error('Error fetching settings:', error);
                toast.error('Failed to load settings.');
                setLoadError(true);
                return;
            }
            if (cancelled) return;
            const rows = new Map(loadedRows.map((r) => [r.key, r]));
            const next: Loaded = { values: {}, present: {}, updatedAt: {} };
            for (const def of SETTINGS) {
                const row = rows.get(def.key);
                next.values[def.key] = toDraftValue(def, row ? row.value : undefined);
                next.present[def.key] = !!row;
                next.updatedAt[def.key] = toDate(row?.updatedAt);
            }
            setLoaded(next);
            setDraft(next.values);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, reloadKey]);

    const errors: Record<string, string> = {};
    // What Save would write: anything the user edited, plus any default that
    // has never been stored.
    const changed: SettingDef[] = [];
    // What Discard would undo: only what the user actually edited. A default
    // missing from the database is not something the form can revert, so
    // counting it here would leave Discard enabled and doing nothing.
    const edited: SettingDef[] = [];
    if (loaded) {
        for (const def of SETTINGS) {
            const result = parseValue(def, draft[def.key]);
            if ('error' in result) errors[def.key] = result.error;
            const differs = !sameStored(def, draft[def.key], loaded.values[def.key]);
            if (differs) edited.push(def);
            // A row that is not there and would be stored empty is already in
            // the state it would be saved to: `value` is required, so "no
            // value" is the absence of the row, not an empty one.
            const wouldBeEmpty = 'value' in result && storedString(result.value) === '';
            if ((!loaded.present[def.key] && !wouldBeEmpty) || differs) changed.push(def);
        }
    }
    // Only keys being saved must be valid: an invalid value already stored
    // (and left alone) is still highlighted but does not block other changes.
    const hasErrors = changed.some((def) => def.key in errors);

    async function save(e: React.FormEvent) {
        e.preventDefault();
        if (!loaded || saving) return;
        if (hasErrors) {
            toast.error('Fix the highlighted settings first.');
            return;
        }
        if (changed.length === 0) {
            toast('No changes to save.');
            return;
        }
        const now = new Date().toISOString();
        const rows = changed.map((def) => {
            const result = parseValue(def, draft[def.key]);
            // Validated above.
            return {
                key: def.key,
                value: 'value' in result ? storedString(result.value) : '',
                updatedAt: now,
            };
        });

        setSaving(true);
        try {
            // One call per setting: the `write` Function takes one document
            // at a time. Upsert because a setting left at its default has
            // never been stored, so the first save of it is a create — and
            // the row id *is* the key, so the two are the same write.
            //
            // Sequential rather than parallel, so a refusal stops at the
            // first one instead of half-applying a batch the admin then has
            // to reconcile.
            for (const { key, value, updatedAt } of rows) {
                // `value` is a required column, so a setting cleared back to
                // nothing is removed rather than stored empty. Every reader
                // falls back to its own default for a key that is not there,
                // which is what an empty value meant anyway.
                if (value === '') await deleteRow(TABLES.APP_SETTINGS, key);
                else await upsertRow(TABLES.APP_SETTINGS, key, { key, value, updatedAt });
            }
            toast.success(`Saved ${rows.length} setting${rows.length === 1 ? '' : 's'}`);
            setReloadKey((k) => k + 1);
        } catch (error) {
            console.error('Error saving settings:', error);
            toast.error(`Failed to save settings: ${errorMessage(error)}`);
        } finally {
            setSaving(false);
        }
    }

    function setValue(key: string, value: string | boolean) {
        setDraft((prev) => ({ ...prev, [key]: value }));
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
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-800 rounded-lg flex items-center justify-center">
                            <SettingsIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">App Settings</h1>
                            <p className="text-xs text-gray-600">Live configuration used by the app and backend</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-6 py-8">
                {loadError ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
                        <p className="text-gray-600 mb-4">Settings could not be loaded.</p>
                        <button
                            onClick={() => setReloadKey((k) => k + 1)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                ) : !loaded ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
                    </div>
                ) : (
                    <form onSubmit={(e) => void save(e)} noValidate>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                            {SETTINGS.map((def) => {
                                const id = `setting-${def.key}`;
                                const helpId = `${id}-help`;
                                const errorId = `${id}-error`;
                                const error = errors[def.key];
                                const value = draft[def.key];
                                const updatedAt = loaded.updatedAt[def.key];
                                const isChanged = changed.includes(def);
                                const describedBy = error ? `${helpId} ${errorId}` : helpId;
                                return (
                                    <div key={def.key} className="p-6">
                                        {def.kind === 'bool' ? (
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <label htmlFor={id} className="block font-medium text-gray-900">
                                                        {def.label}
                                                    </label>
                                                    <code className="text-xs text-gray-400">{def.key}</code>
                                                </div>
                                                <input
                                                    id={id}
                                                    type="checkbox"
                                                    role="switch"
                                                    checked={value === true}
                                                    onChange={(e) => setValue(def.key, e.target.checked)}
                                                    aria-describedby={describedBy}
                                                    className="mt-1 h-5 w-5 rounded border-gray-300 bg-white text-[#E63946] focus:ring-[#E63946]"
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <label htmlFor={id} className="block font-medium text-gray-900">
                                                    {def.label}
                                                </label>
                                                <code className="block text-xs text-gray-400 mb-2">{def.key}</code>
                                                {def.kind === 'text' ? (
                                                    <textarea
                                                        id={id}
                                                        rows={2}
                                                        maxLength={def.maxLength}
                                                        value={String(value)}
                                                        onChange={(e) => setValue(def.key, e.target.value)}
                                                        aria-describedby={describedBy}
                                                        aria-invalid={!!error}
                                                        className={`${INPUT_CLASS} ${error ? 'border-red-400' : 'border-gray-300'}`}
                                                    />
                                                ) : (
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            id={id}
                                                            type={def.kind === 'int' ? 'number' : def.kind === 'email' ? 'email' : 'text'}
                                                            inputMode={def.kind === 'int' ? 'numeric' : def.kind === 'email' ? 'email' : 'decimal'}
                                                            maxLength={def.kind === 'email' ? EMAIL_MAX : undefined}
                                                            min={def.kind === 'int' ? def.min : undefined}
                                                            max={def.kind === 'int' ? def.max : undefined}
                                                            step={def.kind === 'int' ? 1 : undefined}
                                                            placeholder={def.kind === 'semver' ? '1.0.14' : def.kind === 'email' ? 'support@cradi.org' : undefined}
                                                            value={String(value)}
                                                            onChange={(e) => setValue(def.key, e.target.value)}
                                                            aria-describedby={describedBy}
                                                            aria-invalid={!!error}
                                                            className={`${INPUT_CLASS} max-w-xs ${error ? 'border-red-400' : 'border-gray-300'}`}
                                                        />
                                                        {def.kind === 'int' && def.unit && (
                                                            <span className="text-sm text-gray-500">{def.unit}</span>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <p id={helpId} className="mt-2 text-sm text-gray-600">
                                            {def.help}
                                            {def.kind === 'int' && ` Allowed: ${def.min}–${def.max}.`}
                                            {def.kind === 'text' &&
                                                ` ${String(value).trim().length}/${def.maxLength} characters.`}
                                        </p>
                                        {error && (
                                            <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
                                                {error}
                                            </p>
                                        )}
                                        <p className="mt-1 text-xs text-gray-400">
                                            {!loaded.present[def.key]
                                                ? 'Not set: the default shown is used until you save.'
                                                : updatedAt
                                                    ? `Last updated ${updatedAt.toLocaleString()}`
                                                    : null}
                                            {isChanged && loaded.present[def.key] && (
                                                <span className="ml-2 font-medium text-amber-700">Unsaved change</span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-6 flex flex-wrap gap-3 justify-end">
                            <button
                                type="button"
                                onClick={() => setDraft(loaded.values)}
                                disabled={saving || edited.length === 0}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Discard changes
                            </button>
                            <button
                                type="submit"
                                disabled={saving || hasErrors || changed.length === 0}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white bg-gradient-to-r from-[#e85d04] to-[#dc2f02] hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save {changed.length > 0 ? `${changed.length} change${changed.length === 1 ? '' : 's'}` : 'changes'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
