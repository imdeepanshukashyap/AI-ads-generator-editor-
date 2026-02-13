# UGC Project - Complete Technical Documentation

> **Comprehensive contributor-ready documentation for the UGC AI-powered content generation platform**

## 📖 Documentation Structure

This technical documentation is split into 4 parts for easier navigation:

### [Part 1: Overview & Frontend](./TECHNICAL_DOCUMENTATION.md)
- 1️⃣ Project Overview
- 2️⃣ System Architecture  
- 3️⃣ Frontend Documentation (React/Vite/Clerk)

### [Part 2: Backend Architecture](./TECHNICAL_DOCUMENTATION_PART2.md)
- 4️⃣ Backend Documentation (Express/Prisma/Winston)
  - Tech stack, folder structure, server startup
  - Middleware flow, auth integration
  - Route list, controller responsibilities
  - AI generation flow, credit system
  - Logging system, error handling
  - Timeout & quota safeguards

### [Part 3: Database & Integrations](./TECHNICAL_DOCUMENTATION_PART3.md)
- 5️⃣ Database Layer (Prisma/PostgreSQL)
- 6️⃣ AI & External Services Integration
  - Google Gemini (image generation)
  - Google Veo (video generation)
  - Cloudinary (media storage)
  - Clerk (authentication)
- 7️⃣ End-to-End Flow Walkthroughs
  - User creates project
  - Image generation (detailed)
  - Video generation
  - Credit deduction/refund
  - Error case handling
- 8️⃣ Configuration & Environment Setup

### [Part 4: Status & Contribution Guide](./TECHNICAL_DOCUMENTATION_PART4.md)
- 9️⃣ Current Project Status Snapshot
  - Fully implemented features
  - Partially implemented features
  - Known limitations
  - Stability levels
- 🔟 Contribution Guide for New Developers
  - Where to start reading code
  - Safe vs. sensitive modules
  - Testing flow
  - Logging & debugging tips

---

## 🚀 Quick Start for New Contributors

### 1. Read Documentation (30 minutes)
```
1. Start with Part 1 (overview, architecture)
2. Read Part 2 (backend) if working on server
3. Read Part 3 (integrations) for AI/database work
4. Read Part 4 (contribution guide) before coding
```

### 2. Setup Local Environment (15 minutes)
```bash
# Clone and install
git clone <repo-url>
cd ugc-project
cd client && npm install
cd ../server && npm install

# Setup .env files (see Part 3, Section 8)
# Get API keys: Clerk, Google AI, Cloudinary, PostgreSQL

# Setup database
cd server
npx prisma generate
npx prisma db push

# Start development
# Terminal 1
cd client && npm run dev

# Terminal 2
cd server && npm run server
```

### 3. Test Basic Flow (10 minutes)
```
1. Open http://localhost:5173
2. Sign up with Clerk
3. Navigate to /generate
4. Upload 2 images
5. Generate image
6. View result
7. Generate video
8. Download assets
```

### 4. Explore Codebase (30 minutes)
```
Key files to read:
- client/src/App.tsx (routing)
- client/src/pages/Genetator.tsx (main flow)
- server/server.ts (Express setup)
- server/controllers/projectController.ts (AI logic)
- server/prisma/schema.prisma (database)
```

---

## 📊 Project Overview

**What it does**: AI-powered UGC (User-Generated Content) creation platform that generates professional product showcase images and videos using Google's Gemini AI.

**Tech Stack**:
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, Clerk Auth
- **Backend**: Node.js, Express, TypeScript, Prisma, PostgreSQL, Winston
- **AI**: Google Gemini 2.5 Flash (images), Google Veo 3.1 (videos)
- **Storage**: Cloudinary
- **Monitoring**: Sentry, Winston logs

**User Flow**:
```
Sign Up (20 credits) → Upload Images → Generate Image (5 credits)
→ Generate Video (10 credits) → Download/Publish
```

---

## 🏗️ Architecture Diagram

```
┌─────────────┐
│   React     │  Client (Vite, Clerk, Axios)
│   Frontend  │
└──────┬──────┘
       │ HTTP/JSON
       ↓
┌─────────────────────────────────────┐
│   Express Server                    │
│   ┌──────────────────────────────┐ │
│   │ CORS → Clerk → Logger        │ │
│   └──────────────────────────────┘ │
│   ┌──────────┐  ┌──────────────┐  │
│   │Controllers│  │  Middleware  │  │
│   │- project  │  │  - auth      │  │
│   │- user     │  │  - logger    │  │
│   │- clerk    │  └──────────────┘  │
│   └──────────┘                      │
└────┬────────┬────────┬──────────────┘
     │        │        │
     ↓        ↓        ↓
┌─────────┐ ┌─────────┐ ┌──────────┐
│PostgreSQL│ │Google AI│ │Cloudinary│
│ (Prisma)│ │(Gemini) │ │ (Media)  │
└─────────┘ └─────────┘ └──────────┘
```

---

## 📁 Repository Structure

```
ugc-project/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # UI components (13 files)
│   │   ├── pages/         # Route pages (7 files)
│   │   ├── configs/       # Axios config
│   │   ├── types/         # TypeScript types
│   │   └── App.tsx        # Main app
│   └── package.json
│
├── server/                 # Express backend
│   ├── configs/           # Service configs (5 files)
│   ├── controllers/       # Request handlers (3 files)
│   ├── middlewares/       # Express middleware (2 files)
│   ├── routes/            # API routes (2 files)
│   ├── prisma/            # Database schema
│   ├── logs/              # Winston logs (gitignored)
│   └── server.ts          # Main server
│
└── TECHNICAL_DOCUMENTATION*.md  # This documentation
```

---

## 🔑 Key Features

✅ **Implemented**:
- AI image generation (Gemini 2.5 Flash)
- AI video generation (Veo 3.1)
- Credit system (20 free credits)
- User authentication (Clerk)
- Project management (CRUD)
- Media storage (Cloudinary)
- Comprehensive logging (Winston)
- Error tracking (Sentry)

⚠️ **Partially Implemented**:
- Payment integration (webhook only, no UI)
- Community features (basic gallery)

❌ **Not Implemented**:
- Project editing
- Batch generation
- Advanced analytics
- Email notifications

---

## 🛠️ Development Commands

```bash
# Client
cd client
npm run dev      # Start dev server (Vite)
npm run build    # Build for production
npm run preview  # Preview production build

# Server
cd server
npm run server   # Start dev server (nodemon)
npm run start    # Start production server
npm run build    # Compile TypeScript

# Database
cd server
npx prisma studio        # Open database GUI
npx prisma generate      # Generate Prisma client
npx prisma db push       # Push schema changes
npx prisma migrate dev   # Create migration
```

---

## 📝 API Endpoints

**Project Routes** (`/api/project`):
- `POST /create` - Upload images + generate AI image
- `POST /video` - Generate video from image
- `GET /published` - Get published projects
- `DELETE /:projectId` - Delete project

**User Routes** (`/api/user`):
- `GET /credits` - Get credit balance
- `GET /projects` - Get user's projects
- `GET /projects/:projectId` - Get specific project
- `PATCH /project/:projectId/publish` - Toggle publish

---

## 🐛 Debugging

**View Logs**:
```bash
tail -f server/logs/combined.log  # All logs
tail -f server/logs/error.log     # Errors only
```

**Database GUI**:
```bash
cd server && npx prisma studio
```

**Common Issues**:
- "Unauthorized" → Check Clerk auth token
- "Insufficient credits" → Add credits via webhook
- "Model quota reached" → Google AI quota limit
- "Generation in progress" → Wait for current to finish

---

## 📚 Documentation Index

| Section | File | Topics |
|---------|------|--------|
| **Overview & Frontend** | [Part 1](./TECHNICAL_DOCUMENTATION.md) | Project overview, architecture, React/Vite frontend |
| **Backend** | [Part 2](./TECHNICAL_DOCUMENTATION_PART2.md) | Express server, controllers, logging, error handling |
| **Database & Integrations** | [Part 3](./TECHNICAL_DOCUMENTATION_PART3.md) | Prisma schema, AI services, end-to-end flows, setup |
| **Status & Contribution** | [Part 4](./TECHNICAL_DOCUMENTATION_PART4.md) | Project status, contribution guide, testing, debugging |

---

## 🎯 For New Contributors

**Before coding**:
1. ✅ Read all 4 documentation parts
2. ✅ Setup local environment
3. ✅ Test basic user flow
4. ✅ Review key files (App.tsx, server.ts, projectController.ts)
5. ✅ Check logs to understand request flow

**Safe to modify**:
- UI components, styles
- Page layouts
- Log messages
- Error messages

**Modify with caution**:
- AI generation logic
- Credit system
- Authentication
- Webhook handling

**For questions**:
- Review code comments (all functions documented)
- Check logs for request flow
- Read relevant documentation section

---

**Last Updated**: February 13, 2026  
**Version**: 1.0  
**Maintained by**: Development Team

For detailed information, navigate to the specific documentation part above.
