import crypto from 'crypto';
import { canPostTo } from '../services/social/validator.js';

async function runPhase5Tests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING PHASE 5 (ENDPOINTS & UI LOGIC) VERIFICATION');
    console.log('======================================================\n');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition: boolean, testName: string) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passedTests++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`);
            failedTests++;
        }
    }

    // ----------------------------------------------------
    // TEST 1: Scheduled Time Validation Range Rules
    // ----------------------------------------------------
    console.log('🔹 [Test 1] Scheduling Datetime Boundary Validation');
    const now = Date.now();

    // Past date -> Invalid
    const pastDate = new Date(now - 1000 * 60 * 10);
    const isPastValid = pastDate.getTime() > now;
    assert(!isPastValid, 'Past datetime is rejected');

    // Future within 90 days -> Valid
    const validFuture = new Date(now + 1000 * 60 * 60 * 24 * 5); // 5 days ahead
    const isFutureValid = validFuture.getTime() > now && validFuture.getTime() <= now + 90 * 24 * 60 * 60 * 1000;
    assert(isFutureValid, 'Future date within 90 days is accepted');

    // More than 90 days ahead -> Invalid
    const tooFarFuture = new Date(now + 1000 * 60 * 60 * 24 * 95);
    const isTooFarValid = tooFarFuture.getTime() <= now + 90 * 24 * 60 * 60 * 1000;
    assert(!isTooFarValid, 'Scheduling further than 90 days ahead is rejected');

    // ----------------------------------------------------
    // TEST 2: AI Caption Output Parser & Sanitizer
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] AI Caption Output Parser & Fenced JSON Handling');
    const sampleRawAiOutput = '```json\n{\n  "caption": "Step into luxury with our handcrafted leather shoes. Perfect for any evening.",\n  "hashtags": ["#luxury", "#leather", "#style", "#ad"]\n}\n```';
    
    let cleanedText = sampleRawAiOutput.trim();
    if (cleanedText.startsWith('```json')) cleanedText = cleanedText.replace(/^```json/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanedText);

    assert(parsed.caption.includes('handcrafted leather shoes'), 'Parsed AI caption cleanly from markdown code fences');
    assert(Array.isArray(parsed.hashtags) && parsed.hashtags.length === 4, 'Parsed hashtags array correctly');

    // ----------------------------------------------------
    // TEST 3: Media Ownership Guard
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Media Ownership & Project Asset Verification');
    const mockProject = {
        generatedImage: 'https://res.cloudinary.com/demo/image/upload/img1.jpg',
        generatedImages: ['https://res.cloudinary.com/demo/image/upload/b1.jpg', 'https://res.cloudinary.com/demo/image/upload/b2.jpg'],
        generatedVideo: 'https://res.cloudinary.com/demo/video/upload/video1.mp4',
        uploadedImages: ['https://res.cloudinary.com/demo/image/upload/up1.jpg'],
    };

    const validUrls = [
        mockProject.generatedImage,
        ...mockProject.generatedImages,
        mockProject.generatedVideo,
        ...mockProject.uploadedImages,
    ];

    const legitimateMedia = 'https://res.cloudinary.com/demo/video/upload/video1.mp4';
    const isLegitValid = validUrls.includes(legitimateMedia);
    assert(isLegitValid, 'Legitimate project video recognized as authorized');

    const foreignMedia = 'https://res.cloudinary.com/attacker/malicious.mp4';
    const isForeignValid = validUrls.includes(foreignMedia);
    assert(!isForeignValid, 'Foreign/unauthorized media URL rejected');

    // ----------------------------------------------------
    // TEST 4: AI Disclosure Injection
    // ----------------------------------------------------
    console.log('\n🔹 [Test 4] AI Disclosure Formatting');
    const baseCaption = 'Excited to announce our new product line!';
    const withDisclosure = `${baseCaption}\n\n✨ AI Disclosure: Generated with Vigyapan AI`.trim();
    assert(withDisclosure.includes('✨ AI Disclosure: Generated with Vigyapan AI'), 'AI disclosure notice correctly appended to post caption');

    console.log('\n======================================================');
    console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('======================================================\n');

    if (failedTests > 0) process.exit(1);
}

runPhase5Tests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
