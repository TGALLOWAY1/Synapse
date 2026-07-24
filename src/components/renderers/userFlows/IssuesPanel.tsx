import { AlertTriangle } from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, FlowIssue, FlowIssueKind, ParsedStep } from './types';
import { ISSUE_KIND_META } from './issueMeta';
import { inlineWithFeatures } from './inlineWithFeatures';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
    flowIndex: number;
    issues: FlowIssue[];
    edgeCases?: string;
    steps: ParsedStep[];
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

const KIND_ORDER: FlowIssueKind[] = [
    'alternate_path',
    'edge_case',
    'validation_warning',
    'failure_mode',
];

function splitEdgeCases(block: string): string[] {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const items: string[] = [];
    let buffer = '';
    for (const line of lines) {
        if (/^[-*]\s+/.test(line)) {
            if (buffer) items.push(buffer);
            buffer = line.replace(/^[-*]\s+/, '');
        } else if (buffer) {
            buffer += ' ' + line;
        } else {
            items.push(line);
        }
    }
    if (buffer) items.push(buffer);
    return items;
}

export function IssuesPanel({
    flowIndex, issues, edgeCases, steps, featuresById, onSelectFeature,
}: Props) {
    // Pull edge-case bullets into the panel as `edge_case` issues so authors
    // get a single unified list rather than two parallel sections.
    const edgeCaseItems = edgeCases ? splitEdgeCases(edgeCases) : [];
    const seen = new Set(issues.map(i => i.text));
    const synthesized: FlowIssue[] = edgeCaseItems
        .filter(text => !seen.has(text))
        .map(text => ({ text, kind: 'edge_case' as const }));
    const all = [...issues, ...synthesized];

    if (all.length === 0) return null;

    const grouped: Record<FlowIssueKind, FlowIssue[]> = {
        alternate_path: [],
        edge_case: [],
        validation_warning: [],
        failure_mode: [],
    };
    for (const issue of all) {
        grouped[issue.kind].push(issue);
    }

    const stepLabel = (idx: number | undefined): string | undefined => {
        if (typeof idx !== 'number') return undefined;
        const step = steps[idx];
        if (!step) return undefined;
        return step.title?.trim() || `Step ${idx + 1}`;
    };

    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    return (
        <CollapsibleSection
            title="Alternate paths & edge cases"
            icon={<AlertTriangle size={12} className="text-amber-500" />}
            count={all.length}
        >
            <div className="space-y-3">
                {KIND_ORDER.map(kind => {
                    const list = grouped[kind];
                    if (list.length === 0) return null;
                    const meta = ISSUE_KIND_META[kind];
                    return (
                        <div
                            key={kind}
                            className={`rounded-xl border ${meta.sectionBorder} ${meta.sectionBg} p-3.5`}
                        >
                            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${meta.sectionHeader}`}>
                                {meta.label}{list.length > 1 ? 's' : ''}
                                <span className="ml-1.5 font-normal text-neutral-500">· {list.length}</span>
                            </p>
                            <ul className="space-y-1.5 text-sm text-neutral-800">
                                {list.map((issue, i) => {
                                    const linked = stepLabel(issue.linkedStepIndex);
                                    return (
                                        <li key={i} className="flex gap-2">
                                            <span className={`shrink-0 mt-0.5 inline-block w-1.5 h-1.5 rounded-full ${meta.badgeBg}`} />
                                            <div className="min-w-0 flex-1">
                                                <span>{renderText(issue.text)}</span>
                                                {linked && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const el = document.getElementById(
                                                                `flow-${flowIndex}-step-${issue.linkedStepIndex}`,
                                                            );
                                                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                        }}
                                                        className="ml-2 text-[10px] font-medium text-indigo-600 hover:underline"
                                                    >
                                                        ↗ {linked}
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </div>
        </CollapsibleSection>
    );
}
