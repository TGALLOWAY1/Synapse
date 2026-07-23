import { useEffect, useId, useRef } from 'react';
import { Clock, X } from 'lucide-react';
import { HistoryView } from './HistoryView';

interface HistoryPanelProps {
    open: boolean;
    projectId: string;
    onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function HistoryPanel({ open, projectId, onClose }: HistoryPanelProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (!panelRef.current) return;
            const nestedDialog = panelRef.current.querySelector<HTMLElement>(
                '[role="dialog"][aria-modal="true"]',
            );
            if (nestedDialog?.contains(document.activeElement)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
                FOCUSABLE_SELECTOR,
            )];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus();
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            role="presentation"
            className="fixed inset-0 z-[1000] flex justify-end bg-black/50"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="flex h-[100dvh] w-full flex-col overflow-hidden bg-neutral-50 text-neutral-900 shadow-2xl sm:max-w-2xl"
            >
                <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-2">
                        <Clock size={19} className="shrink-0 text-indigo-600" />
                        <h2 id={titleId} className="truncate text-lg font-bold">
                            Project history
                        </h2>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close project history"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                        <X size={19} />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                    <HistoryView projectId={projectId} showHeader={false} />
                </div>
            </section>
        </div>
    );
}
