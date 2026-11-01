import type React from "react";


export interface UploadZoneProps {
    label: string;
    file: File | null;
    onClear: () => void;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    previewUrl?: string;
    previewLabel?: string;
    onChooseLibrary?: () => void;
}

export interface User {
    id?: string;
    name?: string;
    email?: string;
}

export interface Project {
    id: string;
    name?: string;
    userId?: string;
    user?: User;
    productName: string;
    productDescription?: string;
    userPrompt?: string;
    aspectRatio: string;
    targetLength?: number;
    language?: string;
    generatedImage?: string;          // Single image generation (5 credits)
    generatedImages?: string[];       // 3-image bundle generation (15 credits)
    generatedVideo?: string;
    isGenerating: boolean;
    isPublished: boolean;
    error?: string;
    createdAt: Date | string;
    updatedAt?: Date | string;
    uploadedImages: string[];
}

export interface SocialAccount {
    id: string;
    platform: 'instagram' | 'facebook' | 'youtube';
    externalId: string;
    displayName: string;
    needsReconnect: boolean;
    tokenExpiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ScheduledPost {
    id: string;
    userId: string;
    projectId: string;
    socialAccountId: string;
    mediaType: 'image' | 'video';
    mediaUrl: string;
    caption: string;
    aiDisclosure: boolean;
    scheduledFor?: string | null;
    status: 'scheduled' | 'publishing' | 'published' | 'failed';
    externalPostId?: string | null;
    externalUrl?: string | null;
    error?: string | null;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    socialAccount?: {
        platform: 'instagram' | 'facebook' | 'youtube';
        displayName: string;
    };
    project?: {
        name: string;
        productName: string;
    };
}
