import { describe, it, expect } from 'vitest';
import type { MockupPayload, ScreenInventoryContent } from '../../types';
import { buildScreenIndex } from '../screenExperience';
import { parseFlows } from '../../components/renderers/userFlows/parseFlow';
import {
    buildScreenGroups, deriveScreenConnections, flowFilterOptions, hasFlowGrouping,
} from '../screenFlowView';

const inventory: ScreenInventoryContent = {
    sections: [{
        title: 'Main',
        screens: [
            {
                id: 'scr-upload', name: 'Upload', priority: 'P0', purpose: 'Upload images',
                entryPoints: ['App launch'],
                exitPaths: [{ label: 'Continue', target: 'Verification' }],
            },
            {
                id: 'scr-verification', name: 'Verification', priority: 'P1', purpose: 'Verify',
                exitPaths: [{ label: 'Next', target: 'Review' }, { label: 'Back', target: 'Upload' }],
            },
            { id: 'scr-review', name: 'Review', priority: 'P1', purpose: 'Review results' },
            { id: 'scr-settings', name: 'Settings', priority: 'P2', purpose: 'Configure' },
        ],
    }],
};

const FLOWS_MD = `### Flow: Content Ingestion
**Goal:** Ingest content
**Steps:**
1. [Upload] — User uploads → System accepts
2. [Verification] — User verifies → System checks
3. [Review] — User reviews → System stores
`;

function build() {
    const flows = parseFlows(FLOWS_MD);
    return buildScreenIndex(inventory, flows, null as unknown as MockupPayload);
}

describe('deriveScreenConnections', () => {
    it('derives outgoing target names and flow titles', () => {
        const index = build();
        const upload = index.byId.get('scr-upload')!;
        const c = deriveScreenConnections(upload);
        expect(c.outgoing).toEqual(['Verification']);
        expect(c.incoming).toEqual(['App launch']);
        expect(c.flowTitles).toEqual(['Content Ingestion']);
    });

    it('dedupes and preserves order', () => {
        const index = build();
        const verification = index.byId.get('scr-verification')!;
        const c = deriveScreenConnections(verification);
        expect(c.outgoing).toEqual(['Review', 'Upload']);
    });

    it('returns empty connections for an unconnected screen', () => {
        const index = build();
        const settings = index.byId.get('scr-settings')!;
        const c = deriveScreenConnections(settings);
        expect(c.outgoing).toEqual([]);
        expect(c.flowTitles).toEqual([]);
    });
});

describe('buildScreenGroups', () => {
    it('groups flow screens by their flow, in step order, with an Other bucket', () => {
        const index = build();
        const groups = buildScreenGroups(index, 'flow');
        expect(groups[0].title).toBe('Content Ingestion');
        expect(groups[0].items.map(i => i.screen.name)).toEqual(['Upload', 'Verification', 'Review']);
        // Settings is in no flow → trailing "Other screens" group.
        const other = groups.find(g => g.id === '__other__');
        expect(other?.items.map(i => i.screen.name)).toEqual(['Settings']);
    });

    it('groups by section', () => {
        const index = build();
        const groups = buildScreenGroups(index, 'section');
        expect(groups).toHaveLength(1);
        expect(groups[0].title).toBe('Main');
        expect(groups[0].items).toHaveLength(4);
    });

    it('groups by priority, highest tier first', () => {
        const index = build();
        const groups = buildScreenGroups(index, 'priority');
        expect(groups.map(g => g.id)).toEqual(['priority:P0', 'priority:P1', 'priority:P2']);
        expect(groups[0].items.map(i => i.screen.name)).toEqual(['Upload']);
    });
});

describe('flow helpers', () => {
    it('hasFlowGrouping is true when a screen is referenced by a flow', () => {
        expect(hasFlowGrouping(build())).toBe(true);
    });

    it('flowFilterOptions lists distinct flow titles', () => {
        expect(flowFilterOptions(build())).toEqual(['Content Ingestion']);
    });
});
