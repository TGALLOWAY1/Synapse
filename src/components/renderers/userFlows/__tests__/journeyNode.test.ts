import { describe, expect, it } from 'vitest';
import { buildJourneyNodes, inferNodeKind } from '../journeyNode';
import type { ParsedStep } from '../types';

function step(over: Partial<ParsedStep>): ParsedStep {
    return {
        index: 0,
        rawText: '',
        title: undefined,
        userAction: undefined,
        systemBehavior: undefined,
        uiFeedback: undefined,
        decisions: [],
        apiRefs: [],
        errorRefs: [],
        featureRefs: [],
        ...over,
    };
}

describe('inferNodeKind', () => {
    it('infers screen when title mentions screen / page / view', () => {
        expect(inferNodeKind(step({ title: 'NLP Recipe Importer' }))).toBe('screen');
        expect(inferNodeKind(step({ title: 'Importer Screen' }))).toBe('screen');
        expect(inferNodeKind(step({ title: 'Recipe Library Page' }))).toBe('screen');
    });

    it('infers state when title or body mentions loading / importing', () => {
        expect(inferNodeKind(step({ title: 'Importing Recipe' }))).toBe('state');
        expect(inferNodeKind(step({ title: 'Loading State' }))).toBe('state');
    });

    it('infers action when title or action wording is verbal', () => {
        expect(
            inferNodeKind(step({ userAction: 'Click Save Recipe to Library' })),
        ).toBe('action');
    });

    it('infers decision when multiple decisions are present', () => {
        expect(
            inferNodeKind(step({
                title: 'Validate input',
                decisions: [
                    'If valid → proceed',
                    'If invalid → show error',
                ],
            })),
        ).toBe('decision');
    });

    it('infers system when body mentions api / service / queue and no screen', () => {
        expect(
            inferNodeKind(step({
                title: 'Schedule job',
                userAction: '',
                systemBehavior: 'queue worker fires the cron job',
            })),
        ).toBe('system');
    });

    it('falls back to screen when nothing matches', () => {
        expect(inferNodeKind(step({ title: 'Untitled' }))).toBe('screen');
    });
});

describe('buildJourneyNodes', () => {
    it('uses step title for the label, falling back to userAction or rawText', () => {
        const nodes = buildJourneyNodes([
            step({ index: 0, title: 'Importer', rawText: 'raw' }),
            step({ index: 1, title: undefined, userAction: 'User clicks save', rawText: 'fallback' }),
            step({ index: 2, title: undefined, userAction: undefined, rawText: 'just prose' }),
        ]);
        expect(nodes[0].label).toBe('Importer');
        expect(nodes[1].label).toBe('User clicks save');
        expect(nodes[2].label).toBe('just prose');
    });
});
