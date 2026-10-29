import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../configs/axios';

const AdminUsers = () => {
    const { getToken } = useAuth();
    const navigate = useNavigate();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState<string | null>(null);

    const loadUsers = async () => {
        try {
            const token = await getToken();
            await api.get('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
            const { data } = await api.get('/api/admin/users?page=1&limit=100', { headers: { Authorization: `Bearer ${token}` } });
            setUsers(data.data);
        } catch (error: any) {
            const status = error?.response?.status;
            const message = status === 401 ? 'Your session has expired. Please sign in again.' : status === 403 ? 'This account is not an active admin.' : error?.response?.data?.message || 'Unable to load users';
            setError(message);
            toast.error(message);
            if (status === 401 || status === 403) navigate('/');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadUsers(); }, []);

    const changeRole = async (userId: string, role: 'USER' | 'ADMIN') => {
        const user = users.find((item) => item.id === userId);
        if (!user || user.role === role) return;
        if (!window.confirm(`Change ${user.name || user.email} role to ${role}?`)) {
            return;
        }
        setSavingId(userId);
        try {
            const token = await getToken();
            const { data } = await api.patch(`/api/admin/users/${userId}`, { role }, { headers: { Authorization: `Bearer ${token}` } });
            setUsers((current) => current.map((item) => item.id === userId ? { ...item, ...data.data } : item));
            toast.success('User role updated');
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Unable to change user role');
        } finally {
            setSavingId(null);
        }
    };

    if (loading) return <div className="glass-panel rounded-xl p-10 text-center text-gray-400"><div className="animate-pulse">Loading users...</div></div>;
    if (error) return <div className="glass-panel rounded-xl p-10 text-center text-rose-300">{error}</div>;
    return <div className="glass-panel rounded-xl p-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-gray-500 border-b border-white/10"><tr>{['User', 'Email', 'Role', 'Status', 'Credits', 'Action'].map((label) => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead>
            <tbody>{users.map((user) => <tr key={user.id} className="border-b border-white/5">
                <td className="p-3">{user.name || 'Unnamed'}</td><td className="p-3 text-gray-400">{user.email}</td><td className="p-3"><select value={user.role} disabled={savingId === user.id} onChange={(event) => changeRole(user.id, event.target.value as 'USER' | 'ADMIN')} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 disabled:opacity-50"><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></td><td className="p-3">{user.status}</td><td className="p-3">{user.credits}</td><td className="p-3 text-gray-500">{savingId === user.id ? 'Saving...' : 'Role access'}</td>
            </tr>)}</tbody>
        </table>
        {users.length === 0 && <div className="py-14 text-center text-gray-500">No users found</div>}
    </div>;
};

export default AdminUsers;
