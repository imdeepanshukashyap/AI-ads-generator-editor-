import React, { useState } from "react";
import UploadZone from "../components/UploadZone";
import ModelLibraryBrowser, { type LibraryModel } from "../components/ModelLibraryBrowser";
import { Loader2Icon, RectangleHorizontalIcon, RectangleVerticalIcon, Wand2Icon } from "lucide-react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../configs/axios";

const inputClassName = "w-full rounded-xl border border-violet-200/[0.14] bg-white/[0.055] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[#78748E] hover:border-violet-200/[0.24] focus:border-violet-300/60 focus:ring-4 focus:ring-violet-500/10";
const labelClassName = "mb-2.5 block text-sm font-medium text-gray-200";

const Genetator = () => {
  const { user } = useUser();
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [productImage, setProductImage] = useState<File | null>(null);
  const [modelImage, setModelImage] = useState<File | null>(null);
  const [libraryModel, setLibraryModel] = useState<LibraryModel | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [language, setLanguage] = useState("English");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationType, setGenerationType] = useState<"single" | "bundle">("single");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: "product" | "model") => {
    const image = event.target.files?.[0];
    if (!image) return;
    if (type === "product") setProductImage(image);
    else {
      setLibraryModel(null);
      setModelImage(image);
    }
  };

  const handleGenerate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return toast("Please login to generate");
    if (!productImage || (!modelImage && !libraryModel) || !name || !productName || !aspectRatio) {
      return toast("Please fill all the required fields");
    }

    try {
      setIsGenerating(true);
      const formData = new FormData();
      formData.append("name", name);
      formData.append("productName", productName);
      formData.append("productDescription", productDescription);
      formData.append("userPrompt", userPrompt);
      formData.append("aspectRatio", aspectRatio);
      formData.append("language", language);
      formData.append("images", productImage);
      if (modelImage) formData.append("images", modelImage);
      if (libraryModel) formData.append("modelLibraryId", libraryModel.id);

      const token = await getToken();
      const endpoint = generationType === "bundle" ? "/api/project/create-bundle" : "/api/project/create";
      const { data } = await api.post(endpoint, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (generationType === "bundle" && data.imagesGenerated) {
        toast.success(`Generated ${data.imagesGenerated} images successfully!`);
      } else {
        toast.success(data.message || "Image generated successfully!");
      }
      navigate(`/result/${data.projectId}`);
    } catch (error: any) {
      setIsGenerating(false);
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  const creditCost = generationType === "bundle" ? 15 : 5;
  const actionLabel = generationType === "bundle" ? "Generate 3 Images" : "Generate Image";

  return (
    <main className="min-h-screen overflow-x-hidden px-4 pb-16 pt-28 text-white sm:px-6 lg:px-8 lg:pb-24">
      <form onSubmit={handleGenerate} className="mx-auto max-w-6xl">
        <header className="mb-7 border-b border-white/[0.07] pb-6">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.22em] text-violet-400">AI CREATIVE STUDIO</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create your next campaign</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400 sm:text-base">
            Turn your product and model images into campaign-ready creative assets.
          </p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)] lg:gap-7">
          <aside className="rounded-3xl border border-violet-200/[0.16] bg-gradient-to-br from-[#171039]/75 to-[#0d0b1b]/70 p-4 shadow-[0_24px_70px_rgba(5,3,20,.38),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-2xl sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Source assets</p>
                <p className="mt-1 text-xs text-[#9692AD]">Upload one product and model image.</p>
              </div>
              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[10px] font-medium text-violet-300">2 required</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <UploadZone label="Product Image" file={productImage} onClear={() => setProductImage(null)} onChange={(event) => handleFileChange(event, "product")} />
              <UploadZone
                label="Model Image"
                file={modelImage}
                previewUrl={libraryModel?.imageUrl}
                previewLabel={libraryModel ? `${libraryModel.name} · ${libraryModel.category}` : undefined}
                onClear={() => { setModelImage(null); setLibraryModel(null); }}
                onChange={(event) => handleFileChange(event, "model")}
                onChooseLibrary={() => setLibraryOpen(true)}
              />
            </div>
          </aside>

          <div className="space-y-5">
            <section className="rounded-3xl border border-violet-200/[0.16] bg-gradient-to-br from-white/[0.055] to-violet-500/[0.025] p-5 shadow-[0_24px_70px_rgba(5,3,20,.28),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-2xl sm:p-6">
              <div className="mb-5">
                <h2 className="text-sm font-semibold">Project details</h2>
                <p className="mt-1 text-xs text-[#9692AD]">Give this creative direction a clear identity.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={labelClassName}>Project Name</label>
                  <input type="text" id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name your project" required className={inputClassName} />
                </div>
                <div>
                  <label htmlFor="productName" className={labelClassName}>Product Name</label>
                  <input type="text" id="productName" value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Enter the product name" required className={inputClassName} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="productDescription" className={labelClassName}>Product Description <span className="font-normal text-violet-300">(optional)</span></label>
                  <textarea id="productDescription" rows={3} value={productDescription} onChange={(event) => setProductDescription(event.target.value)} placeholder="Describe the product and its key details" className={`${inputClassName} resize-none`} />
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-violet-200/[0.16] bg-gradient-to-br from-white/[0.055] to-violet-500/[0.025] p-5 shadow-[0_24px_70px_rgba(5,3,20,.28),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-2xl sm:p-6">
              <div className="mb-5">
                <h2 className="text-sm font-semibold">Creative direction</h2>
                <p className="mt-1 text-xs text-[#9692AD]">Set the format and tone of the result.</p>
              </div>

              <fieldset className="mb-5">
                <legend className={labelClassName}>Aspect Ratio</legend>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" aria-pressed={aspectRatio === "9:16"} onClick={() => setAspectRatio("9:16")} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${aspectRatio === "9:16" ? "border-violet-300/60 bg-violet-400/[0.16] text-white shadow-[0_8px_28px_rgba(139,92,246,.12),inset_0_1px_rgba(255,255,255,.06)]" : "border-violet-200/[0.13] bg-white/[0.035] text-[#C4B5FD] hover:border-violet-200/[0.26] hover:bg-white/[0.055]"}`}>
                    <RectangleVerticalIcon className="size-6" /><span><span className="block text-sm font-medium">Portrait</span><span className="text-xs text-gray-500">9:16</span></span>
                  </button>
                  <button type="button" aria-pressed={aspectRatio === "16:9"} onClick={() => setAspectRatio("16:9")} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${aspectRatio === "16:9" ? "border-violet-300/60 bg-violet-400/[0.16] text-white shadow-[0_8px_28px_rgba(139,92,246,.12),inset_0_1px_rgba(255,255,255,.06)]" : "border-violet-200/[0.13] bg-white/[0.035] text-[#C4B5FD] hover:border-violet-200/[0.26] hover:bg-white/[0.055]"}`}>
                    <RectangleHorizontalIcon className="size-6" /><span><span className="block text-sm font-medium">Landscape</span><span className="text-xs text-gray-500">16:9</span></span>
                  </button>
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-[1.35fr_.65fr]">
                <div>
                  <label htmlFor="userPrompt" className={labelClassName}>User Prompt <span className="font-normal text-violet-300">(optional)</span></label>
                  <textarea id="userPrompt" rows={3} value={userPrompt} onChange={(event) => setUserPrompt(event.target.value)} placeholder="Describe the scene, mood, or narration" className={`${inputClassName} resize-none`} />
                </div>
                <div>
                  <label htmlFor="language" className={labelClassName}>Narration Language</label>
                  <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)} className={`${inputClassName} cursor-pointer`}>
                    <option value="English" className="bg-gray-900">English</option>
                    <option value="Hindi" className="bg-gray-900">Hindi (हिंदी)</option>
                    <option value="Hinglish" className="bg-gray-900">Hinglish</option>
                    <option value="Spanish" className="bg-gray-900">Spanish</option>
                    <option value="French" className="bg-gray-900">French</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-violet-200/[0.16] bg-gradient-to-br from-white/[0.055] to-violet-500/[0.025] p-5 shadow-[0_24px_70px_rgba(5,3,20,.28),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-2xl sm:p-6">
              <div className="mb-4">
                <h2 className="text-sm font-semibold">Generation settings</h2>
                <p className="mt-1 text-xs text-[#9692AD]">Choose the deliverable for this campaign.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Generation type">
                <button type="button" role="radio" aria-checked={generationType === "single"} onClick={() => setGenerationType("single")} className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${generationType === "single" ? "border-violet-300/60 bg-violet-400/[0.16] shadow-[0_8px_28px_rgba(139,92,246,.11),inset_0_1px_rgba(255,255,255,.05)]" : "border-violet-200/[0.13] bg-white/[0.035] hover:border-violet-200/[0.28] hover:bg-white/[0.055]"}`}>
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Single Image</span><span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-300">5 credits</span></div>
                  <p className="mt-2 text-xs text-gray-500">One high-quality campaign image</p>
                </button>
                <button type="button" role="radio" aria-checked={generationType === "bundle"} onClick={() => setGenerationType("bundle")} className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${generationType === "bundle" ? "border-violet-300/60 bg-violet-400/[0.16] shadow-[0_8px_28px_rgba(139,92,246,.11),inset_0_1px_rgba(255,255,255,.05)]" : "border-violet-200/[0.13] bg-white/[0.035] hover:border-violet-200/[0.28] hover:bg-white/[0.055]"}`}>
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">3-Image Bundle</span><span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-300">15 credits</span></div>
                  <p className="mt-2 text-xs text-gray-500">Hero, detail and action shots</p>
                </button>
              </div>

              <button type="submit" disabled={isGenerating} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600/95 via-[#7c5ce6]/95 to-violet-400/90 px-5 text-sm font-semibold text-white shadow-[0_14px_38px_rgba(124,58,237,.28),0_0_34px_rgba(139,92,246,.12),inset_0_1px_rgba(255,255,255,.16)] transition hover:brightness-110 hover:shadow-[0_16px_44px_rgba(124,58,237,.38),0_0_38px_rgba(139,92,246,.18)] active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d12]">
                {isGenerating ? <><Loader2Icon className="size-5 animate-spin" />Generating...</> : <><Wand2Icon className="size-5" />{actionLabel} · {creditCost} credits</>}
              </button>
            </section>
          </div>
        </div>
      </form>
      <ModelLibraryBrowser
        open={libraryOpen}
        selectedId={libraryModel?.id}
        onClose={() => setLibraryOpen(false)}
        onSelect={(model) => {
          setModelImage(null);
          setLibraryModel(model);
          setLibraryOpen(false);
        }}
      />
    </main>
  );
};

export default Genetator;
