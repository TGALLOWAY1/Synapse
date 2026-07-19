import type {
    CanonicalPrdSpine,
    CoreArtifactSubtype,
    ProjectPlatform,
    StructuredPRD,
} from '../../types';

export type ReviewSpecialistId =
    | 'product_scope'
    | 'ux_behavior'
    | 'architecture'
    | 'data_backend'
    | 'security_privacy'
    | 'accessibility'
    | 'reliability_qa'
    | 'ai_model_risk'
    | 'delivery_operations';

export type ReviewFindingType =
    | 'contradiction'
    | 'risk'
    | 'missing_information'
    | 'assumption'
    | 'recommendation'
    | 'optional_improvement'
    | 'user_judgment';

export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ReviewConfidence = 'low' | 'medium' | 'high';
export type ReviewCoverageArea =
    | 'problem'
    | 'primary_user'
    | 'intended_outcome'
    | 'first_release_scope'
    | 'material_assumptions'
    | 'specialist_boundary';

export interface ReviewSourceLocator {
    id: string;
    sourceKey: string;
    sourceType: 'spine' | 'artifact';
    spineVersionId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    artifactSubtype?: CoreArtifactSubtype;
    path: string;
    label: string;
    excerpt: string;
    excerptHash: string;
}

export interface ReviewManifestSource {
    sourceKey: string;
    sourceType: 'spine' | 'artifact';
    label: string;
    content: string;
    contentHash: string;
    spineVersionId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    artifactSubtype?: CoreArtifactSubtype;
}

export interface ReviewContextManifest {
    schemaVersion: 1;
    projectId: string;
    projectName: string;
    platform?: ProjectPlatform;
    productCategory?: string;
    capturedAt: number;
    spineVersionId: string;
    prdSchemaVersion?: number;
    canonicalSpine?: CanonicalPrdSpine;
    constraints: string[];
    safetyBoundaries: string[];
    sources: ReviewManifestSource[];
    locators: ReviewSourceLocator[];
    availableArtifacts: CoreArtifactSubtype[];
    missingArtifacts: CoreArtifactSubtype[];
    contextSignature: string;
}

export interface BuildReviewManifestInput {
    projectId: string;
    projectName: string;
    platform?: ProjectPlatform;
    productCategory?: string;
    capturedAt?: number;
    spine: {
        versionId: string;
        schemaVersion?: number;
        content: string;
        structuredPRD: StructuredPRD;
        canonicalSpine?: CanonicalPrdSpine;
    };
    artifacts: Array<{
        artifactId: string;
        versionId: string;
        subtype: CoreArtifactSubtype;
        title: string;
        content: string;
    }>;
    expectedArtifactSubtypes?: CoreArtifactSubtype[];
    safetyBoundaries?: string[];
}

export interface SpecialistEvidenceInput {
    sourceKey: string;
    locatorId?: string;
    path?: string;
    excerpt: string;
    excerptHash?: string;
}

export interface VerifiedEvidenceRef extends SpecialistEvidenceInput {
    locatorId: string;
    path: string;
    excerptHash: string;
    verified: boolean;
    failureReason?:
        | 'unknown_source'
        | 'unknown_locator'
        | 'locator_mismatch'
        | 'excerpt_too_short'
        | 'excerpt_mismatch'
        | 'hash_mismatch';
}

export interface ParsedSpecialistFinding {
    id: string;
    title: string;
    observation: string;
    type: ReviewFindingType;
    severity: ReviewSeverity;
    confidence: ReviewConfidence;
    implementationBlocking: boolean;
    canDefer: boolean;
    consequence: string;
    decisionOrClarification: string;
    recommendedAction: string;
    affectedFeatureIds: string[];
    evidence: SpecialistEvidenceInput[];
}

export interface ParsedSpecialistOutput {
    coverageSummary: string;
    resolvedAreas: string[];
    coverageChecks: Array<{
        area: ReviewCoverageArea;
        conclusion: string;
        evidence: SpecialistEvidenceInput[];
    }>;
    findings: ParsedSpecialistFinding[];
}

export type ValidatedCoverageCheck = {
    area: ReviewCoverageArea;
    conclusion: string;
    evidence: VerifiedEvidenceRef[];
};

export interface ValidatedSpecialistFinding extends Omit<ParsedSpecialistFinding, 'evidence'> {
    specialistId: ReviewSpecialistId;
    evidence: VerifiedEvidenceRef[];
    grounded: boolean;
    validationWarnings: string[];
    fingerprint: string;
}

export interface SpecialistDefinition {
    id: ReviewSpecialistId;
    label: string;
    responsibility: string;
    goals: string[];
    boundaries: string[];
    relevantArtifacts: CoreArtifactSubtype[];
}

export interface RecommendedSpecialist {
    specialistId: ReviewSpecialistId;
    score: number;
    reasons: string[];
}

export interface SpecialistRunResult {
    specialistId: ReviewSpecialistId;
    status: 'complete' | 'failed' | 'cancelled';
    attempts: number;
    findings: ValidatedSpecialistFinding[];
    coverageSummary?: string;
    resolvedAreas?: string[];
    coverageChecks?: ValidatedCoverageCheck[];
    error?: string;
}

export interface FindingCluster {
    id: string;
    title: string;
    findingIds: string[];
    specialistIds: ReviewSpecialistId[];
    severity: ReviewSeverity;
    consensus: 'single' | 'reinforcing' | 'disagreement';
    perspectives: Array<{
        specialistId: ReviewSpecialistId;
        findingId: string;
        recommendation: string;
    }>;
}

export interface ReviewOrchestrationResult {
    status: 'complete' | 'partial' | 'failed' | 'cancelled';
    specialistResults: SpecialistRunResult[];
    clusters: FindingCluster[];
    coverage: {
        selected: ReviewSpecialistId[];
        completed: ReviewSpecialistId[];
        failed: ReviewSpecialistId[];
        cancelled: ReviewSpecialistId[];
    };
}
