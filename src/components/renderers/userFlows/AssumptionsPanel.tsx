import { HelpCircle, Lightbulb } from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, ParsedFlow } from './types';
import { inlineWithFeatures } from './inlineWithFeatures';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
    flow: ParsedFlow;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

function splitBullets(block: string): string[] {
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

/**
 * Surfaces explicit `**Assumptions:**` and `**Open Questions:**`
 * sections from the generated artifact. Hidden entirely when neither
 * section exists so we don't introduce empty cards on legacy data.
 */
export function AssumptionsPanel({ flow, featuresById, onSelectFeature }: Props) {
    const assumptions = flow.assumptions ? splitBullets(flow.assumptions) : [];
    const openQuestions = flow.openQuestions ? splitBullets(flow.openQuestions) : [];
    if (assumptions.length === 0 && openQuestions.length === 0) return null;

    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    return (
        <CollapsibleSection
            title="Assumptions & open questions"
            icon={<Lightbulb size={12} />}
            count={assumptions.length + openQuestions.length}
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {assumptions.length > 0 && (
                    <section className="rounded-xl border border-neutral-200 bg-white p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-2 inline-flex items-center gap-1">
                            <Lightbulb size={11} className="text-amber-600" /> Assumptions
                            <span className="ml-1 font-normal text-neutral-400">· {assumptions.length}</span>
                        </p>
                        <ul className="space-y-1.5 text-sm text-neutral-800">
                            {assumptions.map((a, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="shrink-0 mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    <span className="min-w-0 flex-1">{renderText(a)}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
                {openQuestions.length > 0 && (
                    <section className="rounded-xl border border-neutral-200 bg-white p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-2 inline-flex items-center gap-1">
                            <HelpCircle size={11} className="text-sky-600" /> Open questions
                            <span className="ml-1 font-normal text-neutral-400">· {openQuestions.length}</span>
                        </p>
                        <ul className="space-y-1.5 text-sm text-neutral-800">
                            {openQuestions.map((q, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="shrink-0 mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-sky-400" />
                                    <span className="min-w-0 flex-1">{renderText(q)}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </CollapsibleSection>
    );
}
