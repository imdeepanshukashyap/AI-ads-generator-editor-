import { isAxiosError } from 'axios';

type ApiErrorResponse = { message?: string };

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
    if (isAxiosError<ApiErrorResponse>(error)) {
        return error.response?.data?.message || fallback;
    }

    return error instanceof Error ? error.message || fallback : fallback;
};

export const getApiErrorStatus = (error: unknown): number | undefined =>
    isAxiosError(error) ? error.response?.status : undefined;
