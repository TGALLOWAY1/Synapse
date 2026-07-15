import type { ReviewCoverageArea, ReviewSpecialistId } from './types';

export const PRODUCT_READINESS_COVERAGE_AREAS: ReviewCoverageArea[] = [
    'problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions',
];

const PRODUCT_PATHS: Record<Exclude<ReviewCoverageArea, 'specialist_boundary'>, string[]> = {
    problem: ['prd.coreProblem'],
    primary_user: ['prd.targetUsers'],
    intended_outcome: ['prd.successMetrics', 'prd.vision'],
    first_release_scope: ['prd.mvpScope', 'prd.features.'],
    material_assumptions: ['prd.assumptions', 'prd.risks'],
};

const SPECIALIST_PATHS: Record<Exclude<ReviewSpecialistId, 'product_scope'>, string[]> = {
    ux_behavior: ['prd.targetUsers', 'prd.features.', 'prd.uxPages.'],
    architecture: ['prd.architecture', 'prd.constraints', 'prd.features.'],
    data_backend: ['prd.architecture', 'prd.entities.', 'prd.features.'],
    security_privacy: ['prd.constraints', 'prd.risks', 'prd.architecture'],
    accessibility: ['prd.uxPages.', 'prd.targetUsers', 'prd.constraints'],
    reliability_qa: ['prd.risks', 'prd.nonFunctionalRequirements', 'prd.features.'],
    ai_model_risk: ['prd.risks', 'prd.constraints', 'prd.features.'],
    delivery_operations: ['prd.architecture', 'prd.constraints', 'prd.nonFunctionalRequirements'],
};

const matchesPath = (path: string, allowed: string): boolean => (
    allowed.endsWith('.')
        ? path.startsWith(allowed)
        : path === allowed || path.startsWith(`${allowed}.chunk-`)
);

/** Coverage evidence is deliberately limited to deterministic structured PRD
 * paths. Artifact evidence remains valid for findings, but cannot manufacture
 * a readiness-wide no-finding conclusion that cannot be revalidated later. */
export function coveragePathSupports(
    specialistId: string,
    area: ReviewCoverageArea,
    path: string,
): boolean {
    if (area !== 'specialist_boundary') {
        return specialistId === 'product_scope'
            && PRODUCT_PATHS[area].some(allowed => matchesPath(path, allowed));
    }
    if (specialistId === 'product_scope' || !(specialistId in SPECIALIST_PATHS)) return false;
    return SPECIALIST_PATHS[specialistId as keyof typeof SPECIALIST_PATHS]
        .some(allowed => matchesPath(path, allowed));
}

