// The **Components** section of the Screens experience.
//
// W4 of docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md deliberately surfaces the
// `component_inventory` artifact HERE rather than as a new top-level sidebar
// row: it is a bridge artifact between screens and implementation, and a
// separate row would re-fragment the same surface (the audit's consolidation
// preference — the same reasoning that folded Screen Inventory + Mockups into
// the Screens view). So `component_inventory` stays out of `ARTIFACT_GROUPS`
// even though it is no longer a hidden subtype.
//
// Because the artifact now has no row of its own, this section is also the ONLY
// place its slot status is visible and the only place it can be retried. That
// affordance is load-bearing: `component_inventory` now gates
// `ProjectWorkspace.assetsReady` and is auto-resumed by
// `artifactJobController.resumeIfNeeded`, which is only acceptable while the
// user can see and retry it (see the HIDDEN_ARTIFACT_SUBTYPES rule in
// `coreArtifactPipeline.ts`).
//
// Presentation only — the content, back-references and advisories all come from
// existing artifact contents and the derived `componentExperience` join.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Blocks, ChevronDown, ChevronUp, Loader2, RefreshCcw } from 'lucide-react';
import type { GenerationStatus } from '../../types';
import { parseComponentInventoryMarkdown } from '../../lib/componentInventoryParse';
import {
    buildComponentInventoryModel,
    type ComponentJoinScreen,
} from '../../lib/componentExperience';
import { ArtifactContentRenderer } from '../renderers';

interface Props {
    /** Preferred `component_inventory` version content, when one exists. */
    content?: string;
    /** Screens projected from the canonical Screens index. */
    screens: readonly ComponentJoinScreen[];
    /** Live slot status for the `component_inventory` slot. */
    status: GenerationStatus;
    /** Slot error message, when the slot failed. */
    errorMessage?: string;
    /** Opens and focuses this hosted slot for an exact navigation action. */
    initiallyOpen?: boolean;
    /** Keeps the slot visible when an action is explaining that it is missing. */
    showWhenEmpty?: boolean;
    /** Retry the slot. Omitted when the project can't generate (demo/keyless). */
    onRetry?: () => void;
    /** Open a screen by slug (the Screens view's navigation key). */
    onNavigateToScreen?: (screenSlug: string) => void;
}

export function ScreenComponentsSection({
    content,
    screens,
    status,
    errorMessage,
    initiallyOpen = false,
    showWhenEmpty = false,
    onRetry,
    onNavigateToScreen,
}: Props) {
    const model = useMemo(
        () => buildComponentInventoryModel(parseComponentInventoryMarkdown(content ?? ''), screens),
        [content, screens],
    );
    const summary = model.summary;
    const inFlight = status === 'generating' || status === 'queued';
    const failed = status === 'error' || status === 'interrupted';
    const [open, setOpen] = useState(initiallyOpen);
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!initiallyOpen) return;
        sectionRef.current?.scrollIntoView?.({ block: 'center' });
        sectionRef.current?.focus({ preventScroll: true });
    }, [initiallyOpen]);

    // Nothing generated and nothing happening → render nothing rather than an
    // empty nag. A failed/in-flight slot always shows, so the status is never
    // invisible (that was the defect that justified hiding this artifact).
    if (!content && !inFlight && !failed && !showWhenEmpty) return null;

    const headline = inFlight
        ? 'Generating the component inventory…'
        : failed
            ? status === 'error' ? 'Component inventory generation failed' : 'Component inventory generation was interrupted'
            : summary.componentCount > 0
                ? `${summary.componentCount} component${summary.componentCount === 1 ? '' : 's'}`
                    + (summary.joinAvailable ? ` · ${summary.referencedCount} referenced by a screen` : '')
                : content ? 'Reusable components and patterns' : 'Component inventory not generated';

    const advisoryCount = model.issues.filter(issue => issue.severity === 'review').length;

    return (
        <div
            ref={sectionRef}
            id="screens-components"
            tabIndex={-1}
            className="mx-auto max-w-3xl xl:max-w-5xl"
        >
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50"
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${failed ? 'bg-amber-50' : 'bg-indigo-50'}`}>
                            {inFlight
                                ? <Loader2 size={14} className="animate-spin text-sky-500" />
                                : failed
                                    ? <AlertTriangle size={14} className={status === 'error' ? 'text-red-500' : 'text-amber-500'} />
                                    : <Blocks size={14} className="text-indigo-600" />}
                        </div>
                        <div className="min-w-0 text-left">
                            <h3 className="text-sm font-semibold text-neutral-900">Components</h3>
                            <p className={`text-[11px] ${failed ? 'text-amber-700' : 'text-neutral-500'}`}>{headline}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {advisoryCount > 0 && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                                {advisoryCount} to review
                            </span>
                        )}
                        {open ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
                    </div>
                </button>

                {open && (
                    <div className="border-t border-neutral-100 px-4 pb-4 pt-3">
                        {failed && (
                            <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                {errorMessage && <p className="break-words text-xs text-neutral-600">{errorMessage}</p>}
                                <p className="mt-1 text-[11px] text-neutral-500">
                                    Mockups use this inventory to tag which components each screen composes, so a missing
                                    inventory means less specific mockups.
                                </p>
                                {onRetry && (
                                    <button
                                        type="button"
                                        onClick={onRetry}
                                        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700"
                                    >
                                        <RefreshCcw size={13} /> Retry
                                    </button>
                                )}
                            </div>
                        )}
                        {inFlight && !content && (
                            <p className="text-xs text-neutral-500">
                                The component inventory is still being generated — it will appear here when it lands.
                            </p>
                        )}
                        {!content && !inFlight && !failed && (
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                <p className="text-xs text-neutral-600">
                                    Generate the component inventory to review reusable UI patterns and their screen references.
                                </p>
                                {onRetry && (
                                    <button
                                        type="button"
                                        onClick={onRetry}
                                        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700"
                                    >
                                        <RefreshCcw size={13} /> Generate
                                    </button>
                                )}
                            </div>
                        )}
                        {content && (
                            <ArtifactContentRenderer
                                subtype="component_inventory"
                                content={content}
                                componentScreens={screens}
                                onNavigateToScreen={onNavigateToScreen}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
