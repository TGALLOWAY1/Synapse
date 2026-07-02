import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Calendar, ChevronRight, Flag, Layers, Target, Users } from 'lucide-react';
import { SectionTabs, type SectionTabItem } from '../SectionTabs';
import {
    parseImplementationPlan,
    parseMilestoneBody,
    type ParsedMilestone,
} from '../../lib/services/implementationPlanParser';
import { buildConsolidatedPlan } from '../../lib/services/implementationPlanAdapter';
import { ConsolidatedPlanView } from './implementationPlan/ConsolidatedPlanView';

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
// Content with no fence and no `### Milestone N:` headings falls through to
// the original milestone-regex timeline / plain-markdown rendering so older
// projects in localStorage always stay readable.

interface Props {
    content: string;
    /**
     * Content of the project's legacy standalone `prompt_pack` artifact, when
     * one exists. Its prompts are adapted into prompt packs inside the
     * consolidated view. Omitted for new projects (packs are native).
     */
    promptPackContent?: string;
}

function inlineMd(text: string) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
            {text}
        </ReactMarkdown>
    );
}

function blockMd(text: string) {
    return (
        <div className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
    );
}

const SECTION_ICON: Record<string, typeof Target> = {
    goal: Target,
    'key deliverables': Layers,
    'technical approach': Layers,
    dependencies: ChevronRight,
    risks: Flag,
    'definition of done': Target,
};

function LegacyMilestoneCard({ milestone }: { milestone: ParsedMilestone }) {
    const { sections, deliverables } = useMemo(() => parseMilestoneBody(milestone.body), [milestone.body]);
    return (
        <article
            id={`milestone-${milestone.id}`}
            className="bg-white rounded-xl border border-neutral-200 p-5 scroll-mt-24"
        >
            <header className="flex items-start gap-3 mb-3 pb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold">
                    M{milestone.id}
                </div>
                <div className="min-w-0">
                    <h3 className="text-base font-bold text-neutral-900 leading-snug">{milestone.title}</h3>
                    {milestone.timeframe && (
                        <p className="flex items-center gap-1 text-[11px] text-neutral-500 mt-0.5">
                            <Calendar size={11} />
                            {milestone.timeframe}
                        </p>
                    )}
                </div>
            </header>

            {deliverables.length > 0 && (
                <div className="mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                        Key Deliverables
                    </p>
                    <ul className="space-y-1">
                        {deliverables.map((d, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                                <input
                                    type="checkbox"
                                    checked={d.checked}
                                    readOnly
                                    aria-label={d.text}
                                    className="mt-1 rounded border-neutral-300 cursor-default"
                                />
                                <span>{inlineMd(d.text)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {sections.length > 0 && (
                <div className="space-y-3">
                    {sections.map((section, i) => {
                        const key = section.label.toLowerCase();
                        const Icon = SECTION_ICON[key] ?? ChevronRight;
                        return (
                            <div key={i}>
                                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                    <Icon size={11} />
                                    {section.label}
                                </p>
                                <div className="text-sm text-neutral-800">
                                    {blockMd(section.body)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </article>
    );
}

function AppendixSection({ markdown }: { markdown: string }) {
    if (!markdown.trim()) return null;
    return (
        <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-5">
            <header className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-neutral-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Notes &amp; Traceability
                </p>
            </header>
            {blockMd(markdown)}
        </div>
    );
}

function LegacyTimeline({ content }: { content: string }) {
    const plan = useMemo(() => parseImplementationPlan(content), [content]);
    if (plan.milestones.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }
    const tabs: SectionTabItem[] = plan.milestones.map(m => ({
        id: `milestone-${m.id}`,
        label: `M${m.id}`,
    }));
    return (
        <div className="space-y-5">
            <SectionTabs items={tabs} />
            {plan.preamble && blockMd(plan.preamble)}
            {plan.milestones.map(m => (
                <LegacyMilestoneCard key={m.id} milestone={m} />
            ))}
            <AppendixSection markdown={plan.appendix} />
        </div>
    );
}

export function ImplementationPlanRenderer({ content, promptPackContent }: Props) {
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
    if (consolidated) {
        return <ConsolidatedPlanView plan={consolidated} />;
    }
    return <LegacyTimeline content={content} />;
}
