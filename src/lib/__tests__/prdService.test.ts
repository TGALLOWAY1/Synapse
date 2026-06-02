import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafetyClassificationResult } from '../safety';
import type { PreflightContext } from '../prompts/preflightPrompts';

// The safety classifier and the PRD pipeline are the two collaborators of the
// generateStructuredPRD chokepoint. We mock both so we can assert the
// orchestration contract: the classifier runs FIRST and a `disallowed` verdict
// hard-stops before the pipeline is ever invoked. SafetyBlockedError and
// buildRestrictionDirective are kept real (spread from the actual module) so
// `instanceof` checks and the appended directive text are authentic.
const classifyMock = vi.fn<(prompt: string, opts?: unknown) => Promise<SafetyClassificationResult>>();
const pipelineMock = vi.fn();

vi.mock('../safety', async (importActual) => {
    const actual = await importActual<typeof import('../safety')>();
    return {
        ...actual,
        classifyProjectSafety: (prompt: string, opts?: unknown) => classifyMock(prompt, opts),
    };
});

vi.mock('../services/progressivePrdPipeline', () => ({
    runProgressivePrdPipeline: (...args: unknown[]) => pipelineMock(...args),
}));

import { generateStructuredPRD } from '../services/prdService';
import { SafetyBlockedError, buildRestrictionDirective } from '../safety';
import { buildClarificationPromptBlock } from '../prompts/preflightPrompts';

const allowed = (overrides: Partial<SafetyClassificationResult> = {}): SafetyClassificationResult => ({
    classification: 'allowed',
    confidence: 'high',
    detectedConcerns: [],
    userFacingReason: '',
    safeAlternatives: [],
    ...overrides,
});

beforeEach(() => {
    classifyMock.mockReset();
    pipelineMock.mockReset();
    pipelineMock.mockResolvedValue({ structuredPRD: { vision: 'ok' } });
});

describe('generateStructuredPRD — safety chokepoint', () => {
    it('runs the classifier before the pipeline and hard-stops on a disallowed verdict', async () => {
        classifyMock.mockResolvedValue(allowed({ classification: 'disallowed' }));

        await expect(generateStructuredPRD('build malware')).rejects.toBeInstanceOf(SafetyBlockedError);

        expect(classifyMock).toHaveBeenCalledTimes(1);
        // The pipeline must never run for a disallowed idea — this is the
        // guarantee that no partially-filled PRD can be produced.
        expect(pipelineMock).not.toHaveBeenCalled();
    });

    it('runs the pipeline and fires onSafety for an allowed verdict', async () => {
        const result = allowed();
        classifyMock.mockResolvedValue(result);
        const onSafety = vi.fn();

        const prd = await generateStructuredPRD('build a notes app', { onSafety });

        expect(pipelineMock).toHaveBeenCalledTimes(1);
        expect(onSafety).toHaveBeenCalledWith(result);
        expect(prd).toEqual({ vision: 'ok' });
    });

    it('appends the restriction directive to the pipeline prompt for allowed_with_restrictions', async () => {
        const result = allowed({
            classification: 'allowed_with_restrictions',
            detectedConcerns: ['surveillance'],
        });
        classifyMock.mockResolvedValue(result);

        await generateStructuredPRD('an employee monitoring tool');

        expect(pipelineMock).toHaveBeenCalledTimes(1);
        const promptArg = pipelineMock.mock.calls[0][0] as string;
        expect(promptArg).toContain(buildRestrictionDirective(result));
    });

    it('appends the preflight clarification block after the safety gate', async () => {
        classifyMock.mockResolvedValue(allowed());
        const preflight: PreflightContext = {
            mode: 'quick',
            clarificationResponses: [
                { question: 'Who is the primary user?', answer: 'field technicians', skipped: false },
            ],
        };

        await generateStructuredPRD('a maintenance app', { preflight });

        const promptArg = pipelineMock.mock.calls[0][0] as string;
        expect(promptArg).toContain(buildClarificationPromptBlock(preflight));
    });

    it('does not append a clarification block when preflight mode is none', async () => {
        classifyMock.mockResolvedValue(allowed());
        await generateStructuredPRD('a maintenance app', {
            preflight: { mode: 'none', clarificationResponses: [] },
        });

        const promptArg = pipelineMock.mock.calls[0][0] as string;
        expect(promptArg).not.toContain('## Preflight Clarification');
    });
});
