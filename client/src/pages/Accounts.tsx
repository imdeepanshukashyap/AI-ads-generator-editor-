import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useSearchParams } from 'react-router-dom';
import { 
    YoutubeIcon, 
    FacebookIcon, 
    InstagramIcon, 
    Loader2Icon, 
    Trash2Icon, 
    AlertTriangleIcon, 
    CheckCircle2Icon, 
    PlusCircleIcon,
    RefreshCwIcon
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchConnectedAccounts, disconnectSocialAccount, getConnectAuthUrl } from '../services/social';
import type { SocialAccount } from '../types';
import { GhostButton, PrimaryButton } from '../components/Buttons';

const Accounts = () => {
    const { user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const [searchParams] = useSearchParams();

    const [accounts, setAccounts] = useState<SocialAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
    const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

    // Handle incoming OAuth callback URL query parameters
    useEffect(() => {
        const connected = searchParams.get('connected');
        const error = searchParams.get('error');

        if (connected) {
            toast.success(`Successfully connected ${connected.toUpperCase()}!`, { duration: 5000 });
            window.history.replaceState({}, '', '/accounts');
        } else if (error) {
            toast.error(`Connection failed: ${decodeURIComponent(error)}`, { duration: 6000 });
            window.history.replaceState({}, '', '/accounts');
        }
    }, [searchParams]);

    const loadAccounts = async () => {
        try {
            setLoading(true);
            const token = await getToken();
            if (!token) return;
            const data = await fetchConnectedAccounts(token);
            setAccounts(data);
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Failed to load social accounts');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadAccounts();
        }
    }, [user]);

    const handleConnect = async (platform: 'youtube' | 'meta') => {
        try {
            setConnectingPlatform(platform);
            const token = await getToken();
            if (!token) {
                toast.error('Authentication required');
                return;
            }

            const authUrl = await getConnectAuthUrl(platform, token);
            // Redirect browser to OAuth provider consent screen
            window.location.href = authUrl;
        } catch (error: any) {
            setConnectingPlatform(null);
            toast.error(error?.response?.data?.message || `Failed to initiate ${platform} connection`);
        }
    };

    const handleDisconnect = async (accountId: string, displayName: string) => {
        if (!confirm(`Are you sure you want to disconnect ${displayName}?`)) return;

        try {
            setDisconnectingId(accountId);
            const token = await getToken();
            if (!token) return;

            await disconnectSocialAccount(accountId, token);
            toast.success(`Disconnected ${displayName}`);
            setAccounts(prev => prev.filter(acc => acc.id !== accountId));
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Failed to disconnect account');
        } finally {
            setDisconnectingId(null);
        }
    };

    const getPlatformIcon = (platform: string) => {
        switch (platform.toLowerCase()) {
            case 'youtube':
                return <YoutubeIcon className="size-5 text-red-500" />;
            case 'facebook':
                return <FacebookIcon className="size-5 text-blue-500" />;
            case 'instagram':
                return <InstagramIcon className="size-5 text-pink-500" />;
            default:
                return null;
        }
    };

    if (!isLoaded) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2Icon className="size-7 animate-spin text-indigo-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen text-white p-6 md:p-12 mt-28">
            <div className="max-w-5xl mx-auto space-y-12">
                {/* Header */}
                <header className="space-y-3">
                    <h1 className="text-3xl md:text-4xl font-semibold">Connected Social Accounts</h1>
                    <p className="text-gray-400 max-w-2xl">
                        Connect your brand accounts on YouTube, Facebook Pages, and Instagram to publish or schedule your AI UGC ads directly from AdGen Studio.
                    </p>
                </header>

                {/* Connect Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* YouTube Card */}
                    <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border border-white/10 hover:border-red-500/30 transition-all">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                                    <YoutubeIcon className="size-6 text-red-500" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold">YouTube Shorts</h2>
                                    <p className="text-xs text-gray-400">Upload AI video ads directly to your channel</p>
                                </div>
                            </div>
                            <ul className="text-xs text-gray-300 space-y-2 pl-2">
                                <li className="flex items-center gap-2">
                                    <CheckCircle2Icon className="size-3.5 text-green-400" />
                                    <span>Supports 9:16 vertical video with auto #Shorts</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2Icon className="size-3.5 text-green-400" />
                                    <span>Direct resumable Cloudinary stream upload</span>
                                </li>
                            </ul>
                        </div>
                        <div className="pt-6">
                            <PrimaryButton 
                                onClick={() => handleConnect('youtube')}
                                disabled={connectingPlatform === 'youtube'}
                                className="w-full justify-center bg-red-600 hover:bg-red-700"
                            >
                                {connectingPlatform === 'youtube' ? (
                                    <>
                                        <Loader2Icon className="size-4 animate-spin" /> Connecting...
                                    </>
                                ) : (
                                    <>
                                        <PlusCircleIcon className="size-4" /> Connect YouTube
                                    </>
                                )}
                            </PrimaryButton>
                        </div>
                    </div>

                    {/* Meta Card (Facebook + Instagram) */}
                    <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border border-white/10 hover:border-blue-500/30 transition-all">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-gradient-to-tr from-blue-500/20 to-pink-500/20 rounded-xl border border-white/10 flex gap-1.5">
                                    <FacebookIcon className="size-5 text-blue-400" />
                                    <InstagramIcon className="size-5 text-pink-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold">Meta (Facebook & Instagram)</h2>
                                    <p className="text-xs text-gray-400">Publish photos, videos & Instagram Reels</p>
                                </div>
                            </div>
                            <ul className="text-xs text-gray-300 space-y-2 pl-2">
                                <li className="flex items-center gap-2">
                                    <CheckCircle2Icon className="size-3.5 text-green-400" />
                                    <span>Facebook Pages: Photo & Video ad posts</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle2Icon className="size-3.5 text-green-400" />
                                    <span>Instagram Business: Feed Photos & Reels</span>
                                </li>
                            </ul>
                        </div>
                        <div className="pt-6">
                            <PrimaryButton 
                                onClick={() => handleConnect('meta')}
                                disabled={connectingPlatform === 'meta'}
                                className="w-full justify-center bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                            >
                                {connectingPlatform === 'meta' ? (
                                    <>
                                        <Loader2Icon className="size-4 animate-spin" /> Connecting...
                                    </>
                                ) : (
                                    <>
                                        <PlusCircleIcon className="size-4" /> Connect Facebook & Instagram
                                    </>
                                )}
                            </PrimaryButton>
                        </div>
                    </div>
                </div>

                {/* Existing Connected Accounts Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Active Connections ({accounts.length})</h2>
                        <GhostButton onClick={loadAccounts} className="text-xs py-1.5 px-3">
                            <RefreshCwIcon className="size-3.5" /> Refresh
                        </GhostButton>
                    </div>

                    {loading ? (
                        <div className="glass-panel p-12 text-center rounded-2xl">
                            <Loader2Icon className="size-6 animate-spin text-indigo-400 mx-auto" />
                            <p className="text-xs text-gray-400 mt-2">Loading connected accounts...</p>
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="glass-panel p-12 text-center rounded-2xl border border-white/5">
                            <p className="text-gray-400 text-sm">No social accounts connected yet.</p>
                            <p className="text-gray-500 text-xs mt-1">Connect your YouTube channel or Facebook/Instagram page above to get started.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {accounts.map(account => (
                                <div key={account.id} className="glass-panel p-5 rounded-xl border border-white/10 flex flex-col justify-between space-y-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                                                {getPlatformIcon(account.platform)}
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-medium text-white truncate max-w-[160px]" title={account.displayName}>
                                                    {account.displayName}
                                                </h3>
                                                <span className="text-[11px] capitalize text-gray-400">
                                                    {account.platform}
                                                </span>
                                            </div>
                                        </div>

                                        {account.needsReconnect ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">
                                                <AlertTriangleIcon className="size-3" /> Reconnect
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">
                                                Active
                                            </span>
                                        )}
                                    </div>

                                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
                                        <span className="text-gray-500 text-[11px]">
                                            Connected {new Date(account.createdAt).toLocaleDateString()}
                                        </span>
                                        <button
                                            onClick={() => handleDisconnect(account.id, account.displayName)}
                                            disabled={disconnectingId === account.id}
                                            className="text-red-400 hover:text-red-300 flex items-center gap-1 text-xs cursor-pointer transition disabled:opacity-50"
                                        >
                                            {disconnectingId === account.id ? (
                                                <Loader2Icon className="size-3 animate-spin" />
                                            ) : (
                                                <Trash2Icon className="size-3.5" />
                                            )}
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Accounts;
