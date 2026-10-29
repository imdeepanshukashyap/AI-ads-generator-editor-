import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, LayersIcon, PlayIcon, VideoIcon, Volume2Icon, VolumeXIcon, XIcon } from 'lucide-react';
import api from '../configs/axios';
import toast from 'react-hot-toast';

type MediaTab = 'image' | 'video' | 'carousel';

const formatDuration = (seconds?: number) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : null;

const Community = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeTab, setActiveTab] = useState<MediaTab>('image');
  const [selectedVideo, setSelectedVideo] = useState<Project | null>(null);
  const [selectedCarousel, setSelectedCarousel] = useState<Project | null>(null);
  const [selectedCarouselIndex, setSelectedCarouselIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const dialogVideo = useRef<HTMLVideoElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const fetchProjects = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get('/api/project/published');
      setProjects(data.projects);
    } catch (caught: unknown) {
      setError(true);
      const message = caught && typeof caught === 'object' && 'response' in caught
        ? (caught as { response?: { data?: { message?: string } } }).response?.data?.message
        : caught instanceof Error ? caught.message : undefined;
      toast.error(message || 'Unable to load the community');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProjects();
  }, []);

  useEffect(() => {
    setSelectedVideo(null);
  }, [activeTab]);

  useEffect(() => {
    if (!selectedVideo) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedVideo(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogVideo.current?.play().catch(() => undefined);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      dialogVideo.current?.pause();
    };
  }, [selectedVideo]);

  useEffect(() => {
    if (!selectedCarousel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCarousel(null);
      if (event.key === 'ArrowLeft') setSelectedCarouselIndex((index) => (index - 1 + selectedCarousel.generatedImages!.length) % selectedCarousel.generatedImages!.length);
      if (event.key === 'ArrowRight') setSelectedCarouselIndex((index) => (index + 1) % selectedCarousel.generatedImages!.length);
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedCarousel]);

  const imageProjects = projects.filter((project) => !project.generatedVideo && (project.generatedImages?.length ?? 0) <= 1 && Boolean(project.generatedImage || project.generatedImages?.length));
  const videoProjects = projects.filter((project) => Boolean(project.generatedVideo));
  const carouselProjects = projects.filter((project) => !project.generatedVideo && (project.generatedImages?.length ?? 0) > 1);
  const visibleProjects = activeTab === 'image' ? imageProjects : activeTab === 'video' ? videoProjects : carouselProjects;
  const closeVideo = () => {
    dialogVideo.current?.pause();
    setSelectedVideo(null);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
    setActiveTab((['image', 'video', 'carousel'] as const)[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const openVideo = (project: Project) => {
    setMuted(true);
    setSelectedVideo(project);
  };

  const openCarousel = (project: Project) => {
    setSelectedCarouselIndex(0);
    setSelectedCarousel(project);
  };

  const closeCarousel = () => setSelectedCarousel(null);

  const showPreviousCarouselImage = () => {
    if (!selectedCarousel?.generatedImages?.length) return;
    setSelectedCarouselIndex((index) => (index - 1 + selectedCarousel.generatedImages!.length) % selectedCarousel.generatedImages!.length);
  };

  const showNextCarouselImage = () => {
    if (!selectedCarousel?.generatedImages?.length) return;
    setSelectedCarouselIndex((index) => (index + 1) % selectedCarousel.generatedImages!.length);
  };

  return (
    <main className='min-h-screen text-white px-5 pb-16 pt-32 md:px-12 md:pb-24'>
      <div className='mx-auto max-w-6xl'>
        <header className='mb-8'>
          <h1 className='text-3xl font-semibold md:text-4xl'>Community</h1>
          <p className='mt-3 text-sm text-gray-400 md:text-base'>Explore creations made with AdGen Studio.</p>
        </header>

        <div className='mb-8 inline-grid grid-cols-3 rounded-xl border border-white/10 bg-white/[0.03] p-1' role='tablist' aria-label='Community generation type'>
          {([
            { id: 'image' as const, label: 'Image Generations', icon: ImageIcon },
            { id: 'video' as const, label: 'Video Generations', icon: VideoIcon },
            { id: 'carousel' as const, label: 'Carousel Generations', icon: LayersIcon },
          ]).map((tab, index) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(element) => { tabRefs.current[index] = element; }}
                type='button'
                role='tab'
                id={`${tab.id}-tab`}
                aria-selected={active}
                aria-controls={`${tab.id}-panel`}
                tabIndex={active ? 0 : -1}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition sm:px-5 sm:text-sm ${active ? 'bg-violet-500 text-white shadow-[0_8px_24px_rgba(139,92,246,.22)]' : 'text-gray-400 hover:text-white'}`}
              >
                <Icon className='size-4' aria-hidden='true' />
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className='grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'>
            {[0, 1, 2].map((item) => <div key={item} className='h-80 animate-pulse rounded-2xl border border-white/8 bg-white/[0.04]' />)}
          </div>
        ) : error ? (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-2xl border border-red-400/15 bg-red-500/[0.04] text-center'>
            <AlertCircleIcon className='mb-3 size-7 text-red-300' />
            <h2 className='font-medium'>Community is unavailable</h2>
            <p className='mt-2 text-sm text-gray-500'>Please try loading the posts again.</p>
            <button type='button' onClick={() => void fetchProjects()} className='mt-5 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium hover:bg-violet-400'>Try again</button>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/[0.025] text-center'>
            {activeTab === 'image' ? <ImageIcon className='mb-3 size-8 text-violet-300' /> : activeTab === 'video' ? <VideoIcon className='mb-3 size-8 text-violet-300' /> : <LayersIcon className='mb-3 size-8 text-violet-300' />}
            <h2 className='font-medium'>No {activeTab === 'carousel' ? 'carousel' : activeTab} generations yet</h2>
            <p className='mt-2 text-sm text-gray-500'>Published community creations will appear here.</p>
          </div>
        ) : (
          <div role='tabpanel' id={`${activeTab}-panel`} aria-labelledby={`${activeTab}-tab`} className='grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'>
            {visibleProjects.map((project) => activeTab === 'image' ? (
              <article key={project.id} className='group overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] transition duration-300 hover:-translate-y-1 hover:border-violet-400/30 hover:shadow-[0_18px_50px_rgba(0,0,0,.28)]'>
                <div className={`${project.aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'} overflow-hidden bg-black/30`}>
                  <img src={project.generatedImages?.[0] || project.generatedImage} alt={`${project.productName} generated image`} className='h-full w-full object-contain transition duration-500 group-hover:scale-[1.025]' loading='lazy' />
                </div>
                <div className='p-4'><h2 className='truncate font-medium'>{project.productName}</h2><p className='mt-1 text-xs text-gray-500'>{project.user?.name || 'AdGen creator'} · {project.aspectRatio}</p></div>
              </article>
            ) : activeTab === 'video' ? (
              <article key={project.id} className='group overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] transition duration-300 hover:-translate-y-1 hover:border-violet-400/30'>
                <button type='button' onClick={() => openVideo(project)} aria-label={`Play ${project.productName} video`} className='relative block w-full overflow-hidden bg-black text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400'>
                  <div className={`${project.aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                    {project.generatedImage || project.generatedImages?.[0] ? (
                      <img src={project.generatedImages?.[0] || project.generatedImage} alt='' aria-hidden='true' className='absolute inset-0 h-full w-full object-contain transition-opacity duration-300 group-hover:opacity-0' loading='lazy' />
                    ) : null}
                    <video
                      src={project.generatedVideo}
                      muted
                      loop
                      playsInline
                      preload='metadata'
                      className='absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-300 group-hover:opacity-100'
                      onPointerEnter={(event) => { if (event.pointerType === 'mouse') void event.currentTarget.play().catch(() => undefined); }}
                      onPointerLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }}
                    />
                    <span className='absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur transition group-hover:scale-110'><PlayIcon className='ml-1 size-6 fill-white' aria-hidden='true' /></span>
                    {formatDuration(project.targetLength) && <span className='absolute bottom-3 right-3 rounded-md bg-black/75 px-2 py-1 text-xs tabular-nums'>{formatDuration(project.targetLength)}</span>}
                  </div>
                </button>
                <div className='p-4'><h2 className='truncate font-medium'>{project.productName}</h2><p className='mt-1 text-xs text-gray-500'>{project.user?.name || 'AdGen creator'} · Video</p></div>
              </article>
            ) : (
              <article key={project.id} className='overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] transition duration-300 hover:-translate-y-1 hover:border-violet-400/30 hover:shadow-[0_18px_50px_rgba(0,0,0,.28)]'>
                <button type='button' onClick={() => openCarousel(project)} aria-label={`Preview all ${project.generatedImages?.length} images for ${project.productName}`} className='block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400'>
                  <div className='grid grid-cols-3 gap-1 bg-black/30 p-1'>
                    {project.generatedImages?.map((image, index) => (
                      <img
                        key={`${project.id}-${index}`}
                        src={image}
                        alt={`${project.productName} carousel image ${index + 1}`}
                        className='aspect-[3/4] h-full w-full rounded-md object-cover'
                        loading='lazy'
                      />
                    ))}
                  </div>
                  <div className='p-4'>
                    <h2 className='truncate font-medium'>{project.productName}</h2>
                    <p className='mt-1 text-xs text-gray-500'>{project.user?.name || 'AdGen creator'} · {project.generatedImages?.length} images · {project.aspectRatio}</p>
                  </div>
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {selectedVideo?.generatedVideo && (
        <div role='dialog' aria-modal='true' aria-label={`${selectedVideo.productName} video`} className='fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md' onMouseDown={(event) => { if (event.target === event.currentTarget) closeVideo(); }}>
          <div className='relative w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#09090d] shadow-2xl'>
            <button type='button' onClick={closeVideo} aria-label='Close video player' className='absolute right-3 top-3 z-10 rounded-full bg-black/70 p-2 text-white hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'><XIcon className='size-5' /></button>
            <video ref={dialogVideo} src={selectedVideo.generatedVideo} muted={muted} controls playsInline onVolumeChange={(event) => setMuted(event.currentTarget.muted)} className='max-h-[78vh] w-full bg-black' />
            <button type='button' onClick={() => { const video = dialogVideo.current; if (!video) return; video.muted = !video.muted; setMuted(video.muted); void video.play().catch(() => undefined); }} aria-label={muted ? 'Unmute video' : 'Mute video'} className='absolute bottom-14 right-3 flex items-center gap-2 rounded-full bg-black/75 px-3 py-2 text-xs'>{muted ? <VolumeXIcon className='size-4' /> : <Volume2Icon className='size-4' />}{muted ? 'Unmute' : 'Mute'}</button>
          </div>
        </div>
      )}

      {selectedCarousel?.generatedImages?.length && (
        <div role='dialog' aria-modal='true' aria-label={`${selectedCarousel.productName} carousel preview`} className='fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md' onMouseDown={(event) => { if (event.target === event.currentTarget) closeCarousel(); }}>
          <div className='relative w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#09090d] shadow-2xl'>
            <div className='flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6'>
              <div className='min-w-0'>
                <h2 className='truncate font-medium'>{selectedCarousel.productName}</h2>
                <p className='mt-1 text-xs text-gray-400'>Image {selectedCarouselIndex + 1} of {selectedCarousel.generatedImages.length}</p>
              </div>
              <button type='button' onClick={closeCarousel} aria-label='Close carousel preview' className='shrink-0 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'>
                <XIcon className='size-5' />
              </button>
            </div>
            <div className='relative flex h-[min(65vh,680px)] items-center justify-center bg-black px-12 sm:px-16'>
              <img src={selectedCarousel.generatedImages[selectedCarouselIndex]} alt={`${selectedCarousel.productName} image ${selectedCarouselIndex + 1}`} className='max-h-full max-w-full object-contain' />
              <button type='button' onClick={showPreviousCarouselImage} aria-label='Previous image' className='absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/60 p-2 text-white transition hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'>
                <ChevronLeftIcon className='size-6' />
              </button>
              <button type='button' onClick={showNextCarouselImage} aria-label='Next image' className='absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/60 p-2 text-white transition hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'>
                <ChevronRightIcon className='size-6' />
              </button>
            </div>
            <div className='flex gap-2 overflow-x-auto border-t border-white/10 p-3 sm:p-4'>
              {selectedCarousel.generatedImages.map((image, index) => (
                <button key={`${selectedCarousel.id}-preview-${index}`} type='button' onClick={() => setSelectedCarouselIndex(index)} aria-label={`Show image ${index + 1}`} aria-current={index === selectedCarouselIndex ? 'true' : undefined} className={`shrink-0 overflow-hidden rounded-lg border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${index === selectedCarouselIndex ? 'border-violet-400' : 'border-transparent opacity-65 hover:opacity-100'}`}>
                  <img src={image} alt='' className='h-16 w-16 object-cover sm:h-20 sm:w-20' />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default Community;
