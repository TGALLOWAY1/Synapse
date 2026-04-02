/* eslint-disable react-refresh/only-export-components */
import React from 'react';

interface IntentInfo {
    intent: string;
    helper: string;
}

const INTENT_PATTERNS: { prefix: string; intent: string; helper: string }[] = [
    { prefix: 'clarify', intent: 'Clarify', helper: 'Ask for precision, fix ambiguity, or correct a specific detail tied to this text.' },
    { prefix: 'expand', intent: 'Expand', helper: 'Add depth or options. Generate UX ideas, NB3 prompts, or elaborations.' },
    { prefix: 'specify', intent: 'Specify', helper: 'Turn this into implementable requirements: constraints, acceptance criteria, data/API details.' },
    { prefix: 'alternative', intent: 'Alternative', helper: 'Propose a different approach or architecture and explain tradeoffs.' },
    { prefix: 'replace', intent: 'Replace', helper: 'Suggest a concrete change. The system will apply locally or across the document during consolidation.' },
];

export function getIntentInfo(text: string): IntentInfo | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    const match = INTENT_PATTERNS.find(p => lower.startsWith(p.prefix));
    return match ? { intent: match.intent, helper: match.helper } : null;
}

/** Inline hint used in SelectableSpine's popover */
export function IntentHelperInline({ text }: { text: string }): React.ReactElement | null {
    const info = getIntentInfo(text);
    if (!info) return null;
    return (
        <div className="text-xs text-neutral-400 italic leading-snug bg-neutral-800/50 p-2 rounded border border-neutral-700/50 mb-2">
            {info.helper}
        </div>
    );
}

/** Label + description used in BranchList cards */
export function IntentHelperLabel({ text }: { text: string }): React.ReactElement | null {
    const info = getIntentInfo(text);
    if (!info) return null;
    return (
        <div className="mt-2 text-xs">
            <span className="font-semibold text-neutral-500 uppercase tracking-wider">Intent: {info.intent}</span>
            <p className="text-neutral-400 italic mt-0.5 leading-snug">{info.helper}</p>
        </div>
    );
}
