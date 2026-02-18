import type React from "react";


export interface UploadZoneProps {
    label: string;
    file: File | null;
    onClear: () => void;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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