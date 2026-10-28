import { useAuth, useUser } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import api from '../configs/axios';

type AdminAccessState = 'checking' | 'allowed' | 'denied';

export default function AdminRouteGuard() {
    const { user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const navigate = useNavigate();
    const [accessState, setAccessState] = useState<AdminAccessState>('checking');

    useEffect(() => {
        if (!isLoaded) return;
        if (!user) {
            navigate('/sign-in?intent=admin&error=sign-in-required', { replace: true });
            return;
        }

        let active = true;
        const verifyAdminAccess = async () => {
            try {
                const token = await getToken();
                await api.get('/api/admin/me', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (active) setAccessState('allowed');
            } catch {
                if (!active) return;
                setAccessState('denied');
                navigate('/', { replace: true, state: { adminAccessDenied: true } });
            }
        };

        void verifyAdminAccess();
        return () => {
            active = false;
        };
    }, [getToken, isLoaded, navigate, user]);

    if (!isLoaded || accessState === 'checking') {
        return <div className='min-h-screen pt-32 text-center text-violet-300' role='status'>Verifying admin access…</div>;
    }

    if (accessState === 'denied') return <Navigate to='/' replace state={{ adminAccessDenied: true }} />;
    return <Outlet />;
}
