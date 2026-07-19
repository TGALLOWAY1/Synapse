import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ListChecks } from 'lucide-react';
import type { ProjectTask } from '../../types';
import type { DependencyNodeStatus } from '../../lib/artifactDependencyGraph';
import { buildConsolidatedPlan } from '../../lib/services/implementationPlanAdapter';
import {
    readPlanProgress,
    type ImplementationPlanProgress,
} from '../../lib/services/implementationPlanInsights';
import { ConsolidatedPlanView } from './implementationPlan/ConsolidatedPlanView';
import type { ImplementationPlanNavigationTarget } from '../../lib/planning/implementationPlanNavigation';

// Render an `implementation_plan` artifact.
//
// The primary path is the consolidated Implementation Plan view
// (Overview / Milestones / Prompt Packs / Quality Gates / Traceability),
// built by `implementationPlanAdapter` from the artifact content plus — for
// legacy projects — the old standalone `prompt_pack` artifact's content
// (threaded through `promptPackContent`). New artifacts carry milestone
// prompt packs natively in the ```json synapse-plan fence; legacy artifacts
// are adapted at render time with no migration.
//
// If `buildConsolidatedPlan` throws on malformed/partial data, we fall back to
// a minimal fallback: a Convert-to-Tasks action row + plain-markdown rendering
// of the raw content, so older/broken projects in localStorage stay readable.

interface Props {
    content: string;
    /**
     * Content of the project's legacy standalone `prompt_pack` artifact, when
     * one exists. Its prompts are adapted into prompt packs inside the
     * consolidated view. Omitted for new projects (packs are native).
     */
    promptPackContent?: string;
    /** "Version 2" — the PRD version this plan was generated from. */
    prdVersionLabel?: string;
    staleness?: DependencyNodeStatus;
    /** Source artifact versions recorded at generation time ("Data Model v1"). */
    sourceVersions?: string[];
    /** Saved (converted) tasks for this artifact — marks plan tasks as tracked. */
    savedTasks?: ProjectTask[];
    /** Opens the Convert-to-Tasks modal (lives in the plan header). */
    onConvertToTasks?: () => void;
    /** Version metadata — carries the persisted `planProgress` overlay. */
    metadata?: Record<string, unknown>;
    /** Persists the copy/gate-status progress overlay onto the version. */
    onUpdatePlanProgress?: (next: ImplementationPlanProgress) => void;
    /** Opens the exact milestone selected from a bounded downstream update plan. */
    initialMilestoneId?: string;
    /** Opens an exact architecture or delivery-plan region when it can be resolved safely. */
    initialNavigationTarget?: ImplementationPlanNavigationTarget;
}

// Minimal fallback for content the consolidated adapter can't build (malformed
// or partial data): a Convert-to-Tasks action row + plain-markdown rendering of
// the raw content, so the plan stays readable and the tasks modal reachable.
function LegacyTimeline({ content, onConvertToTasks, savedTaskCount = 0 }: {
    content: string;
    onConvertToTasks?: () => void;
    savedTaskCount?: number;
}) {
    const convertAction = onConvertToTasks ? (
        <div className="flex items-center justify-end not-prose">
            <button
                type="button"
                onClick={onConvertToTasks}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
            >
                <ListChecks size={12} />
                {savedTaskCount > 0 ? `Manage Tasks (${savedTaskCount})` : 'Convert to Tasks'}
            </button>
        </div>
    ) : null;
    return (
        <div className="space-y-4">
            {convertAction}
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        </div>
    );
}

export function ImplementationPlanRenderer({
    content,
    promptPackContent,
    prdVersionLabel,
    staleness,
    sourceVersions,
    savedTasks,
    onConvertToTasks,
    metadata,
    onUpdatePlanProgress,
    initialMilestoneId,
    initialNavigationTarget,
}: Props) {
    const consolidated = useMemo(
        () => {
            try {
                return buildConsolidatedPlan({ planContent: content, promptPackContent });
            } catch {
                // Malformed/partial data must never break the page — fall back
                // to the legacy renderer, which degrades to plain markdown.
                return null;
            }
        },
        [content, promptPackContent],
    );
    const progress = useMemo(() => readPlanProgress(metadata), [metadata]);
    if (consolidated) {
        return (
            <ConsolidatedPlanView
                key={initialNavigationTarget?.anchorId ?? initialMilestoneId ?? 'implementation-plan'}
                plan={consolidated}
                prdVersionLabel={prdVersionLabel}
                staleness={staleness}
                sourceVersions={sourceVersions}
                savedTasks={savedTasks}
                onConvertToTasks={onConvertToTasks}
                progress={onUpdatePlanProgress ? progress : undefined}
                onUpdateProgress={onUpdatePlanProgress}
                initialMilestoneId={initialMilestoneId}
                initialNavigationTarget={initialNavigationTarget}
            />
        );
    }
    return (
        <LegacyTimeline
            content={content}
            onConvertToTasks={onConvertToTasks}
            savedTaskCount={savedTasks?.length ?? 0}
        />
    );
}
