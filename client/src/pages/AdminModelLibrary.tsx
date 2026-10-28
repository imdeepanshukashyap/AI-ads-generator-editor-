import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ImagePlusIcon, Loader2Icon, PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import toast from 'react-hot-toast';
import api from '../configs/axios';

type Model = { id: string; name: string; description: string; category: string; tags: string[]; imageUrl: string; isPublished: boolean; createdAt: string };
type Page = { data: Model[]; categories: string[]; pagination: { page: number; totalPages: number; total: number } };
const inputClass = 'mt-2 w-full rounded-xl border border-violet-200/[0.14] bg-white/[0.055] px-3.5 py-3 text-sm outline-none focus:border-violet-300/60 focus:ring-4 focus:ring-violet-500/10';

export default function AdminModelLibrary() {
  const { getToken } = useAuth();
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [published, setPublished] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [form, setForm] = useState({ name: '', description: '', category: 'General', tags: '', isPublished: true });
  const imageInput = useRef<HTMLInputElement>(null);

  const headers = async () => ({ Authorization: `Bearer ${await getToken()}` });
  const load = async (retry = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (published) params.set('published', published);
      const response = await api.get(`/api/admin/model-library?${params}`, { headers: await headers() });
      setPage(response.data);
      if (retry) toast.success('Library refreshed');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Unable to load model library');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [category, published]);
  useEffect(() => {
    if (!image) { setImagePreview(''); return; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const reset = () => {
    setEditing(null); setOpen(false); setImage(null); setImagePreview('');
    setForm({ name: '', description: '', category: 'General', tags: '', isPublished: true });
  };
  const beginCreate = () => { reset(); setOpen(true); };
  const beginEdit = (model: Model) => {
    setEditing(model); setOpen(true); setImage(null);
    setForm({ name: model.name, description: model.description || '', category: model.category, tags: (model.tags || []).join(', '), isPublished: model.isPublished });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Model name is required');
    if (!editing && !image) return toast.error('Choose an image for the model');
    setSaving(true);
    try {
      const body = new FormData();
      body.set('name', form.name.trim());
      body.set('description', form.description.trim());
      body.set('category', form.category.trim() || 'General');
      body.set('tags', form.tags);
      body.set('isPublished', String(form.isPublished));
      if (image) body.set('image', image);
      const response = editing
        ? await api.patch(`/api/admin/model-library/${editing.id}`, body, { headers: await headers() })
        : await api.post('/api/admin/model-library', body, { headers: await headers() });
      toast.success(response.data.message);
      reset(); await load();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Unable to save model');
    } finally { setSaving(false); }
  };

  const togglePublished = async (model: Model) => {
    try {
      await api.patch(`/api/admin/model-library/${model.id}`, { isPublished: !model.isPublished }, { headers: await headers() });
      toast.success(model.isPublished ? 'Model unpublished' : 'Model published'); await load();
    } catch (error: any) { toast.error(error?.response?.data?.message || 'Unable to update model'); }
  };
  const remove = async (model: Model) => {
    if (!window.confirm(`Delete “${model.name}” from the model library? Existing generated projects will retain their images.`)) return;
    try { await api.delete(`/api/admin/model-library/${model.id}`, { headers: await headers() }); toast.success('Model deleted'); await load(); }
    catch (error: any) { toast.error(error?.response?.data?.message || 'Unable to delete model'); }
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      <label className="relative flex-1 sm:max-w-xs"><SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" /><span className="sr-only">Search models</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void load()} placeholder="Search models" className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400" /></label>
      <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter category" className="rounded-xl border border-white/10 bg-[#171039] px-3 py-2.5 text-sm"><option value="">All categories</option>{page?.categories.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={published} onChange={(event) => setPublished(event.target.value)} aria-label="Filter publication status" className="rounded-xl border border-white/10 bg-[#171039] px-3 py-2.5 text-sm"><option value="">All statuses</option><option value="true">Published</option><option value="false">Unpublished</option></select>
      <button type="button" onClick={beginCreate} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-semibold hover:bg-violet-400"><ImagePlusIcon className="size-4" />Add model</button>
    </div>

    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#080713]/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={editing ? 'Edit model' : 'Add model'}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-violet-200/20 bg-[#171039]/95 p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-violet-300">MODEL DETAILS</p><h2 className="mt-1 text-xl font-semibold">{editing ? 'Edit library model' : 'Add AI model'}</h2></div><button type="button" onClick={reset} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm">Close</button></div>
        <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
          <button type="button" onClick={() => imageInput.current?.click()} className="group relative flex aspect-[4/5] min-h-72 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-300/30 bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.14),_transparent_55%),rgba(255,255,255,0.035)] text-sm text-slate-300">
            {(imagePreview || editing?.imageUrl) ? <img src={imagePreview || editing?.imageUrl} alt="Model preview" className="absolute inset-0 h-full w-full object-contain p-2" /> : <span>Choose model image</span>}
            <span className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 opacity-0 backdrop-blur-md group-hover:opacity-100">{editing ? 'Replace image' : 'Choose image'}</span>
          </button>
          <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => setImage(event.target.files?.[0] || null)} />
          <div className="space-y-4"><label className="block text-sm">Name<input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label><label className="block text-sm">Description<textarea rows={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${inputClass} resize-none`} /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm">Category<input maxLength={40} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={inputClass} /></label><label className="block text-sm">Tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="fashion, studio" className={inputClass} /></label></div><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.isPublished} onChange={(event) => setForm({ ...form, isPublished: event.target.checked })} className="size-4 accent-violet-500" />Publish to users</label></div>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={reset} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm">Cancel</button><button type="submit" disabled={saving} className="min-w-28 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold hover:bg-violet-400 disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Save changes' : 'Add model'}</button></div>
      </form>
    </div>}

    {loading ? <div className="flex justify-center py-24"><Loader2Icon className="size-8 animate-spin text-violet-300" /></div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {(page?.data || []).map((model) => <article key={model.id} className="overflow-hidden rounded-2xl border border-violet-200/[0.14] bg-white/[0.035]">
        <div className="aspect-[4/5] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.12),_transparent_60%),rgba(8,7,19,0.72)]"><img src={model.imageUrl} alt={model.name} className="h-full w-full object-contain p-2" /></div>
        <div className="p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{model.name}</h2><p className="mt-1 text-xs text-violet-300">{model.category}</p></div><button type="button" onClick={() => void togglePublished(model)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${model.isPublished ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-gray-400'}`}>{model.isPublished ? 'Published' : 'Unpublished'}</button></div>{model.description && <p className="mt-3 line-clamp-2 text-sm text-gray-400">{model.description}</p>}<div className="mt-4 flex items-center justify-end gap-2"><button type="button" onClick={() => beginEdit(model)} aria-label={`Edit ${model.name}`} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5"><PencilIcon className="size-4" /></button><button type="button" onClick={() => void remove(model)} aria-label={`Delete ${model.name}`} className="rounded-lg border border-rose-300/10 p-2 text-rose-300 hover:bg-rose-500/10"><Trash2Icon className="size-4" /></button></div></div>
      </article>)}
    </div>}
    {!loading && page?.data.length === 0 && <div className="rounded-2xl border border-dashed border-violet-200/15 py-16 text-center text-gray-500">No model library entries found.</div>}
  </div>;
}
