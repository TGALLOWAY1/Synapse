import type { ProjectPlatform, StructuredPRD } from '../../../types';
import { buildReviewContextManifest } from '../manifest';

export const structuredPRD: StructuredPRD = {
    productName: 'Careful AI',
    productCategory: 'health workflow',
    vision: 'Help clinicians summarize private patient notes with AI.',
    coreProblem: 'Clinical notes take too long to review.',
    targetUsers: ['Clinicians'],
    architecture: 'A web client calls an authenticated API and an LLM provider.',
    risks: ['Generated summaries may be inaccurate.'],
    constraints: ['Patient notes must remain private.'],
    features: [{
        id: 'f1',
        name: 'Note summary',
        description: 'Generate a concise summary from a patient note.',
        userValue: 'Review notes faster.',
        complexity: 'high',
        priority: 'must',
        acceptanceCriteria: ['A clinician can review the source note beside the summary.'],
    }],
};

export const makeManifest = (overrides: {
    platform?: ProjectPlatform;
    structuredPRD?: StructuredPRD;
    artifacts?: Parameters<typeof buildReviewContextManifest>[0]['artifacts'];
} = {}) => buildReviewContextManifest({
    projectId: 'project-1',
    projectName: 'Careful AI',
    platform: overrides.platform ?? 'web',
    productCategory: 'health workflow',
    capturedAt: 100,
    spine: {
        versionId: 'spine-v2',
        schemaVersion: 2,
        content: '# PRD\n\n## Vision\nHelp clinicians summarize private patient notes with AI.\n\n## Feature f1\nGenerate a concise summary from a patient note.',
        structuredPRD: overrides.structuredPRD ?? structuredPRD,
    },
    artifacts: overrides.artifacts ?? [
        {
            artifactId: 'screens',
            versionId: 'screens-v1',
            subtype: 'screen_inventory',
            title: 'Screen Inventory',
            content: '# Screen Inventory\n\n## Review screen\nThe clinician sees the source note beside the generated summary.',
        },
        {
            artifactId: 'data',
            versionId: 'data-v3',
            subtype: 'data_model',
            title: 'Data Model',
            content: '# Data Model\n\n## PatientNote\nStores note text and generated summary.\n\n## API endpoints\nPOST /summaries.',
        },
    ],
    safetyBoundaries: ['Do not provide autonomous diagnosis.'],
});

export const validCoverageChecks = (locator: ReturnType<typeof makeManifest>['locators'][number]) => [
    'problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions', 'specialist_boundary',
].map(area => ({
    area,
    conclusion: `The ${area.replaceAll('_', ' ')} was explicitly evaluated against the cited plan context.`,
    evidence: [{
        sourceKey: locator.sourceKey,
        locatorId: locator.id,
        path: locator.path,
        excerpt: locator.excerpt,
        excerptHash: locator.excerptHash,
    }],
}));

export function validResponse(locator: ReturnType<typeof makeManifest>['locators'][number], overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        coverageSummary: 'Reviewed the supplied plan within the specialist boundary.',
        resolvedAreas: [],
        coverageChecks: validCoverageChecks(locator),
        findings: [{
            title: 'Summary accuracy lacks an evaluation decision',
            observation: 'The plan identifies inaccurate summaries as a risk but provides no evaluation threshold.',
            type: 'missing_information',
            severity: 'high',
            confidence: 'high',
            implementationBlocking: true,
            canDefer: false,
            consequence: 'Different teams could ship incompatible quality bars.',
            decisionOrClarification: 'Define the minimum acceptable summary accuracy and evaluation set.',
            recommendedAction: 'Require an evaluation decision before implementation.',
            affectedFeatureIds: ['f1'],
            evidence: [{
                sourceKey: locator.sourceKey,
                locatorId: locator.id,
                path: locator.path,
                excerpt: locator.excerpt,
                excerptHash: locator.excerptHash,
            }],
            ...overrides,
        }],
    });
}
