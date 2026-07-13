import { hashReviewValue } from './hash';
import type {
    ParsedSpecialistFinding,
    ParsedSpecialistOutput,
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

export const specialistOutputSchema = {
    type: 'OBJECT',
    properties: {
        coverageSummary: { type: 'STRING' },
        resolvedAreas: { type: 'ARRAY', items: { type: 'STRING' } },
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
                    evidence: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                sourceKey: { type: 'STRING' },
                                locatorId: { type: 'STRING' },
                                path: { type: 'STRING' },
                                excerpt: { type: 'STRING' },
                                excerptHash: { type: 'STRING' },
                            },
                            required: ['sourceKey', 'locatorId', 'path', 'excerpt'],
                        },
                    },
                },
                required: [
                    'title', 'observation', 'type', 'severity', 'confidence',
                    'implementationBlocking', 'canDefer', 'consequence',
                    'decisionOrClarification', 'recommendedAction', 'affectedFeatureIds', 'evidence',
                ],
            },
        },
    },
    required: ['coverageSummary', 'resolvedAreas', 'findings'],
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

function parseEvidence(value: unknown, findingIndex: number): SpecialistEvidenceInput[] {
    if (!Array.isArray(value)) {
        throw new SpecialistOutputValidationError(`findings[${findingIndex}].evidence must be an array`);
    }
    return value.map((item, evidenceIndex) => {
        if (!isRecord(item)) {
            throw new SpecialistOutputValidationError(`findings[${findingIndex}].evidence[${evidenceIndex}] must be an object`);
        }
        const sourceKey = requiredString(item, 'sourceKey');
        const excerpt = requiredString(item, 'excerpt');
        const locatorId = typeof item.locatorId === 'string' && item.locatorId.trim() ? item.locatorId.trim() : undefined;
        const path = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : undefined;
        if (!locatorId && !path) {
            throw new SpecialistOutputValidationError(`findings[${findingIndex}].evidence[${evidenceIndex}] needs locatorId or path`);
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
        evidence: parseEvidence(value.evidence, index),
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
    if (parsed.findings.length > 12) throw new SpecialistOutputValidationError('findings exceeds the limit of 12');
    return {
        coverageSummary: requiredString(parsed, 'coverageSummary'),
        resolvedAreas: strings(parsed.resolvedAreas, 'resolvedAreas'),
        findings: parsed.findings.map(parseFinding),
    };
}
