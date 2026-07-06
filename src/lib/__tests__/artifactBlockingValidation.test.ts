import { describe, it, expect } from 'vitest';
import { detectArtifactBlockers, readValidationBlockers } from '../artifactBlockingValidation';
import type { StructuredPRD } from '../../types';

// Minimal PRD with one feature so traceability checks have something to match.
const prd = {
    features: [{ id: 'F1', name: 'Booking', description: 'Book a slot' }],
} as unknown as StructuredPRD;

describe('detectArtifactBlockers', () => {
    it('blocks a data_model that maps no API surface', () => {
        const content = '# Data Model\n\n## Booking (F1)\nFields: id, when.\n';
        const blockers = detectArtifactBlockers('data_model', content, prd);
        expect(blockers.some(b => /API surface/i.test(b))).toBe(true);
    });

    it('does not block a data_model that includes API endpoints', () => {
        const content = '# Data Model\n\n## Booking (F1)\nFields: id.\n\n## API Endpoints\n| Method | Path |\n|--|--|\n| GET | /bookings |\n';
        const blockers = detectArtifactBlockers('data_model', content, prd);
        expect(blockers.some(b => /API surface/i.test(b))).toBe(false);
    });

    it('blocks user_flows that omit error paths', () => {
        const content = '# User Flows\n\n## Booking flow (F1)\nStep 1: pick a slot.\nStep 2: confirm.\n';
        const blockers = detectArtifactBlockers('user_flows', content, prd);
        expect(blockers.some(b => /error paths/i.test(b))).toBe(true);
    });

    it('does not block user_flows that describe error handling', () => {
        const content = '# User Flows\n\n## Booking flow (F1)\nStep 1: pick a slot.\nError: slot taken → show message.\n';
        const blockers = detectArtifactBlockers('user_flows', content, prd);
        expect(blockers.some(b => /error paths/i.test(b))).toBe(false);
    });

    it('blocks a structurally empty JSON-mode artifact (screen inventory with no screens)', () => {
        const content = JSON.stringify({ sections: [{ title: 'Core', screens: [] }] });
        const blockers = detectArtifactBlockers('screen_inventory', content, prd);
        expect(blockers.some(b => /no screens/i.test(b))).toBe(true);
    });

    it('does not block a screen inventory that has screens', () => {
        const content = JSON.stringify({
            sections: [{ title: 'Core', screens: [{ name: 'Home', purpose: 'Landing page for users' }] }],
        });
        const blockers = detectArtifactBlockers('screen_inventory', content, prd);
        expect(blockers).toEqual([]);
    });

    it('blocks an implementation-critical artifact with no PRD traceability', () => {
        const content = '# User Flows\n\n## Some flow\nStep 1.\nError handled.\n';
        const blockers = detectArtifactBlockers('user_flows', content, prd);
        expect(blockers.some(b => /traceability/i.test(b))).toBe(true);
    });
});

describe('readValidationBlockers', () => {
    it('returns [] for legacy/clean metadata', () => {
        expect(readValidationBlockers(undefined)).toEqual([]);
        expect(readValidationBlockers({})).toEqual([]);
    });
    it('reads stamped blockers', () => {
        expect(readValidationBlockers({ validationBlockers: ['a', 1, 'b'] })).toEqual(['a', 'b']);
    });
});
