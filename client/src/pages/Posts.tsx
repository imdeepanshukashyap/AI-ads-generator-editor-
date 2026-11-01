import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { 
    Loader2Icon, 
    RefreshCwIcon, 
    ExternalLinkIcon, 
    AlertCircleIcon, 
    CheckCircle2Icon, 
    ClockIcon, 
    RotateCcwIcon,
    YoutubeIcon,
    FacebookIcon,
    InstagramIcon,
    VideoIcon,
    ImageIcon
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchPostHistory, retrySocialPost } from '../services/social';
import type { ScheduledPost } from '../types';
import { GhostButton, PrimaryButton } from '../components/Buttons';

const Posts = () => {
    const { user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const navigate = useNavigate();

    const [posts, setPosts] = useState<ScheduledPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [retryingId, setRetryingId] = useState<string | null>(null);

    const loadPosts = async () => {
        try {
            setLoading(true);
            const token = await getToken();
            if (!token) return;
            const data = await fetchPostHistory(token);
            setPosts(data);
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Failed to load post history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadPosts();
        }
    }, [user]);

    const handleRetry = async (postId: string) => {
        try {
            setRetryingId(postId);
            const token = await getToken();
            if (!token) return;

            const res = await retrySocialPost(postId, token);
            toast.success(res.message || 'Post retry initiated!');
            await loadPosts();
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Retry failed');
        } finally {
            setRetryingId(null);
        }
    };

    const getPlatformIcon = (platform?: string) => {
        switch (platform?.toLowerCase()) {
            case 'youtube':
                return <YoutubeIcon className="size-4 text-red-500" />;
            case 'facebook':
                return <FacebookIcon className="size-4 text-blue-500" />;
            case 'instagram':
                return <InstagramIcon className="size-4 text-pink-500" />;
            default:
                return null;
        }
    };

    const renderStatusBadge = (post: ScheduledPost) => {
        switch (post.status) {
            case 'published':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                        <CheckCircle2Icon className="size-3.5" /> Published
                    </span>
                );
            case 'scheduled':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        <ClockIcon className="size-3.5" /> Scheduled
                    </span>
                );
            case 'publishing':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Loader2Icon className="size-3.5 animate-spin" /> Publishing...
                    </span>
                );
            case 'failed':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                        <AlertCircleIcon className="size-3.5" /> Failed
                    </span>
                );
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
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-semibold">Social Post History</h1>
                        <p className="text-gray-400 text-sm mt-1">Track live publications, scheduled campaigns, and delivery statuses.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <GhostButton onClick={loadPosts} className="text-xs">
                            <RefreshCwIcon className="size-3.5" /> Refresh
                        </GhostButton>
                        <PrimaryButton onClick={() => navigate('/accounts')} className="text-xs">
                            Connected Accounts
                        </PrimaryButton>
                    </div>
                </div>

                {/* Posts List */}
                {loading ? (
                    <div className="glass-panel p-16 text-center rounded-2xl">
                        <Loader2Icon className="size-7 animate-spin text-indigo-400 mx-auto" />
                        <p className="text-sm text-gray-400 mt-3">Loading post history...</p>
                    </div>
                ) : posts.length === 0 ? (
                    <div className="glass-panel p-16 text-center rounded-2xl border border-white/5 space-y-4">
                        <h3 className="text-lg font-medium text-white">No posts published yet</h3>
                        <p className="text-sm text-gray-400 max-w-md mx-auto">
                            Go to any generated ad on the Result page and click "Share to Social" to publish or schedule your ad.
                        </p>
                        <PrimaryButton onClick={() => navigate('/my-generations')} className="mx-auto">
                            View My Generations
                        </PrimaryButton>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {posts.map(post => (
                            <div
                                key={post.id}
                                className="glass-panel p-5 rounded-2xl border border-white/10 hover:border-white/20 transition-all flex flex-col md:flex-row items-start md:items-center gap-5 justify-between"
                            >
                                {/* Left Section: Media Thumbnail + Details */}
                                <div className="flex items-start gap-4 min-w-0 flex-1">
                                    <div className="relative size-16 rounded-xl overflow-hidden bg-black/40 shrink-0 border border-white/10">
                                        {post.mediaType === 'video' ? (
                                            <video src={post.mediaUrl} className="w-full h-full object-cover" muted />
                                        ) : (
                                            <img src={post.mediaUrl} alt="Post media" className="w-full h-full object-cover" />
                                        )}
                                        <div className="absolute bottom-1 right-1 p-0.5 rounded bg-black/60">
                                            {post.mediaType === 'video' ? (
                                                <VideoIcon className="size-3 text-indigo-400" />
                                            ) : (
                                                <ImageIcon className="size-3 text-pink-400" />
                                            )}
                                        </div>
                                    </div>

                                    <div className="min-w-0 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium text-sm text-white">
                                                {post.project?.productName || post.project?.name || 'Advertisement'}
                                            </span>
                                            <span className="text-gray-500">•</span>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-300">
                                                {getPlatformIcon(post.socialAccount?.platform)}
                                                <span>{post.socialAccount?.displayName}</span>
                                            </div>
                                        </div>

                                        <p className="text-xs text-gray-400 line-clamp-2 max-w-xl">
                                            {post.caption}
                                        </p>

                                        <div className="flex items-center gap-3 text-[11px] text-gray-500 pt-0.5">
                                            <span>Created {new Date(post.createdAt).toLocaleDateString()} at {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            {post.scheduledFor && post.status === 'scheduled' && (
                                                <span className="text-purple-300 font-medium">
                                                    Scheduled for: {new Date(post.scheduledFor).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                </span>
                                            )}
                                            {post.aiDisclosure && (
                                                <span className="text-indigo-400/80">✨ AI Disclosed</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Section: Status Badge & Actions */}
                                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end pt-3 md:pt-0 border-t md:border-t-0 border-white/5">
                                    {renderStatusBadge(post)}

                                    {/* Link to live post if published */}
                                    {post.status === 'published' && post.externalUrl && (
                                        <a
                                            href={post.externalUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 text-indigo-400 hover:text-indigo-300 rounded-lg hover:bg-white/5 transition flex items-center gap-1 text-xs"
                                            title="View live post"
                                        >
                                            <ExternalLinkIcon className="size-4" />
                                            <span className="hidden sm:inline">View Post</span>
                                        </a>
                                    )}

                                    {/* Retry button if failed */}
                                    {post.status === 'failed' && (
                                        <GhostButton
                                            onClick={() => handleRetry(post.id)}
                                            disabled={retryingId === post.id}
                                            className="text-xs py-1.5 px-3 border-red-500/30 text-red-300 hover:bg-red-500/10"
                                        >
                                            {retryingId === post.id ? (
                                                <Loader2Icon className="size-3.5 animate-spin" />
                                            ) : (
                                                <RotateCcwIcon className="size-3.5" />
                                            )}
                                            Retry
                                        </GhostButton>
                                    )}
                                </div>

                                {/* Error message banner if failed */}
                                {post.status === 'failed' && post.error && (
                                    <div className="w-full text-xs text-red-400 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20 mt-2">
                                        <strong>Error:</strong> {post.error}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Posts;
