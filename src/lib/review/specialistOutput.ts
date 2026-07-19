import { hashReviewValue } from './hash';
import type {
    ParsedSpecialistFinding,
    ParsedSpecialistOutput,
    ReviewCoverageArea,
    ReviewConfidence,
    ReviewFindingType,
    ReviewSeverity,
    SpecialistEvidenceInput,
} from './types';

const FINDING_TYPES: ReviewFindingType[] = [
    'contradiction', 'risk', 'missing_information', 'assumption', 'recommendation', 'optional_improvement', 'user_judgment',
];
const SEVERITIES: ReviewSeverity[] = ['low', 'medium', 'high', 'critical'];
const CONFIDENCES: ReviewConfidence[] = ['low', 'medium', 'high'];
const COVERAGE_AREAS: ReviewCoverageArea[] = [
    'problem', 'primary_user', 'intended_outcome', 'first_release_scope',
    'material_assumptions', 'specialist_boundary',
];

const evidenceSchema = {
    type: 'ARRAY',
    items: {
        type: 'OBJECT',
        properties: {
            sourceKey: { type: 'STRING' }, locatorId: { type: 'STRING' },
            path: { type: 'STRING' }, excerpt: { type: 'STRING' }, excerptHash: { type: 'STRING' },
        },
        required: ['sourceKey', 'locatorId', 'path', 'excerpt'],
    },
};

export const specialistOutputSchema = {
    type: 'OBJECT',
    properties: {
        coverageSummary: { type: 'STRING' },
        resolvedAreas: { type: 'ARRAY', items: { type: 'STRING' } },
        coverageChecks: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    area: { type: 'STRING', enum: COVERAGE_AREAS },
                    conclusion: { type: 'STRING' },
                    evidence: evidenceSchema,
                },
                required: ['area', 'conclusion', 'evidence'],
            },
        },
        findings: {
            type: 'ARRAY',
            maxItems: 12,
            items: {
                type: 'OBJECT',
                properties: {
                    title: { type: 'STRING' },
                    observation: { type: 'STRING' },
                    type: { type: 'STRING', enum: FINDING_TYPES },
                    severity: { type: 'STRING', enum: SEVERITIES },
                    confidence: { type: 'STRING', enum: CONFIDENCES },
                    implementationBlocking: { type: 'BOOLEAN' },
                    canDefer: { type: 'BOOLEAN' },
                    consequence: { type: 'STRING' },
                    decisionOrClarification: { type: 'STRING' },
                    recommendedAction: { type: 'STRING' },
                    affectedFeatureIds: { type: 'ARRAY', items: { type: 'STRING' } },
                    evidence: evidenceSchema,
                },
                required: [
                    'title', 'observation', 'type', 'severity', 'confidence',
                    'implementationBlocking', 'canDefer', 'consequence',
                    'decisionOrClarification', 'recommendedAction', 'affectedFeatureIds', 'evidence',
                ],
            },
        },
    },
    required: ['coverageSummary', 'resolvedAreas', 'coverageChecks', 'findings'],
};

export class SpecialistOutputValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpecialistOutputValidationError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new SpecialistOutputValidationError(`${field} must be an array of strings`);
    }
    return value.map(item => item.trim()).filter(Boolean);
};
const requiredString = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new SpecialistOutputValidationError(`${key} must be a non-empty string`);
    }
    return value.trim();
};
const requiredBoolean = (record: Record<string, unknown>, key: string): boolean => {
    if (typeof record[key] !== 'boolean') {
        throw new SpecialistOutputValidationError(`${key} must be a boolean`);
    }
    return record[key];
};

function parseEvidence(value: unknown, fieldPath: string): SpecialistEvidenceInput[] {
    if (!Array.isArray(value)) {
        throw new SpecialistOutputValidationError(`${fieldPath} must be an array`);
    }
    return value.map((item, evidenceIndex) => {
        if (!isRecord(item)) {
            throw new SpecialistOutputValidationError(`${fieldPath}[${evidenceIndex}] must be an object`);
        }
        const sourceKey = requiredString(item, 'sourceKey');
        const excerpt = requiredString(item, 'excerpt');
        const locatorId = typeof item.locatorId === 'string' && item.locatorId.trim() ? item.locatorId.trim() : undefined;
        const path = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : undefined;
        if (!locatorId && !path) {
            throw new SpecialistOutputValidationError(`${fieldPath}[${evidenceIndex}] needs locatorId or path`);
        }
        return {
            sourceKey,
            locatorId,
            path,
            excerpt,
            excerptHash: typeof item.excerptHash === 'string' && item.excerptHash.trim() ? item.excerptHash.trim() : undefined,
        };
    });
}

function parseFinding(value: unknown, index: number): ParsedSpecialistFinding {
    if (!isRecord(value)) throw new SpecialistOutputValidationError(`findings[${index}] must be an object`);
    const title = requiredString(value, 'title');
    const type = requiredString(value, 'type') as ReviewFindingType;
    const severity = requiredString(value, 'severity') as ReviewSeverity;
    const confidence = requiredString(value, 'confidence') as ReviewConfidence;
    if (!FINDING_TYPES.includes(type)) throw new SpecialistOutputValidationError(`findings[${index}].type is invalid`);
    if (!SEVERITIES.includes(severity)) throw new SpecialistOutputValidationError(`findings[${index}].severity is invalid`);
    if (!CONFIDENCES.includes(confidence)) throw new SpecialistOutputValidationError(`findings[${index}].confidence is invalid`);
    return {
        id: `finding-${hashReviewValue(`${index}:${title}:${requiredString(value, 'observation')}`)}`,
        title,
        observation: requiredString(value, 'observation'),
        type,
        severity,
        confidence,
        implementationBlocking: requiredBoolean(value, 'implementationBlocking'),
        canDefer: requiredBoolean(value, 'canDefer'),
        consequence: requiredString(value, 'consequence'),
        decisionOrClarification: requiredString(value, 'decisionOrClarification'),
        recommendedAction: requiredString(value, 'recommendedAction'),
        affectedFeatureIds: strings(value.affectedFeatureIds, `findings[${index}].affectedFeatureIds`),
        evidence: parseEvidence(value.evidence, `findings[${index}].evidence`),
    };
}

export function parseSpecialistOutput(raw: string): ParsedSpecialistOutput {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new SpecialistOutputValidationError('Specialist response was not valid JSON');
    }
    if (!isRecord(parsed)) throw new SpecialistOutputValidationError('Specialist response must be an object');
    if (!Array.isArray(parsed.findings)) throw new SpecialistOutputValidationError('findings must be an array');
    if (!Array.isArray(parsed.coverageChecks) || parsed.coverageChecks.length === 0) {
        throw new SpecialistOutputValidationError('coverageChecks must be a non-empty array');
    }
    if (parsed.findings.length > 12) throw new SpecialistOutputValidationError('findings exceeds the limit of 12');
    return {
        coverageSummary: requiredString(parsed, 'coverageSummary'),
        resolvedAreas: strings(parsed.resolvedAreas, 'resolvedAreas'),
        coverageChecks: parsed.coverageChecks.map((value, index) => {
            if (!isRecord(value)) throw new SpecialistOutputValidationError(`coverageChecks[${index}] must be an object`);
            const area = requiredString(value, 'area') as ReviewCoverageArea;
            if (!COVERAGE_AREAS.includes(area)) throw new SpecialistOutputValidationError(`coverageChecks[${index}].area is invalid`);
            return {
                area,
                conclusion: requiredString(value, 'conclusion'),
                evidence: parseEvidence(value.evidence, `coverageChecks[${index}].evidence`),
            };
        }),
        findings: parsed.findings.map(parseFinding),
    };
}
