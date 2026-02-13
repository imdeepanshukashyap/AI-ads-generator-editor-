# UGC Project - Technical Documentation (Part 2)

## 4️⃣ Backend Documentation

### Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | Runtime | Latest |
| **Express.js** | Web Framework | Latest |
| **TypeScript** | Type Safety | 5.9.3 |
| **Prisma** | ORM | 7.2.0 |
| **PostgreSQL** | Database | Latest |
| **Winston** | Logging | Latest |
| **Clerk Express** | Auth Middleware | 1.7.61 |
| **Google AI SDK** | AI Generation | 1.35.0 |
| **Cloudinary** | Media Storage | Latest |
| **Multer** | File Upload | Latest |
| **Sentry** | Error Tracking | Latest |
| **Axios** | HTTP Client | Latest |

### Folder Structure

```
server/
├── configs/              # Configuration modules
│   ├── cloudinary.ts     # Cloudinary setup
│   ├── googleAI.ts       # Google AI client
│   ├── instrument.mjs    # Sentry instrumentation
│   ├── logger.ts         # Winston logger setup
│   ├── multer.ts         # File upload config
│   └── prisma.ts         # Prisma client
├── controllers/          # Request handlers
│   ├── clerk.ts          # Clerk webhook handler
│   ├── projectController.ts  # Project CRUD + AI generation
│   └── userController.ts     # User operations
├── middlewares/          # Express middleware
│   ├── auth.ts           # Authentication guard
│   └── requestLogger.ts  # Request lifecycle logging
├── routes/               # Route definitions
│   ├── projectRoutes.ts  # /api/project routes
│   └── userRoutes.ts     # /api/user routes
├── prisma/               # Database schema
│   ├── schema.prisma     # Prisma schema
│   └── migrations/       # DB migrations
├── types/                # TypeScript types
│   └── express.d.ts      # Express type extensions
├── logs/                 # Winston log files (gitignored)
│   ├── combined.log
│   └── error.log
├── uploads/              # Temp file uploads (gitignored)
├── videos/               # Temp video files (gitignored)
├── server.ts             # Main server file
└── package.json
```

### Server Startup Flow

```
1. Load environment variables (.env)
2. Initialize Sentry instrumentation
3. Create Express app
4. Register CORS middleware
5. Register Clerk webhook endpoint (raw body parser)
6. Register JSON parser + Clerk middleware
7. Register request logger middleware
8. Register route handlers (/api/user, /api/project)
9. Register Sentry error handler
10. Configure server timeout (5 minutes)
11. Start HTTP server on PORT
12. Setup graceful shutdown handlers (SIGTERM, SIGINT)
13. Log server startup complete
```

**Code** (server.ts):
```typescript
const app = express();
app.use(cors());
app.post('/api/clerk', express.raw({type: 'application/json'}), clerkWebhooks);
app.use(express.json());
app.use(clerkMiddleware());
app.use(requestLogger);
app.use('/api/user', userRouter);
app.use('/api/project', projectRouter);
Sentry.setupExpressErrorHandler(app);
const server = app.listen(PORT);
server.timeout = 300000; // 5 minutes
```

### Middleware Flow

**Request Pipeline**:
```
Incoming Request
  ↓
1. CORS Middleware (allow all origins)
  ↓
2. Clerk Webhook Check (if /api/clerk → raw body parser)
  ↓
3. JSON Body Parser
  ↓
4. Clerk Middleware (attach auth to req)
  ↓
5. Request Logger (generate requestId, log entry)
  ↓
6. Route Handler
  ↓
7. Protect Middleware (if protected route)
  ↓
8. Controller Logic
  ↓
9. Response Logger (log completion, duration)
  ↓
10. Sentry Error Handler (if error)
  ↓
Response Sent
```

### Auth Integration Flow

**Clerk Authentication**:
```typescript
// 1. Clerk middleware attaches auth to request
app.use(clerkMiddleware());

// 2. Protect middleware checks userId
export const protect = async (req, res, next) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    next();
}

// 3. Controller accesses userId
const { userId } = getAuth(req);
```

**Webhook Flow** (clerk.ts):
```
Clerk Event → Webhook POST /api/clerk → Verify Signature
→ Parse Event Type → Handle Event → Update Database
```

Events handled:
- `user.created` → Create user with 20 credits
- `user.updated` → Update user profile
- `user.deleted` → Delete user
- `paymentAttempt.updated` → Add credits (80 for pro, 240 for premium)

### Route List with Purpose

**Project Routes** (`/api/project`):
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/create` | ✅ | Upload images + generate AI image |
| POST | `/video` | ✅ | Generate video from image |
| GET | `/published` | ❌ | Get all published projects |
| DELETE | `/:projectId` | ✅ | Delete project |

**User Routes** (`/api/user`):
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/credits` | ✅ | Get user credit balance |
| GET | `/projects` | ✅ | Get all user projects |
| GET | `/projects/:projectId` | ✅ | Get specific project |
| PATCH | `/project/:projectId/publish` | ✅ | Toggle publish status |

### Controller Responsibilities

**projectController.ts**:
- `createProject`: Handle image upload, AI generation, credit deduction
- `createVideo`: Handle video generation from image
- `getAllPublishedProjects`: Fetch public gallery
- `deleteProject`: Delete project and associated data

**userController.ts**:
- `getUserCredits`: Return user credit balance
- `getAllProjects`: Return user's projects
- `getProjectById`: Return specific project
- `toggleProjectPublic`: Publish/unpublish project

**clerk.ts**:
- `clerkWebhooks`: Handle Clerk webhook events

### AI Generation Flow (Image + Video)

**Image Generation** (createProject):
```
1. Validate request (2 images, product name required)
2. Get/create user (handle race condition)
3. Check credits (≥5 required)
4. Check spam (max 1 concurrent generation)
5. Upload images to Cloudinary (parallel)
6. Create project record (isGenerating: true)
7. Convert images to base64
8. Call Google AI API (Gemini 2.5 Flash Image)
   - Model: gemini-2.5-flash-image
   - Config: temperature 0.7, topP 0.9, topK 40
   - Timeout: 60 seconds
9. Handle quota errors (throw "Model quota reached")
10. Validate response (check for image data)
11. Upload generated image to Cloudinary
12. Deduct 5 credits
13. Update project (generatedImage, isGenerating: false)
14. Cleanup temp files
15. Return projectId
```

**Video Generation** (createVideo):
```
1. Validate request (projectId required)
2. Get/create user
3. Check credits (≥10 required)
4. Deduct 10 credits upfront
5. Fetch project (verify ownership)
6. Check generation state (not already generating)
7. Check if video exists (not already generated)
8. Mark project as generating
9. Fetch generated image from Cloudinary
10. Convert to base64
11. Call Google AI Video API (Veo 3.1)
    - Model: veo-3.1-generate-preview
    - Config: aspectRatio, numberOfVideos: 1, resolution: 720p
12. Poll operation status (10s intervals, max 30 attempts = 5 min)
13. Check for safety filters
14. Download video from Google AI
15. Upload to Cloudinary
16. Update project (generatedVideo, isGenerating: false)
17. Cleanup temp files
18. Return video URL
```

### Credit System Logic

**Initial Credits**: 20 (on user creation)

**Cost Structure**:
- Image generation: 5 credits
- Video generation: 10 credits

**Deduction Timing**:
- **Image**: Deducted AFTER successful generation
- **Video**: Deducted UPFRONT (before generation)

**Refund Logic**:
```typescript
// If error occurs and credits were deducted
if (isCreditDeducted) {
    await prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: COST } }
    });
}
```

**Credit Addition** (via webhooks):
- Pro plan: +80 credits
- Premium plan: +240 credits

### Database Models and Relations

**User Model**:
```prisma
model User {
  id        String   @id
  email     String
  name      String
  image     String
  credits   Int      @default(20)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  projects  Project[]
}
```

**Project Model**:
```prisma
model Project {
  id                 String   @id @default(uuid())
  name               String
  userId             String
  productName        String   
  productDescription String   @default("")
  userPrompt         String   @default("")
  aspectRatio        String   @default("9:16")
  targetLength       Int      @default(5)
  uploadedImages     String[]
  generatedImage     String   @default("")
  generatedVideo     String   @default("")
  isGenerating       Boolean  @default(false)
  isPublished        Boolean  @default(false)
  error              String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### Logging System (Winston) Behavior

**Log Levels**:
- `error`: Errors with stack traces
- `warn`: Warnings (quota, unauthorized, missing data)
- `info`: Request lifecycle, operations, success
- `debug`: Detailed debugging info

**Log Format**:
```json
{
  "level": "info",
  "message": "[createProject] Request received",
  "metadata": {"userId": "user_123", "requestId": "uuid"},
  "timestamp": "2026-02-13 16:37:59"
}
```

**What Gets Logged**:
- Server startup/shutdown
- Every request (entry, duration, status code)
- Database operations
- External API calls (Cloudinary, Google AI)
- Credit operations
- Errors with full stack traces
- Sensitive data is masked (passwords, API keys)

**Log Files**:
- `logs/combined.log`: All logs
- `logs/error.log`: Errors only
- Rotation: 5 files × 5MB each

### Error Handling Strategy

**Controller-Level**:
```typescript
try {
  // Operation
} catch (error: any) {
  logger.error('[operation] Failed', {
    userId, error: error.message, stack: error.stack
  });
  Sentry.captureException(error);
  res.status(500).json({ message: error.message });
}
```

**Middleware-Level**:
```typescript
export const errorLogger = (err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message, stack: err.stack, path: req.path
  });
  next(err);
};
```

**Global Error Handlers**:
```typescript
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});
```

### Timeout & Quota Safeguards

**Server Timeout**: 5 minutes (300,000ms)
```typescript
server.timeout = 300000;
```

**Axios Timeout**: 5 minutes
```typescript
timeout: 300000
```

**AI Generation Timeout**: 60 seconds
```typescript
await withTimeout(ai.models.generateContent(...), 60000);
```

**Video Polling Timeout**: 5 minutes (30 attempts × 10s)
```typescript
let attempts = 0;
while (!operation.done && attempts < 30) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  operation = await ai.operations.getVideosOperation({operation});
  attempts++;
}
if (!operation.done) throw new Error('Video generation timeout');
```

**Quota Error Detection**:
```typescript
function isQuotaError(err: any): boolean {
  return err.message?.includes('quota') || 
         err.message?.includes('rate limit') ||
         err.status === 429;
}
```

### Background Operations & Polling Logic

**Video Generation Polling**:
- **Interval**: 10 seconds
- **Max Attempts**: 30 (= 5 minutes total)
- **Operation**: Check `operation.done` status
- **Failure**: Throw timeout error, refund credits

**Frontend Polling** (Result.tsx):
- **Interval**: 10 seconds
- **Condition**: While `isGenerating === true`
- **Action**: Fetch project data
- **Stop**: When `isGenerating === false`

---

