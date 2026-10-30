# UGC Project - Technical Documentation (Part 3)

## 5️⃣ Database Layer

### Schema Explanation

**User Table**:
- `id`: Clerk user ID (primary key, string)
- `email`: User email
- `name`: Full name
- `image`: Profile image URL
- `credits`: Available credits (default: 20)
- `createdAt`: Account creation timestamp
- `updatedAt`: Last update timestamp

**Project Table**:
- `id`: UUID (auto-generated)
- `name`: Project name (user-defined)
- `userId`: Foreign key to User
- `productName`: Product being showcased
- `productDescription`: Optional product details
- `userPrompt`: Optional custom prompt
- `aspectRatio`: "9:16" or "16:9"
- `targetLength`: Video length (default: 5s, not currently used)
- `uploadedImages`: Array of Cloudinary URLs
- `generatedImage`: AI-generated image URL
- `generatedVideo`: AI-generated video URL
- `isGenerating`: Boolean flag for active generation
- `isPublished`: Boolean flag for public visibility
- `error`: Error message if generation failed
- `createdAt`: Project creation timestamp
- `updatedAt`: Last update timestamp

### Model Relationships

```
User (1) ──────< (N) Project
  │                    │
  └─ Cascade Delete ───┘
```

**Cascade Delete**: When a user is deleted, all their projects are automatically deleted.

### Credit Tracking Logic

**Initial State**:
```sql
INSERT INTO User (id, email, name, image, credits)
VALUES ('user_123', 'user@example.com', 'John Doe', 'url', 20);
```

**Deduction** (Image):
```sql
UPDATE User SET credits = credits - 5 WHERE id = 'user_123';
```

**Deduction** (Video):
```sql
UPDATE User SET credits = credits - 10 WHERE id = 'user_123';
```

**Refund** (on error):
```sql
UPDATE User SET credits = credits + 5 WHERE id = 'user_123';
```

**Addition** (payment):
```sql
UPDATE User SET credits = credits + 80 WHERE id = 'user_123'; -- Pro plan
```

### Project Lifecycle States

```
1. CREATED
   isGenerating: false
   generatedImage: ""
   generatedVideo: ""
   error: ""

2. GENERATING_IMAGE
   isGenerating: true
   generatedImage: ""
   generatedVideo: ""
   error: ""

3. IMAGE_COMPLETE
   isGenerating: false
   generatedImage: "https://cloudinary.com/..."
   generatedVideo: ""
   error: ""

4. GENERATING_VIDEO
   isGenerating: true
   generatedImage: "https://cloudinary.com/..."
   generatedVideo: ""
   error: ""

5. VIDEO_COMPLETE
   isGenerating: false
   generatedImage: "https://cloudinary.com/..."
   generatedVideo: "https://cloudinary.com/..."
   error: ""

6. ERROR_STATE
   isGenerating: false
   generatedImage: "" (or URL if image succeeded)
   generatedVideo: ""
   error: "Error message"
```

---

## 6️⃣ AI & External Services Integration

### AI Models Used and Where

**Google Gemini 2.5 Flash Image** (Image Generation):
- **Where**: `projectController.ts` → `createProject`
- **Purpose**: Generate UGC images from product + model photos
- **Input**: 2 base64-encoded images + text prompt
- **Output**: Base64-encoded generated image
- **Timeout**: 60 seconds
- **Config**: temperature 0.7, topP 0.9, topK 40

**Google Veo 3.1** (Video Generation):
- **Where**: `projectController.ts` → `createVideo`
- **Purpose**: Convert static images into videos
- **Input**: Base64-encoded image + text prompt
- **Output**: Video file (downloaded from Google AI)
- **Timeout**: 5 minutes (polling)
- **Config**: aspectRatio, numberOfVideos: 1, resolution: 720p

### Image Generation Flow

```
1. User uploads 2 images (product + model)
2. Multer saves to temp directory (uploads/)
3. Cloudinary upload (parallel)
   - Product image → URL1
   - Model image → URL2
4. Convert URLs to base64
5. Construct prompt:
   "make the person showcase the product which is {productName} 
    and Product Description: {productDescription}
    {userPrompt}"
6. Call Google AI API
   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent
   Headers: x-goog-api-key: {GOOGLE_AI_KEY}
   Body: {
     contents: [img1base64, img2base64, prompt],
     generationConfig: {...}
   }
7. Wait for response (max 60s)
8. Extract image data from response.candidates[0].content.parts
9. Convert base64 to buffer
10. Upload to Cloudinary
11. Return URL
```

### Video Generation Flow

```
1. Fetch generated image from Cloudinary
2. Download image as arraybuffer
3. Convert to base64
4. Construct prompt:
   "make the person showcase the product which is {productName} 
    and Product Description: {productDescription}"
5. Call Google AI Video API
   POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateVideos
   Body: {
     model: "veo-3.1-generate-preview",
     prompt: "...",
     image: { imageBytes: base64, mimeType: "image/png" },
     config: { aspectRatio, numberOfVideos: 1, resolution: "720p" }
   }
6. Receive operation object { name, done: false }
7. Poll operation status every 10 seconds
   GET https://generativelanguage.googleapis.com/v1beta/{operation.name}
8. Check operation.done (max 30 attempts)
9. Check for safety filters (operation.response.raiMediaFilteredReasons)
10. Download video
    ai.files.download({
      file: operation.response.generatedVideos[0].video,
      downloadPath: "videos/{filename}.mp4"
    })
11. Upload to Cloudinary
12. Delete temp file
13. Return URL
```

### Cloudinary Upload Flow

**Image Upload**:
```typescript
const uploadResult = await cloudinary.uploader.upload(base64Image, {
  resource_type: 'image'
});
// Returns: { secure_url: "https://...", public_id: "..." }
```

**Video Upload**:
```typescript
const uploadResult = await cloudinary.uploader.upload(filePath, {
  resource_type: 'video'
});
```

**Download Link**:
```typescript
// Add fl_attachment flag to force download
url.replace("/upload", "/upload/fl_attachment")
```

### Clerk Auth Flow

**User Sign-In**:
```
1. User clicks "Sign In" (Clerk UI)
2. Clerk handles authentication
3. Clerk returns JWT token
4. Frontend stores token in memory
5. Frontend includes token in API requests:
   headers: { Authorization: `Bearer ${token}` }
```

**Server-Side Verification**:
```
1. Request arrives with Authorization header
2. Clerk middleware verifies JWT
3. Extracts userId from token
4. Attaches to request: req.auth = { userId }
5. Protect middleware checks userId
6. Controller accesses userId via getAuth(req)
```

**Webhook Flow**:
```
1. User signs up on Clerk
2. Clerk sends webhook to /api/clerk
3. Server verifies webhook signature
4. Extracts event data
5. Creates user in database with 20 credits
```

### Failure & Retry Behavior

**AI Generation Failures**:
- **Quota Error**: Throw "Model quota reached — try later" (no retry)
- **Timeout**: Throw timeout error after 60s (no retry)
- **Invalid Response**: Throw "No image returned from model" (no retry)
- **Safety Filter**: Throw filter reason (no retry)

**Credit Refund on Failure**:
```typescript
if (isCreditDeducted) {
  await prisma.user.update({
    where: { id: userId },
    data: { credits: { increment: COST } }
  });
}
```

**Cloudinary Upload Failures**:
- No retry logic implemented
- Errors propagate to controller error handler

**Database Failures**:
- Prisma handles connection retries automatically
- Errors propagate to controller error handler

---

## 7️⃣ End-to-End Flow Walkthroughs

### User Creates Project

```
1. User navigates to /generate
2. Clerk checks authentication
   - If not logged in → Redirect to sign-in
   - If logged in → Continue
3. User fills form:
   - Project name: "Summer Campaign"
   - Product name: "Sunglasses"
   - Product description: "Polarized UV protection"
   - Aspect ratio: 9:16
   - Upload product image (sunglasses.jpg)
   - Upload model image (model.jpg)
   - User prompt: "Outdoor beach setting"
4. User clicks "Generate Image"
5. Frontend:
   - Disables button (isGenerating = true)
   - Creates FormData with all fields
   - Gets Clerk JWT token
   - POST /api/project/create with Authorization header
6. Backend (createProject):
   - Verify auth (protect middleware)
   - Extract userId from JWT
   - Validate inputs (2 images, product name)
   - Check user exists (create if race condition)
   - Check credits ≥ 5
   - Check spam (no concurrent generations)
   - Upload images to Cloudinary (parallel)
   - Create project record (isGenerating: true)
   - Convert images to base64
   - Call Google AI API
   - Wait for response (up to 60s)
   - Validate response
   - Upload generated image to Cloudinary
   - Deduct 5 credits
   - Update project (generatedImage, isGenerating: false)
   - Cleanup temp files
   - Return { projectId }
7. Frontend:
   - Receive response
   - Navigate to /result/{projectId}
8. Result page:
   - Fetch project data
   - Display generated image
   - Show "Generate Video" button
```

### Image Generation

**Detailed Backend Flow**:
```
1. Request arrives: POST /api/project/create
   Headers: { Authorization: "Bearer eyJ..." }
   Body: FormData {
     name: "Summer Campaign",
     productName: "Sunglasses",
     productDescription: "Polarized UV protection",
     aspectRatio: "9:16",
     userPrompt: "Outdoor beach setting",
     images: [File, File]
   }

2. Middleware Stack:
   - CORS: Allow origin
   - Clerk: Verify JWT → userId = "user_123"
   - Request Logger: Generate requestId, log entry
   - Protect: Check userId exists → Continue

3. Controller (createProject):
   a. Extract data:
      const { userId } = getAuth(req);
      const { name, productName, ... } = req.body;
      const images = req.files;

   b. Validate:
      if (!images || images.length !== 2) throw Error
      if (!productName) throw Error

   c. Get/Create User:
      let user = await prisma.user.findUnique({ where: { id: userId }});
      if (!user) {
        user = await prisma.user.create({
          data: { id: userId, email: "pending", credits: 20 }
        });
      }

   d. Check Credits:
      if (user.credits < 5) throw Error("Insufficient credits")

   e. Check Spam:
      const generating = await prisma.project.findFirst({
        where: { userId, isGenerating: true }
      });
      if (generating) throw Error("Generation in progress")

   f. Upload to Cloudinary:
      const [img1, img2] = await Promise.all([
        cloudinary.uploader.upload(images[0].path),
        cloudinary.uploader.upload(images[1].path)
      ]);

   g. Create Project:
      const project = await prisma.project.create({
        data: {
          name, userId, productName, productDescription,
          aspectRatio, userPrompt,
          uploadedImages: [img1.secure_url, img2.secure_url],
          isGenerating: true
        }
      });

   h. Convert to Base64:
      const img1base64 = await urlToBase64(img1.secure_url);
      const img2base64 = await urlToBase64(img2.secure_url);

   i. Construct Prompt:
      const prompt = `make the person showcase the product which is ${productName} 
                      and Product Description: ${productDescription}
                      ${userPrompt}`;

   j. Call AI:
      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [img1base64, img2base64, prompt],
          config: { temperature: 0.7, topP: 0.9, topK: 40 }
        }),
        60000
      );

   k. Validate Response:
      const imagePart = response.candidates[0].content.parts.find(p => p.inlineData?.data);
      if (!imagePart) throw Error("No image returned");

   l. Upload Generated Image:
      const finalBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
      const base64Image = `data:image/png;base64,${finalBuffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(base64Image);

   m. Deduct Credits:
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 5 } }
      });

   n. Update Project:
      await prisma.project.update({
        where: { id: project.id },
        data: {
          generatedImage: uploadResult.secure_url,
          isGenerating: false
        }
      });

   o. Cleanup:
      images.forEach(f => fs.unlink(f.path));

   p. Return:
      res.json({ projectId: project.id });

4. Response Logger:
   - Log completion (status: 200, duration: 45s)

5. Frontend:
   - Receive { projectId: "abc-123" }
   - Navigate to /result/abc-123
```

### Video Generation

```
1. User on /result/{projectId}
2. Sees generated image
3. Clicks "Generate Video"
4. Frontend:
   - Disables button (isGenerating = true)
   - POST /api/project/video
   Body: { projectId }
5. Backend (createVideo):
   - Verify auth
   - Get user, check credits ≥ 10
   - Deduct 10 credits UPFRONT
   - Fetch project
   - Validate (has generatedImage, not already generating)
   - Mark project as generating
   - Fetch image from Cloudinary
   - Convert to base64
   - Call Google AI Video API
   - Receive operation { name, done: false }
   - Start polling loop:
     while (!operation.done && attempts < 30) {
       wait 10 seconds
       operation = await getOperation(operation.name)
       attempts++
     }
   - Check for timeout
   - Check for safety filters
   - Download video from Google AI
   - Upload to Cloudinary
   - Update project (generatedVideo, isGenerating: false)
   - Cleanup temp file
   - Return { videoUrl }
6. Frontend:
   - Polling detects isGenerating = false
   - Fetches updated project
   - Displays video
   - Shows success message
```

### Credit Deduction/Refund

**Successful Image Generation**:
```
1. User has 20 credits
2. Starts image generation
3. AI succeeds
4. Credits deducted: 20 - 5 = 15
5. User has 15 credits
```

**Failed Image Generation**:
```
1. User has 20 credits
2. Starts image generation
3. AI fails (quota error)
4. Credits NOT deducted (deduction happens AFTER success)
5. User still has 20 credits
```

**Failed Video Generation**:
```
1. User has 15 credits
2. Starts video generation
3. Credits deducted UPFRONT: 15 - 10 = 5
4. AI fails (timeout)
5. Credits refunded: 5 + 10 = 15
6. User has 15 credits
```

### Error Case Handling

**Insufficient Credits**:
```
1. User has 3 credits
2. Tries to generate image (costs 5)
3. Backend checks: user.credits < 5
4. Returns 403: "Insufficient credits"
5. Frontend shows toast: "Insufficient credits. You need at least 5 credits."
```

**Concurrent Generation**:
```
1. User starts image generation
2. Project marked as isGenerating: true
3. User tries to start another generation
4. Backend checks: existing project with isGenerating: true
5. Returns 429: "You already have a generation in progress"
6. Frontend shows toast
```

**AI Quota Error**:
```
1. Image generation starts
2. Google AI returns quota error
3. Backend detects quota error
4. Logs warning
5. Throws "Model quota reached — try later"
6. Project marked as isGenerating: false, error: "Model quota reached"
7. Credits NOT deducted (error before deduction)
8. Returns 500
9. Frontend shows toast: "Model quota reached — try later"
```

**Timeout Error**:
```
1. Video generation starts
2. Credits deducted (10)
3. Polling reaches 30 attempts (5 minutes)
4. Backend throws "Video generation timeout"
5. Credits refunded (+10)
6. Project marked as isGenerating: false, error: "Video generation timeout"
7. Returns 500
8. Frontend shows toast: "Video generation timeout"
```

---

## 8️⃣ Configuration & Environment Setup

### Required Environment Variables

**Server** (`.env`):
```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Clerk
CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
CLERK_WEBHOOK_SECRET="whsec_..."

# Google AI
GOOGLE_AI_KEY="AIza..."

# Cloudinary
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="123456789"
CLOUDINARY_API_SECRET="your_secret"

# Sentry
SENTRY_DSN="https://...@sentry.io/..."

# Server
PORT=5001
NODE_ENV="development"
LOG_LEVEL="info"
```

**Client** (`.env`):
```env
VITE_BASEURL="http://localhost:5001"
VITE_CLERK_PUBLISHABLE_KEY="pk_test_..."
```

### API Keys Needed

1. **Clerk** (Authentication):
   - Sign up at clerk.com
   - Create application
   - Get publishable key + secret key
   - Setup webhook endpoint

2. **Google AI** (Gemini):
   - Go to ai.google.dev
   - Create API key
   - Enable Gemini API

3. **Cloudinary** (Media Storage):
   - Sign up at cloudinary.com
   - Get cloud name, API key, API secret

4. **Sentry** (Error Tracking):
   - Sign up at sentry.io
   - Create project
   - Get DSN

5. **PostgreSQL** (Database):
   - Use Neon, Supabase, or local PostgreSQL
   - Get connection string

### Service Setup Steps

**1. Clerk Setup**:
```
1. Create account at clerk.com
2. Create new application
3. Copy publishable key to client .env
4. Copy secret key to server .env
5. Go to Webhooks
6. Add endpoint: https://your-domain.com/api/clerk
7. Subscribe to: user.created, user.updated, user.deleted, paymentAttempt.updated
8. Copy webhook secret to server .env
```

**2. Google AI Setup**:
```
1. Go to ai.google.dev
2. Sign in with Google account
3. Click "Get API Key"
4. Create new API key
5. Copy to server .env as GOOGLE_AI_KEY
6. Enable Gemini API in Google Cloud Console
```

**3. Cloudinary Setup**:
```
1. Sign up at cloudinary.com
2. Go to Dashboard
3. Copy Cloud Name, API Key, API Secret
4. Add to server .env
```

**4. Database Setup**:
```
1. Create PostgreSQL database (Neon recommended)
2. Copy connection string
3. Add to server .env as DATABASE_URL
4. Run: cd server && npx prisma generate
5. Run: npx prisma db push
```

### Local Dev Setup Steps

```bash
# 1. Clone repository
git clone <repo-url>
cd ugc-project

# 2. Install dependencies
cd client && npm install
cd ../server && npm install

# 3. Setup environment variables
# Create client/.env and server/.env with values above

# 4. Setup database
cd server
npx prisma generate
npx prisma db push

# 5. Start development servers
# Terminal 1 (Client)
cd client
npm run dev
# Runs on http://localhost:5173

# Terminal 2 (Server)
cd server
npm run server
# Runs on http://localhost:5001

# 6. Open browser
# Navigate to http://localhost:5173
```

---

