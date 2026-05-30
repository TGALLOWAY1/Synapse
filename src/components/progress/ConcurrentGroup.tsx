import { Info } from 'lucide-react';
import type { GenerationStep } from './types';
import { StatusIcon, StepBody } from './TimelineStep';

/**
 * A dependency wave that runs in parallel. Rendered as a dashed container with
 * branch connectors so the parallelism reads visually before any text. Children
 * are leaf sections labeled "2A", "2B", … and each carries its own status,
 * model chip, timing, and retry affordance.
 */
export function ConcurrentGroup({
    group,
    isDesktop,
    expandedIds,
    onToggle,
    onRetry,
    retryingStepId,
    isLast,
}: {
    group: GenerationStep;
    isDesktop: boolean;
    expandedIds: Set<string>;
    onToggle: (id: string) => void;
    onRetry?: (sectionId: string) => void;
    retryingStepId?: string;
    isLast?: boolean;
}) {
    const children = group.children ?? [];
    return (
        <div className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
                <StatusIcon status={group.status} />
                {!isLast && <span className="w-px flex-1 bg-neutral-200 mt-1" />}
            </div>
            <div className={`${isLast ? 'pb-0' : 'pb-5'} flex-1 min-w-0`}>
                <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/30 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 mb-2">
                        <Info size={13} className="shrink-0" />
                        Running concurrently
                    </div>
                    <div>
                        {children.map((child, i) => {
                            const isLastChild = i === children.length - 1;
                            return (
                                <div key={child.id} className="flex gap-2">
                                    <div className="relative w-5 shrink-0">
                                        <span
                                            className={`absolute left-0 top-0 w-px bg-indigo-200 ${isLastChild ? 'h-3' : 'h-full'}`}
                                        />
                                        <span className="absolute left-0 top-3 w-4 h-px bg-indigo-200" />
                                    </div>
                                    <div className={`${isLastChild ? '' : 'pb-3'} flex-1 min-w-0`}>
                                        <div className="flex gap-2">
                                            <div className="pt-0.5">
                                                <StatusIcon status={child.status} size="sm" />
                                            </div>
                                            <StepBody
                                                step={child}
                                                isDesktop={isDesktop}
                                                expanded={expandedIds.has(child.id)}
                                                onToggle={() => onToggle(child.id)}
                                                onRetry={onRetry}
                                                retrying={retryingStepId === child.sectionId}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
