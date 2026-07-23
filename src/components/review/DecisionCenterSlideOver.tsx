import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { DecisionCenterContainer } from './DecisionCenterContainer';

interface DecisionCenterSlideOverProps {
    open: boolean;
    projectId: string;
    initialRecordId?: string;
    onClose: () => void;
    onContinueToExplore?: () => void;
}

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Universal Decision Center presentation. It deliberately owns no navigation
 * state; ProjectWorkspace keeps the originating surface mounted and controls
 * the URL intent that opens or closes this layer.
 */
export function DecisionCenterSlideOver({
    open,
    projectId,
    initialRecordId,
    onClose,
    onContinueToExplore,
}: DecisionCenterSlideOverProps) {
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
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !panelRef.current) return;
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
            className="fixed inset-0 z-[1200] flex justify-end bg-black/50"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white text-neutral-900 shadow-2xl md:max-w-[min(92vw,72rem)]"
            >
                <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4">
                    <h2 id={titleId} className="text-base font-semibold text-neutral-950">
                        Decision Center
                    </h2>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close Decision Center"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                        <X size={19} />
                    </button>
                </header>
                <div className="min-h-0 flex-1">
                    <DecisionCenterContainer
                        projectId={projectId}
                        initialRecordId={initialRecordId}
                        onContinueToExplore={onContinueToExplore}
                    />
                </div>
            </section>
        </div>
    );
}
