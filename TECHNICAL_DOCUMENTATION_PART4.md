# UGC Project - Technical Documentation (Part 4 - Final)

## 9️⃣ Current Project Status Snapshot

### What is Fully Implemented ✅

**Authentication & User Management**:
- ✅ Clerk authentication (sign-up, sign-in, sign-out)
- ✅ User auto-creation on first API call
- ✅ User credit system (initial 20 credits)
- ✅ Clerk webhook integration (user events, payment events)

**Image Generation**:
- ✅ Dual image upload (product + model)
- ✅ Cloudinary upload and storage
- ✅ Google AI (Gemini 2.5 Flash Image) integration
- ✅ AI-generated image creation
- ✅ Credit deduction (5 credits per image)
- ✅ Error handling and rollback
- ✅ Spam prevention (1 concurrent generation limit)

**Video Generation**:
- ✅ Google AI (Veo 3.1) integration
- ✅ Image-to-video conversion
- ✅ Polling mechanism (10s intervals, 5 min timeout)
- ✅ Credit deduction (10 credits per video)
- ✅ Credit refund on failure
- ✅ Safety filter detection

**Project Management**:
- ✅ Project creation and storage
- ✅ Project listing (user-specific)
- ✅ Project detail view
- ✅ Project deletion
- ✅ Publish/unpublish toggle
- ✅ Public gallery (published projects)

**Media Handling**:
- ✅ Image download
- ✅ Video download
- ✅ Aspect ratio selection (9:16, 16:9)
- ✅ Cloudinary CDN delivery

**Logging & Monitoring**:
- ✅ Winston logging (all operations)
- ✅ Request lifecycle tracking
- ✅ Error logging with stack traces
- ✅ Sentry error tracking
- ✅ Sensitive data masking

**Frontend**:
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ Dark theme UI
- ✅ Toast notifications
- ✅ Loading states
- ✅ Smooth scrolling (Lenis)
- ✅ Animations (Framer Motion)

### What is Partially Implemented ⚠️

**Payment Integration**:
- ⚠️ Clerk webhook receives payment events
- ⚠️ Credits added on payment (80 for pro, 240 for premium)
- ❌ No Stripe/Clerk Billing UI integration
- ❌ No subscription management
- ❌ Plans page is UI-only (no actual payment flow)

**Community Features**:
- ⚠️ Published projects gallery exists
- ❌ No likes/comments
- ❌ No user profiles
- ❌ No search/filter functionality

**Error Handling**:
- ⚠️ Basic error messages shown to users
- ❌ No retry logic for failed operations
- ❌ No detailed error explanations
- ❌ No user-friendly error recovery flows

**User Experience**:
- ⚠️ Basic loading states (spinners)
- ❌ No progress bars for long operations
- ❌ No estimated time remaining
- ❌ No background generation (must stay on page)

### Known Limitations

**Technical Constraints**:
1. **Google AI Quota**: Limited free tier, quota errors common
2. **Timeout Limits**: 5-minute max for video generation
3. **Concurrent Generations**: 1 per user (spam prevention)
4. **File Size**: No explicit limits (Cloudinary/Multer defaults)
5. **Video Length**: Fixed at ~5 seconds (not configurable)
6. **Resolution**: Fixed at 720p for videos

**Functional Limitations**:
1. **No Project Editing**: Can only create new projects
2. **No Batch Generation**: One project at a time
3. **No Custom Models**: Fixed AI models (Gemini, Veo)
4. **No Video Customization**: Can't adjust length, style, effects
5. **No Image Editing**: Can't adjust generated images
6. **No Analytics**: No usage stats or insights

**UX Limitations**:
1. **Polling-Based Updates**: No WebSocket real-time updates
2. **Page Refresh Required**: Must stay on result page during generation
3. **No Notifications**: No email/push notifications when done
4. **No Drafts**: Projects created immediately
5. **No Undo**: Deleted projects are permanent

### Known Quota/Platform Constraints

**Google AI**:
- **Free Tier Limits**: 60 requests/minute, 1500 requests/day
- **Quota Errors**: "Model quota reached — try later"
- **Rate Limiting**: 429 status codes
- **Safety Filters**: Content may be blocked (violence, adult content)

**Cloudinary**:
- **Free Tier**: 25 GB storage, 25 GB bandwidth/month
- **Upload Limits**: 10 MB per image, 100 MB per video (free tier)
- **Transformations**: Limited on free tier

**Clerk**:
- **Free Tier**: 10,000 MAU (Monthly Active Users)
- **Webhook Limits**: No explicit limits documented

**PostgreSQL (Neon)**:
- **Free Tier**: 0.5 GB storage, 10 GB data transfer/month
- **Connection Limits**: 100 concurrent connections

### Stability Level of Each Module

| Module | Stability | Notes |
|--------|-----------|-------|
| **Authentication** | 🟢 Stable | Clerk handles all edge cases |
| **Image Generation** | 🟡 Moderate | Quota errors common, timeouts rare |
| **Video Generation** | 🟡 Moderate | Timeouts possible (5 min), safety filters |
| **Credit System** | 🟢 Stable | Refund logic tested |
| **Database** | 🟢 Stable | Prisma handles connections well |
| **Cloudinary Upload** | 🟢 Stable | Reliable CDN |
| **Logging** | 🟢 Stable | Winston proven |
| **Error Handling** | 🟡 Moderate | Basic coverage, no retry logic |
| **Frontend UI** | 🟢 Stable | React/Vite stable |
| **Webhooks** | 🟢 Stable | Clerk signature verification |

---

## 🔟 Contribution Guide for New Developers

### Where to Start Reading Code

**Recommended Reading Order**:

1. **Start Here** (High-Level Overview):
   - `README.md` (if exists)
   - `TECHNICAL_DOCUMENTATION.md` (this file)
   - `server/prisma/schema.prisma` (database models)

2. **Frontend Entry Points**:
   - `client/src/main.tsx` (React entry)
   - `client/src/App.tsx` (routing)
   - `client/src/pages/Genetator.tsx` (main user flow)
   - `client/src/pages/Result.tsx` (result display)

3. **Backend Entry Points**:
   - `server/server.ts` (Express setup)
   - `server/routes/projectRoutes.ts` (API routes)
   - `server/controllers/projectController.ts` (core logic)

4. **Key Utilities**:
   - `server/configs/logger.ts` (logging)
   - `server/configs/googleAI.ts` (AI client)
   - `server/configs/cloudinary.ts` (media storage)

5. **Authentication**:
   - `server/middlewares/auth.ts` (protect middleware)
   - `server/controllers/clerk.ts` (webhooks)

### Safe Areas to Modify

**Low Risk** (Safe to modify):
- ✅ `client/src/components/` (UI components)
- ✅ `client/src/pages/` (page layouts)
- ✅ `client/src/index.css` (styles)
- ✅ `server/configs/logger.ts` (log levels, format)
- ✅ `server/middlewares/requestLogger.ts` (logging details)
- ✅ Frontend error messages and toast notifications
- ✅ UI text, labels, placeholders

**Medium Risk** (Test thoroughly):
- ⚠️ `server/controllers/userController.ts` (user operations)
- ⚠️ `server/routes/` (route definitions)
- ⚠️ Database queries (Prisma calls)
- ⚠️ Validation logic
- ⚠️ Error messages

**High Risk** (Modify with caution):
- 🔴 `server/controllers/projectController.ts` (AI generation logic)
- 🔴 Credit deduction/refund logic
- 🔴 `server/controllers/clerk.ts` (webhook handling)
- 🔴 `server/middlewares/auth.ts` (authentication)
- 🔴 AI API calls and configurations
- 🔴 Cloudinary upload logic

### Sensitive Modules

**DO NOT MODIFY WITHOUT UNDERSTANDING**:

1. **Credit System**:
   - Location: `projectController.ts` (deduction/refund)
   - Risk: Financial impact, user trust
   - Test: Verify credits before/after operations

2. **Authentication**:
   - Location: `middlewares/auth.ts`, `clerk.ts`
   - Risk: Security vulnerabilities
   - Test: Verify unauthorized access blocked

3. **AI Generation**:
   - Location: `projectController.ts` (createProject, createVideo)
   - Risk: Quota exhaustion, cost overruns
   - Test: Monitor API usage, test error cases

4. **Webhook Handling**:
   - Location: `controllers/clerk.ts`
   - Risk: Data corruption, duplicate credits
   - Test: Verify signature, test idempotency

5. **Database Migrations**:
   - Location: `prisma/migrations/`
   - Risk: Data loss
   - Test: Always backup before migration

### Testing Flow

**Manual Testing Checklist**:

```
□ Sign up new user → Verify 20 credits
□ Upload 2 images → Generate image → Verify 15 credits
□ Generate video → Verify 5 credits
□ Delete project → Verify deletion
□ Publish project → Verify in community
□ Download image/video → Verify download works
□ Test with insufficient credits → Verify error
□ Test concurrent generation → Verify blocked
□ Test invalid images → Verify error
□ Test timeout scenario → Verify refund
```

**Backend Testing**:
```bash
# Start server
cd server
npm run server

# Test endpoints with curl
curl -X GET http://localhost:5001/
curl -X GET http://localhost:5001/api/project/published

# Check logs
tail -f logs/combined.log
tail -f logs/error.log
```

**Frontend Testing**:
```bash
# Start client
cd client
npm run dev

# Open browser
# Navigate to http://localhost:5173
# Open DevTools → Console/Network tabs
# Test user flows manually
```

**Database Testing**:
```bash
# View database
cd server
npx prisma studio
# Opens GUI at http://localhost:5555

# Check user credits
# Check project records
# Verify relationships
```

### Logging & Debugging Tips

**Enable Debug Logging**:
```env
# server/.env
LOG_LEVEL="debug"
```

**View Logs**:
```bash
# Real-time logs
tail -f server/logs/combined.log

# Error logs only
tail -f server/logs/error.log

# Search logs
grep "createProject" server/logs/combined.log
grep "ERROR" server/logs/combined.log
```

**Add Custom Logs**:
```typescript
// In any controller/middleware
logger.info('[functionName] Description', {
  userId,
  projectId,
  customData: value
});

logger.error('[functionName] Error occurred', {
  error: error.message,
  stack: error.stack,
  context: { userId, projectId }
});
```

**Debug Request Flow**:
```typescript
// Check request ID in logs
// All logs for a single request share the same requestId
grep "requestId\":\"abc-123" logs/combined.log
```

**Frontend Debugging**:
```typescript
// Add console logs
console.log('API Response:', data);
console.log('User State:', user);
console.log('Project Data:', project);

// Check network requests
// DevTools → Network → Filter by "api"
// Inspect request/response payloads
```

**Database Debugging**:
```typescript
// Enable Prisma query logging
// prisma.config.ts
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});
```

**Common Issues & Solutions**:

| Issue | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | Missing/invalid JWT | Check Clerk auth, verify token |
| "Insufficient credits" | User credits < cost | Add credits via webhook/manual |
| "Model quota reached" | Google AI quota limit | Wait for reset, use different API key |
| "Generation in progress" | Concurrent generation | Wait for current to finish |
| "Video generation timeout" | Exceeded 5 minutes | Check Google AI status, retry |
| "No image returned" | AI response invalid | Check prompt, verify model name |
| Database connection error | Invalid DATABASE_URL | Verify connection string |
| Cloudinary upload fails | Invalid credentials | Check API key/secret |

---

## 📚 Additional Resources

**Official Documentation**:
- [Clerk Docs](https://clerk.com/docs)
- [Google AI Docs](https://ai.google.dev/docs)
- [Cloudinary Docs](https://cloudinary.com/documentation)
- [Prisma Docs](https://www.prisma.io/docs)
- [React Router Docs](https://reactrouter.com)
- [Winston Docs](https://github.com/winstonjs/winston)

**Code Patterns**:
- Error handling: See `projectController.ts` try-catch blocks
- Logging: See `requestLogger.ts` for request lifecycle
- Auth: See `auth.ts` for protect middleware pattern
- API calls: See `Genetator.tsx` for Axios usage

**Development Workflow**:
1. Create feature branch: `git checkout -b feature/name`
2. Make changes
3. Test locally (manual + check logs)
4. Commit with descriptive message
5. Push and create PR
6. Review logs in production after deploy

---

## 🎯 Quick Reference

**Start Development**:
```bash
# Terminal 1
cd client && npm run dev

# Terminal 2
cd server && npm run server
```

**View Logs**:
```bash
tail -f server/logs/combined.log
```

**Database GUI**:
```bash
cd server && npx prisma studio
```

**Key Files**:
- Frontend entry: `client/src/App.tsx`
- Backend entry: `server/server.ts`
- Database schema: `server/prisma/schema.prisma`
- Main controller: `server/controllers/projectController.ts`

**Environment Variables**:
- Client: `client/.env`
- Server: `server/.env`

**API Endpoints**:
- Base URL: `http://localhost:5001`
- Create project: `POST /api/project/create`
- Generate video: `POST /api/project/video`
- Get credits: `GET /api/user/credits`

---

## ✅ Checklist for New Contributors

Before starting development:
- [ ] Read this documentation thoroughly
- [ ] Setup local environment (client + server)
- [ ] Get all required API keys
- [ ] Test basic user flow (sign up → generate → download)
- [ ] Review logs to understand request flow
- [ ] Open Prisma Studio to see database structure
- [ ] Read `projectController.ts` to understand AI generation
- [ ] Test error scenarios (insufficient credits, quota errors)

Before submitting PR:
- [ ] Test all affected user flows
- [ ] Check logs for errors
- [ ] Verify no sensitive data logged
- [ ] Test with different user accounts
- [ ] Verify credit deduction/refund logic
- [ ] Test on mobile/tablet (if frontend changes)
- [ ] Update documentation if needed

---

**End of Technical Documentation**

For questions or clarifications, review the code comments and logs. Most functions have inline comments explaining their purpose and behavior.
