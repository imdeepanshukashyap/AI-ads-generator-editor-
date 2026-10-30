# UGC Project - Technical Documentation

> **Last Updated**: February 13, 2026  
> **Version**: 1.0  
> **Purpose**: Comprehensive technical documentation for new contributors

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Frontend Documentation](#3-frontend-documentation)
4. [Backend Documentation](#4-backend-documentation)
5. [Database Layer](#5-database-layer)
6. [AI & External Services Integration](#6-ai--external-services-integration)
7. [End-to-End Flow Walkthroughs](#7-end-to-end-flow-walkthroughs)
8. [Configuration & Environment Setup](#8-configuration--environment-setup)
9. [Current Project Status Snapshot](#9-current-project-status-snapshot)
10. [Contribution Guide for New Developers](#10-contribution-guide-for-new-developers)

---

## 1️⃣ Project Overview

### What the Product Does

UGC Project is a **SaaS platform for AI-powered User-Generated Content (UGC) creation**. It enables users to generate professional-looking product showcase images and videos by combining product photos with model images using Google's Gemini AI.

### Core Problem It Solves

- **Manual UGC Creation is Expensive**: Hiring models, photographers, and video editors for product showcases is costly
- **Time-Consuming**: Traditional UGC creation takes days or weeks
- **Scalability Issues**: Creating multiple variations for different products/platforms is labor-intensive

**Solution**: Automated AI-powered image and video generation in minutes, not days.

### Main Features

1. **AI Image Generation**: Upload product + model images → Get AI-generated UGC image
2. **AI Video Generation**: Convert generated images into dynamic videos
3. **Credit System**: Pay-per-use model (5 credits/image, 10 credits/video)
4. **Project Management**: Save, view, and manage all generations
5. **Aspect Ratio Control**: 9:16 (vertical) or 16:9 (horizontal)
6. **Download & Publish**: Download media or publish to community gallery

### User Journey

```
1. Sign Up (Clerk Auth) → Get 20 free credits
2. Navigate to /generate
3. Upload Product Image + Model Image
4. Fill project details (name, product name, description, aspect ratio)
5. Click "Generate Image" → Wait for AI generation (5-60s)
6. View Result → Download or Generate Video
7. Generate Video → Wait for video generation (5 minutes)
8. Download final assets
```

---

## 2️⃣ System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT (React)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Home   │  │ Generate │  │  Result  │  │My Gens   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                        ↓                                     │
│                  Axios API Client                            │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/JSON
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    SERVER (Express.js)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Middleware Stack                                     │  │
│  │  CORS → Clerk Auth → Request Logger → Routes         │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Controllers  │  │  Middleware  │  │    Routes    │     │
│  │ - project    │  │  - auth      │  │  - /project  │     │
│  │ - user       │  │  - logger    │  │  - /user     │     │
│  │ - clerk      │  └──────────────┘  └──────────────┘     │
│  └──────────────┘                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                   ↓
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  PostgreSQL   │  │  Google AI    │  │  Cloudinary   │
│  (Prisma)     │  │  (Gemini)     │  │  (Storage)    │
│               │  │               │  │               │
│  - Users      │  │  - Image Gen  │  │  - Images     │
│  - Projects   │  │  - Video Gen  │  │  - Videos     │
└───────────────┘  └───────────────┘  └───────────────┘
```

### Frontend ↔ Backend ↔ External Services Flow

```
User Action → React Component → Axios Request → Express Route
→ Auth Middleware → Controller → External API (AI/Cloudinary)
→ Database Update → Response → React State Update → UI Render
```

### AI Generation Pipeline Flow

**Image Generation:**
```
Upload Images → Multer (temp storage) → Cloudinary Upload
→ Base64 Encode → Google AI API (Gemini) → Response Validation
→ Cloudinary Upload → Database Update → Credit Deduction
→ Cleanup Temp Files → Return Project ID
```

**Video Generation:**
```
Fetch Project → Get Generated Image → Download from Cloudinary
→ Google AI Video API → Poll Operation (10s intervals, max 30 attempts)
→ Download Video → Upload to Cloudinary → Database Update
→ Cleanup → Return Video URL
```

### Media Processing Flow

```
Client Upload → FormData → Multer Middleware → Temp File (uploads/)
→ Cloudinary Upload → Secure URL → Database Storage
→ Temp File Cleanup
```

### Auth Flow

```
User Signs In (Clerk) → JWT Token → Clerk Middleware (server)
→ Extract userId → Attach to Request → Protect Middleware
→ Controller Access → Database Query (userId filter)
```

---

## 3️⃣ Frontend Documentation

### Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **React** | UI Library | 19.2.0 |
| **Vite** | Build Tool | 7.2.4 |
| **TypeScript** | Type Safety | 5.9.3 |
| **React Router** | Routing | 7.11.0 |
| **Tailwind CSS** | Styling | 4.1.17 |
| **Clerk** | Authentication | 5.59.2 |
| **Axios** | HTTP Client | 1.13.2 |
| **Framer Motion** | Animations | 12.23.26 |
| **React Hot Toast** | Notifications | 2.6.0 |
| **Lucide React** | Icons | 0.555.0 |
| **Lenis** | Smooth Scroll | 1.3.16 |

### Folder Structure

```
client/src/
├── assets/          # Static assets (images, dummy data)
│   ├── assets.tsx   # Asset imports
│   └── dummy-data.tsx
├── components/      # Reusable UI components (13 files)
│   ├── Buttons.tsx        # PrimaryButton, GhostButton
│   ├── Navbar.tsx         # Navigation with Clerk auth
│   ├── Hero.tsx           # Landing page hero
│   ├── Features.tsx       # Feature showcase
│   ├── Pricing.tsx        # Pricing cards
│   ├── FAQ.tsx            # FAQ accordion
│   ├── CTA.tsx            # Call-to-action section
│   ├── Footer.tsx         # Site footer
│   ├── Title.tsx          # Page title component
│   ├── UploadZone.tsx     # File upload component
│   ├── ProjectCard.tsx    # Project display card
│   ├── SoftBackdrop.tsx   # Background gradient
│   └── lenis.tsx          # Smooth scroll wrapper
├── configs/         # Configuration files
│   └── axios.ts     # Axios instance with baseURL
├── pages/           # Route pages (7 files)
│   ├── Home.tsx           # Landing page (/)
│   ├── Genetator.tsx      # Image generation (/generate)
│   ├── Result.tsx         # Result display (/result/:projectId)
│   ├── MyGenerations.tsx  # User projects (/my-generations)
│   ├── Community.tsx      # Public gallery (/community)
│   ├── Plans.tsx          # Pricing page (/plans)
│   └── Loading.tsx        # Loading state (/loading)
├── types/           # TypeScript types
│   └── index.ts     # Project, User, UploadZoneProps
├── App.tsx          # Main app component with routes
├── main.tsx         # React entry point
└── index.css        # Global styles
```

### Page/Route Flow

| Route | Component | Purpose | Auth Required |
|-------|-----------|---------|---------------|
| `/` | Home | Landing page with features/pricing | No |
| `/generate` | Genetator | Image generation form | Yes |
| `/result/:projectId` | Result | View generated image/video | Yes |
| `/my-generations` | MyGenerations | User's project list | Yes |
| `/community` | Community | Published projects gallery | No |
| `/plans` | Plans | Pricing/subscription page | No |
| `/loading` | Loading | Loading state page | No |

### Component Hierarchy

```
App
├── SoftBackdrop (background gradient)
├── LenisScroll (smooth scroll wrapper)
├── Navbar (auth, navigation)
├── Routes
│   ├── Home
│   │   ├── Hero
│   │   ├── Features
│   │   ├── Pricing
│   │   ├── FAQ
│   │   └── CTA
│   ├── Genetator
│   │   ├── Title
│   │   ├── UploadZone (×2)
│   │   └── PrimaryButton
│   ├── Result
│   │   ├── ProjectCard
│   │   ├── GhostButton (×2)
│   │   └── PrimaryButton
│   └── MyGenerations
│       └── ProjectCard (×N)
└── Footer
```

### State Management Approach

**No Global State Management** - Uses React's built-in state:

- **Local State**: `useState` for component-specific data
- **Auth State**: Clerk's `useUser()` and `useAuth()` hooks
- **Server State**: Direct API calls with Axios (no caching layer)
- **URL State**: React Router's `useParams()` for dynamic routes

**Example** (Genetator.tsx):
```typescript
const [name, setName] = useState('');
const [productImage, setProductImage] = useState<File | null>(null);
const [isGenerating, setIsGenerating] = useState(false);
const {user} = useUser(); // Clerk auth
const {getToken} = useAuth(); // JWT token
```

### API Integration Layer

**Axios Configuration** (`configs/axios.ts`):
```typescript
const api = axios.create({
    baseURL: import.meta.env.VITE_BASEURL || 'http://localhost:5000',
    timeout: 300000 // 5 minutes (for long AI operations)
})
```

**API Call Pattern**:
```typescript
const token = await getToken(); // Clerk JWT
const { data } = await api.post('/api/project/create', formData, {
   headers: { Authorization: `Bearer ${token}` }
});
```

**Endpoints Used**:
- `POST /api/project/create` - Create project + generate image
- `POST /api/project/video` - Generate video from image
- `GET /api/user/credits` - Get user credit balance
- `GET /api/user/projects` - Get user's projects
- `GET /api/user/projects/:projectId` - Get specific project
- `GET /api/project/published` - Get published projects
- `PATCH /api/user/project/:projectId/publish` - Toggle publish status
- `DELETE /api/project/:projectId` - Delete project

### Forms, Uploads, and Media Handling

**File Upload** (UploadZone.tsx):
```typescript
<input type="file" accept="image/*" onChange={onChange} />
```

**FormData Construction** (Genetator.tsx):
```typescript
const formData = new FormData();
formData.append('name', name);
formData.append('productName', productName);
formData.append('images', productImage);  // File 1
formData.append('images', modelImage);    // File 2
```

**Media Display**:
- Images: `<img src={project.generatedImage} />`
- Videos: `<video src={project.generatedVideo} controls autoPlay loop />`

**Download Links**:
```typescript
<a href={url.replace("/upload", "/upload/fl_attachment")} download>
```

### Error Handling and Loading States

**Error Handling**:
```typescript
try {
  const { data } = await api.post('/api/project/create', formData);
  toast.success(data.message);
} catch (error: any) {
  toast.error(error?.response?.data?.message || error.message);
}
```

**Loading States**:
- `isGenerating` - Button disabled, spinner shown
- `loading` - Full-page loader (Result.tsx)
- Polling - Auto-refresh every 10s while `isGenerating === true`

**Polling Implementation** (Result.tsx):
```typescript
useEffect(() => {
    if (user && isGenerating) {
        const interval = setInterval(() => {
            fetchProjectData();
        }, 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }
}, [user, isGenerating]);
```

### Current Implemented Features

✅ **Fully Implemented**:
- User authentication (Clerk)
- Image upload (2 images)
- AI image generation
- AI video generation
- Credit system display
- Project listing
- Download functionality
- Aspect ratio selection (9:16, 16:9)
- Published projects gallery
- Responsive design

### Pending / Placeholder Areas

⚠️ **Partially Implemented**:
- Plans page (UI only, no Clerk Billing integration)
- Community page (fetches published projects, basic UI)
- Error states (basic toast notifications, no retry logic)

❌ **Not Implemented**:
- Payment integration (Clerk Billing setup incomplete)
- Project editing (can only create new)
- Batch generation
- Advanced filters/search
- User profile page
- Analytics dashboard

---

# #   4 ��   B a c k e n d   D o c u m e n t a t i o n  
 