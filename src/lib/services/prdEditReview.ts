// Pre-commit critique for PRD edits (staged batch consolidation).
//
// Before a set of staged edits is committed as a new spine version, one fast
// pass reviews the *proposed* document against the current one and surfaces
// problems the edits introduce — contradictions with unedited sections,
// references left dangling, or newly-required states left unspecified. It is
// ADVISORY: it never blocks the commit, and any transport/parse failure yields
// an empty (degraded) result so a flaky model can never wedge the flow.

import { callGemini, getFastModel } from '../geminiClient';
import { repairTruncatedJson } from '../jsonRepair';

export type EditReviewSeverity = 'high' | 'medium' | 'low';

export interface EditReviewFinding {
    severity: EditReviewSeverity;
    /** Short label. */
    title: string;
    /** One or two sentences: the problem and what to reconcile. */
    detail: string;
}

export interface EditReviewResult {
    findings: EditReviewFinding[];
    /** True when the review could not run and returned nothing (fail-open). */
    degraded: boolean;
}

/** Injectable transport for tests; defaults to a fast-model JSON call. */
export type EditReviewTransport = (input: {
    system: string;
    prompt: string;
    model: string;
}) => Promise<string>;

const REVIEW_SCHEMA = {
    type: 'OBJECT',
    properties: {
        findings: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                    title: { type: 'STRING' },
                    detail: { type: 'STRING' },
                },
                required: ['severity', 'title', 'detail'],
            },
        },
    },
    required: ['findings'],
} as const;

const SYSTEM = `You are a meticulous PRD reviewer checking a proposed EDIT for coherence with the rest of the document. `
    + `You are given the current PRD, the proposed PRD (after edits), and the specific changes. Report ONLY real problems the `
    + `changes introduce or leave unresolved: contradictions with sections that were NOT edited, references (features, screens, `
    + `terms) the edit now leaves dangling or renamed inconsistently, and states/requirements the change makes necessary but `
    + `leaves unspecified. Do not restate the edit, do not praise it, and do not invent issues to seem thorough — if the change `
    + `is coherent, return an empty findings array. Order findings by severity (most costly first).`;

const defaultTransport: EditReviewTransport = (input) =>
    callGemini(input.system, input.prompt, {
        model: input.model,
        responseMimeType: 'application/json',
        responseSchema: REVIEW_SCHEMA,
        temperature: 0.2,
    });

const isSeverity = (v: unknown): v is EditReviewSeverity =>
    v === 'high' || v === 'medium' || v === 'low';

/**
 * Review staged edits against the whole document. Advisory and fail-open: any
 * error returns `{ findings: [], degraded: true }`.
 */
export const reviewStagedEdits = async (input: {
    beforePrd: string;
    afterPrd: string;
    edits: { anchorText: string; replacement: string }[];
    transport?: EditReviewTransport;
    model?: string;
}): Promise<EditReviewResult> => {
    const { beforePrd, afterPrd, edits } = input;
    const transport = input.transport ?? defaultTransport;
    const model = input.model ?? getFastModel();

    const changeList = edits
        .map((e, i) => `Change ${i + 1}:\n  Selected: "${e.anchorText}"\n  Replaced with: "${e.replacement}"`)
        .join('\n');
    const prompt = `CHANGES BEING APPLIED:\n${changeList}\n\n`
        + `CURRENT PRD:\n${beforePrd}\n\n`
        + `PROPOSED PRD (after the changes):\n${afterPrd}`;

    try {
        const raw = await transport({ system: SYSTEM, prompt, model });
        const parsed = JSON.parse(repairTruncatedJson(raw).text) as { findings?: unknown };
        const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const findings: EditReviewFinding[] = rawFindings
            .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
            .map(f => ({
                severity: isSeverity(f.severity) ? f.severity : 'medium',
                title: typeof f.title === 'string' ? f.title : 'Issue',
                detail: typeof f.detail === 'string' ? f.detail : '',
            }))
            .filter(f => f.detail.trim().length > 0);
        return { findings, degraded: false };
    } catch (e) {
        console.error('[PRD edit review failed]', e);
        return { findings: [], degraded: true };
    }
};
