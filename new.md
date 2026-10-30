
md
Implementation Plan: 3-Image Advertisement Bundle
Goal
Upgrade the image generation feature from single image to a 3-image advertisement bundle with distinct camera angles while maintaining model consistency.

User Review Required
IMPORTANT

Breaking Change: This will change the database schema from generatedImage: String to generatedImages: String[]. Existing projects with single images will need migration handling.

WARNING

Credit Cost Change: Image generation will now cost 15 credits (3 images × 5 credits) instead of 5 credits. This is a 3x increase in cost per generation.

CAUTION

Timeout Increase: AI generation timeout will increase from 60s to 90s to accommodate 3 parallel image generations.

Proposed Changes
Database Layer
[MODIFY] 
schema.prisma
Change generatedImage String @default("") to generatedImages String[]
This allows storing multiple image URLs as an array
Migration strategy: Existing single images will need to be wrapped in an array
Backend Layer
[MODIFY] 
projectController.ts
Changes to 
createProject
 function:

Define Advertisement Angles:

Hero Shot: Eye-level, front-facing, centered composition
Dynamic Angle: Low angle, 45-degree side view, dramatic lighting
Lifestyle Close-up: Extreme close-up on hands/product, shallow depth
Update Credit Check: Require 15 credits instead of 5

Parallel AI Generation:

Use Promise.allSettled() for 3 parallel Gemini API calls
Each call uses a different camera angle prompt
Include model consistency instruction in all prompts
Handle individual failures gracefully (partial success)
Timeout Adjustment: Increase from 60s to 90s

Cloudinary Upload Loop: Upload all 3 generated images

Credit Deduction: Deduct 15 credits only on successful generation

Error Handling:

If all 3 fail → Refund 0 credits (none deducted)
If 1-2 succeed → Deduct proportional credits (5 or 10)
If all 3 succeed → Deduct 15 credits
Changes to 
createVideo
 function:

Update to use generatedImages[0] (first image) as the base for video generation
Or allow user to select which image to convert to video
Frontend Layer
[MODIFY] 
types/index.ts
Change generatedImage?: string to generatedImages?: string[]
[MODIFY] 
Genetator.tsx
Update UI to show "Generate 3 Images (15 credits)" instead of "Generate Image (5 credits)"
Display cost warning
[MODIFY] 
Result.tsx
Display all 3 images in a grid or carousel
Allow user to select which image to use for video generation
Add download buttons for each individual image
Add "Download All" button for bundle
[MODIFY] 
ProjectCard.tsx
Display first image as thumbnail or show all 3 in mini-grid
[MODIFY] 
Community.tsx
Update to display image bundles properly
Configuration Changes
[MODIFY] 
projectController.ts
Update 
withTimeout
 calls from 60000ms to 90000ms
Update model name if needed (currently using gemini-2.5-flash-image)
Implementation Details
Advertisement Angles Configuration
typescript
const AD_ANGLES = [
  {
    name: "Hero Shot",
    camera: "Eye-level, front-facing, centered composition, product-focused, professional studio lighting"
  },
  {
    name: "Dynamic Angle",
    camera: "Low angle, 45-degree side view, dramatic lighting, showing scale and depth"
  },
  {
    name: "Lifestyle Close-up",
    camera: "Extreme close-up on hands using the product, shallow depth of field, soft bokeh background"
  }
];
Model Consistency Prompt
typescript
const CONSISTENCY_INSTRUCTION = `
CRITICAL: The person's facial features, clothing, and overall appearance must be 
IDENTICAL in all shots to maintain brand continuity. Same person, same outfit, 
same styling throughout all angles.
`;
Parallel Generation Logic
typescript
const generationPromises = AD_ANGLES.map(async (angle) => {
  const specificPrompt = `
    ${basePrompt}
    ${CONSISTENCY_INSTRUCTION}
    CAMERA ANGLE: ${angle.camera}
    SCENE TYPE: ${angle.name}
  `;
  
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [img1base64, img2base64, { text: specificPrompt }],
        config: generationConfig
      }),
      90000 // 90 seconds
    );
    return { status: 'fulfilled', value: response, angle: angle.name };
  } catch (error) {
    logger.warn(`[createProject] ${angle.name} generation failed`, { error });
    return { status: 'rejected', reason: error, angle: angle.name };
  }
});
const results = await Promise.allSettled(generationPromises);
Credit Calculation Logic
typescript
const successfulImages = results.filter(r => r.status === 'fulfilled');
const creditsToDeduct = successfulImages.length * 5; // 5 credits per image
if (successfulImages.length === 0) {
  throw new Error('All image generations failed');
}
// Deduct proportional credits
await prisma.user.update({
  where: { id: userId },
  data: { credits: { decrement: creditsToDeduct } }
});
Verification Plan
Automated Tests
Test with sufficient credits (≥15) → Should generate 3 images
Test with insufficient credits (<15) → Should fail with error
Test partial failure (1-2 images succeed) → Should save successful images and deduct proportional credits
Test complete failure (all 3 fail) → Should not deduct credits
Test video generation with multiple images → Should use selected image
Manual Verification
Generate image bundle and verify all 3 have consistent model
Verify different camera angles are applied
Check credit deduction is correct (15 for success, proportional for partial)
Test download functionality for individual and all images
Verify video generation works with selected image
Check community page displays bundles correctly
Migration Strategy
Database Migration
Option 1: Automatic Migration (Recommended)

typescript
// Migration script to convert existing single images to arrays
const projects = await prisma.project.findMany({
  where: { generatedImage: { not: "" } }
});
for (const project of projects) {
  await prisma.project.update({
    where: { id: project.id },
    data: {
      generatedImages: [project.generatedImage],
      generatedImage: undefined // Remove old field
    }
  });
}
Option 2: Backward Compatibility

Keep both generatedImage and generatedImages fields temporarily
Frontend checks for both and displays accordingly
Deprecate generatedImage after migration period
Rollout Plan
Phase 1: Update database schema and run migration
Phase 2: Update backend logic (with feature flag if needed)
Phase 3: Update frontend to display bundles
Phase 4: Test thoroughly in staging
Phase 5: Deploy to production
Phase 6: Monitor logs for errors and credit deductions
Risks & Mitigation
Risk	Impact	Mitigation
Increased AI quota usage	High	Monitor quota, implement rate limiting
Higher timeout failures	Medium	Increase timeout to 90s, implement retry for failed images
Credit deduction bugs	High	Thorough testing, add detailed logging
Existing projects break	High	Implement migration script, test backward compatibility
Safety filter hits	Medium	Graceful degradation (save successful images)
User confusion about cost	Medium	Clear UI messaging about 15 credit cost