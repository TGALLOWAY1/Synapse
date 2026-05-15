import { describe, expect, it } from 'vitest';
import { parseFlows, stripTraceMetadata } from '../parseFlow';

describe('stripTraceMetadata', () => {
    it('strips a trailing [Traces to: f1, f2, f3] block and extracts the ids', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'Offline Core Workout Loop & Real-Time Tracking [Traces to: f1, f2, f3, f4, f5, f6]',
        );
        expect(cleanTitle).toBe('Offline Core Workout Loop & Real-Time Tracking');
        expect(extracted.map(e => e.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    });

    it('strips a parenthesized "Traces: ..." form', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'Workout Loop (Traces: f1, f2)',
        );
        expect(cleanTitle).toBe('Workout Loop');
        expect(extracted.map(e => e.id)).toEqual(['f1', 'f2']);
    });

    it('strips a trailing dash "— Traces to: f1" form', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'Offline Mode — Traces to: f1, F-014',
        );
        expect(cleanTitle).toBe('Offline Mode');
        expect(extracted.map(e => e.id)).toContain('f1');
        expect(extracted.map(e => e.id)).toContain('f014');
    });

    it('strips "Maps to: f1" alternative wording', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'Coach Triage & Program Override [Maps to: f4, f5, f7]',
        );
        expect(cleanTitle).toBe('Coach Triage & Program Override');
        expect(extracted.map(e => e.id)).toEqual(['f4', 'f5', 'f7']);
    });

    it('handles "[Features: f1, f2]" wording', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'Onboarding [Features: f1, f2]',
        );
        expect(cleanTitle).toBe('Onboarding');
        expect(extracted.map(e => e.id)).toEqual(['f1', 'f2']);
    });

    it('leaves a title without trace metadata unchanged', () => {
        const { cleanTitle, extracted } = stripTraceMetadata(
            'AI Baseline Setup & Initial Onboarding',
        );
        expect(cleanTitle).toBe('AI Baseline Setup & Initial Onboarding');
        expect(extracted).toEqual([]);
    });

    it('does NOT eat a bracketed prefix that is part of the title', () => {
        // `[Beta]` is not a trace-metadata token — it should stay in the title.
        const { cleanTitle, extracted } = stripTraceMetadata(
            '[Beta] Onboarding Flow',
        );
        expect(cleanTitle).toBe('[Beta] Onboarding Flow');
        expect(extracted).toEqual([]);
    });

    it('handles an empty string gracefully', () => {
        const { cleanTitle, extracted } = stripTraceMetadata('');
        expect(cleanTitle).toBe('');
        expect(extracted).toEqual([]);
    });
});

describe('parseFlows — trace metadata in headings', () => {
    it('cleans the title in the heading and lifts the feature refs to the flow', () => {
        const md = `### Flow: Offline Core Workout Loop & Real-Time Tracking [Traces to: f1, f2, f3]
**Steps:**
1. [Active Workout] — User starts a set → System records the rep`;
        const flow = parseFlows(md)[0];
        expect(flow.title).toBe('Offline Core Workout Loop & Real-Time Tracking');
        expect(flow.rawTitle).toBe(
            'Offline Core Workout Loop & Real-Time Tracking [Traces to: f1, f2, f3]',
        );
        const ids = flow.featureRefs.map(r => r.id);
        expect(ids).toEqual(expect.arrayContaining(['f1', 'f2', 'f3']));
    });

    it('keeps original feature refs from steps and adds the title-extracted ones', () => {
        const md = `### Flow: Recipe Ingestion [Traces to: f9]
**Steps:**
1. [Importer] — User pastes URL → System scrapes via [f1] microservice`;
        const flow = parseFlows(md)[0];
        const ids = flow.featureRefs.map(r => r.id);
        // Both the title-extracted (f9) and the step-extracted (f1) appear.
        expect(ids).toEqual(expect.arrayContaining(['f9', 'f1']));
        expect(flow.title).toBe('Recipe Ingestion');
    });
});
