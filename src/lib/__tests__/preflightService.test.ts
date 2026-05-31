import { describe, it, expect } from 'vitest';
import {
    generatePreflightQuestions,
    generatePreflightSummary,
    type PreflightTransport,
} from '../services/preflightService';
import type { SafetyTransport } from '../safety';
import type { PreflightQuestion } from '../../types';

// Safety transport stubs (mirror classifyProjectSafety's injection pattern).
const allowSafety: SafetyTransport = async () =>
    JSON.stringify({
        classification: 'allowed',
        confidence: 'high',
        detectedConcerns: [],
        userFacingReason: '',
        safeAlternatives: [],
    });

const disallowSafety: SafetyTransport = async () =>
    JSON.stringify({
        classification: 'disallowed',
        confidence: 'high',
        detectedConcerns: ['credential theft'],
        userFacingReason: 'This enables credential theft.',
        safeAlternatives: [],
    });

const questionsTransport = (n: number): PreflightTransport => async () =>
    JSON.stringify({
        questions: Array.from({ length: n }, (_, i) => ({
            question: `Generated question ${i + 1}?`,
            intent: `intent ${i + 1}`,
        })),
    });

describe('generatePreflightQuestions', () => {
    it('generates 5 idea-specific questions in quick mode', async () => {
        const { questions, usedFallback } = await generatePreflightQuestions('A meal planning app', 'quick', {
            safetyTransport: allowSafety,
            transport: questionsTransport(5),
        });
        expect(questions).toHaveLength(5);
        expect(usedFallback).toBe(false);
        expect(questions[0].question).toContain('Generated question 1');
        expect(questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    });

    it('generates 10 questions in deep mode', async () => {
        const { questions } = await generatePreflightQuestions('A drone inspection platform', 'deep', {
            safetyTransport: allowSafety,
            transport: questionsTransport(10),
        });
        expect(questions).toHaveLength(10);
    });

    it('caps over-produced questions to the requested count', async () => {
        const { questions } = await generatePreflightQuestions('idea', 'quick', {
            safetyTransport: allowSafety,
            transport: questionsTransport(12),
        });
        expect(questions).toHaveLength(5);
    });

    it('throws SafetyBlockedError before producing questions for a disallowed idea', async () => {
        await expect(
            generatePreflightQuestions('Build a keylogger that steals passwords', 'quick', {
                safetyTransport: disallowSafety,
                // This transport would throw if ever reached — proving questions
                // are never generated for a disallowed idea.
                transport: async () => {
                    throw new Error('question generation must not run for disallowed ideas');
                },
            }),
        ).rejects.toMatchObject({ name: 'SafetyBlockedError' });
    });

    it('falls back to the generic set on a non-safety generation failure', async () => {
        const { questions, usedFallback } = await generatePreflightQuestions('idea', 'quick', {
            safetyTransport: allowSafety,
            transport: async () => {
                throw new Error('model unavailable');
            },
        });
        expect(usedFallback).toBe(true);
        expect(questions).toHaveLength(5);
        expect(questions[0].question).toBe('Who is the primary user?');
    });

    it('uses the 10-question fallback set in deep mode', async () => {
        const { questions, usedFallback } = await generatePreflightQuestions('idea', 'deep', {
            safetyTransport: allowSafety,
            transport: async () => '{"questions": []}',
        });
        expect(usedFallback).toBe(true);
        expect(questions).toHaveLength(10);
    });
});

describe('generatePreflightSummary', () => {
    const questions: PreflightQuestion[] = [
        { id: 'q1', question: 'Who is the primary user?', answer: 'Independent musicians', skipped: false },
        { id: 'q2', question: 'How is it monetized?', skipped: true },
    ];

    it('returns the AI summary, assumptions, and unknowns', async () => {
        const transport: PreflightTransport = async () =>
            JSON.stringify({
                summary: '- Target users are independent musicians.',
                assumptions: ['Mobile-first experience'],
                unknowns: ['Monetization not decided'],
            });
        const result = await generatePreflightSummary('A songwriting app', questions, { transport });
        expect(result.summary).toContain('independent musicians');
        expect(result.assumptions).toContain('Mobile-first experience');
        expect(result.unknowns).toContain('Monetization not decided');
    });

    it('falls back to a local recap and treats skipped questions as unknowns', async () => {
        const result = await generatePreflightSummary('A songwriting app', questions, {
            transport: async () => {
                throw new Error('model unavailable');
            },
        });
        expect(result.summary).toContain('Independent musicians');
        // The skipped question becomes an open unknown, not fabricated certainty.
        expect(result.unknowns).toContain('How is it monetized?');
    });
});
