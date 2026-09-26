'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import {
    TABLES,
    USER_ROLES,
    ROLE_LABELS,
    errorMessage,
    isUserRole,
    sanitizeSearch,
    toDate,
    type UserRole,
} from '@/lib/constants';
import { adminApi } from '@/lib/admin-api';
import Pagination from '@/components/Pagination';
import Modal from '@/components/Modal';
import { Users as UsersIcon, Loader2, Search, CheckCircle, Ban, Trash2, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';

const PAGE_SIZE = 25;

type StatusFilter = 'all' | 'pending' | 'approved' | 'blocked';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All users' },
    { value: 'pending', label: 'Pending approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'blocked', label: 'Blocked' },
];

interface AppUser {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    address?: string;
    state?: string;
    lga?: string;
    ward?: string;
    isVerified: boolean;
    isApproved: boolean;
    isDisabled: boolean;
    createdAt: Date | null;
}

interface ProfileRow {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
    address: string | null;
    state: string | null;
    lga: string | null;
    ward: string | null;
    is_verified: boolean | null;
    is_approved: boolean | null;
    is_disabled: boolean | null;
    created_at: string | null;
}

const PROFILE_COLUMNS =
    'id, name, email, phone, role, address, state, lga, ward, is_verified, is_approved, is_disabled, created_at';

interface ConfirmState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    isDangerous?: boolean;
    confirmLabel?: string;
}

const CLOSED_MODAL: ConfirmState = {
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => { },
};

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function toAppUser(row: ProfileRow): AppUser {
    return {
        id: row.id,
        name: str(row.name),
        email: str(row.email),
        phone: str(row.phone),
        role: str(row.role),
        address: str(row.address),
        state: str(row.state),
        lga: str(row.lga),
        ward: str(row.ward),
        isVerified: row.is_verified === true,
        isApproved: row.is_approved === true,
        isDisabled: row.is_disabled === true,
        createdAt: toDate(row.created_at),
    };
}

function formatLocation(u: AppUser): string {
    const parts = [u.ward, u.lga, u.state].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return u.address || 'Not provided';
}

function StatusBadge({ user }: { user: AppUser }) {
    if (user.isDisabled) {
        return (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                Blocked
            </span>
        );
    }
    if (user.isApproved) {
        return (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Approved
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            Pending
        </span>
    );
}

export default function UsersPage() {
    const { user, loading: authLoading, getAccessToken } = useAuth();
    const [users, setUsers] = useState<AppUser[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [reloadKey, setReloadKey] = useState(0);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<ConfirmState>(CLOSED_MODAL);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [roleModal, setRoleModal] = useState<{ user: AppUser; role: UserRole } | null>(null);

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
                .from(TABLES.PROFILES)
                .select(PROFILE_COLUMNS, { count: 'exact' })
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (statusFilter === 'pending') query = query.eq('is_approved', false).eq('is_disabled', false);
            if (statusFilter === 'approved') query = query.eq('is_approved', true).eq('is_disabled', false);
            if (statusFilter === 'blocked') query = query.eq('is_disabled', true);
            if (searchQuery) {
                const pattern = `*${searchQuery}*`;
                query = query.or(`name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
            }
            const { data, count, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error fetching users:', error);
                toast.error('Failed to load users.');
                setUsers([]);
                setTotalCount(null);
            } else {
                const rows = (data ?? []) as ProfileRow[];
                if (rows.length === 0 && page > 0) {
                    // Past the last page (rows changed elsewhere): step back.
                    const lastPage = count ? Math.ceil(count / PAGE_SIZE) - 1 : page - 1;
                    setPage(Math.max(0, Math.min(page - 1, lastPage)));
                    return;
                }
                setUsers(rows.map(toAppUser));
                setTotalCount(count ?? null);
            }
            setLoading(false);
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [user, page, searchQuery, statusFilter, reloadKey]);

    const patchLocalUser = useCallback((id: string, patch: Partial<AppUser>) => {
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    }, []);

    const closeModal = useCallback(() => {
        setConfirmModal(CLOSED_MODAL);
    }, []);

    const runConfirm = useCallback(async () => {
        if (confirmBusy) return;
        const action = confirmModal.onConfirm;
        setConfirmBusy(true);
        // Close immediately so the action cannot be triggered twice.
        setConfirmModal(CLOSED_MODAL);
        try {
            await action();
        } finally {
            setConfirmBusy(false);
        }
    }, [confirmBusy, confirmModal.onConfirm]);

    const userApi = useCallback(
        (id: string, init: { method: 'PATCH' | 'DELETE'; body?: unknown }) =>
            adminApi(getAccessToken, `/api/admin/users/${encodeURIComponent(id)}`, init),
        [getAccessToken],
    );

    function handleApproveUser(target: AppUser) {
        setConfirmModal({
            isOpen: true,
            title: 'Approve User',
            message: `Approve ${target.name || target.email || 'this user'}? Their selected role (${
                isUserRole(target.role) ? ROLE_LABELS[target.role] : 'User'
            }) will take effect and they will gain access to the platform.`,
            confirmLabel: 'Approve',
            onConfirm: async () => {
                setActionLoading(target.id);
                try {
                    await userApi(target.id, { method: 'PATCH', body: { approve: true } });
                    patchLocalUser(target.id, { isApproved: true, isVerified: true });
                    toast.success('User approved successfully!');
                } catch (error) {
                    console.error('Error approving user:', error);
                    toast.error(`Failed to approve user: ${errorMessage(error)}`);
                } finally {
                    setActionLoading(null);
                }
            },
        });
    }

    function handleBlockUser(target: AppUser) {
        const currentlyBlocked = target.isDisabled;
        const action = currentlyBlocked ? 'unblock' : 'block';
        setConfirmModal({
            isOpen: true,
            title: currentlyBlocked ? 'Unblock User' : 'Block User',
            message: `Are you sure you want to ${action} ${target.name || target.email || 'this user'}? ${currentlyBlocked
                ? 'They will regain access to the platform.'
                : 'They will be unable to sign in and lose access to the platform.'
                }`,
            isDangerous: !currentlyBlocked,
            confirmLabel: currentlyBlocked ? 'Unblock' : 'Block',
            onConfirm: async () => {
                setActionLoading(target.id);
                try {
                    await userApi(target.id, { method: 'PATCH', body: { disabled: !currentlyBlocked } });
                    patchLocalUser(target.id, { isDisabled: !currentlyBlocked });
                    toast.success(`User ${action}ed successfully!`);
                } catch (error) {
                    console.error(`Error trying to ${action} user:`, error);
                    toast.error(`Failed to ${action} user: ${errorMessage(error)}`);
                } finally {
                    setActionLoading(null);
                }
            },
        });
    }

    function handleDeleteUser(target: AppUser) {
        setConfirmModal({
            isOpen: true,
            title: 'Delete User',
            message: `Are you absolutely sure you want to DELETE ${target.name || target.email || 'this user'}? This cannot be undone. Their sign-in account and profile will be permanently removed.`,
            isDangerous: true,
            confirmLabel: 'Delete',
            onConfirm: async () => {
                setActionLoading(target.id);
                try {
                    await userApi(target.id, { method: 'DELETE' });
                    toast.success('User deleted successfully!');
                    // Reload so the page stays full (or step back if it is now empty).
                    if (users.length === 1 && page > 0) setPage((p) => p - 1);
                    else setReloadKey((k) => k + 1);
                } catch (error) {
                    console.error('Error deleting user:', error);
                    toast.error(`Failed to delete user: ${errorMessage(error)}`);
                } finally {
                    setActionLoading(null);
                }
            },
        });
    }

    async function submitRoleChange() {
        if (!roleModal) return;
        const { user: target, role } = roleModal;
        setRoleModal(null);
        if (role === target.role) return;
        setActionLoading(target.id);
        try {
            await userApi(target.id, { method: 'PATCH', body: { role } });
            patchLocalUser(target.id, { role });
            toast.success(`Role changed to ${ROLE_LABELS[role]}`);
        } catch (error) {
            console.error('Error changing role:', error);
            toast.error(`Failed to change role: ${errorMessage(error)}`);
        } finally {
            setActionLoading(null);
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
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-[#E63946] to-[#9D0208] rounded-lg flex items-center justify-center">
                                <UsersIcon className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">User Management</h1>
                                <p className="text-xs text-gray-600">View and manage EWER users</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Search + Filter */}
                <div className="mb-6 flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, email, or phone..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            aria-label="Search users"
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as StatusFilter);
                            setPage(0);
                        }}
                        aria-label="Filter users by status"
                        className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                    >
                        {STATUS_FILTERS.map((f) => (
                            <option key={f.value} value={f.value}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Users Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            User
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Phone
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Location
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Role
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Joined
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {users.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                                No users found
                                            </td>
                                        </tr>
                                    ) : (
                                        users.map((u) => {
                                            const busy = actionLoading === u.id;
                                            const isSelf = u.id === user.id;
                                            return (
                                                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div>
                                                            <div className="font-medium text-gray-900">
                                                                {u.name || 'N/A'}
                                                            </div>
                                                            <div className="text-sm text-gray-500">{u.email || 'No email'}</div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {u.phone || 'Not provided'}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {formatLocation(u)}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {isUserRole(u.role) ? ROLE_LABELS[u.role] : u.role || 'User'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <StatusBadge user={u} />
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-700">
                                                        {u.createdAt ? u.createdAt.toLocaleDateString() : '—'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {busy ? (
                                                            <div className="p-2">
                                                                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                {!u.isApproved && !u.isDisabled && (
                                                                    <button
                                                                        onClick={() => handleApproveUser(u)}
                                                                        disabled={actionLoading !== null}
                                                                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                                                        title="Approve user"
                                                                        aria-label={`Approve ${u.name || u.email || 'user'}`}
                                                                    >
                                                                        <CheckCircle className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                {!isSelf && (
                                                                    <>
                                                                        <button
                                                                            onClick={() =>
                                                                                setRoleModal({
                                                                                    user: u,
                                                                                    role: isUserRole(u.role) ? u.role : 'user',
                                                                                })
                                                                            }
                                                                            disabled={actionLoading !== null}
                                                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                                                                            title="Change role"
                                                                            aria-label={`Change role of ${u.name || u.email || 'user'}`}
                                                                        >
                                                                            <UserCog className="w-4 h-4" />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleBlockUser(u)}
                                                                            disabled={actionLoading !== null}
                                                                            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${u.isDisabled
                                                                                ? 'text-blue-600 hover:bg-blue-50'
                                                                                : 'text-orange-600 hover:bg-orange-50'
                                                                                }`}
                                                                            title={u.isDisabled ? 'Unblock user' : 'Block user'}
                                                                            aria-label={`${u.isDisabled ? 'Unblock' : 'Block'} ${u.name || u.email || 'user'}`}
                                                                        >
                                                                            <Ban className="w-4 h-4" />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleDeleteUser(u)}
                                                                            disabled={actionLoading !== null}
                                                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                                            title="Delete user"
                                                                            aria-label={`Delete ${u.name || u.email || 'user'}`}
                                                                        >
                                                                            <Trash2 className="w-4 h-4" />
                                                                        </button>
                                                                    </>
                                                                )}
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
                            itemCount={users.length}
                            noun="users"
                            disabled={loading}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {confirmModal.isOpen && (
                <Modal
                    title={confirmModal.title}
                    titleClassName={`text-xl font-bold mb-4 ${confirmModal.isDangerous ? 'text-red-600' : 'text-gray-900'}`}
                    onClose={closeModal}
                >
                    <p className="text-gray-600 mb-6 leading-relaxed">
                        {confirmModal.message}
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={closeModal}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void runConfirm()}
                            disabled={confirmBusy}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${confirmModal.isDangerous
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'bg-gradient-to-r from-[#e85d04] to-[#dc2f02] text-white hover:opacity-90'
                                }`}
                        >
                            {confirmModal.confirmLabel || 'Confirm'}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Role Modal */}
            {roleModal && (
                <Modal
                    title="Change Role"
                    titleClassName="text-xl font-bold mb-2 text-gray-900"
                    onClose={() => setRoleModal(null)}
                >
                    <p className="text-gray-600 mb-4 leading-relaxed">
                        {roleModal.user.name || roleModal.user.email || 'This user'} will be assigned the selected
                        role. It only takes effect while the account is approved and not blocked.
                    </p>
                    <select
                        aria-label="Role"
                        value={roleModal.role}
                        onChange={(e) => {
                            const role = e.target.value as UserRole;
                            setRoleModal((prev) => (prev ? { ...prev, role } : prev));
                        }}
                        className="w-full mb-6 px-4 py-3 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
                    >
                        {USER_ROLES.map((r) => (
                            <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                            </option>
                        ))}
                    </select>
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => setRoleModal(null)}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void submitRoleChange()}
                            disabled={roleModal.role === roleModal.user.role}
                            className="px-4 py-2 rounded-lg font-medium transition-colors bg-gradient-to-r from-[#e85d04] to-[#dc2f02] text-white hover:opacity-90 disabled:opacity-50"
                        >
                            Save Role
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
