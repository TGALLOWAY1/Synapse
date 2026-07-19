import { useToastStore } from '../store/toastStore';
import type { ToastType } from '../store/toastStore';
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string; iconComponent: typeof AlertCircle }> = {
    error:   { bg: 'bg-red-50',    border: 'border-red-200',    icon: 'text-red-500',    iconComponent: AlertCircle },
    warning: { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: 'text-amber-500',  iconComponent: AlertTriangle },
    success: { bg: 'bg-green-50',  border: 'border-green-200',  icon: 'text-green-500',  iconComponent: CheckCircle2 },
    info:    { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'text-blue-500',   iconComponent: Info },
};

export function ToastContainer() {
    const { toasts, removeToast } = useToastStore();

    if (toasts.length === 0) return null;
    const latestToastId = toasts.at(-1)?.id;

    return (
        <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[100] flex w-auto max-w-none flex-col gap-2 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
            {toasts.map(toast => {
                const style = TOAST_STYLES[toast.type];
                const Icon = style.iconComponent;
                return (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto ${latestToastId === toast.id ? 'flex' : 'hidden sm:flex'} ${style.bg} ${style.border} items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-right-5 duration-200`}
                    >
                        <Icon size={18} className={`shrink-0 mt-0.5 ${style.icon}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-900">{toast.title}</p>
                            {toast.message && (
                                <p className="text-xs text-neutral-600 mt-0.5">{toast.message}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label={`Dismiss ${toast.title}`}
                            onClick={() => removeToast(toast.id)}
                            className="-m-3 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-neutral-400 transition hover:text-neutral-600"
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
