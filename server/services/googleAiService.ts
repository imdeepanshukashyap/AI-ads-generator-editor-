import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const getClient = (): GoogleGenAI => {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY1 || process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_CLOUD_API_KEY1 is not configured in server environment variables.');
    return new GoogleGenAI({ apiKey });
};

const imageModel = process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
const configuredVideoModel = process.env.GOOGLE_VIDEO_MODEL;
const videoModel = !configuredVideoModel || configuredVideoModel === 'veo-3.1-generate-preview'
    ? 'gemini-omni-1.1-flash'
    : configuredVideoModel;

const downloadReference = async (url: string): Promise<{ data: string; mimeType: string }> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to fetch reference image (${response.status}).`);
    return { data: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' };
};

export const generateGoogleImages = async (params: { prompt: string; imageUrls: string[]; imageCount: number }): Promise<{ paths: string[]; directory: string }> => {
    const client = getClient();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'google-ai-images-'));
    const references = await Promise.all(params.imageUrls.map(downloadReference));
    const contents = [{ text: params.prompt }, ...references.map((image) => ({ inlineData: { data: image.data, mimeType: image.mimeType } }))];
    const paths: string[] = [];

    for (let index = 0; index < params.imageCount; index += 1) {
        const response = await client.models.generateContent({
            model: imageModel,
            contents,
            config: { responseModalities: ['IMAGE', 'TEXT'] },
        });
        const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
        if (!imagePart?.inlineData?.data) throw new Error('Google AI returned no generated image.');
        const outputPath = path.join(directory, `image-${index + 1}.png`);
        await fs.writeFile(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));
        paths.push(outputPath);
    }
    return { paths, directory };
};

export const generateGoogleVideo = async (params: { imageUrl: string; prompt: string; aspectRatio?: string; durationSeconds: number }): Promise<{ path: string; directory: string }> => {
    const client = getClient();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'google-ai-video-'));
    try {
        const reference = await downloadReference(params.imageUrl);
        const interaction = await client.interactions.create({
            model: videoModel,
            input: [
                { type: 'image', data: reference.data, mime_type: reference.mimeType },
                { type: 'text', text: `${params.prompt}\n\nCreate a ${params.durationSeconds}-second video.` },
            ],
            response_format: {
                type: 'video',
                aspect_ratio: params.aspectRatio || '9:16',
                resolution: '720p',
            },
        });
        const videoData = interaction.output_video?.data;
        if (!videoData) {
            throw new Error('Google AI returned no generated video.');
        }

        const outputPath = path.join(directory, 'video.mp4');
        await fs.writeFile(outputPath, Buffer.from(videoData, 'base64'));
        return { path: outputPath, directory };
    } catch (error) {
        await cleanupGoogleDirectory(directory);
        throw error;
    }
};

export const cleanupGoogleDirectory = async (directory: string): Promise<void> => {
    await fs.rm(directory, { recursive: true, force: true });
};