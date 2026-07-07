// Safety Review artifact helpers: the hard-stop error thrown by the generation
// gate, the canonical blocked-state markdown (used for SpineVersion.responseText
// and markdown export), and the restriction directive appended to the prompt
// for allowed_with_restrictions runs.

import type { SafetyClassificationResult, SpineSafetyReview } from './safetyTypes';
import { DEFAULT_SAFE_ALTERNATIVES } from './safetyTypes';
import { BLOCKED_CONCERN_FALLBACK, RESTRICTED_CONCERN_FALLBACK } from './safetyPolicy';

/**
 * Thrown by `generateStructuredPRD` when a request is classified `disallowed`.
 * Hard-stops the pipeline before any section runs; call sites catch it and
 * persist a blocked `SpineVersion.safetyReview` instead of a generation error.
 */
export class SafetyBlockedError extends Error {
    readonly result: SafetyClassificationResult;

    constructor(result: SafetyClassificationResult) {
        super('Request blocked by Synapse safety review.');
        this.name = 'SafetyBlockedError';
        this.result = result;
    }
}

/** Build the persisted `SpineSafetyReview` for a blocked request. */
export const buildBlockedSafetyReview = (
    result: SafetyClassificationResult,
): SpineSafetyReview => ({
    classification: 'disallowed',
    status: 'blocked',
    detectedConcerns: result.detectedConcerns,
    userFacingReason: result.userFacingReason,
    safeAlternatives:
        result.safeAlternatives.length > 0
            ? result.safeAlternatives
            : DEFAULT_SAFE_ALTERNATIVES,
    reviewedAt: Date.now(),
});

/** Build the persisted `SpineSafetyReview` for an allowed_with_restrictions run. */
export const buildRestrictedSafetyReview = (
    result: SafetyClassificationResult,
): SpineSafetyReview => ({
    classification: 'allowed_with_restrictions',
    status: 'restricted',
    detectedConcerns: result.detectedConcerns,
    userFacingReason: result.userFacingReason,
    safeAlternatives: result.safeAlternatives,
    reviewedAt: Date.now(),
});

/**
 * Canonical Safety Review document. Stored as the spine's `responseText` so
 * History views and markdown export render something coherent instead of a
 * half-built PRD. User-facing only — no internal policy language.
 */
export const buildSafetyReviewMarkdown = (
    result: SafetyClassificationResult,
): string => {
    const alternatives =
        result.safeAlternatives.length > 0
            ? result.safeAlternatives
            : DEFAULT_SAFE_ALTERNATIVES;

    const concerns = result.detectedConcerns.length > 0
        ? result.detectedConcerns.join(', ')
        : BLOCKED_CONCERN_FALLBACK;

    return [
        '# Request Cannot Be Fulfilled',
        '',
        'Synapse identified that this request falls into a restricted category.',
        '',
        '## Why this was blocked',
        '',
        result.userFacingReason ||
            `This request appears to involve software that could enable ${BLOCKED_CONCERN_FALLBACK}.`,
        '',
        `Detected concerns: ${concerns}.`,
        '',
        '## Generation Outcome',
        '',
        'No project artifacts were generated.',
        '',
        '## Status',
        '',
        'Blocked',
        '',
        '## Classification',
        '',
        'Disallowed Request',
        '',
        '## Safe Alternatives',
        '',
        'If your goal is legitimate security research, compliance testing, employee training, ' +
            'or defensive monitoring, reframe the project around authorized and transparent use.',
        '',
        'Allowed alternatives may include:',
        '',
        ...alternatives.map((a) => `- ${a}`),
        '',
    ].join('\n');
};

/**
 * Directive appended to the user prompt for allowed_with_restrictions runs.
 * Constrains the generated PRD to safe/defensive/authorized framing and asks
 * the model to surface what it intentionally excluded.
 */
export const buildRestrictionDirective = (
    result: SafetyClassificationResult,
): string => {
    const concerns = result.detectedConcerns.length > 0
        ? result.detectedConcerns.join(', ')
        : RESTRICTED_CONCERN_FALLBACK;

    return [
        'SAFETY CONSTRAINTS (binding):',
        `- This product touches sensitive territory (${concerns}). Constrain the entire PRD to ` +
            'legitimate, authorized, transparent, consent-based, defensive, or educational use only.',
        '- Require explicit user/admin consent, oversight, audit logging, and transparency for any ' +
            'monitoring, simulation, or data-collection feature.',
        '- Do NOT include credential harvesting, covert/silent collection, evasion or anti-detection ' +
            'techniques, persistence mechanisms, or any real-world abuse instructions.',
        '- Include a short "Safety Boundaries" note (in the non-goals / intentional tradeoffs fields) ' +
            'stating what is intentionally excluded and why.',
    ].join('\n');
};
