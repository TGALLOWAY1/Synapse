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

// Render an `implementation_plan` artifact as a vertical timeline of
// `### Milestone N: …` cards with each milestone's checklist surfaced
// as actual checkboxes (read-only). Anything after the milestones (the
// horizontal rule + "Critical Path Summary" / "Team Size Recommendation"
// / "Traceability Map" sections) is rendered as plain markdown so we
// don't lose any content.

interface Props {
    content: string;
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

function MilestoneCard({ milestone }: { milestone: ParsedMilestone }) {
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

export function ImplementationPlanRenderer({ content }: Props) {
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
                <MilestoneCard key={m.id} milestone={m} />
            ))}
            <AppendixSection markdown={plan.appendix} />
        </div>
    );
}
