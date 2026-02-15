'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { databases, DATABASE_ID, COLLECTIONS, Query } from '@/lib/appwrite';
import { Users as UsersIcon, Loader2, Search, ArrowLeft, CheckCircle, Ban, Trash2 } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface User {
    $id: string;
    fullName: string;
    email: string;
    phoneNumber?: string;
    location?: string;
    verified?: boolean;
    isApproved?: boolean;
    isBlocked?: boolean;
    $createdAt: string;
}

export default function UsersPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        isDangerous?: boolean;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

    async function handleApproveUser(userId: string) {
        setConfirmModal({
            isOpen: true,
            title: 'Approve User',
            message: 'Are you sure you want to approve this user? They will gain full access to the platform.',
            onConfirm: async () => {
                try {
                    setActionLoading(userId);
                    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, userId, {
                        isApproved: true,
                        verified: true,
                    });
                    await fetchUsers();
                    toast.success('User approved successfully!');
                } catch (error) {
                    console.error('Error approving user:', error);
                    toast.error('Failed to approve user. Please try again.');
                } finally {
                    setActionLoading(null);
                    setConfirmModal({ ...confirmModal, isOpen: false });
                }
            },
        });
    }

    async function handleBlockUser(userId: string, currentlyBlocked: boolean) {
        const action = currentlyBlocked ? 'unblock' : 'block';
        setConfirmModal({
            isOpen: true,
            title: `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
            message: `Are you sure you want to ${action} this user? ${currentlyBlocked ? 'They will regain access to the platform.' : 'They will lose access to the platform.'}`,
            isDangerous: !currentlyBlocked,
            onConfirm: async () => {
                try {
                    setActionLoading(userId);
                    await databases.updateDocument(DATABASE_ID, COLLECTIONS.USERS, userId, {
                        isBlocked: !currentlyBlocked,
                    });
                    await fetchUsers();
                    toast.success(`User ${action}ed successfully!`);
                } catch (error) {
                    console.error(`Error ${action}ing user:`, error);
                    toast.error(`Failed to ${action} user. Please try again.`);
                } finally {
                    setActionLoading(null);
                    setConfirmModal({ ...confirmModal, isOpen: false });
                }
            },
        });
    }

    async function handleDeleteUser(userId: string) {
        setConfirmModal({
            isOpen: true,
            title: 'Delete User',
            message: 'Are you absolutely sure you want to DELETE this user? This action cannot be undone! All user data will be permanently removed from the system.',
            isDangerous: true,
            onConfirm: async () => {
                try {
                    setActionLoading(userId);
                    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
                    await fetchUsers();
                    toast.success('User deleted successfully!');
                } catch (error) {
                    console.error('Error deleting user:', error);
                    toast.error('Failed to delete user. Please try again.');
                } finally {
                    setActionLoading(null);
                    setConfirmModal({ ...confirmModal, isOpen: false });
                }
            },
        });
    }

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
        } else if (user) {
            fetchUsers();
        }
    }, [user, authLoading, router]);

    async function fetchUsers() {
        try {
            setLoading(true);
            const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.USERS, [
                Query.orderDesc('$createdAt'),
                Query.limit(100),
            ]);
            setUsers(response.documents as any);
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    }

    const filteredUsers = users.filter(
        (u) =>
            u.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.phoneNumber?.includes(searchQuery)
    );

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
                                            Contact
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            Location
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
                                            <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                                No users found
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredUsers.map((user) => (
                                            <tr key={user.$id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div>
                                                        <div className="font-medium text-gray-900">
                                                            {user.fullName || 'N/A'}
                                                        </div>
                                                        <div className="text-sm text-gray-500">{user.email}</div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-700">
                                                    {user.phoneNumber || user.email || 'Not provided'}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-700">
                                                    {(user as any).address || 'Not provided'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span
                                                        className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${user.verified
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-yellow-100 text-yellow-700'
                                                            }`}
                                                    >
                                                        {user.verified ? 'Verified' : 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-700">
                                                    {new Date(user.$createdAt).toLocaleDateString()}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        {!user.isApproved && (
                                                            <button
                                                                onClick={() => handleApproveUser(user.$id)}
                                                                disabled={actionLoading === user.$id}
                                                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                                                title="Approve user"
                                                            >
                                                                {actionLoading === user.$id ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                ) : (
                                                                    <CheckCircle className="w-4 h-4" />
                                                                )}
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleBlockUser(user.$id, user.isBlocked || false)}
                                                            disabled={actionLoading === user.$id}
                                                            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${user.isBlocked
                                                                ? 'text-blue-600 hover:bg-blue-50'
                                                                : 'text-orange-600 hover:bg-orange-50'
                                                                }`}
                                                            title={user.isBlocked ? 'Unblock user' : 'Block user'}
                                                        >
                                                            {actionLoading === user.$id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Ban className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(user.$id)}
                                                            disabled={actionLoading === user.$id}
                                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                            title="Delete user"
                                                        >
                                                            {actionLoading === user.$id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                            <p className="text-sm text-gray-600">
                                Showing {filteredUsers.length} of {users.length} users
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in duration-200">
                        <h3 className={`text-xl font-bold mb-4 ${confirmModal.isDangerous ? 'text-red-600' : 'text-gray-900'}`}>
                            {confirmModal.title}
                        </h3>
                        <p className="text-gray-600 mb-6 leading-relaxed">
                            {confirmModal.message}
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmModal.onConfirm}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${confirmModal.isDangerous
                                        ? 'bg-red-600 text-white hover:bg-red-700'
                                        : 'bg-gradient-to-r from-[#e85d04] to-[#dc2f02] text-white hover:opacity-90'
                                    }`}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
