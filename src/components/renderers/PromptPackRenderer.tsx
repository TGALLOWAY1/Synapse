import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Check, Copy, Pencil, RotateCcw } from 'lucide-react';
import { PromptPackSidebar, type PromptNavItem } from './PromptPackSidebar';
import type { Feature } from '../../types';

// Render a `prompt_pack` artifact as one card per `### N. Title` heading,
// extracting `**Target Tool:**` / `**Reason:**` / `**Category:**` chips and
// the fenced code block that holds the actual prompt body. Each card has a
// "Copy prompt" button and an editable mode. User edits are stored as a
// per-prompt overlay on the version's metadata; copy uses the edited body.

interface Props {
    content: string;
    /** Feature definitions from the current spine PRD; used to flag dangling feature IDs. */
    features?: Feature[];
    /** User edits keyed by prompt index; falls back to the generated body when absent. */
    edits?: Record<number, string>;
    /** Persist new edit overlay. Pass-through omitted = read-only render. */
    onUpdateEdits?: (next: Record<number, string>) => void;
}

type PromptCard = {
    index: number;
    title: string;
    targetTool?: string;
    targetReason?: string;
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
        const reason = line.match(/^\*\*Reason:\*\*\s*(.+)$/i);
        if (reason) {
            card.targetReason = reason[1].trim();
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

// Find feature IDs (e.g. f1, F-014) that appear OUTSIDE a "## Features In
// Scope" section. Dangling IDs aren't usable when the prompt is copied
// standalone — they confuse the recipient agent.
function findUnresolvedFeatureIds(body: string, features: Feature[]): string[] {
    if (!body) return [];
    const lines = body.split('\n');
    let inScope = false;
    let inOtherSection = false;
    const danglingLines: string[] = [];
    for (const line of lines) {
        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            const name = heading[1].toLowerCase();
            inScope = name.includes('features in scope') || name.includes('feature in scope');
            inOtherSection = !inScope;
            continue;
        }
        if (!inScope) {
            danglingLines.push(line);
        }
        // suppress unused-var lint for tracking variable
        void inOtherSection;
    }
    const outside = danglingLines.join('\n');
    // Match either `f<digits>` (canonical) or `F-<digits>` (legacy) tokens.
    const tokenRegex = /\b[fF]-?\d+\b/g;
    const found = outside.match(tokenRegex) ?? [];
    if (found.length === 0) return [];
    const knownIds = new Set(features.map(f => f.id.toLowerCase()));
    const unique = Array.from(new Set(found));
    // A token is "unresolved" if it doesn't appear in the known feature list
    // either way; alternatively, every appearance of a known ID outside the
    // scope section is also unresolved (bare ref). We treat both as
    // unresolved so the warning catches the user pasting a stale ID.
    return unique.filter(token => {
        // Always flag tokens that aren't known features at all.
        if (!knownIds.has(token.toLowerCase())) return true;
        // Known IDs leaking outside Features In Scope are also unresolved
        // (the ID is bare without its definition).
        return true;
    });
}

interface CopyButtonProps {
    text: string;
    disabled?: boolean;
    disabledReason?: string;
}

function CopyButton({ text, disabled, disabledReason }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : 'Copy this prompt to the clipboard'}
            onClick={async () => {
                if (disabled) return;
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch {
                    // Clipboard API not available — silently no-op.
                }
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                disabled
                    ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
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

interface PromptCardViewProps {
    card: PromptCard;
    effectiveBody: string;
    modified: boolean;
    unresolvedIds: string[];
    canEdit: boolean;
    onEdit: (next: string) => void;
    onReset: () => void;
}

function PromptCardView({
    card,
    effectiveBody,
    modified,
    unresolvedIds,
    canEdit,
    onEdit,
    onReset,
}: PromptCardViewProps) {
    const [editing, setEditing] = useState(false);
    const hasWarning = unresolvedIds.length > 0;
    const copyDisabled = hasWarning;
    return (
        <article className="bg-white rounded-xl border border-neutral-200 overflow-hidden">

            <header className="px-4 py-3 border-b border-neutral-100">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                    Prompt {card.index}
                </p>
                <h3 className="text-sm font-bold text-neutral-900 leading-snug mt-0.5">
                    {card.title}
                </h3>
                {(card.category || modified) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {card.category && (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700">
                                {card.category}
                            </span>
                        )}
                        {modified && (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                Modified
                            </span>
                        )}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {canEdit && (
                        <>
                            <button
                                type="button"
                                onClick={() => setEditing(prev => !prev)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
                            >
                                {editing ? <Check size={12} /> : <Pencil size={12} />}
                                {editing ? 'Done' : 'Edit'}
                            </button>
                            {modified && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onReset();
                                        setEditing(false);
                                    }}
                                    title="Restore the originally generated prompt"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
                                >
                                    <RotateCcw size={12} />
                                    Reset
                                </button>
                            )}
                        </>
                    )}
                    {effectiveBody && (
                        <CopyButton
                            text={effectiveBody}
                            disabled={copyDisabled}
                            disabledReason="Resolve dangling feature references before copying."
                        />
                    )}
                </div>
            </header>
            {hasWarning && (
                <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-rose-800 leading-snug">
                        <span className="font-semibold">Unresolved feature references:</span>{' '}
                        {unresolvedIds.join(', ')}. Copy is disabled — these IDs aren't expanded
                        inside &quot;Features In Scope,&quot; so the recipient agent won't know
                        what they mean. Edit the prompt or regenerate the artifact.
                    </p>
                </div>
            )}
            {editing && canEdit ? (
                <textarea
                    value={effectiveBody}
                    onChange={e => onEdit(e.target.value)}
                    className="w-full bg-neutral-900 text-neutral-100 px-4 py-3 text-xs font-mono leading-relaxed min-h-[18rem] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    spellCheck={false}
                />
            ) : (
                effectiveBody && (
                    <div className="bg-neutral-900 text-neutral-100 px-4 py-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                        {effectiveBody}
                    </div>
                )
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

export function PromptPackRenderer({ content, features, edits, onUpdateEdits }: Props) {
    const { preamble, cards } = useMemo(() => parsePromptPack(content), [content]);
    const editsMap = edits ?? {};
    const canEdit = typeof onUpdateEdits === 'function';

    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    if (cards.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    const safeIndex = Math.min(selectedIndex, cards.length - 1);
    const card = cards[safeIndex];
    const overlay = editsMap[card.index];
    const effectiveBody = overlay !== undefined ? overlay : card.promptBody;
    const modified = overlay !== undefined && overlay !== card.promptBody;
    const unresolvedIds = findUnresolvedFeatureIds(effectiveBody, features ?? []);

    const navItems: PromptNavItem[] = cards.map(c => ({
        index: c.index,
        title: c.title,
        category: c.category,
    }));
    const modifiedIndices = new Set(
        cards
            .filter(c => editsMap[c.index] !== undefined && editsMap[c.index] !== c.promptBody)
            .map(c => c.index),
    );

    return (
        <div className="md:flex md:gap-5 md:items-start">
            <PromptPackSidebar
                items={navItems}
                selectedIndex={safeIndex}
                onSelect={setSelectedIndex}
                isMobileOpen={mobileNavOpen}
                onToggleMobile={setMobileNavOpen}
                modifiedIndices={modifiedIndices}
            />
            <div className="flex-1 min-w-0 space-y-4">
                {preamble && (
                    <div className="prose prose-sm prose-neutral max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
                    </div>
                )}
                <PromptCardView
                    key={card.index}
                    card={card}
                    effectiveBody={effectiveBody}
                    modified={modified}
                    unresolvedIds={unresolvedIds}
                    canEdit={canEdit}
                    onEdit={next => {
                        if (!canEdit) return;
                        onUpdateEdits!({ ...editsMap, [card.index]: next });
                    }}
                    onReset={() => {
                        if (!canEdit) return;
                        const { [card.index]: _omit, ...rest } = editsMap;
                        void _omit;
                        onUpdateEdits!(rest);
                    }}
                />
            </div>
        </div>
    );
}
