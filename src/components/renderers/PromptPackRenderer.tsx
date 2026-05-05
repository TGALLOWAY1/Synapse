import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Sparkles } from 'lucide-react';
import { SectionTabs, type SectionTabItem } from '../SectionTabs';

// Render a `prompt_pack` artifact as one card per `### N. Title` heading,
// extracting `**Target Tool:**` / `**Category:**` chips and the fenced
// code block that holds the actual prompt body. Each card has a
// "Copy prompt" button that copies the prompt text to the clipboard.

interface Props {
    content: string;
}

type PromptCard = {
    index: number;
    title: string;
    targetTool?: string;
    category?: string;
    promptBody: string;
    expected?: string;
};

const PROMPT_HEADING = /^###\s+(\d+)\.?\s+(.+?)\s*$/;

function parsePromptPack(markdown: string): { preamble: string; cards: PromptCard[] } {
    const lines = markdown.split('\n');
    const preambleLines: string[] = [];
    const cards: PromptCard[] = [];
    let active: { rawLines: string[]; index: number; title: string } | null = null;
    let inMilestones = false;

    for (const line of lines) {
        const heading = line.match(PROMPT_HEADING);
        if (heading) {
            if (active) cards.push(buildCard(active));
            active = { rawLines: [], index: Number(heading[1]), title: heading[2] };
            inMilestones = true;
            continue;
        }
        if (active) {
            active.rawLines.push(line);
        } else if (!inMilestones) {
            preambleLines.push(line);
        }
    }
    if (active) cards.push(buildCard(active));
    return { preamble: preambleLines.join('\n').trim(), cards };
}

function buildCard(active: { rawLines: string[]; index: number; title: string }): PromptCard {
    const card: PromptCard = {
        index: active.index,
        title: active.title,
        promptBody: '',
    };
    let inFence = false;
    const promptLines: string[] = [];
    let collectExpected = false;
    const expectedLines: string[] = [];

    for (const line of active.rawLines) {
        if (/^```/.test(line.trim())) {
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            promptLines.push(line);
            continue;
        }
        const tool = line.match(/^\*\*Target Tool:\*\*\s*(.+)$/i);
        if (tool) {
            card.targetTool = tool[1].trim();
            continue;
        }
        const cat = line.match(/^\*\*Category:\*\*\s*(.+)$/i);
        if (cat) {
            card.category = cat[1].trim();
            continue;
        }
        const exp = line.match(/^\*\*Expected Output:\*\*\s*(.*)$/i);
        if (exp) {
            collectExpected = true;
            if (exp[1].trim()) expectedLines.push(exp[1].trim());
            continue;
        }
        if (collectExpected) {
            expectedLines.push(line);
        }
    }
    card.promptBody = promptLines.join('\n').trim();
    if (expectedLines.length > 0) {
        card.expected = expectedLines.join('\n').trim();
    }
    return card;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch {
                    // Clipboard API not available — silently no-op.
                }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition"
        >
            {copied ? (
                <>
                    <Check size={12} /> Copied
                </>
            ) : (
                <>
                    <Copy size={12} /> Copy prompt
                </>
            )}
        </button>
    );
}

function PromptCardView({ card }: { card: PromptCard }) {
    return (
        <article
            id={`prompt-${card.index}`}
            className="bg-white rounded-xl border border-neutral-200 overflow-hidden scroll-mt-24"
        >
            <header className="px-4 py-3 border-b border-neutral-100 flex flex-wrap items-start gap-3 justify-between">
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                        Prompt {card.index}
                    </p>
                    <h3 className="text-sm font-bold text-neutral-900 leading-snug mt-0.5">
                        {card.title}
                    </h3>
                    {(card.targetTool || card.category) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {card.targetTool && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    <Sparkles size={10} />
                                    {card.targetTool}
                                </span>
                            )}
                            {card.category && (
                                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700">
                                    {card.category}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {card.promptBody && <CopyButton text={card.promptBody} />}
            </header>
            {card.promptBody && (
                <div className="bg-neutral-900 text-neutral-100 px-4 py-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                    {card.promptBody}
                </div>
            )}
            {card.expected && (
                <div className="px-4 py-3 border-t border-neutral-100 bg-emerald-50/40">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                        Expected output
                    </p>
                    <div className="prose prose-sm prose-neutral max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.expected}</ReactMarkdown>
                    </div>
                </div>
            )}
        </article>
    );
}

export function PromptPackRenderer({ content }: Props) {
    const { preamble, cards } = useMemo(() => parsePromptPack(content), [content]);
    if (cards.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }
    const tabs: SectionTabItem[] = cards.map(card => ({
        id: `prompt-${card.index}`,
        label: `${card.index}. ${card.title.length > 24 ? card.title.slice(0, 22) + '…' : card.title}`,
    }));
    return (
        <div className="space-y-4">
            <SectionTabs items={tabs} />
            {preamble && (
                <div className="prose prose-sm prose-neutral max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
                </div>
            )}
            {cards.map(card => (
                <PromptCardView key={card.index} card={card} />
            ))}
        </div>
    );
}
