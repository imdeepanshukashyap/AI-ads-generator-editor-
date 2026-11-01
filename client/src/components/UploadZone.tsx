import { CameraIcon, FolderOpenIcon, RefreshCwIcon, SparklesIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UploadZoneProps } from "../types";

const UploadZone = ({ label, file, onClear, onChange, previewUrl: suppliedPreviewUrl, previewLabel, onChooseLibrary }: UploadZoneProps) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [objectPreviewUrl, setObjectPreviewUrl] = useState<string>();
  const previewUrl = suppliedPreviewUrl || objectPreviewUrl;
  const hasPreview = Boolean(file || suppliedPreviewUrl);
  const [isDragging, setIsDragging] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);

  useEffect(() => {
    if (!file) {
      setObjectPreviewUrl(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setObjectPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => () => {
    cameraRequest.current += 1;
    cameraStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopCamera = () => {
    cameraRequest.current += 1;
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setIsCameraOpen(false);
    setCameraError(undefined);
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInput.current?.click();
      return;
    }

    setIsCameraOpen(true);
    setIsCameraStarting(true);
    setCameraError(undefined);
    const request = ++cameraRequest.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (request !== cameraRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream.current = stream;

      if (cameraVideo.current) {
        cameraVideo.current.srcObject = stream;
        await cameraVideo.current.play();
      }
    } catch (error) {
      if (request !== cameraRequest.current) return;
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setCameraError(denied
        ? "Camera permission was denied. Allow camera access or choose a file instead."
        : "The camera could not be opened. Try another device or choose a file.");
    } finally {
      setIsCameraStarting(false);
    }
  };

  const submitCameraPhoto = () => {
    const video = cameraVideo.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const input = fileInput.current;
      if (!input) return;

      const photo = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const transfer = new DataTransfer();
      transfer.items.add(photo);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      stopCamera();
    }, "image/jpeg", 0.92);
  };

  useEffect(() => {
    if (!isCameraOpen || !cameraStream.current || !cameraVideo.current) return;

    cameraVideo.current.srcObject = cameraStream.current;
    void cameraVideo.current.play().catch(() => undefined);
  }, [isCameraOpen]);

  useEffect(() => {
    if (!isCameraOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopCamera();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [isCameraOpen]);

  return (
    <div className="group w-full">
      <div
        className={`relative flex h-64 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-white/[0.035] p-5 shadow-[inset_0_1px_rgba(255,255,255,.025)] backdrop-blur-xl transition-all duration-200 ${isDragging ? "border-violet-300/70 bg-violet-500/15" : file ? "border-violet-300/35 bg-violet-500/[0.07]" : "border-violet-200/[0.18] hover:border-violet-300/40 hover:bg-white/[0.065]"}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const image = event.dataTransfer.files[0];
          if (!image?.type.startsWith("image/")) return;
          const input = fileInput.current;
          if (!input) return;
          const transfer = new DataTransfer();
          transfer.items.add(image);
          input.files = transfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      >
        {hasPreview && previewUrl ? (
          <>
            <img src={previewUrl} alt={`${label} preview`} className="absolute inset-0 h-full w-full object-contain bg-black/20" />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/35 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-xs font-medium text-white hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <RefreshCwIcon className="size-4" /> Replace
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label={`Remove ${label}`}
                className="rounded-lg bg-black/70 p-2.5 text-white hover:bg-red-500/30 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            {onChooseLibrary && (
              <button
                type="button"
                onClick={onChooseLibrary}
                className="absolute bottom-3 left-3 rounded-lg border border-violet-300/25 bg-violet-950/85 px-3 py-2 text-xs font-medium text-violet-100 backdrop-blur-md hover:bg-violet-800/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Change model
              </button>
            )}
            <p className="absolute bottom-3 left-3 right-3 truncate rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm font-medium backdrop-blur-md" title={previewLabel || file?.name}>{previewLabel || file?.name}</p>
          </>
        ) : (
          <>
            <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-violet-300 shadow-[0_8px_30px_rgba(139,92,246,.12),inset_0_1px_rgba(255,255,255,.08)] transition-transform duration-200 group-hover:scale-105">
              <UploadIcon className="size-7" />
            </div>
            <h3 className="mb-1 text-center text-base font-semibold md:text-lg">{label}</h3>
            <p className="mb-5 text-center text-xs text-gray-400">Drag & drop an image, or choose how to add it</p>

            <div className={`grid w-full gap-2 ${onChooseLibrary ? "max-w-[360px] grid-cols-3" : "max-w-[220px] grid-cols-2"}`}>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200/[0.16] bg-white/[0.055] px-2 text-xs font-medium text-slate-100 transition duration-200 hover:border-violet-300/40 hover:bg-violet-400/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <FolderOpenIcon className="size-4" />
                Choose file
              </button>
              <button
                type="button"
                onClick={() => void openCamera()}
                className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-300/20 bg-violet-500/85 px-2 text-xs font-medium text-white shadow-[0_8px_24px_rgba(139,92,246,.18)] backdrop-blur-lg transition duration-200 hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <CameraIcon className="size-4" />
                Camera
              </button>
              {onChooseLibrary && (
                <button
                  type="button"
                  onClick={onChooseLibrary}
                  className="flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-300/20 bg-violet-500/15 px-2 text-xs font-medium text-violet-100 backdrop-blur-lg transition duration-200 hover:border-violet-300/45 hover:bg-violet-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <SparklesIcon className="size-4" />
                  Library
                </button>
              )}
            </div>
          </>
        )}

        <input ref={fileInput} type="file" accept="image/*" onChange={onChange} hidden aria-label={`Choose ${label} file`} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={onChange} hidden aria-label={`Capture ${label} with camera`} />
      </div>

      {isCameraOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080713]/85 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label={`Capture ${label}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) stopCamera();
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-violet-200/20 bg-[#171039]/95 shadow-[0_24px_90px_rgba(5,3,20,.7)]">
            <div className="flex items-center justify-between border-b border-violet-200/10 px-5 py-4">
              <div>
                <p className="text-sm font-semibold">Capture {label}</p>
                <p className="mt-0.5 text-xs text-slate-400">Position the subject and take a photo</p>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                aria-label="Close camera"
                autoFocus
                className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <div className="relative min-h-64 bg-black">
              <video
                ref={cameraVideo}
                autoPlay
                muted
                playsInline
                className="aspect-[4/3] w-full object-contain"
              />
              {isCameraStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-slate-200">
                  Opening camera…
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-x-4 bottom-4 rounded-xl border border-amber-300/20 bg-black/80 px-4 py-3 text-sm text-amber-100 backdrop-blur-md">
                  {cameraError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  cameraInput.current?.click();
                }}
                className="min-h-11 rounded-xl border border-violet-200/15 bg-white/5 px-4 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Choose file
              </button>
              <button
                type="button"
                onClick={submitCameraPhoto}
                disabled={isCameraStarting || Boolean(cameraError)}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(139,92,246,.28)] hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                <CameraIcon className="size-4" />
                Take photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadZone;
