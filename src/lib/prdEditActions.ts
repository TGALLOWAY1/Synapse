// PRD edit-action registry — the single source of truth for the highlight →
// refine gesture.
//
// Historically the actions were a bare string tuple (`SELECTION_ACTIONS`) whose
// only behavioural effect was prefixing the user's intent with `"<Label>: "`
// before it hit ONE generic `replyInBranch` prompt — so "Specify" produced
// nothing structurally different from "Expand". This registry gives every
// action a real, specialized system prompt (so the output is genuinely
// distinct), an icon, inline helper copy, and an interaction `mode`.
//
// Consumers derive from this list rather than restating it:
//   - `SelectionActionDialog.tsx` renders the chips
//   - `intentHelper.tsx` derives its label/helper hints
//   - `branchService.replyInBranch` selects the system prompt by action id
// The interactive tour (`src/components/tour/`) keeps its own self-contained
// demo scripts and demos a representative subset of these actions.

import {
    Sparkles,
    Maximize2,
    SlidersHorizontal,
    Shuffle,
    RefreshCw,
    ShieldQuestion,
    type LucideIcon,
} from 'lucide-react';

export type PrdEditActionId =
    | 'clarify'
    | 'expand'
    | 'specify'
    | 'alternative'
    | 'replace'
    | 'critique';

/**
 * How an action is expected to be worked:
 * - `chat` — open-ended; the branch conversation is the natural home.
 * - `draft` — the user wants a concrete change back; suited to a one-shot
 *   draft-and-preview (still available in the conversation too).
 */
export type PrdEditActionMode = 'chat' | 'draft';

export interface PrdEditAction {
    id: PrdEditActionId;
    /** Display label + the intent prefix (`"<label>: "`). */
    label: string;
    icon: LucideIcon;
    /** Inline hint shown under the chips and on branch cards. */
    helper: string;
    /** Specialized system prompt for `replyInBranch`. */
    systemPrompt: string;
    mode: PrdEditActionMode;
}

// A shared preamble keeps tone/format consistent across actions without
// restating it in each prompt.
const SHARED_PREAMBLE =
    'You are a senior product manager helping a user refine a specific passage of a PRD. '
    + 'You are given the selected text and the conversation so far. Use formal, professional, '
    + 'implementation-ready language and avoid hedging. Stay tightly scoped to the selected '
    + 'passage — do not restate or rewrite the rest of the document.';

// Every action that can yield a concrete edit ends by emitting a machine-
// readable replacement block, so the consolidation/draft path can lift it out.
const REPLACEMENT_CONTRACT =
    'When (and only when) you are proposing concrete new wording for the selected text, end '
    + 'your response with a line `Suggested replacement for selected text:` followed by the '
    + 'replacement on the next lines, and nothing after it.';

export const PRD_EDIT_ACTIONS: readonly PrdEditAction[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: Sparkles,
        helper: 'Ask for precision, fix ambiguity, or correct a specific detail tied to this text.',
        mode: 'chat',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants to CLARIFY this passage. Identify what is ambiguous, `
            + 'underspecified, or open to more than one reading. If a single precise interpretation is '
            + 'obvious from context, state it and propose sharper wording. If it genuinely depends on a '
            + 'product decision the user must make, ask exactly one focused question rather than guessing. '
            + `Do not add new scope. ${REPLACEMENT_CONTRACT}`,
    },
    {
        id: 'expand',
        label: 'Expand',
        icon: Maximize2,
        helper: 'Add depth or options — elaborate the idea, surface UX considerations or edge cases.',
        mode: 'chat',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants to EXPAND this passage — add useful depth without padding. `
            + 'Elaborate the intent, surface relevant considerations, edge cases, or UX ideas that the '
            + 'current wording leaves implicit. Keep every addition grounded in what the passage is already '
            + `about; do not invent unrelated features. ${REPLACEMENT_CONTRACT}`,
    },
    {
        id: 'specify',
        label: 'Specify',
        icon: SlidersHorizontal,
        helper: 'Turn this into implementable requirements: constraints, acceptance criteria, data/API details.',
        mode: 'draft',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants to SPECIFY this passage — make it implementable. Convert it `
            + 'into concrete requirements: explicit constraints, measurable acceptance criteria (happy path '
            + 'plus the notable edge/error states), and any data shapes, states, or interface details a '
            + 'builder would need. Prefer tight, checkable bullet points over prose. Flag as an open '
            + `question anything you cannot specify without a decision from the user. ${REPLACEMENT_CONTRACT}`,
    },
    {
        id: 'alternative',
        label: 'Alternative',
        icon: Shuffle,
        helper: 'Propose a different approach or framing and explain the tradeoffs.',
        mode: 'chat',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants ALTERNATIVES to this passage. Propose two or three genuinely `
            + 'different approaches, framings, or directions — not cosmetic rephrasings. For each, give it a '
            + 'short name, describe it in one or two sentences, and state its main tradeoff (what it wins and '
            + 'what it costs) relative to the current text. End with a one-line recommendation and why. Only '
            + `emit a replacement block if the user then picks one. ${REPLACEMENT_CONTRACT}`,
    },
    {
        id: 'replace',
        label: 'Replace',
        icon: RefreshCw,
        helper: 'Suggest a concrete rewrite of the selected text, ready to apply.',
        mode: 'draft',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants to REPLACE this passage with improved wording. Produce a `
            + 'single, concrete rewrite that preserves the original intent and any wording not affected by '
            + 'the request, and makes the minimal, targeted change needed. Do not offer several options or '
            + `commentary — commit to one rewrite. ${REPLACEMENT_CONTRACT}`,
    },
    {
        id: 'critique',
        label: 'Critique',
        icon: ShieldQuestion,
        helper: 'Stress-test this text: find gaps, unstated assumptions, and missing states.',
        mode: 'draft',
        systemPrompt:
            `${SHARED_PREAMBLE} The user wants a CRITIQUE of this passage. Act as a skeptical reviewer: `
            + 'surface the gaps, unstated assumptions, ambiguities, missing states (empty/loading/error/'
            + 'permission), and contradictions this text carries or invites — grounded in what it actually '
            + 'says, not a generic checklist. Order findings by how costly each is to get wrong. Be '
            + 'concrete; do not manufacture criticism to seem thorough. Offer a tightened rewrite only if it '
            + `clearly follows from the findings. ${REPLACEMENT_CONTRACT}`,
    },
] as const;

/** Registry lookup by id. */
export const getPrdEditAction = (id: PrdEditActionId): PrdEditAction | undefined =>
    PRD_EDIT_ACTIONS.find(a => a.id === id);

/**
 * Resolve the action an intent string belongs to, by its `"<Label>: "` prefix
 * (case-insensitive). Free-text intents with no recognized prefix return
 * `undefined` — the caller falls back to the generic behaviour.
 */
export const getActionFromIntent = (intent: string): PrdEditAction | undefined => {
    if (!intent) return undefined;
    const lower = intent.toLowerCase();
    return PRD_EDIT_ACTIONS.find(a => lower.startsWith(a.label.toLowerCase() + ': '));
};

/** The `"<Label>: "` intent prefix a chip prefills / a quick action submits. */
export const intentPrefixFor = (action: PrdEditAction): string => `${action.label}: `;
