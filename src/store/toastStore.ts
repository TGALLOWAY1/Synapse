/**
 * Ephemeral toast notification store.
 *
 * Separate from projectStore so toasts are NOT persisted to localStorage.
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type ToastType = 'error' | 'success' | 'warning' | 'info';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration: number; // ms, 0 = sticky (user must dismiss)
}

interface ToastState {
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
    removeToast: (id: string) => void;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
    error: 8000,
    warning: 6000,
    success: 4000,
    info: 5000,
};

const MAX_TOASTS = 5;

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],

    addToast: (toast) => {
        const id = uuidv4();
        const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];
        const newToast: Toast = { ...toast, id, duration };

        set((state) => ({
            toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), newToast],
        }));

        if (duration > 0) {
            setTimeout(() => {
                set((state) => ({
                    toasts: state.toasts.filter(t => t.id !== id),
                }));
            }, duration);
        }
    },

    removeToast: (id) => {
        set((state) => ({
            toasts: state.toasts.filter(t => t.id !== id),
        }));
    },
}));
