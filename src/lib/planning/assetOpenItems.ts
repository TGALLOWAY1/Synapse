// Derived, advisory projection of "things still open" inside generated
// outputs — a flow's Open Questions bullet, a declared assumption, a stray TBD
// left in a step.
//
// Assets are read surfaces: they describe the product, they do not adjudicate
// it. Flagging an open item *inside* an asset put the prompt in the wrong place
// and, when it was inferred from loose wording, mostly fired on designed
// fallbacks. So the assets render their content plainly and this module lifts
// the genuinely-open items into the Decision Center, each carrying enough
// locator to navigate back to the exact flow (and step) it came from.
//
// Nothing here is persisted and nothing here is authority: these are candidates
// the user may promote into a real PlanningRecord via the existing
// flag-to-plan path. Detection is deliberately narrow — an explicitly labelled
// block, or an unambiguous marker token — because a noisy queue is worse than
// a short one.

import { parseFlows } from '../../components/renderers/userFlows/parseFlow';
import type { ArtifactSlotKey, CoreArtifactSubtype } from '../../types';

export type AssetOpenItemKind = 'open_question' | 'assumption' | 'unresolved_marker';

export type AssetOpenItem = {
    /** Stable across versions for the same artifact + wording. */
    id: string;
    artifactId: string;
    artifactVersionId: string;
    slot: ArtifactSlotKey;
    artifactTitle: string;
    kind: AssetOpenItemKind;
    text: string;
    /** Human-readable "where in the asset" — a flow title, or a heading. */
    locationLabel: string;
    /** Flow deep-link locators. Present for user-flow assets only. */
    flowId?: string;
    flowStepIndex?: number;
};

export type AssetOpenItemSource = {
    artifactId: string;
    artifactVersionId: string;
    slot: ArtifactSlotKey;
    subtype?: CoreArtifactSubtype;
    artifactTitle: string;
    content: string;
};

/** Matches `UserFlowsRenderer`'s `flowId()` so a locator round-trips. */
const slug = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Narrow on purpose. "missing", "unresolved" and "not found" are excluded:
// they are ordinary words in a designed fallback ("… is missing from the index
// → return a canned reply") and flagging those is exactly the false positive
// that made the in-asset indicator untrustworthy.
const MARKER_RE = /\b(tbd|todo)\b|\bto be (determined|decided|confirmed)\b|\bneeds? a decision\b|\bdecide later\b/i;

const MAX_TEXT_LENGTH = 400;

const stableHash = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

const clean = (value: string): string =>
    value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);

/** Split a markdown block into its bullet items, joining wrapped lines. */
export function splitBlockItems(block: string): string[] {
    const items: string[] = [];
    let buffer = '';
    for (const line of block.split('\n').map(l => l.trim()).filter(Boolean)) {
        if (/^[-*]\s+/.test(line)) {
            if (buffer) items.push(buffer);
            buffer = line.replace(/^[-*]\s+/, '');
        } else if (buffer) {
            buffer += ` ${line}`;
        } else {
            items.push(line);
        }
    }
    if (buffer) items.push(buffer);
    return items.map(clean).filter(Boolean);
}

const makeItem = (
    source: AssetOpenItemSource,
    kind: AssetOpenItemKind,
    text: string,
    locationLabel: string,
    locator?: { flowId?: string; flowStepIndex?: number },
): AssetOpenItem => ({
    // Version is intentionally NOT part of the id: an item that survives a
    // regeneration is the same open question, not a new one.
    id: `asset-open-${stableHash(`${source.artifactId}:${kind}:${text.toLowerCase()}`)}`,
    artifactId: source.artifactId,
    artifactVersionId: source.artifactVersionId,
    slot: source.slot,
    artifactTitle: source.artifactTitle,
    kind,
    text,
    locationLabel,
    ...(locator?.flowId ? { flowId: locator.flowId } : {}),
    ...(typeof locator?.flowStepIndex === 'number' ? { flowStepIndex: locator.flowStepIndex } : {}),
});

/** Flow-aware pass: uses the flow parser so every item carries a flow locator. */
function deriveFromFlows(source: AssetOpenItemSource): AssetOpenItem[] {
    const out: AssetOpenItem[] = [];
    for (const flow of parseFlows(source.content)) {
        const flowId = slug(flow.title);
        const at = { flowId };

        for (const text of splitBlockItems(flow.openQuestions ?? '')) {
            out.push(makeItem(source, 'open_question', text, flow.title, at));
        }
        for (const text of splitBlockItems(flow.assumptions ?? '')) {
            out.push(makeItem(source, 'assumption', text, flow.title, at));
        }
        for (const issue of flow.issues) {
            const text = clean(issue.text);
            if (!MARKER_RE.test(text)) continue;
            out.push(makeItem(source, 'unresolved_marker', text, flow.title, {
                flowId,
                flowStepIndex: issue.linkedStepIndex,
            }));
        }
        for (const step of flow.steps) {
            const text = clean(step.rawText);
            if (!MARKER_RE.test(text)) continue;
            out.push(makeItem(source, 'unresolved_marker', text, flow.title, {
                flowId,
                flowStepIndex: step.index,
            }));
        }
    }
    return out;
}

const LABELLED_BLOCK_RE = /^\s*(?:\*\*|##+\s*)?(open questions?|assumptions?)\s*[:*]*\s*$/i;
const HEADING_RE = /^#{1,4}\s+(.*\S)\s*$/;

/** Generic markdown pass for every other asset type. */
function deriveFromMarkdown(source: AssetOpenItemSource): AssetOpenItem[] {
    const out: AssetOpenItem[] = [];
    let heading = source.artifactTitle;
    let blockKind: AssetOpenItemKind | null = null;
    let blockLines: string[] = [];
    let blockHeading = heading;

    const flushBlock = () => {
        if (blockKind) {
            for (const text of splitBlockItems(blockLines.join('\n'))) {
                out.push(makeItem(source, blockKind, text, blockHeading));
            }
        }
        blockKind = null;
        blockLines = [];
    };

    for (const line of source.content.split('\n')) {
        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
            flushBlock();
            heading = clean(headingMatch[1].replace(/^#+\s*/, ''));
            continue;
        }

        const labelled = line.match(LABELLED_BLOCK_RE);
        if (labelled) {
            flushBlock();
            blockKind = /open/i.test(labelled[1]) ? 'open_question' : 'assumption';
            blockHeading = heading;
            continue;
        }

        if (blockKind) {
            // A blank line or a new bold label ends the block.
            if (!line.trim() || /^\s*\*\*/.test(line)) {
                flushBlock();
            } else {
                blockLines.push(line);
                continue;
            }
        }

        const text = clean(line.replace(/^[-*]\s+/, ''));
        if (text && MARKER_RE.test(text)) {
            out.push(makeItem(source, 'unresolved_marker', text, heading));
        }
    }
    flushBlock();
    return out;
}

/** Source key used when an item is promoted into a real planning record.
 * Version-independent, matching the item id, so a promoted item stays marked
 * as promoted after the asset regenerates. */
export const assetOpenItemPlanningSourceKey = (item: AssetOpenItem): string =>
    `asset-open-item:${item.artifactId}:${item.id}`;

/** Short title for a promoted record — the full text becomes the statement. */
export function assetOpenItemTitle(item: AssetOpenItem): string {
    const prefix = item.kind === 'assumption' ? 'Assumption' : 'Open question';
    const trimmed = item.text.length > 90 ? `${item.text.slice(0, 87).trimEnd()}…` : item.text;
    return `${prefix}: ${trimmed}`;
}

export function deriveAssetOpenItems(sources: AssetOpenItemSource[]): AssetOpenItem[] {
    const seen = new Set<string>();
    const out: AssetOpenItem[] = [];
    for (const source of sources) {
        if (!source.content.trim()) continue;
        const items = source.slot === 'user_flows'
            ? deriveFromFlows(source)
            : deriveFromMarkdown(source);
        for (const item of items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            out.push(item);
        }
    }
    return out;
}
