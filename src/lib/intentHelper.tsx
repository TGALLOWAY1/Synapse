/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { getActionFromIntent } from './prdEditActions';

interface IntentInfo {
    intent: string;
    helper: string;
}

export function getIntentInfo(text: string): IntentInfo | null {
    // Labels and helper copy live in the PRD edit-action registry (single
    // source of truth); this derives the hint from the intent's `"<Label>: "`
    // prefix.
    const action = getActionFromIntent(text);
    return action ? { intent: action.label, helper: action.helper } : null;
}

/** Inline hint used in the selection popover */
export function IntentHelperInline({ text }: { text: string }): React.ReactElement | null {
    const info = getIntentInfo(text);
    if (!info) return null;
    return (
        // Light-themed to match SelectionActionDialog (its only consumer).
        <div className="text-xs text-neutral-500 italic leading-snug bg-neutral-50 p-2 rounded border border-neutral-200 mb-2">
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
