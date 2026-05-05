import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, GitBranch, Sparkles, Target } from 'lucide-react';
import { SectionTabs, type SectionTabItem } from '../SectionTabs';

// Render a `user_flows` artifact as one card per `### Flow: …` heading,
// extracting the conventional `**Goal:**`, `**Preconditions:**`, `**Steps:**`,
// `**Success Outcome:**`, `**Error Paths:**`, `**Edge Cases:**` sub-sections.
//
// We keep ReactMarkdown for the actual prose so backticks, links, and
// emphasis still work — the renderer only restructures the layout.

interface Props {
    content: string;
}

type FlowSection = {
    title: string;
    goal?: string;
    preconditions?: string;
    stepsBlock?: string;
    successOutcome?: string;
    errorPaths?: string;
    edgeCases?: string;
    rest?: string;
};

const SECTION_LABELS: Array<[keyof FlowSection, RegExp]> = [
    ['goal', /^\*\*Goal:\*\*\s*/i],
    ['preconditions', /^\*\*Preconditions:\*\*\s*/i],
    ['stepsBlock', /^\*\*Steps:\*\*\s*/i],
    ['successOutcome', /^\*\*Success Outcome:\*\*\s*/i],
    ['errorPaths', /^\*\*Error Paths:\*\*\s*/i],
    ['edgeCases', /^\*\*Edge Cases:\*\*\s*/i],
];

function splitFlows(markdown: string): FlowSection[] {
    const flows: FlowSection[] = [];
    let current: FlowSection | null = null;
    let buffer: { key: keyof FlowSection | null; lines: string[] } = { key: null, lines: [] };
    const flush = () => {
        if (!current || buffer.key === null) {
            buffer = { key: null, lines: [] };
            return;
        }
        const text = buffer.lines.join('\n').trim();
        // We only set string keys here — TS narrows correctly via the closure.
        (current as Record<string, string>)[buffer.key as string] = text;
        buffer = { key: null, lines: [] };
    };

    const lines = markdown.split('\n');
    for (const rawLine of lines) {
        const line = rawLine;
        const headingMatch = line.match(/^#{1,4}\s+Flow:\s*(.+?)\s*$/i);
        if (headingMatch) {
            if (current) {
                flush();
                flows.push(current);
            }
            current = { title: headingMatch[1] };
            buffer = { key: null, lines: [] };
            continue;
        }
        if (!current) continue;
        let matchedKey: keyof FlowSection | null = null;
        for (const [key, re] of SECTION_LABELS) {
            if (re.test(line)) {
                matchedKey = key;
                flush();
                buffer = { key, lines: [line.replace(re, '')] };
                break;
            }
        }
        if (matchedKey) continue;
        buffer.lines.push(line);
    }
    if (current) {
        flush();
        flows.push(current);
    }
    return flows;
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

function StepsList({ block }: { block: string }) {
    // Parse numbered items at column 0 (`1.`, `2.`) and any indented bullets.
    const stepGroups: Array<{ text: string; subs: string[] }> = [];
    let active: { text: string; subs: string[] } | null = null;
    for (const line of block.split('\n')) {
        const top = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (top) {
            if (active) stepGroups.push(active);
            active = { text: top[2], subs: [] };
            continue;
        }
        const sub = line.match(/^\s+[-*]\s+(.*)$/);
        if (sub && active) {
            active.subs.push(sub[1]);
            continue;
        }
        if (active && line.trim().length > 0) {
            // Continuation of the previous step — append onto the current step's main text.
            active.text += ' ' + line.trim();
        }
    }
    if (active) stepGroups.push(active);
    if (stepGroups.length === 0) return blockMd(block);

    return (
        <ol className="space-y-2">
            {stepGroups.map((step, i) => (
                <li key={i} className="flex gap-3">
                    <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                        {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-800 leading-snug">
                            {inlineMd(step.text)}
                        </div>
                        {step.subs.length > 0 && (
                            <ul className="mt-1 space-y-1 pl-2 border-l-2 border-amber-200">
                                {step.subs.map((sub, k) => (
                                    <li
                                        key={k}
                                        className="text-xs text-amber-900 bg-amber-50/50 px-2 py-1 rounded"
                                    >
                                        {inlineMd(sub)}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
}

function FlowCard({ flow, index }: { flow: FlowSection; index: number }) {
    return (
        <article
            id={`flow-${index}`}
            className="bg-white rounded-xl border border-neutral-200 p-5 scroll-mt-24"
        >
            <div className="flex items-start gap-3 mb-3 pb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md bg-indigo-50 text-indigo-600">
                    <GitBranch size={16} />
                </div>
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                        Flow {index + 1}
                    </p>
                    <h3 className="text-base font-bold text-neutral-900 leading-snug">
                        {flow.title}
                    </h3>
                </div>
            </div>

            {flow.goal && (
                <div className="flex items-start gap-2 mb-3">
                    <Target size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                    <div className="text-sm text-neutral-800">
                        <span className="font-semibold text-emerald-700">Goal:</span>{' '}
                        {inlineMd(flow.goal)}
                    </div>
                </div>
            )}
            {flow.preconditions && (
                <div className="text-sm text-neutral-700 mb-3">
                    <span className="font-semibold text-neutral-600">Preconditions:</span>{' '}
                    {inlineMd(flow.preconditions)}
                </div>
            )}
            {flow.stepsBlock && (
                <div className="mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        Steps
                    </p>
                    <StepsList block={flow.stepsBlock} />
                </div>
            )}
            {flow.successOutcome && (
                <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-emerald-50/60 border border-emerald-100 rounded-md">
                    <Sparkles size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                    <div className="text-sm text-neutral-800">
                        <span className="font-semibold text-emerald-700">Success outcome:</span>{' '}
                        {inlineMd(flow.successOutcome)}
                    </div>
                </div>
            )}
            {flow.errorPaths && (
                <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-red-50/60 border border-red-100 rounded-md">
                    <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-600" />
                    <div className="text-sm text-neutral-800 min-w-0">
                        <span className="font-semibold text-red-700">Error paths:</span>
                        <div className="mt-1">{blockMd(flow.errorPaths)}</div>
                    </div>
                </div>
            )}
            {flow.edgeCases && (
                <div className="text-sm text-neutral-600 italic">
                    <span className="font-semibold not-italic">Edge cases:</span>{' '}
                    {inlineMd(flow.edgeCases)}
                </div>
            )}
            {flow.rest && <div className="mt-3">{blockMd(flow.rest)}</div>}
        </article>
    );
}

export function UserFlowsRenderer({ content }: Props) {
    const flows = useMemo(() => splitFlows(content), [content]);
    if (flows.length === 0) {
        // Fall back to plain markdown if we couldn't detect any Flow:
        // headings — preserves backwards-compat with very legacy content.
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }
    const tabs: SectionTabItem[] = flows.map((flow, i) => ({
        id: `flow-${i}`,
        label: flow.title.length > 32 ? `${flow.title.slice(0, 30)}…` : flow.title,
    }));
    return (
        <div className="space-y-4">
            <SectionTabs items={tabs} />
            {flows.map((flow, i) => (
                <FlowCard key={i} flow={flow} index={i} />
            ))}
        </div>
    );
}
