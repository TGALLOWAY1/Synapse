import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
    /** Section label shown in the header button. */
    title: string;
    /** Small icon left of the title. */
    icon?: ReactNode;
    /** Optional count badge rendered after the title (e.g. "· 4"). */
    count?: number;
    /** Whether the section starts expanded. Defaults to collapsed. */
    defaultOpen?: boolean;
    /** Optional muted summary shown inline in the header while collapsed. */
    collapsedSummary?: ReactNode;
    children: ReactNode;
}

/**
 * A lightweight progressive-disclosure section used by the User Flows
 * renderer to demote secondary content (Related Artifacts, Edge Cases,
 * Technical Dependencies) below the primary reading flow. Presentation
 * only — no data is removed, just tucked behind a toggle.
 */
export function CollapsibleSection({
    title, icon, count, defaultOpen = false, collapsedSummary, children,
}: Props) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="mb-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-neutral-50 transition-colors"
            >
                <ChevronRight
                    size={14}
                    className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600 inline-flex items-center gap-1.5">
                    {icon}
                    <span>{title}</span>
                    {typeof count === 'number' && count > 0 && (
                        <span className="text-neutral-400 font-normal">· {count}</span>
                    )}
                </span>
                {!open && collapsedSummary && (
                    <span className="ml-auto text-[11px] text-neutral-400 truncate min-w-0">
                        {collapsedSummary}
                    </span>
                )}
            </button>
            {open && <div className="px-3.5 pb-3.5 pt-1">{children}</div>}
        </section>
    );
}
