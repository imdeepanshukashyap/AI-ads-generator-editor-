import React, { useState } from "react"
import Title from "../components/Title"
import UploadZone from "../components/UploadZone"
import { Loader2Icon, RectangleHorizontalIcon, RectangleVerticalIcon, Wand2Icon } from "lucide-react"
import { PrimaryButton } from "../components/Buttons"
import { useAuth, useUser } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import api from "../configs/axios"


const Genetator = () => {

  const { user } = useUser()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [productImage, setProductImage] = useState<File | null>(null)
  const [modelImage, setModelImage] = useState<File | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [language, setLanguage] = useState('English')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationType, setGenerationType] = useState<'single' | 'bundle'>('single') // New state for generation type


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'product' | 'model') => {
    if (e.target.files && e.target.files[0]) {
      if (type === 'product') setProductImage(e.target.files[0]);
      else setModelImage(e.target.files[0])
    }
  }

  const handleGenerate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return toast('Please login to generate')

    if (!productImage || !modelImage || !name || !productName || !aspectRatio) return toast('Please fill all the required fields')

    try {
      setIsGenerating(true);
      const formData = new FormData();

      formData.append('name', name)
      formData.append('productName', productName)
      formData.append('productDescription', productDescription)
      formData.append('userPrompt', userPrompt)
      formData.append('aspectRatio', aspectRatio)
      formData.append('language', language)
      formData.append('images', productImage)
      formData.append('images', modelImage)

      const token = await getToken()

      // Choose endpoint based on generation type
      const endpoint = generationType === 'bundle' ? '/api/project/create-bundle' : '/api/project/create';

      const { data } = await api.post(endpoint, formData, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (generationType === 'bundle' && data.imagesGenerated) {
        toast.success(`Generated ${data.imagesGenerated} images successfully!`)
      } else {
        toast.success(data.message || 'Image generated successfully!')
      }
      navigate('/result/' + data.projectId)

    } catch (error: any) {
      setIsGenerating(false);
      toast.error(error?.response?.data?.message || error.message)
    }
  }

  return (
    <div className="min-h-screen text-white p-6 md:p-12 mt-28">

      <form onSubmit={handleGenerate} className="max-w-4xl mx-auto mb-40">

        <Title heading='Create In-Context Image' description="Upload your model and product images to generate stunning UGC, short-form videos and social media posts" />

        <div className="flex gap-20 max-sm:flex-col items-start justify-between">
          {/* left col  */}
          <div className="flex flex-col w-full sm:max-w-60 gap-8 mt-8 mb-12">

            <UploadZone label="Product Image" file={productImage} onClear={() => setProductImage(null)} onChange={(e) => handleFileChange(e, 'product')} />
            <UploadZone label="Model Image" file={modelImage} onClear={() => setModelImage(null)} onChange={(e) => handleFileChange(e, 'model')} />
          </div>

          {/* right col  */}
          <div className="w-full">
            <div className="mb-4 text-gray-300">
              <label htmlFor="name" className="block text-sm mb-4">Project Name</label>
              <input type="text" id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your project" required className="w-full bg-white/3 rounded-lg border-2 p-4 text-sm border-violet-200/10 focus:border-violet-500/50 outline-none transition-all" />
            </div>
            <div className="mb-4 text-gray-300">
              <label htmlFor="productName" className="block text-sm mb-4">Product Name</label>
              <input type="text" id="productName" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Enter the name of the product" required className="w-full bg-white/3 rounded-lg border-2 p-4 text-sm border-violet-200/10 focus:border-violet-500/50 outline-none transition-all" />
            </div>
            <div className="mb-4 text-gray-300">
              <label htmlFor="productDescription" className="block text-sm mb-4">Product Description <span className="text-xs text-violet-400">(optional)</span></label>

              <textarea id="productDescription" rows={4} value={productDescription} onChange={(e) => setProductDescription(e.target.value)} placeholder="Enter the description of the product"
                className="w-full bg-white/3 rounded-lg border-2 p-4 text-sm border-violet-200/10 focus:border-violet-500/50 outline-none resize-none transition-all" />
            </div>

            <div className="mb-4 text-gray-300">
              <label className="block text-sm mb-4">Aspect Ratio</label>
              <div className="flex gap-3">
                <RectangleVerticalIcon onClick={() => setAspectRatio('9:16')} className={`p-2.5 size-13 bg-white/6 rounded transition-all ring-2 ring-transparent cursor-pointer ${aspectRatio === '9:16' ? 'ring-violet-500/50 bg-white/10' : ''}`} />
                <RectangleHorizontalIcon onClick={() => setAspectRatio('16:9')} className={`p-2.5 size-13 bg-white/6 rounded transition-all ring-2 ring-transparent cursor-pointer ${aspectRatio === '16:9' ? 'ring-violet-500/50 bg-white/10' : ''}`} />
              </div>
            </div>

            <div className="mb-4 text-gray-300">
              <label htmlFor="userPrompt" className="block text-sm mb-4">User Prompt <span className="text-xs text-violet-400">(optional)</span></label>

              <textarea id="userPrompt" rows={4} value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} placeholder="Describe how you want the narration to be."
                className="w-full bg-white/3 rounded-lg border-2 p-4 text-sm border-violet-200/10 focus:border-violet-500/50 outline-none resize-none transition-all" />
            </div>

            {/* Language Selection */}
            <div className="mb-4 text-gray-300">
              <label htmlFor="language" className="block text-sm mb-4">Narration Language <span className="text-xs text-violet-400">(for video generation)</span></label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-white/3 rounded-lg border-2 p-4 text-sm border-violet-200/10 focus:border-violet-500/50 outline-none transition-all cursor-pointer"
              >
                <option value="English" className="bg-gray-900">English</option>
                <option value="Hindi" className="bg-gray-900">Hindi (हिंदी)</option>
                <option value="Hinglish" className="bg-gray-900">Hinglish (Hindi + English)</option>
                <option value="Spanish" className="bg-gray-900">Spanish (Español)</option>
                <option value="French" className="bg-gray-900">French (Français)</option>
              </select>
            </div>

            {/* Generation Type Selector */}
            <div className="mb-4 text-gray-300">
              <label className="block text-sm mb-4">Generation Type</label>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setGenerationType('single')}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${generationType === 'single'
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-violet-200/10 bg-white/3 hover:border-violet-500/30'
                    }`}
                >
                  <div className="text-sm font-medium">Single Image</div>
                  <div className="text-xs text-violet-400 mt-1">5 credits</div>
                  <div className="text-xs text-gray-400 mt-1">One high-quality image</div>
                </button>
                <button
                  type="button"
                  onClick={() => setGenerationType('bundle')}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${generationType === 'bundle'
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-violet-200/10 bg-white/3 hover:border-violet-500/30'
                    }`}
                >
                  <div className="text-sm font-medium">3-Image Bundle</div>
                  <div className="text-xs text-violet-400 mt-1">15 credits</div>
                  <div className="text-xs text-gray-400 mt-1">Hero, Detail & Action shots</div>
                </button>
              </div>
            </div>

          </div>
        </div>
        <div className="flex justify-center mt-10">
          <PrimaryButton disabled={isGenerating} className="px-10 py-3 rounded-md disabled:opacity-70 disabled:cursor-not-allowed">
            {isGenerating ? (
              <>
                <Loader2Icon className="size-5 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Wand2Icon className="size-5" /> Generate {generationType === 'bundle' ? '3 Images' : 'Image'} ({generationType === 'bundle' ? '15' : '5'} credits)
              </>
            )}
          </PrimaryButton>
        </div>
      </form>
    </div>
  )
}

export default Genetator
