// A single component card. Collapsed: live preview + name + badges + short
// purpose + used-in line. Expanded: adds full purpose, props table, the
// dedicated accessibility block, and notes. Progressive disclosure — the
// heavy detail stays hidden until expanded. The preview is the primary object
// and stays visible in both states (stacked on mobile, side-by-side at sm+).

import { ChevronDown } from 'lucide-react';
import type { FlatComponent } from './filter';
import { inferPreviewType, deriveAccessibility } from './inferPreview';
import { ComponentPreview } from './ComponentPreview';
import { CategoryBadge, ComplexityBadge, UsageBadge } from './badges';
import { PropsTable } from './PropsTable';
import { AccessibilityChecklist } from './AccessibilityChecklist';
import { UsedInList } from './UsedInList';

interface Props {
    component: FlatComponent;
    expanded: boolean;
    onToggle: () => void;
}

export function ComponentCard({ component, expanded, onToggle }: Props) {
    const previewType = inferPreviewType(component);
    const usedIn = component.usedIn ?? [];

    return (
        <article className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="flex flex-col sm:flex-row">
                {/* Preview — primary object, top on mobile / left on wider screens */}
                <div className="sm:w-56 sm:shrink-0 p-3 sm:border-r border-b sm:border-b-0 border-neutral-100">
                    <ComponentPreview previewType={previewType} />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 p-4">
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={expanded}
                        className="w-full flex items-start justify-between gap-2 text-left"
                    >
                        <h4 className="font-semibold text-neutral-800 text-sm">{component.name}</h4>
                        <ChevronDown
                            size={18}
                            className={`text-neutral-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                    </button>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <CategoryBadge category={component.category} />
                        <ComplexityBadge complexity={component.complexity} />
                        <UsageBadge count={usedIn.length} />
                    </div>

                    <p className="text-xs text-neutral-600 mt-2 leading-relaxed">{component.purpose}</p>

                    {!expanded && usedIn.length > 0 && (
                        <p className="text-[11px] text-neutral-400 mt-2">
                            Used In: {usedIn.join(' • ')}
                        </p>
                    )}

                    {expanded && (
                        <div className="mt-4 space-y-4">
                            {component.props && component.props.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Props</div>
                                    <PropsTable props={component.props} />
                                </div>
                            )}

                            <AccessibilityChecklist a11y={deriveAccessibility(component)} />

                            {usedIn.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Used In</div>
                                    <UsedInList screens={usedIn} />
                                </div>
                            )}

                            {component.notes && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Notes</div>
                                    <p className="text-xs text-neutral-600 leading-relaxed">{component.notes}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}
