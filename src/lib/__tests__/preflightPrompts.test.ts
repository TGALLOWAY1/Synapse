import { describe, it, expect } from 'vitest';
import {
    buildClarificationPromptBlock,
    fallbackQuestionsFor,
    formatAnswersForSummary,
    QUESTION_COUNT,
    type PreflightContext,
} from '../prompts/preflightPrompts';
import type { PreflightQuestion } from '../../types';

describe('buildClarificationPromptBlock', () => {
    const ctx: PreflightContext = {
        mode: 'quick',
        clarificationResponses: [
            { question: 'Who is the primary user?', answer: 'Independent musicians', skipped: false },
            { question: 'How is it monetized?', answer: null, skipped: true },
        ],
        summary: '- Target users are independent musicians.',
        assumptions: ['Mobile-first'],
        unknowns: ['Monetization undecided'],
    };

    it('includes the authoritative-intent instruction verbatim', () => {
        const block = buildClarificationPromptBlock(ctx);
        expect(block).toContain('Treat answered clarification responses as authoritative intent');
        expect(block).toContain('If a question was skipped, do not invent certainty');
    });

    it('includes answered responses', () => {
        const block = buildClarificationPromptBlock(ctx);
        expect(block).toContain('Who is the primary user?');
        expect(block).toContain('Independent musicians');
    });

    it('marks skipped questions as open unknowns rather than fabricating answers', () => {
        const block = buildClarificationPromptBlock(ctx);
        expect(block).toContain('How is it monetized?');
        expect(block).toContain('skipped — treat as an open unknown');
    });

    it('includes summary, assumptions, and unknowns when present', () => {
        const block = buildClarificationPromptBlock(ctx);
        expect(block).toContain('Target users are independent musicians');
        expect(block).toContain('Mobile-first');
        expect(block).toContain('Monetization undecided');
    });
});

describe('fallback question sets', () => {
    it('provides exactly the right counts per mode', () => {
        expect(QUESTION_COUNT.quick).toBe(5);
        expect(QUESTION_COUNT.deep).toBe(10);
        expect(fallbackQuestionsFor('quick')).toHaveLength(5);
        expect(fallbackQuestionsFor('deep')).toHaveLength(10);
    });
});

describe('formatAnswersForSummary', () => {
    it('renders answered and skipped questions distinctly', () => {
        const questions: PreflightQuestion[] = [
            { id: 'q1', question: 'Who is the user?', answer: 'Musicians', skipped: false },
            { id: 'q2', question: 'Monetization?', skipped: true },
        ];
        const text = formatAnswersForSummary('A songwriting app', questions);
        expect(text).toContain('A songwriting app');
        expect(text).toContain('Answer: Musicians');
        expect(text).toContain('Answer: (skipped)');
    });
});
