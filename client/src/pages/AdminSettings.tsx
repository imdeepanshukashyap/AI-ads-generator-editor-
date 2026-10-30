import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { LanguagesIcon, Loader2Icon, SaveIcon, ShieldAlertIcon, SparklesIcon, VideoIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../configs/axios';

type AdminSettingsValues = { maintenanceMode: boolean; maxImageGenerations: number; maxVideoGenerations: number; defaultUserCredits: number; supportedLanguages: string[] };
const defaults: AdminSettingsValues = { maintenanceMode: false, maxImageGenerations: 100, maxVideoGenerations: 50, defaultUserCredits: 20, supportedLanguages: ['English', 'Hindi'] };
const inputClass = 'mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15';

export default function AdminSettings() {
    const { getToken } = useAuth();
    const [settings, setSettings] = useState<AdminSettingsValues>(defaults);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const token = await getToken();
                const { data } = await api.get('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
                const values = (data.data as Array<{ key: keyof AdminSettingsValues; value: AdminSettingsValues[keyof AdminSettingsValues] }>).reduce((result, item) => ({ ...result, [item.key]: item.value }), {} as Partial<AdminSettingsValues>);
                if (active) setSettings({ ...defaults, ...values });
            } catch { toast.error('Unable to load settings'); } finally { if (active) setLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [getToken]);

    const save = async () => {
        setSaving(true);
        try {
            const token = await getToken();
            await api.patch('/api/admin/settings', settings, { headers: { Authorization: `Bearer ${token}` } });
            toast.success('Settings saved');
        } catch (error: unknown) {
            const message = error && typeof error === 'object' && 'response' in error ? (error as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
            toast.error(message || 'Unable to save settings');
        } finally { setSaving(false); }
    };

    if (loading) return <div className='glass-panel flex min-h-80 items-center justify-center rounded-xl text-gray-400' role='status'><Loader2Icon className='mr-2 size-5 animate-spin text-violet-400' />Loading settings…</div>;

    const numberSettings = [
        { key: 'defaultUserCredits' as const, label: 'Default user credits', icon: SparklesIcon },
        { key: 'maxImageGenerations' as const, label: 'Max image generations', icon: SparklesIcon },
        { key: 'maxVideoGenerations' as const, label: 'Max video generations', icon: VideoIcon },
    ];

    return (
        <div className='max-w-5xl space-y-5'>
            <section className='glass-panel overflow-hidden rounded-xl'>
                <div className='border-b border-white/8 px-5 py-4 sm:px-6'><h2 className='font-semibold text-white'>Platform controls</h2><p className='mt-1 text-sm text-gray-500'>Control availability and resource limits for users.</p></div>
                <div className='p-5 sm:p-6'>
                    <label className='flex cursor-pointer items-start justify-between gap-5 rounded-xl border border-white/8 bg-white/[0.02] p-4 transition hover:border-white/15'>
                        <div className='flex gap-3'><div className='mt-0.5 rounded-lg bg-amber-500/10 p-2 text-amber-300'><ShieldAlertIcon className='size-5' /></div><div><span className='block text-sm font-medium text-white'>Maintenance mode</span><span className='mt-1 block text-xs leading-5 text-gray-500'>Temporarily stop normal user generation activity.</span></div></div>
                        <input type='checkbox' aria-label='Maintenance mode' checked={settings.maintenanceMode} onChange={(event) => setSettings({ ...settings, maintenanceMode: event.target.checked })} className='mt-1 size-5 shrink-0 accent-violet-500' />
                    </label>
                    <div className='mt-5 grid gap-4 lg:grid-cols-3'>{numberSettings.map(({ key, label, icon: Icon }) => <label key={key} className='block rounded-xl border border-white/8 bg-white/[0.02] p-4 text-sm text-gray-300'><span className='flex items-center gap-2'><Icon className='size-4 text-violet-300' />{label}</span><input type='number' min='0' value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Math.max(0, Number(event.target.value)) })} className={inputClass} /></label>)}</div>
                </div>
            </section>
            <section className='glass-panel overflow-hidden rounded-xl'>
                <div className='border-b border-white/8 px-5 py-4 sm:px-6'><h2 className='font-semibold text-white'>Localization</h2><p className='mt-1 text-sm text-gray-500'>Languages offered by AdGen Studio.</p></div>
                <div className='p-5 sm:p-6'><label className='block text-sm text-gray-300'><span className='flex items-center gap-2'><LanguagesIcon className='size-4 text-violet-300' />Supported languages</span><input value={settings.supportedLanguages.join(', ')} onChange={(event) => setSettings({ ...settings, supportedLanguages: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className={inputClass} placeholder='English, Hindi' /></label><p className='mt-2 text-xs text-gray-500'>Separate each language with a comma.</p></div>
            </section>
            <div className='flex justify-end'><button type='button' onClick={() => void save()} disabled={saving} className='inline-flex min-w-32 items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]'>{saving ? <Loader2Icon className='size-4 animate-spin' /> : <SaveIcon className='size-4' />}{saving ? 'Saving…' : 'Save settings'}</button></div>
        </div>
    );
}
