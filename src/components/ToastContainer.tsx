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

    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => {
                const style = TOAST_STYLES[toast.type];
                const Icon = style.iconComponent;
                return (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto ${style.bg} ${style.border} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-right-5 duration-200`}
                    >
                        <Icon size={18} className={`shrink-0 mt-0.5 ${style.icon}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-900">{toast.title}</p>
                            {toast.message && (
                                <p className="text-xs text-neutral-600 mt-0.5">{toast.message}</p>
                            )}
                        </div>
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="shrink-0 text-neutral-400 hover:text-neutral-600 transition"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
