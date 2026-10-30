import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { 
    XIcon, 
    SparklesIcon, 
    Loader2Icon, 
    CalendarIcon, 
    SendIcon, 
    CheckCircle2Icon, 
    AlertCircleIcon,
    YoutubeIcon,
    FacebookIcon,
    InstagramIcon,
    ImageIcon,
    VideoIcon
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Project, SocialAccount } from '../types';
import { fetchConnectedAccounts, generateAiCaption, publishSocialPost } from '../services/social';
import { GhostButton, PrimaryButton } from './Buttons';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
    initialSelectedMedia?: string | null;
}

export const ShareModal: React.FC<ShareModalProps> = ({
    isOpen,
    onClose,
    project,
    initialSelectedMedia,
}) => {
    const { getToken } = useAuth();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<SocialAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');

    // Media list available from this project
    const availableMedia: { url: string; type: 'image' | 'video'; label: string }[] = [];
    if (project.generatedVideo) {
        availableMedia.push({ url: project.generatedVideo, type: 'video', label: 'AI Video Commercial' });
    }
    if (project.generatedImages && project.generatedImages.length > 0) {
        project.generatedImages.forEach((url, i) => {
            const angleName = i === 0 ? 'Hero Shot' : i === 1 ? 'Detail Shot' : 'Action Shot';
            availableMedia.push({ url, type: 'image', label: `${angleName}` });
        });
    } else if (project.generatedImage) {
        availableMedia.push({ url: project.generatedImage, type: 'image', label: 'Generated Image' });
    }

    const [selectedMediaUrl, setSelectedMediaUrl] = useState<string>(
        initialSelectedMedia || availableMedia[0]?.url || ''
    );

    const [caption, setCaption] = useState<string>('');
    const [hashtags, setHashtags] = useState<string[]>([]);
    const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
    const [aiDisclosure, setAiDisclosure] = useState(true);

    const [publishMode, setPublishMode] = useState<'now' | 'schedule'>('now');
    const [scheduledDateTime, setScheduledDateTime] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Load user's connected social accounts
    useEffect(() => {
        if (!isOpen) return;

        const loadAccounts = async () => {
            try {
                setLoadingAccounts(true);
                const token = await getToken();
                if (!token) return;
                const data = await fetchConnectedAccounts(token);
                setAccounts(data);
                if (data.length > 0) {
                    setSelectedAccountId(data[0].id);
                }
            } catch (err: any) {
                toast.error('Failed to load connected social accounts');
            } finally {
                setLoadingAccounts(false);
            }
        };

        loadAccounts();
    }, [isOpen]);

    // Prevent background page from scrolling when modal is open
    useEffect(() => {
        if (!isOpen) return;
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const selectedMedia = availableMedia.find(m => m.url === selectedMediaUrl) || availableMedia[0];
    const selectedAccount = accounts.find(a => a.id === selectedAccountId);

    // Validation rules
    const isYouTube = selectedAccount?.platform === 'youtube';
    const isImage = selectedMedia?.type === 'image';
    const isYouTubeImageIncompatible = isYouTube && isImage;

    const handleGenerateCaption = async () => {
        if (!selectedAccount) {
            toast.error('Please select a target account first');
            return;
        }

        try {
            setIsGeneratingCaption(true);
            const token = await getToken();
            if (!token) return;

            const res = await generateAiCaption(project.id, selectedAccount.platform, token);
            setCaption(res.caption);
            setHashtags(res.hashtags || []);
            toast.success('AI caption generated!');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to generate AI caption');
        } finally {
            setIsGeneratingCaption(false);
        }
    };

    const handleAddHashtag = (tag: string) => {
        if (!caption.includes(tag)) {
            setCaption(prev => `${prev} ${tag}`.trim());
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedAccountId) {
            toast.error('Please select a connected social account');
            return;
        }

        if (isYouTubeImageIncompatible) {
            toast.error('YouTube only accepts videos, not static images. Please select the AI video.');
            return;
        }

        if (!caption.trim()) {
            toast.error('Please enter a caption or generate one with AI');
            return;
        }

        if (publishMode === 'schedule') {
            if (!scheduledDateTime) {
                toast.error('Please select a scheduled date and time');
                return;
            }
            if (new Date(scheduledDateTime).getTime() <= Date.now()) {
                toast.error('Scheduled time must be in the future');
                return;
            }
        }

        try {
            setIsSubmitting(true);
            const token = await getToken();
            if (!token) return;

            const res = await publishSocialPost({
                projectId: project.id,
                socialAccountId: selectedAccountId,
                mediaUrl: selectedMediaUrl,
                caption,
                aiDisclosure,
                scheduledFor: publishMode === 'schedule' ? new Date(scheduledDateTime).toISOString() : undefined,
            }, token);

            toast.success(res.message || (publishMode === 'now' ? 'Published successfully!' : 'Scheduled successfully!'));
            onClose();
            navigate('/posts');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || err.message || 'Failed to submit post');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-hidden animate-fade-in"
            onClick={onClose}
        >
            <div 
                onClick={e => e.stopPropagation()} 
                className="glass-panel w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-white/10 shadow-2xl overflow-hidden bg-gray-950/95"
            >
                {/* Fixed Header */}
                <div className="flex items-center justify-between p-6 pb-4 border-b border-white/10 shrink-0">
                    <div>
                        <h2 className="text-xl font-semibold text-white">Share Ad to Social Media</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{project.productName} ({project.aspectRatio})</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition">
                        <XIcon className="size-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Scrollable Content Body */}
                    <div className="overflow-y-auto overscroll-contain p-6 space-y-6 flex-1">
                        {/* 1. Media Selector */}
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
                            1. Select Media Asset
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {availableMedia.map((m, idx) => {
                                const isSelected = selectedMediaUrl === m.url;
                                return (
                                    <button
                                        type="button"
                                        key={idx}
                                        onClick={() => setSelectedMediaUrl(m.url)}
                                        className={`relative rounded-xl overflow-hidden border-2 text-left p-1 transition-all ${
                                            isSelected 
                                                ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/10' 
                                                : 'border-white/10 hover:border-white/20 bg-white/5'
                                        }`}
                                    >
                                        <div className="aspect-square rounded-lg overflow-hidden relative bg-black/40">
                                            {m.type === 'video' ? (
                                                <video src={m.url} className="w-full h-full object-cover" muted />
                                            ) : (
                                                <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                                            )}
                                            <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] bg-black/60 font-medium flex items-center gap-1 text-white">
                                                {m.type === 'video' ? <VideoIcon className="size-2.5 text-indigo-400" /> : <ImageIcon className="size-2.5 text-pink-400" />}
                                                {m.type === 'video' ? 'Video' : 'Image'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] font-medium text-gray-200 mt-1 truncate px-1">{m.label}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Account Picker */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
                                2. Destination Account
                            </label>
                            <button
                                type="button"
                                onClick={() => navigate('/accounts')}
                                className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                            >
                                Manage accounts
                            </button>
                        </div>

                        {loadingAccounts ? (
                            <div className="p-3 bg-white/5 rounded-xl flex items-center justify-center text-xs text-gray-400">
                                <Loader2Icon className="size-4 animate-spin mr-2" /> Loading accounts...
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center justify-between">
                                <span>No connected accounts found. Please connect YouTube or Meta first.</span>
                                <button
                                    type="button"
                                    onClick={() => navigate('/accounts')}
                                    className="px-2.5 py-1 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400"
                                >
                                    Connect Now
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {accounts.map(acc => {
                                    const isSelected = selectedAccountId === acc.id;
                                    const isYtImg = acc.platform === 'youtube' && isImage;

                                    return (
                                        <button
                                            type="button"
                                            key={acc.id}
                                            onClick={() => setSelectedAccountId(acc.id)}
                                            className={`p-3 rounded-xl border flex items-center gap-3 transition-all text-left ${
                                                isSelected 
                                                    ? 'border-indigo-500 bg-indigo-500/15 ring-2 ring-indigo-500/20' 
                                                    : 'border-white/10 hover:border-white/20 bg-white/5'
                                            } ${isYtImg ? 'opacity-50' : ''}`}
                                        >
                                            <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                                                {acc.platform === 'youtube' && <YoutubeIcon className="size-4 text-red-500" />}
                                                {acc.platform === 'facebook' && <FacebookIcon className="size-4 text-blue-500" />}
                                                {acc.platform === 'instagram' && <InstagramIcon className="size-4 text-pink-500" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-medium text-white truncate">{acc.displayName}</div>
                                                <div className="text-[10px] capitalize text-gray-400">{acc.platform}</div>
                                            </div>
                                            {isSelected && <CheckCircle2Icon className="size-4 text-indigo-400 shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Format warnings */}
                        {isYouTubeImageIncompatible && (
                            <p className="text-xs text-red-400 flex items-center gap-1.5 mt-2">
                                <AlertCircleIcon className="size-3.5 shrink-0" />
                                YouTube only accepts video uploads. Please select the AI video above.
                            </p>
                        )}
                        {selectedAccount?.platform === 'instagram' && isImage && project.aspectRatio === '9:16' && (
                            <p className="text-xs text-amber-300 flex items-center gap-1.5 mt-2 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                                <AlertCircleIcon className="size-3.5 shrink-0" />
                                9:16 still images will be automatically padded to 4:5 for Instagram Feed compliance.
                            </p>
                        )}
                    </div>

                    {/* 3. AI Caption & Hashtags */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
                                3. Caption & Copy
                            </label>
                            <button
                                type="button"
                                onClick={handleGenerateCaption}
                                disabled={isGeneratingCaption || !selectedAccount}
                                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium disabled:opacity-50 cursor-pointer"
                            >
                                {isGeneratingCaption ? (
                                    <>
                                        <Loader2Icon className="size-3.5 animate-spin" /> Generating...
                                    </>
                                ) : (
                                    <>
                                        <SparklesIcon className="size-3.5" /> Generate with AI
                                    </>
                                )}
                            </button>
                        </div>

                        <textarea
                            rows={4}
                            value={caption}
                            onChange={e => setCaption(e.target.value)}
                            placeholder="Write your caption here or click 'Generate with AI'..."
                            className="w-full bg-white/5 rounded-xl border border-white/10 p-3.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 outline-none transition"
                        />

                        {/* Hashtag suggestions */}
                        {hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                {hashtags.map((tag, i) => (
                                    <button
                                        type="button"
                                        key={i}
                                        onClick={() => handleAddHashtag(tag)}
                                        className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition cursor-pointer"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 4. Options & Publishing Mode */}
                    <div className="space-y-4 pt-2 border-t border-white/10">
                        {/* AI Disclosure Toggle */}
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={aiDisclosure}
                                onChange={e => setAiDisclosure(e.target.checked)}
                                className="size-4 accent-indigo-600 rounded cursor-pointer"
                            />
                            <div className="text-xs text-gray-300">
                                <span className="font-medium text-white">Include AI-Generated Disclosure</span>
                                <span className="block text-[11px] text-gray-500">Appends "✨ AI Disclosure: Generated with Vigyapan AI" to the post.</span>
                            </div>
                        </label>

                        {/* Publish Now vs Schedule */}
                        <div className="flex gap-4">
                            <button
                                type="button"
                                onClick={() => setPublishMode('now')}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition ${
                                    publishMode === 'now' 
                                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30' 
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                                }`}
                            >
                                <SendIcon className="size-3.5 inline mr-1.5" /> Post Now
                            </button>
                            <button
                                type="button"
                                onClick={() => setPublishMode('schedule')}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition ${
                                    publishMode === 'schedule' 
                                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30' 
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                                }`}
                            >
                                <CalendarIcon className="size-3.5 inline mr-1.5" /> Schedule for Later
                            </button>
                        </div>

                        {/* DateTime Picker if scheduling */}
                        {publishMode === 'schedule' && (
                            <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-1.5 animate-fade-in">
                                <label className="block text-[11px] text-gray-400">Select Date & Time</label>
                                <input
                                    type="datetime-local"
                                    value={scheduledDateTime}
                                    min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                                    onChange={e => setScheduledDateTime(e.target.value)}
                                    className="w-full bg-black/40 rounded-lg p-2.5 text-xs text-white border border-white/10 focus:border-indigo-500 outline-none"
                                    required={publishMode === 'schedule'}
                                />
                            </div>
                        )}
                    </div>
                </div>

                    {/* Fixed Actions Footer */}
                    <div className="flex gap-3 p-5 border-t border-white/10 bg-black/60 backdrop-blur-md shrink-0">
                        <GhostButton type="button" onClick={onClose} className="w-1/3 justify-center">
                            Cancel
                        </GhostButton>
                        <PrimaryButton
                            type="submit"
                            disabled={isSubmitting || accounts.length === 0 || isYouTubeImageIncompatible}
                            className="w-2/3 justify-center"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2Icon className="size-4 animate-spin" /> 
                                    {publishMode === 'now' ? 'Publishing...' : 'Scheduling...'}
                                </>
                            ) : (
                                <>
                                    <SendIcon className="size-4" /> 
                                    {publishMode === 'now' ? 'Publish Post Now' : 'Schedule Post'}
                                </>
                            )}
                        </PrimaryButton>
                    </div>
                </form>
            </div>
        </div>
    );
};
