import { AlertCircle, AlertTriangle } from 'lucide-react';

interface ErrorBannerProps {
    title?: string;
    message: string;
    onDismiss?: () => void;
    onRetry?: () => void;
    variant?: 'error' | 'warning';
}

const VARIANTS = {
    error: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-700',
        dismiss: 'text-red-400 hover:text-red-600',
        icon: AlertCircle,
        retryBg: 'bg-red-600 hover:bg-red-700',
    },
    warning: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        dismiss: 'text-amber-400 hover:text-amber-600',
        icon: AlertTriangle,
        retryBg: 'bg-amber-600 hover:bg-amber-700',
    },
};

export function ErrorBanner({ title, message, onDismiss, onRetry, variant = 'error' }: ErrorBannerProps) {
    const v = VARIANTS[variant];
    const Icon = v.icon;

    return (
        <div className={`${v.bg} border ${v.border} rounded-lg p-4 text-sm ${v.text} flex items-start gap-3`}>
            <Icon size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                {title && <p className="font-medium mb-1">{title}</p>}
                <p>{message}</p>
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className={`mt-2 px-3 py-1 text-xs font-medium text-white rounded ${v.retryBg} transition`}
                    >
                        Try Again
                    </button>
                )}
            </div>
            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    className={`shrink-0 ${v.dismiss} text-xs font-medium`}
                >
                    &times;
                </button>
            )}
        </div>
    );
}
