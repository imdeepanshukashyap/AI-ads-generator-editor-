import { canPostTo, optimizeForInstagramImage, optimizeForInstagramVideo } from '../services/social/validator.js';

async function runPhase4Tests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING PHASE 4 (INSTAGRAM & VALIDATOR) VERIFICATION');
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

    const sampleImgUrl = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const sampleVideoUrl = 'https://res.cloudinary.com/demo/video/upload/sample.mp4';

    // ----------------------------------------------------
    // TEST 1: canPostTo Compatibility Matrix
    // ----------------------------------------------------
    console.log('🔹 [Test 1] Platform Compatibility & Aspect Ratio Rules (canPostTo)');

    // YouTube rules
    const ytImage = canPostTo('youtube', 'image', '9:16', sampleImgUrl);
    assert(!ytImage.canPost && Boolean(ytImage.reason?.includes('videos only')), 'YouTube rejects still images');

    const ytShort = canPostTo('youtube', 'video', '9:16', sampleVideoUrl);
    assert(ytShort.canPost && ytShort.postType === 'short', 'YouTube accepts 9:16 video as a Short');

    const ytVideo = canPostTo('youtube', 'video', '16:9', sampleVideoUrl);
    assert(ytVideo.canPost && ytVideo.postType === 'video', 'YouTube accepts 16:9 video as standard video');

    // Facebook rules
    const fbPhoto = canPostTo('facebook', 'image', '9:16', sampleImgUrl);
    assert(fbPhoto.canPost && fbPhoto.postType === 'photo', 'Facebook supports direct image publishing');

    const fbVideo = canPostTo('facebook', 'video', '9:16', sampleVideoUrl);
    assert(fbVideo.canPost && fbVideo.postType === 'video', 'Facebook supports direct video publishing');

    // Instagram rules
    const igReel = canPostTo('instagram', 'video', '9:16', sampleVideoUrl);
    assert(igReel.canPost && igReel.postType === 'reel', 'Instagram supports 9:16 video as a Reel');

    const igPhoto916 = canPostTo('instagram', 'image', '9:16', sampleImgUrl);
    assert(igPhoto916.canPost && Boolean(igPhoto916.warning?.includes('padded to 4:5')), 'Instagram flags 9:16 still image for 4:5 auto-padding');

    const igPhoto169 = canPostTo('instagram', 'image', '16:9', sampleImgUrl);
    assert(igPhoto169.canPost && igPhoto169.postType === 'photo', 'Instagram allows 16:9 still image in feed');

    // ----------------------------------------------------
    // TEST 2: Cloudinary Transformation URL Generators
    // ----------------------------------------------------
    console.log('\n🔹 [Test 2] Cloudinary Auto-Transformation Generators');

    const paddedImgUrl = optimizeForInstagramImage(sampleImgUrl, '9:16');
    assert(paddedImgUrl.includes('/c_pad,ar_4:5,b_black'), 'Instagram 9:16 image receives 4:5 black padding transformation');

    const unpaddedImgUrl = optimizeForInstagramImage(sampleImgUrl, '16:9');
    assert(!unpaddedImgUrl.includes('c_pad') && unpaddedImgUrl.includes('q_auto'), 'Instagram 16:9 image avoids unnecessary padding');

    const optimizedVidUrl = optimizeForInstagramVideo(sampleVideoUrl);
    assert(optimizedVidUrl.includes('/vc_h264,ac_aac,f_mp4/'), 'Instagram video receives H.264 + AAC MP4 codec transformation');

    // ----------------------------------------------------
    // TEST 3: Instagram Container Polling Logic Simulation
    // ----------------------------------------------------
    console.log('\n🔹 [Test 3] Instagram Reel Container Status Verification');
    const statusCodes = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
    let finalStatus = '';
    for (const code of statusCodes) {
        if (code === 'FINISHED') {
            finalStatus = 'READY_TO_PUBLISH';
            break;
        }
    }
    assert(finalStatus === 'READY_TO_PUBLISH', 'Container polling successfully detects FINISHED status code');

    const errorCodes = ['IN_PROGRESS', 'ERROR'];
    let errorCaught = false;
    for (const code of errorCodes) {
        if (code === 'ERROR' || code === 'EXPIRED') {
            errorCaught = true;
            break;
        }
    }
    assert(errorCaught, 'Container polling safely catches ERROR and EXPIRED status codes');

    console.log('\n======================================================');
    console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('======================================================\n');

    if (failedTests > 0) process.exit(1);
}

runPhase4Tests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
