import { CheckIcon, SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import api from '../configs/axios';
import { getApiErrorMessage } from '../utils/apiError';

export type LibraryModel = {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags?: string[];
  imageUrl: string;
};

type Props = {
  open: boolean;
  selectedId?: string;
  onClose: () => void;
  onSelect: (model: LibraryModel) => void;
};

export default function ModelLibraryBrowser({ open, selectedId, onClose, onSelect }: Props) {
  const [models, setModels] = useState<LibraryModel[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LibraryModel | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ limit: '48' });
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      api.get(`/api/model-library?${params}`).then((response) => {
        if (!active) return;
        const loadedModels: LibraryModel[] = response.data.data || [];
        setModels(loadedModels);
        setCategories(response.data.categories || []);
        setSelected((current) => {
          if (current && loadedModels.some((model) => model.id === current.id)) return current;
          return loadedModels.find((model) => model.id === selectedId);
        });
      }).catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, 'Unable to load the model library'));
      }).finally(() => active && setLoading(false));
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [open, search, category, selectedId, retryKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', closeOnEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const filteredCount = useMemo(() => models.length, [models]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-110 flex items-end justify-center bg-[#080713]/85 p-0 backdrop-blur-md sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="model-library-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-violet-200/20 bg-[#100e25]/95 shadow-[0_28px_100px_rgba(5,3,20,.8)] sm:rounded-3xl">
        <header className="flex items-start justify-between border-b border-violet-200/10 px-5 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-violet-300">CURATED ASSETS</p>
            <h2 id="model-library-title" className="mt-1 text-xl font-semibold sm:text-2xl">AI Model Library</h2>
            <p className="mt-1 text-sm text-slate-400">Choose a published model for your campaign.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close model library" className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><XIcon className="size-5" /></button>
        </header>

        <div className="flex flex-col gap-3 border-b border-violet-200/10 px-5 py-4 sm:flex-row sm:px-7">
          <label className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <span className="sr-only">Search models</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models" className="h-11 w-full rounded-xl border border-violet-200/14 bg-white/5 pl-10 pr-4 text-sm outline-none focus:border-violet-300/60 focus:ring-4 focus:ring-violet-500/10" />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" className="h-11 rounded-xl border border-violet-200/[0.14] bg-[#171039] px-3 text-sm outline-none focus:border-violet-300/60">
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="min-h-72 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="aspect-4/5 animate-pulse rounded-2xl border border-white/5 bg-white/4" />)}</div>
            : error ? <div className="flex min-h-72 items-center justify-center text-center"><div><p className="text-rose-300">{error}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-4 rounded-lg border border-violet-300/20 px-4 py-2 text-sm">Retry</button></div></div>
              : models.length === 0 ? <div className="min-h-72 text-center"><p className="text-slate-300">No published models match this search.</p></div>
                : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{models.map((model) => {
                  const isSelected = selected?.id === model.id;
                  return <button type="button" key={model.id} onClick={() => setSelected(model)} aria-pressed={isSelected} className={`group overflow-hidden rounded-2xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${isSelected ? 'border-violet-300/70 bg-violet-500/15 shadow-[0_12px_35px_rgba(139,92,246,.16)]' : 'border-violet-200/12 bg-white/[0.035] hover:border-violet-300/35'}`}>
                    <span className="relative block aspect-4/5 overflow-hidden bg-black/20">
                      <img src={model.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                      {isSelected && <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-violet-500 text-white"><CheckIcon className="size-4" /></span>}
                    </span>
                    <span className="block p-3"><span className="block truncate text-sm font-semibold">{model.name}</span><span className="mt-1 block text-xs text-violet-300">{model.category}</span></span>
                  </button>;
                })}</div>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-violet-200/10 px-5 py-4 sm:px-7">
          <p className="text-xs text-slate-500">{filteredCount} model{filteredCount === 1 ? '' : 's'}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-violet-200/15 px-4 text-sm hover:bg-white/5">Cancel</button>
            <button type="button" disabled={!selected} onClick={() => selected && onSelect(selected)} className="min-h-10 rounded-xl bg-violet-500 px-4 text-sm font-semibold shadow-[0_8px_24px_rgba(139,92,246,.25)] hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">Use This Model</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
