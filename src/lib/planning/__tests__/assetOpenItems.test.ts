import { describe, expect, it } from 'vitest';
import { deriveAssetOpenItems, splitBlockItems } from '../assetOpenItems';
import type { AssetOpenItemSource } from '../assetOpenItems';

const flowSource = (content: string): AssetOpenItemSource => ({
    artifactId: 'artifact-flows',
    artifactVersionId: 'v2',
    slot: 'user_flows',
    subtype: 'user_flows',
    artifactTitle: 'User Flows',
    content,
});

const FLOWS = `### Flow: Grounded Knowledge Retrieval
**Goal:** Query the verified knowledge base.
**Steps:**
1. [Knowledge Chat] — User asks a question → System retrieves top-K concepts
2. [Knowledge Chat] — System synthesizes an answer → TBD: confirm the citation format
**Error Paths:**
- Concepts entirely missing from the indexed library → System returns a canned "I don't know" reply
- Third-party LLM API returns 429 → Show an inline retry message
**Assumptions:**
- Users accept answers grounded only in their own uploads
**Open Questions:**
- Should partial-coverage answers be shown with a confidence score?

### Flow: Topic Taxonomy
**Goal:** Manage the topic tree.
**Steps:**
1. [Taxonomy] — User drags a topic → System reparents it`;

describe('deriveAssetOpenItems — user flows', () => {
    const items = deriveAssetOpenItems([flowSource(FLOWS)]);

    it('lifts open questions and assumptions out of the flow', () => {
        const kinds = items.map(i => i.kind);
        expect(kinds).toContain('open_question');
        expect(kinds).toContain('assumption');
        expect(items.find(i => i.kind === 'open_question')?.text)
            .toMatch(/partial-coverage answers/);
    });

    it('carries a flow locator that matches the renderer slug', () => {
        for (const item of items) {
            expect(item.flowId).toBe('grounded-knowledge-retrieval');
            expect(item.locationLabel).toBe('Grounded Knowledge Retrieval');
        }
    });

    it('picks up an explicit TBD marker with its step index', () => {
        const marker = items.find(i => i.kind === 'unresolved_marker');
        expect(marker?.text).toMatch(/citation format/);
        expect(typeof marker?.flowStepIndex).toBe('number');
    });

    it('does not flag a designed fallback that merely says "missing"', () => {
        // This is the exact false positive that made the in-asset "unresolved"
        // badge untrustworthy — it is designed behavior, not an open item.
        expect(items.some(i => /canned/i.test(i.text))).toBe(false);
        expect(items.some(i => /429/.test(i.text))).toBe(false);
    });

    it('ignores flows with nothing open', () => {
        expect(items.some(i => i.locationLabel === 'Topic Taxonomy')).toBe(false);
    });
});

describe('deriveAssetOpenItems — generic markdown assets', () => {
    const items = deriveAssetOpenItems([{
        artifactId: 'artifact-screens',
        artifactVersionId: 'v1',
        slot: 'screen_inventory',
        subtype: 'screen_inventory',
        artifactTitle: 'Screen Inventory',
        content: `## Library Dashboard
Shows every uploaded infographic.

**Open Questions:**
- Do we paginate past 1,000 thumbnails?
- Should archived items stay searchable?

## Upload
Accepts an image plus the source prompt. Retention policy TBD.
`,
    }]);

    it('reads a labelled block under its nearest heading', () => {
        const questions = items.filter(i => i.kind === 'open_question');
        expect(questions).toHaveLength(2);
        expect(questions[0].locationLabel).toBe('Library Dashboard');
    });

    it('flags a marker in body prose against its heading', () => {
        const marker = items.find(i => i.kind === 'unresolved_marker');
        expect(marker?.locationLabel).toBe('Upload');
        expect(marker?.flowId).toBeUndefined();
    });
});

describe('deriveAssetOpenItems — identity', () => {
    it('keeps ids stable across a regeneration of the same artifact', () => {
        const a = deriveAssetOpenItems([flowSource(FLOWS)]);
        const b = deriveAssetOpenItems([{ ...flowSource(FLOWS), artifactVersionId: 'v9' }]);
        expect(b.map(i => i.id)).toEqual(a.map(i => i.id));
    });

    it('deduplicates identical items and skips empty assets', () => {
        const twice = deriveAssetOpenItems([flowSource(FLOWS), flowSource(FLOWS)]);
        expect(twice).toHaveLength(deriveAssetOpenItems([flowSource(FLOWS)]).length);
        expect(deriveAssetOpenItems([flowSource('   ')])).toEqual([]);
    });
});

describe('splitBlockItems', () => {
    it('joins wrapped bullet continuations', () => {
        expect(splitBlockItems('- first line\n  continued here\n- second')).toEqual([
            'first line continued here',
            'second',
        ]);
    });
});
