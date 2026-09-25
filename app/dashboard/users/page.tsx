'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import {
    collection,
    doc,
    documentId,
    getCountFromServer,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    updateDoc,
    type DocumentData,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db, COLLECTIONS, USER_ROLES, ROLE_LABELS, errorMessage, toDate, type UserRole } from '@/lib/firebase';
import { adminApi } from '@/lib/admin-api';
import { Users as UsersIcon, Loader2, Search, ArrowLeft, CheckCircle, Ban, Trash2, UserCog } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

const PAGE_SIZE = 100;

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
    isVerified?: boolean;
    isApproved?: boolean;
    isDisabled?: boolean;
    createdAt: Date | null;
}

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

function toAppUser(snap: QueryDocumentSnapshot<DocumentData>): AppUser {
    const d = snap.data();
    return {
        id: snap.id,
        name: str(d.name) ?? str(d.fullName),
        email: str(d.email),
        phone: str(d.phone) ?? str(d.phoneNumber),
        role: str(d.role),
        address: str(d.address),
        state: str(d.state),
        lga: str(d.lga),
        ward: str(d.ward),
        isVerified: d.isVerified === true,
        isApproved: d.isApproved === true,
        isDisabled: d.isDisabled === true,
        createdAt: toDate(d.createdAt),
    };
}

function sortByCreatedDesc(list: AppUser[]): AppUser[] {
    return [...list].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
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
    const { user, loading: authLoading, getIdToken } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<AppUser[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<ConfirmState>(CLOSED_MODAL);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [roleModal, setRoleModal] = useState<{ user: AppUser; role: UserRole } | null>(null);

    // Users are paged by document id (includes every doc, even ones missing
    // createdAt, which the mobile app writes inconsistently) and then sorted
    // client-side by join date.
    const fetchUsers = useCallback(async (append: boolean) => {
        const usersRef = collection(db, COLLECTIONS.USERS);
        const cursor = append ? lastDocRef.current : null;
        const q = cursor
            ? query(usersRef, orderBy(documentId()), startAfter(cursor), limit(PAGE_SIZE))
            : query(usersRef, orderBy(documentId()), limit(PAGE_SIZE));

        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const [snapshot, count] = await Promise.all([
                getDocs(q),
                append ? Promise.resolve(null) : getCountFromServer(usersRef).then((c) => c.data().count).catch(() => null),
            ]);
            const page = snapshot.docs.map(toAppUser);
            lastDocRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastDocRef.current;
            setHasMore(snapshot.docs.length === PAGE_SIZE);
            setUsers((prev) => sortByCreatedDesc(append ? [...prev, ...page] : page));
            if (!append) setTotalCount(count);
        } catch (error) {
            console.error('Error fetching users:', error);
            toast.error('Failed to load users.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            void fetchUsers(false);
        }
    }, [user, authLoading, router, fetchUsers]);

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

    function handleApproveUser(target: AppUser) {
        setConfirmModal({
            isOpen: true,
            title: 'Approve User',
            message: `Approve ${target.name || target.email || 'this user'}? They will gain full access to the platform.`,
            confirmLabel: 'Approve',
            onConfirm: async () => {
                setActionLoading(target.id);
                try {
                    await updateDoc(doc(db, COLLECTIONS.USERS, target.id), {
                        isApproved: true,
                        isVerified: true,
                    });
                    patchLocalUser(target.id, { isApproved: true, isVerified: true });
                } catch (error) {
                    console.error('Error approving user:', error);
                    toast.error('Failed to approve user. Please try again.');
                    setActionLoading(null);
                    return;
                }
                try {
                    await adminApi(getIdToken, `/api/admin/users/${encodeURIComponent(target.id)}`, {
                        method: 'PATCH',
                        body: { emailVerified: true },
                    });
                    toast.success('User approved successfully!');
                } catch (error) {
                    console.error('Error marking email verified:', error);
                    toast.error(`User approved, but email verification could not be updated: ${errorMessage(error)}`);
                } finally {
                    setActionLoading(null);
                }
            },
        });
    }

    function handleBlockUser(target: AppUser) {
        const currentlyBlocked = target.isDisabled === true;
        const action = currentlyBlocked ? 'unblock' : 'block';
        setConfirmModal({
            isOpen: true,
            title: currentlyBlocked ? 'Unblock User' : 'Block User',
            message: `Are you sure you want to ${action} ${target.name || target.email || 'this user'}? ${currentlyBlocked
                ? 'They will regain access to the platform.'
                : 'They will be signed out and lose access to the platform.'
                }`,
            isDangerous: !currentlyBlocked,
            confirmLabel: currentlyBlocked ? 'Unblock' : 'Block',
            onConfirm: async () => {
                setActionLoading(target.id);
                try {
                    await updateDoc(doc(db, COLLECTIONS.USERS, target.id), {
                        isDisabled: !currentlyBlocked,
                    });
                    patchLocalUser(target.id, { isDisabled: !currentlyBlocked });
                } catch (error) {
                    console.error(`Error trying to ${action} user:`, error);
                    toast.error(`Failed to ${action} user. Please try again.`);
                    setActionLoading(null);
                    return;
                }
                try {
                    await adminApi(getIdToken, `/api/admin/users/${encodeURIComponent(target.id)}`, {
                        method: 'PATCH',
                        body: { disabled: !currentlyBlocked },
                    });
                    toast.success(`User ${action}ed successfully!`);
                } catch (error) {
                    console.error(`Error updating auth account (${action}):`, error);
                    toast.error(`Profile updated, but the sign-in account could not be ${action}ed: ${errorMessage(error)}`);
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
                    await adminApi(getIdToken, `/api/admin/users/${encodeURIComponent(target.id)}`, {
                        method: 'DELETE',
                    });
                    setUsers((prev) => prev.filter((u) => u.id !== target.id));
                    setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
                    toast.success('User deleted successfully!');
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
            await adminApi(getIdToken, `/api/admin/users/${encodeURIComponent(target.id)}`, {
                method: 'PATCH',
                body: { role },
            });
            patchLocalUser(target.id, { role });
            toast.success(`Role changed to ${ROLE_LABELS[role]}`);
        } catch (error) {
            console.error('Error changing role:', error);
            toast.error(`Failed to change role: ${errorMessage(error)}`);
        } finally {
            setActionLoading(null);
        }
    }

    const filteredUsers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return users;
        return users.filter(
            (u) =>
                u.name?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q) ||
                u.phone?.toLowerCase().includes(q)
        );
    }, [users, searchQuery]);

    if (authLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </Link>
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
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Search Bar */}
                <div className="mb-6">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, email, or phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none"
                        />
                    </div>
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
                                    {filteredUsers.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                                No users found
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredUsers.map((u) => {
                                            const busy = actionLoading === u.id;
                                            const isSelf = u.id === user.uid;
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
                                                        {u.role && u.role in ROLE_LABELS
                                                            ? ROLE_LABELS[u.role as UserRole]
                                                            : u.role || 'User'}
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
                                                                {!u.isApproved && (
                                                                    <button
                                                                        onClick={() => handleApproveUser(u)}
                                                                        disabled={actionLoading !== null}
                                                                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                                                        title="Approve user"
                                                                    >
                                                                        <CheckCircle className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    onClick={() =>
                                                                        setRoleModal({
                                                                            user: u,
                                                                            role: (USER_ROLES as readonly string[]).includes(u.role ?? '')
                                                                                ? (u.role as UserRole)
                                                                                : 'user',
                                                                        })
                                                                    }
                                                                    disabled={actionLoading !== null}
                                                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                                                                    title="Change role"
                                                                >
                                                                    <UserCog className="w-4 h-4" />
                                                                </button>
                                                                {!isSelf && (
                                                                    <button
                                                                        onClick={() => handleBlockUser(u)}
                                                                        disabled={actionLoading !== null}
                                                                        className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${u.isDisabled
                                                                            ? 'text-blue-600 hover:bg-blue-50'
                                                                            : 'text-orange-600 hover:bg-orange-50'
                                                                            }`}
                                                                        title={u.isDisabled ? 'Unblock user' : 'Block user'}
                                                                    >
                                                                        <Ban className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                {!isSelf && (
                                                                    <button
                                                                        onClick={() => handleDeleteUser(u)}
                                                                        disabled={actionLoading !== null}
                                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                                        title="Delete user"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
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

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <p className="text-sm text-gray-600">
                                {searchQuery.trim()
                                    ? `${filteredUsers.length} match${filteredUsers.length === 1 ? '' : 'es'} among ${users.length} loaded users`
                                    : `Showing ${users.length} loaded user${users.length === 1 ? '' : 's'}`}
                                {totalCount !== null && ` (${totalCount.toLocaleString()} total)`}
                            </p>
                            {hasMore && (
                                <button
                                    onClick={() => void fetchUsers(true)}
                                    disabled={loadingMore}
                                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Load more
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h3 className={`text-xl font-bold mb-4 ${confirmModal.isDangerous ? 'text-red-600' : 'text-gray-900'}`}>
                            {confirmModal.title}
                        </h3>
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
                    </div>
                </div>
            )}

            {/* Role Modal */}
            {roleModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold mb-2 text-gray-900">Change Role</h3>
                        <p className="text-gray-600 mb-4 leading-relaxed">
                            {roleModal.user.name || roleModal.user.email || 'This user'} will be assigned the selected
                            role. The change applies to their permissions the next time their session refreshes.
                        </p>
                        <select
                            value={roleModal.role}
                            onChange={(e) => {
                                const role = e.target.value as UserRole;
                                setRoleModal((prev) => (prev ? { ...prev, role } : prev));
                            }}
                            className="w-full mb-6 px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all outline-none text-gray-900"
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
                    </div>
                </div>
            )}
        </div>
    );
}
