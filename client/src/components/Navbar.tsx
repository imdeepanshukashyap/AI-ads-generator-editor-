import { DollarSignIcon, FolderEditIcon, GalleryHorizontalEnd, MenuIcon, ShieldCheckIcon, SparkleIcon, XIcon } from 'lucide-react';
import { GhostButton, PrimaryButton } from './Buttons';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import { useClerk, useUser, UserButton, useAuth } from '@clerk/clerk-react';
import api from '../configs/axios';
import toast from 'react-hot-toast';

export default function Navbar() {

    const navigate = useNavigate()
    const { user, isLoaded } = useUser()
    const userId = user?.id;
    const { openSignUp } = useClerk()
    const [adminUserId, setAdminUserId] = useState<string | null>(null);

    const [isOpen, setIsOpen] = useState(false);

    const [creditsByUser, setCreditsByUser] = useState<{ userId: string; credits: number } | null>(null);
    const { getToken } = useAuth()

    const navLinks = [
        { name: 'Home', href: '/#' },
        { name: 'Create', href: '/generate' },
        { name: 'Community', href: '/community' },
        { name: 'Plans', href: '/plans' },
    ];

    const isAdmin = Boolean(userId && adminUserId === userId);
    const credits = creditsByUser && creditsByUser.userId === userId ? creditsByUser.credits : 0;

    useEffect(() => {
        if (!isLoaded || !userId) return;

        let cancelled = false;
        const loadAccountState = async () => {
            const token = await getToken();
            const [creditsResult, adminResult] = await Promise.allSettled([
                api.get('/api/user/credits', { headers: { Authorization: `Bearer ${token}` } }),
                api.get('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } }),
            ]);

            if (cancelled) return;

            if (creditsResult.status === 'fulfilled') {
                setCreditsByUser({ userId: userId, credits: creditsResult.value.data.credits });
            } else {
                toast.error(creditsResult.reason instanceof Error ? creditsResult.reason.message : 'Unable to load credits');
            }

            setAdminUserId(adminResult.status === 'fulfilled' ? userId : null);
        };

        void loadAccountState();
        return () => {
            cancelled = true;
        };
    }, [getToken, isLoaded, userId]);

    useEffect(() => {
        if (!isOpen) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isOpen])

    return (
        <motion.nav className='fixed top-5 left-0 right-0 z-50 px-4'
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 250, damping: 70, mass: 1 }}
        >
            <div className='max-w-6xl mx-auto flex items-center justify-between bg-black/50 backdrop-blur-md border border-white/4 rounded-2xl p-3'>
                <Link to='/' onClick={() => scrollTo(0, 0)} className="flex items-center gap-2">
                    <img src={assets.logo} alt="AdGen Studio logo" className="h-8" />
                    <span className="hidden min-[420px]:inline text-xl font-bold text-white">AdGen Studio</span>
                </Link>

                <div className='hidden md:flex items-center gap-8 text-sm font-medium text-gray-300'>
                    {navLinks.map((link) => (
                        <Link onClick={() => scrollTo(0, 0)} to={link.href} key={link.name} className="hover:text-white transition">
                            {link.name}
                        </Link>
                    ))}
                </div>

                {!user ? (
                    <div className='hidden md:flex items-center gap-3'>
                        <button onClick={() => navigate('/sign-in')} className='text-sm font-medium text-gray-300 hover:text-white transition'>
                            Sign in
                        </button>
                        <PrimaryButton onClick={() => openSignUp()} className='max-sm:text-xs hidden sm:inline-block'>Get Started</PrimaryButton>
                    </div>
                ) : (
                    <div className='hidden md:flex gap-2'>
                        {isAdmin && <GhostButton onClick={() => navigate('/admin')} className='border-none text-violet-300 sm:py-1.5'>
                            <ShieldCheckIcon className='size-4' /> Admin Portal
                        </GhostButton>}
                        <GhostButton onClick={() => navigate('/plans')} className='border-none text-gray-300 sm:py-1.5'>
                            Credits: {credits}
                        </GhostButton>
                        <UserButton>
                            <UserButton.MenuItems>

                                <UserButton.Action label='Generate' labelIcon={<SparkleIcon size={14} />} onClick={() => navigate('/generate')} />

                                <UserButton.Action label='My Generations' labelIcon={<FolderEditIcon size={14} />} onClick={() => navigate('/my-generations')} />

                                <UserButton.Action label='Community' labelIcon={<GalleryHorizontalEnd size={14} />} onClick={() => navigate('/community')} />

                                <UserButton.Action label='Plans' labelIcon={<DollarSignIcon size={14} />} onClick={() => navigate('/plans')} />

                            </UserButton.MenuItems>
                        </UserButton>
                    </div>
                )}

                <button
                    type='button'
                    aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={isOpen}
                    aria-controls='mobile-navigation'
                    onClick={() => setIsOpen((open) => !open)}
                    className='rounded-lg p-2 text-gray-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 md:hidden'
                >
                    {isOpen ? <XIcon className='size-6' /> : <MenuIcon className='size-6' />}
                </button>

            </div>
            <div
                id='mobile-navigation'
                role='dialog'
                aria-modal='true'
                aria-hidden={!isOpen}
                aria-label='Mobile navigation'
                className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/95 px-6 text-lg font-medium backdrop-blur-md transition-[transform,visibility] duration-300 md:hidden ${isOpen ? 'visible translate-x-0' : 'invisible translate-x-full pointer-events-none'}`}
            >
                {navLinks.map((link) => (
                    <a key={link.name} href={link.href} onClick={() => setIsOpen(false)}>
                        {link.name}
                    </a>
                ))}

                {!user ? (
                    <>
                        <button onClick={() => { setIsOpen(false); navigate('/sign-in') }} className='rounded-lg px-4 py-2 font-medium text-gray-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'>
                            Sign in
                        </button>
                        <PrimaryButton onClick={() => { setIsOpen(false); openSignUp() }}>Get Started</PrimaryButton>
                    </>
                ) : (
                    <div className='flex flex-wrap items-center justify-center gap-3'>
                        {isAdmin && <GhostButton onClick={() => { setIsOpen(false); navigate('/admin') }}>
                            <ShieldCheckIcon className='size-4' /> Admin Portal
                        </GhostButton>}
                        <GhostButton onClick={() => { setIsOpen(false); navigate('/plans') }}>
                            Credits: {credits}
                        </GhostButton>
                        <UserButton />
                    </div>
                )}

                <button
                    type='button'
                    aria-label='Close navigation menu'
                    onClick={() => setIsOpen(false)}
                    className='absolute right-5 top-5 rounded-lg bg-white/10 p-2 text-white ring-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2'
                >
                    <XIcon aria-hidden='true' />
                </button>
            </div>
        </motion.nav>
    );
};