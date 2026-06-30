import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Check, Copy, FileCode2, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { CollapsibleArtifactNav } from '../artifact/CollapsibleArtifactNav';
import type { Feature } from '../../types';

// Render a `prompt_pack` artifact as a vertical document — one card per
// `### N. Title` heading — with a Mockups-style collapsible navigator on top
// (CollapsibleArtifactNav) so the prompt content gets the full page width
// instead of competing with a permanent left rail. Each card extracts
// `**Target Tool:**` / `**Reason:**` / `**Category:**` chips and the fenced
// code block that holds the actual prompt body, then surfaces supporting
// context (User Intent / Expected Output / Dependencies / Key Implementation
// Areas) below the body. User edits are stored as a per-prompt overlay on the
// version's metadata; copy uses the edited body.

interface Props {
    content: string;
    /** Feature definitions from the current spine PRD; used to flag dangling feature IDs. */
    features?: Feature[];
    /** User edits keyed by prompt index; falls back to the generated body when absent. */
    edits?: Record<number, string>;
    /** Persist new edit overlay. Pass-through omitted = read-only render. */
    onUpdateEdits?: (next: Record<number, string>) => void;
    /** Creation timestamp of the artifact version, shown as "Generated <date>". */
    generatedAt?: number;
    /** Current artifact version number; powers the "Creates Version X" hint. */
    versionNumber?: number;
}

type PromptCard = {
    index: number;
    title: string;
    targetTool?: string;
    targetReason?: string;
    category?: string;
    promptBody: string;
    expected?: string;
    /** Feature names this prompt declares under "## Features In Scope". */
    dependencies: string[];
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
        dependencies: [],
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
    card.dependencies = parseFeaturesInScope(card.promptBody);
    return card;
}

// Pull the feature names a prompt declares under its "## Features In Scope"
// section. Lines look like `- f1 — Feature Name` (id prefix + em dash) with
// indented detail bullets beneath; we keep the top-level names only.
function parseFeaturesInScope(body: string): string[] {
    if (!body) return [];
    const lines = body.split('\n');
    let inScope = false;
    const names: string[] = [];
    for (const raw of lines) {
        const heading = raw.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            const name = heading[1].toLowerCase();
            inScope = name.includes('features in scope') || name.includes('feature in scope');
            continue;
        }
        if (!inScope) continue;
        // Top-level bullet only (indented detail bullets start with spaces).
        const bullet = raw.match(/^[-*]\s+(.+)$/);
        if (!bullet) continue;
        const text = bullet[1].trim();
        // Strip a leading `f1 —` / `F-014 -` id prefix when present.
        const withId = text.match(/^[fF]-?\d+\s*[—–-]\s*(.+)$/);
        const cleaned = (withId ? withId[1] : text).replace(/[*_`]/g, '').trim();
        if (cleaned) names.push(cleaned);
    }
    return Array.from(new Set(names));
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

function promptAnchorId(index: number): string {
    return `prompt-pack-prompt-${index}`;
}

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
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
                    <Copy size={12} /> Copy Prompt
                </>
            )}
        </button>
    );
}

// A labelled supporting-context card shown below the prompt body. Renders
// nothing when it has no content, so older prompts (which may lack a field)
// degrade gracefully.
function SupportingCard({
    label,
    accent,
    children,
}: {
    label: string;
    accent: string;
    children: React.ReactNode;
}) {
    return (
        <div className="px-4 py-3 border-t border-neutral-100">
            <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${accent}`}>
                {label}
            </p>
            {children}
        </div>
    );
}

function ChipRow({ items }: { items: string[] }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((item, i) => (
                <span
                    key={`${item}-${i}`}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 border border-neutral-200"
                >
                    {item}
                </span>
            ))}
        </div>
    );
}

interface PromptCardViewProps {
    card: PromptCard;
    effectiveBody: string;
    modified: boolean;
    unresolvedIds: string[];
    canEdit: boolean;
    generatedAt?: number;
    onEdit: (next: string) => void;
    onReset: () => void;
}

function PromptCardView({
    card,
    effectiveBody,
    modified,
    unresolvedIds,
    canEdit,
    generatedAt,
    onEdit,
    onReset,
}: PromptCardViewProps) {
    const [editing, setEditing] = useState(false);
    const hasWarning = unresolvedIds.length > 0;
    const copyDisabled = hasWarning;
    const implementationAreas = [
        ...(card.category ? [card.category] : []),
        ...(card.targetTool ? [card.targetTool] : []),
    ];
    return (
        <article className="bg-white rounded-xl border border-neutral-200 overflow-hidden">

            {/* --- Lightweight header: number, title, category, date ------- */}
            <header className="px-4 py-3 border-b border-neutral-100">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                            Prompt {card.index}
                        </p>
                        <h3 className="text-sm font-bold text-neutral-900 leading-snug mt-0.5">
                            {card.title}
                        </h3>
                        {card.category && (
                            <p className="text-xs text-neutral-500 mt-0.5">{card.category}</p>
                        )}
                    </div>
                    {modified && (
                        <span className="shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Modified
                        </span>
                    )}
                </div>
                {generatedAt !== undefined && (
                    <p className="text-[11px] text-neutral-400 mt-1.5">
                        Generated {formatDate(generatedAt)}
                    </p>
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
                            {editing && modified && (
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

            {/* --- Prompt body: rendering preserved exactly as before ------ */}
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

            {/* --- Supporting context (reorganized below the body) --------- */}
            {card.targetReason && (
                <SupportingCard label="User Intent" accent="text-indigo-600">
                    <p className="text-sm text-neutral-700 leading-relaxed">{card.targetReason}</p>
                </SupportingCard>
            )}
            {card.expected && (
                <SupportingCard label="Expected Output" accent="text-emerald-700">
                    <div className="prose prose-sm prose-neutral max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.expected}</ReactMarkdown>
                    </div>
                </SupportingCard>
            )}
            {card.dependencies.length > 0 && (
                <SupportingCard label="Dependencies" accent="text-neutral-500">
                    <ChipRow items={card.dependencies} />
                </SupportingCard>
            )}
            {implementationAreas.length > 0 && (
                <SupportingCard label="Key Implementation Areas" accent="text-neutral-500">
                    <ChipRow items={implementationAreas} />
                </SupportingCard>
            )}
        </article>
    );
}

export function PromptPackRenderer({
    content,
    features,
    edits,
    onUpdateEdits,
    generatedAt,
    versionNumber,
}: Props) {
    const { preamble, cards } = useMemo(() => parsePromptPack(content), [content]);
    const editsMap = edits ?? {};
    const canEdit = typeof onUpdateEdits === 'function';

    if (cards.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    const sectionIds = cards.map(c => promptAnchorId(c.index));
    const nextVersion = versionNumber !== undefined ? versionNumber + 1 : undefined;

    return (
        <div className="space-y-4">
            {preamble && (
                <div className="prose prose-sm prose-neutral max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
                </div>
            )}

            <CollapsibleArtifactNav
                label="Prompts"
                icon={FileCode2}
                sectionIds={sectionIds}
                renderRow={(idx, active) => {
                    const c = cards[idx];
                    const rowModified = editsMap[c.index] !== undefined && editsMap[c.index] !== c.promptBody;
                    return (
                        <>
                            <span
                                className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-semibold tabular-nums ${
                                    active ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'
                                }`}
                            >
                                {c.index}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="flex items-center gap-1.5">
                                    <span
                                        className={`block text-sm font-semibold truncate ${
                                            active ? 'text-indigo-900' : 'text-neutral-900'
                                        }`}
                                    >
                                        {c.title}
                                    </span>
                                    {rowModified && (
                                        <span className="shrink-0 text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                            Edited
                                        </span>
                                    )}
                                </span>
                                {c.category && (
                                    <span className="block text-xs text-neutral-500 truncate">
                                        {c.category}
                                    </span>
                                )}
                            </span>
                        </>
                    );
                }}
            />

            {/* Document layout: every prompt rendered in order. */}
            {cards.map(card => {
                const overlay = editsMap[card.index];
                const effectiveBody = overlay !== undefined ? overlay : card.promptBody;
                const modified = overlay !== undefined && overlay !== card.promptBody;
                const unresolvedIds = findUnresolvedFeatureIds(effectiveBody, features ?? []);
                return (
                    <section
                        key={card.index}
                        id={promptAnchorId(card.index)}
                        className="scroll-mt-20"
                    >
                        <PromptCardView
                            card={card}
                            effectiveBody={effectiveBody}
                            modified={modified}
                            unresolvedIds={unresolvedIds}
                            canEdit={canEdit}
                            generatedAt={generatedAt}
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
                    </section>
                );
            })}

            {/* Subtle, informational "Safe to regenerate" callout. */}
            <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                <ShieldCheck size={15} className="text-neutral-400 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-neutral-500 leading-relaxed">
                    <span className="font-medium text-neutral-600">Safe to regenerate.</span>{' '}
                    {nextVersion !== undefined
                        ? `Regenerating creates Version ${nextVersion}. `
                        : ''}
                    Your current prompts remain available in version history.
                </p>
            </div>
        </div>
    );
}
