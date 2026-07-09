import type { FlowJourneyNode, FlowJourneyNodeKind, ParsedStep } from './types';

/**
 * The canonical PRD spine stamps every screen with a deterministic seed id of
 * the form `scr-<slug>` (see src/lib/canonicalPrdSpine.ts). The model that
 * writes the user_flows artifact sometimes echoes that seed id into a step's
 * `[Screen Name]` bracket instead of the human-readable name — e.g. it writes
 * `[scr-infographic-library]` for the screen named "Infographic Library". Left
 * as-is this detaches the step from its screen: the join key slugs to
 * `scr-infographic-library` while the screen's slug is `infographic-library`,
 * so the Screens view warns "No user flow references this screen" and the flow
 * renders the raw id. These helpers canonicalize that reference so existing
 * (already-final) artifacts join and read correctly at render time. Only the
 * `scr-` screen-seed prefix is handled — `ent-`/other prefixes are unrelated
 * to screen references, and the `scr-` requires a `-`/`_` separator so a real
 * name like "Scribble Pad" (slug `scribble-pad`) is never touched. */
const SCREEN_SEED_PREFIX_RE = /^scr[-_]/i;
const SCREEN_SEED_ID_RE = /^scr[-_][a-z0-9]+(?:[-_][a-z0-9]+)*$/i;

/** True when a flow-step title is a bare screen seed id (`scr-…`) the model
 * echoed instead of a real screen name. */
export function looksLikeScreenSeedId(title: string): boolean {
    return SCREEN_SEED_ID_RE.test(title.trim());
}

/** Strip the `scr-`/`scr_` screen-seed prefix from an already-slugified value
 * so a `scr-infographic-library` step reference matches the `infographic-library`
 * screen slug. A non-seed slug is returned unchanged. */
export function stripScreenSeedPrefix(slug: string): string {
    return slug.replace(SCREEN_SEED_PREFIX_RE, '') || slug;
}

/** Human label for a flow-step screen title: a seed id like
 * `scr-infographic-library` becomes "Infographic Library"; a real name is
 * returned unchanged (only surrounding backticks trimmed). */
export function prettyScreenTitle(title: string): string {
    const trimmed = title.replace(/^`+|`+$/g, '').trim();
    if (!looksLikeScreenSeedId(trimmed)) return trimmed;
    const words = trimmed.replace(SCREEN_SEED_PREFIX_RE, '').replace(/[-_]+/g, ' ').trim();
    return words ? words.replace(/\b\w/g, c => c.toUpperCase()) : trimmed;
}

const STATE_HINTS = /\b(state|loading|importing|saving|syncing|fetching|processing|computing|pending|in[-\s]?progress|generating)\b/i;
const ACTION_HINTS = /\b(save|submit|click|tap|send|post|create|delete|remove|export|import|share|invite|publish|copy|paste|drag|drop|upload|download|trigger|run)\b/i;
const SCREEN_HINTS = /\b(screen|page|view|dashboard|panel|modal|drawer|sheet|inbox|library|settings|home|landing|profile)\b/i;
const SYSTEM_HINTS = /\b(api|service|backend|server|worker|queue|endpoint|webhook|cron|job|microservice|edge\s+function|function|database|db|store)\b/i;

/**
 * Infer what kind of node a step represents (Screen, State, Action,
 * Decision, System, Feature). The artifact prompt encourages the format
 * `[Screen Name] — User action → System response` but the title itself
 * doesn't carry the type, so we guess from wording. Falls back to
 * `screen` because that's the most common case.
 */
export function inferNodeKind(step: ParsedStep): FlowJourneyNodeKind {
    const title = (step.title ?? '').trim();
    const action = (step.userAction ?? '').trim();
    const system = (step.systemBehavior ?? '').trim();

    if (step.decisions.length > 0 && (step.decisions.length > 1 || /\bif\b/i.test(step.decisions[0] ?? ''))) {
        return 'decision';
    }

    // Title-driven: explicit suffix wins.
    if (/\b(state|loading|importing|saving|syncing|pending|generating)\b/i.test(title)) {
        return 'state';
    }
    if (/\b(action|button|cta|submit|save\b)/i.test(title)) {
        return 'action';
    }
    if (SCREEN_HINTS.test(title)) {
        return 'screen';
    }

    // Body-driven heuristics.
    const bodyText = `${action} ${system}`;
    if (STATE_HINTS.test(title) || STATE_HINTS.test(bodyText)) {
        return 'state';
    }
    if (!system && ACTION_HINTS.test(action)) {
        return 'action';
    }
    if (SYSTEM_HINTS.test(bodyText) && !SCREEN_HINTS.test(title)) {
        return 'system';
    }

    // If the step has no title at all but lots of feature refs and a
    // single action, treat it as an action.
    if (!title && step.featureRefs.length > 0 && ACTION_HINTS.test(bodyText)) {
        return 'action';
    }

    return 'screen';
}

export function buildJourneyNodes(steps: ParsedStep[]): FlowJourneyNode[] {
    return steps.map(step => ({
        stepIndex: step.index,
        label: step.title?.trim() || step.userAction?.trim() || step.rawText.trim(),
        kind: inferNodeKind(step),
        action: step.userAction?.trim() || undefined,
    }));
}

const BACKTICKS = /^`+|`+$/g;

/** A run of consecutive journey steps that all happen on the same screen. */
export interface FlowJourneyGroup {
    /** Key shared by every step in the group (a screen slug), or null for a
     * standalone step with no usable screen title. */
    screenSlug: string | null;
    /** The screen name, shown once as the group header. */
    screenLabel: string;
    /** The step nodes belonging to this screen, in flow order. */
    nodes: FlowJourneyNode[];
    /** 0-based indices of the first/last step — drives the "Steps N–M" range. */
    firstStepIndex: number;
    lastStepIndex: number;
}

/** Default screen key: the step's title, backtick-stripped and lowercased.
 * Callers pass `stepScreenSlug` so grouping aligns with screen navigation. */
function defaultScreenKey(step: ParsedStep): string | null {
    const title = step.title ? step.title.replace(BACKTICKS, '').trim().toLowerCase() : '';
    return title || null;
}

/**
 * Collapse the flat step list into per-screen groups: consecutive steps that
 * resolve to the same screen key become one group (rendered as a card with the
 * screen name in the header and the steps as sub-rows), so a screen that owns
 * several sequential steps is no longer repeated node-after-node. Steps with no
 * screen key (null) never merge and stand alone. Order and step indices are
 * preserved, so the grouping stays a pure presentation layer over the same
 * parsed steps.
 */
export function buildJourneyGroups(
    steps: ParsedStep[],
    screenKeyFor: (step: ParsedStep) => string | null = defaultScreenKey,
): FlowJourneyGroup[] {
    const nodes = buildJourneyNodes(steps);
    const groups: FlowJourneyGroup[] = [];
    nodes.forEach((node, i) => {
        const step = steps[i];
        const key = screenKeyFor(step);
        const prev = groups[groups.length - 1];
        if (prev && key !== null && prev.screenSlug === key) {
            prev.nodes.push(node);
            prev.lastStepIndex = step.index;
        } else {
            groups.push({
                screenSlug: key,
                screenLabel: prettyScreenTitle(step.title?.trim() || node.label),
                nodes: [node],
                firstStepIndex: step.index,
                lastStepIndex: step.index,
            });
        }
    });
    return groups;
}

export const NODE_KIND_LABEL: Record<FlowJourneyNodeKind, string> = {
    screen: 'Screen',
    state: 'State',
    action: 'Action',
    decision: 'Decision',
    system: 'System',
    feature: 'Feature',
};

/**
 * Tailwind classes per node kind. Returned as an object so callers can
 * choose between the badge style and the node body style.
 */
export function nodeKindStyle(kind: FlowJourneyNodeKind): {
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    badgeText: string;
} {
    switch (kind) {
        case 'screen':
            return {
                bg: 'bg-indigo-50',
                border: 'border-indigo-200',
                text: 'text-indigo-900',
                badgeBg: 'bg-indigo-100',
                badgeText: 'text-indigo-700',
            };
        case 'state':
            return {
                bg: 'bg-sky-50',
                border: 'border-sky-200',
                text: 'text-sky-900',
                badgeBg: 'bg-sky-100',
                badgeText: 'text-sky-700',
            };
        case 'action':
            return {
                bg: 'bg-emerald-50',
                border: 'border-emerald-200',
                text: 'text-emerald-900',
                badgeBg: 'bg-emerald-100',
                badgeText: 'text-emerald-700',
            };
        case 'decision':
            return {
                bg: 'bg-amber-50',
                border: 'border-amber-200',
                text: 'text-amber-900',
                badgeBg: 'bg-amber-100',
                badgeText: 'text-amber-800',
            };
        case 'system':
            return {
                bg: 'bg-neutral-50',
                border: 'border-neutral-300',
                text: 'text-neutral-900',
                badgeBg: 'bg-neutral-200',
                badgeText: 'text-neutral-700',
            };
        case 'feature':
            return {
                bg: 'bg-fuchsia-50',
                border: 'border-fuchsia-200',
                text: 'text-fuchsia-900',
                badgeBg: 'bg-fuchsia-100',
                badgeText: 'text-fuchsia-700',
            };
    }
}
