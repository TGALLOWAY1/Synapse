import { isAbortError } from '../concurrency';
import { buildSpecialistPrompt } from './prompt';
import { clusterGroundedFindings, validateSpecialistFindings } from './normalize';
import { SPECIALIST_REGISTRY } from './specialists';
import {
    parseSpecialistOutput,
    specialistOutputSchema,
    SpecialistOutputValidationError,
} from './specialistOutput';
import type {
    ReviewContextManifest,
    ReviewOrchestrationResult,
    ReviewSpecialistId,
    SpecialistDefinition,
    SpecialistRunResult,
    ValidatedSpecialistFinding,
} from './types';
import { verifyEvidenceRef } from './manifest';

export interface SpecialistTransportInput {
    specialist: SpecialistDefinition;
    prompt: string;
    schema: object;
    signal?: AbortSignal;
    attempt: number;
    repair?: { previousResponse: string; validationError: string };
}

export type SpecialistTransport = (input: SpecialistTransportInput) => Promise<string>;

export type ReviewOrchestrationEvent =
    | { type: 'specialist_started'; specialistId: ReviewSpecialistId; attempt: number }
    | { type: 'specialist_retrying'; specialistId: ReviewSpecialistId; attempt: number; reason: string }
    | { type: 'specialist_completed'; specialistId: ReviewSpecialistId; attempt: number; findingCount: number; groundedCount: number; findings: ValidatedSpecialistFinding[] }
    | { type: 'specialist_failed'; specialistId: ReviewSpecialistId; error: string }
    | { type: 'specialist_cancelled'; specialistId: ReviewSpecialistId };

export interface ReviewOrchestrationOptions {
    transport: SpecialistTransport;
    signal?: AbortSignal;
    concurrency?: number;
    focus?: string;
    maxStructuredRepairAttempts?: number;
    onEvent?: (event: ReviewOrchestrationEvent) => void;
}

const abortError = (): DOMException => new DOMException('Review cancelled', 'AbortError');
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function runSingleSpecialist(
    manifest: ReviewContextManifest,
    specialistId: ReviewSpecialistId,
    options: ReviewOrchestrationOptions,
): Promise<SpecialistRunResult> {
    const specialist = SPECIALIST_REGISTRY[specialistId];
    if (!specialist) {
        return { specialistId, status: 'failed', attempts: 0, findings: [], error: `Unknown specialist: ${specialistId}` };
    }
    const prompt = buildSpecialistPrompt(manifest, specialistId, options.focus);
    const maxRepairs = Math.max(0, options.maxStructuredRepairAttempts ?? 1);
    let previousResponse = '';
    let validationError = '';

    for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
        if (options.signal?.aborted) {
            options.onEvent?.({ type: 'specialist_cancelled', specialistId });
            return { specialistId, status: 'cancelled', attempts: attempt - 1, findings: [] };
        }
        options.onEvent?.({ type: 'specialist_started', specialistId, attempt });
        try {
            const raw = await options.transport({
                specialist,
                prompt,
                schema: specialistOutputSchema,
                signal: options.signal,
                attempt,
                repair: attempt > 1 ? { previousResponse, validationError } : undefined,
            });
            previousResponse = raw;
            const parsed = parseSpecialistOutput(raw);
            const findings = validateSpecialistFindings(manifest, specialistId, parsed.findings);
            const coverageChecks = parsed.coverageChecks.map(check => ({
                ...check,
                evidence: check.evidence.map(item => verifyEvidenceRef(manifest, item)),
            }));
            const requiredCoverageAreas = specialistId === 'product_scope'
                ? ['problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions'] as const
                : ['specialist_boundary'] as const;
            const missingCoverage = requiredCoverageAreas.filter(area => !coverageChecks.some(check => (
                check.area === area
                && check.conclusion.trim().length >= 20
                && check.evidence.length > 0
                && check.evidence.every(item => item.verified)
            )));
            if (missingCoverage.length > 0) {
                throw new SpecialistOutputValidationError(
                    `Coverage checks are missing grounded conclusions for: ${missingCoverage.join(', ')}`,
                );
            }
            if (findings.length > 0 && findings.every(finding => !finding.grounded)) {
                const reasons = findings.flatMap(finding => finding.validationWarnings).join('; ');
                throw new SpecialistOutputValidationError(
                    `All specialist findings failed evidence validation${reasons ? `: ${reasons}` : ''}`,
                );
            }
            options.onEvent?.({
                type: 'specialist_completed',
                specialistId,
                attempt,
                findingCount: findings.length,
                groundedCount: findings.filter(finding => finding.grounded).length,
                findings,
            });
            return {
                specialistId,
                status: 'complete',
                attempts: attempt,
                findings,
                coverageSummary: parsed.coverageSummary,
                resolvedAreas: parsed.resolvedAreas,
                coverageChecks,
            };
        } catch (error) {
            if (options.signal?.aborted || isAbortError(error)) {
                options.onEvent?.({ type: 'specialist_cancelled', specialistId });
                return { specialistId, status: 'cancelled', attempts: attempt, findings: [] };
            }
            const canRepair = error instanceof SpecialistOutputValidationError && attempt <= maxRepairs;
            if (canRepair) {
                validationError = error.message;
                options.onEvent?.({ type: 'specialist_retrying', specialistId, attempt: attempt + 1, reason: validationError });
                continue;
            }
            const message = messageOf(error);
            options.onEvent?.({ type: 'specialist_failed', specialistId, error: message });
            return { specialistId, status: 'failed', attempts: attempt, findings: [], error: message };
        }
    }
    throw abortError();
}

export async function runAdversarialReview(
    manifest: ReviewContextManifest,
    specialistIds: ReviewSpecialistId[],
    options: ReviewOrchestrationOptions,
): Promise<ReviewOrchestrationResult> {
    const selected = [...new Set(specialistIds)];
    const results: SpecialistRunResult[] = new Array(selected.length);
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, selected.length || 1));
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < selected.length) {
            const index = nextIndex++;
            const specialistId = selected[index];
            if (options.signal?.aborted) {
                results[index] = { specialistId, status: 'cancelled', attempts: 0, findings: [] };
                options.onEvent?.({ type: 'specialist_cancelled', specialistId });
                continue;
            }
            results[index] = await runSingleSpecialist(manifest, specialistId, options);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const settled = results.filter(Boolean);
    const findings = settled.flatMap(result => result.findings);
    const completed = settled.filter(result => result.status === 'complete').map(result => result.specialistId);
    const failed = settled.filter(result => result.status === 'failed').map(result => result.specialistId);
    const cancelled = settled.filter(result => result.status === 'cancelled').map(result => result.specialistId);
    const status: ReviewOrchestrationResult['status'] = cancelled.length > 0
        ? 'cancelled'
        : completed.length === 0
            ? 'failed'
            : failed.length > 0
            ? 'partial'
            : 'complete';
    return {
        status,
        specialistResults: settled,
        clusters: clusterGroundedFindings(findings),
        coverage: { selected, completed, failed, cancelled },
    };
}

/** Retry selected failed/interrupted specialists against the same frozen manifest. */
export const retryReviewSpecialists = runAdversarialReview;
