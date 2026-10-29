import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import toast from 'react-hot-toast';
import api from '../configs/axios';

const AdminProfile = () => {
    const { getToken } = useAuth();
    const [profile, setProfile] = useState<any>(null);
    const [name, setName] = useState('');

    useEffect(() => {
        const load = async () => {
            try {
                const token = await getToken();
                const { data } = await api.get('/api/admin/profile', { headers: { Authorization: `Bearer ${token}` } });
                setProfile(data.data);
                setName(data.data.name);
            } catch {
                toast.error('Unable to load profile');
            }
        };
        load();
    }, [getToken]);

    const save = async () => {
        try {
            const token = await getToken();
            const { data } = await api.patch('/api/admin/profile', { name }, { headers: { Authorization: `Bearer ${token}` } });
            setProfile(data.data);
            toast.success('Profile updated');
        } catch {
            toast.error('Unable to update profile');
        }
    };

    if (!profile) return <div className="py-20 text-center text-gray-400">Loading profile...</div>;
    return <div className="glass-panel rounded-xl p-6 max-w-2xl space-y-5">
        <div><label className="text-sm text-gray-400">Name</label><input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2" /></div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm"><div><p className="text-gray-500">Email</p><p>{profile.email}</p></div><div><p className="text-gray-500">Role</p><p>{profile.role}</p></div><div><p className="text-gray-500">Joined</p><p>{new Date(profile.createdAt).toLocaleDateString()}</p></div><div><p className="text-gray-500">Last active</p><p>{new Date(profile.lastLoginAt).toLocaleString()}</p></div></div>
        <button onClick={save} className="rounded-lg bg-violet-500 px-4 py-2 text-sm">Save Profile</button>
    </div>;
};

export default AdminProfile;
