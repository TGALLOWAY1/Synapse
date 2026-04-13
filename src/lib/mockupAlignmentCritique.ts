import type { MockupScreen, MockupSettings, StructuredPRD } from '../types';

export type AlignmentSeverity = 'low' | 'medium' | 'high';

export interface MockupAlignmentIssue {
    code:
        | 'generic_dashboard_sludge'
        | 'missing_prd_concepts'
        | 'platform_mismatch'
        | 'scope_mismatch'
        | 'fidelity_mismatch'
        | 'generic_naming'
        | 'workflow_gap'
        | 'prd_feature_gap';
    severity: AlignmentSeverity;
    reason: string;
    recommendation: string;
}

export interface ScreenAlignmentCritique {
    screenId?: string;
    screenName: string;
    score: number;
    severity: AlignmentSeverity;
    missingConcepts: string[];
    mismatchReasons: string[];
    recommendations: string[];
    issues: MockupAlignmentIssue[];
}

export interface MockupAlignmentCritique {
    alignmentScore: number;
    severity: AlignmentSeverity;
    missingConcepts: string[];
    mismatchReasons: string[];
    recommendations: string[];
    issues: MockupAlignmentIssue[];
    screens: ScreenAlignmentCritique[];
}

interface ProductConceptContext {
    personaTerms: string[];
    corePurposeTerms: string[];
    entityTerms: string[];
    workflowTerms: string[];
    productTerms: string[];
}

const GENERIC_SLUDGE_PATTERNS: RegExp[] = [
    /overview dashboard/i,
    /kpi(?:s)?/i,
    /revenue summary/i,
    /active users/i,
    /analytics panel/i,
    /item [abc123]/i,
    /team workspace/i,
    /project alpha/i,
    /generic/i,
];

const stripHtml = (value: string): string => value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

const extractCandidateTerms = (value: string): string[] => {
    const normalized = normalizeToken(value);
    if (!normalized) return [];

    const words = normalized.split(' ').filter(w => w.length >= 4);
    const phrases = normalized
        .split(/[.,;:()\n-]/)
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length >= 6)
        .slice(0, 20);

    return [...new Set([...words, ...phrases])];
};

const classifySeverity = (score: number): AlignmentSeverity => {
    if (score >= 80) return 'low';
    if (score >= 55) return 'medium';
    return 'high';
};

const buildConceptContext = (prdContent: string, structuredPRD?: StructuredPRD): ProductConceptContext => {
    if (!structuredPRD) {
        const fallbackTerms = extractCandidateTerms(prdContent).slice(0, 30);
        return {
            personaTerms: fallbackTerms,
            corePurposeTerms: fallbackTerms,
            entityTerms: fallbackTerms,
            workflowTerms: fallbackTerms,
            productTerms: fallbackTerms,
        };
    }

    const personaTerms = structuredPRD.targetUsers.flatMap(extractCandidateTerms).slice(0, 20);
    const corePurposeTerms = [structuredPRD.vision, structuredPRD.coreProblem]
        .flatMap(extractCandidateTerms)
        .slice(0, 30);
    const featureTerms = structuredPRD.features
        .flatMap(feature => [feature.name, feature.description, feature.userValue])
        .flatMap(extractCandidateTerms)
        .slice(0, 80);

    const entityTerms = featureTerms.filter(term => !/user|workflow|screen|feature/.test(term)).slice(0, 40);
    const workflowTerms = featureTerms.filter(term => /(create|edit|review|submit|approve|track|configure|assign|flow|step|stage|sync|share)/.test(term)).slice(0, 30);

    return {
        personaTerms,
        corePurposeTerms,
        entityTerms,
        workflowTerms,
        productTerms: [...new Set([...personaTerms, ...corePurposeTerms, ...featureTerms])],
    };
};

const countTermCoverage = (haystack: string, terms: string[]): number => {
    if (!terms.length) return 0;
    const normalizedHaystack = normalizeToken(haystack);
    return terms.reduce((count, term) => (normalizedHaystack.includes(term) ? count + 1 : count), 0);
};

const critiqueScreen = (
    screen: MockupScreen,
    context: ProductConceptContext,
    settings: MockupSettings,
): ScreenAlignmentCritique => {
    const issues: MockupAlignmentIssue[] = [];
    const screenText = `${screen.name} ${screen.purpose} ${stripHtml(screen.html)} ${screen.notes ?? ''}`;

    const personaCoverage = countTermCoverage(screenText, context.personaTerms.slice(0, 8));
    const purposeCoverage = countTermCoverage(screenText, context.corePurposeTerms.slice(0, 12));
    const entityCoverage = countTermCoverage(screenText, context.entityTerms.slice(0, 15));
    const workflowCoverage = countTermCoverage(screenText, context.workflowTerms.slice(0, 12));

    if (GENERIC_SLUDGE_PATTERNS.some(pattern => pattern.test(screenText))) {
        issues.push({
            code: 'generic_dashboard_sludge',
            severity: 'high',
            reason: 'Screen language looks like a generic dashboard instead of a product-specific concept.',
            recommendation: 'Use PRD entities, workflows, and domain nouns in labels, table columns, and CTAs.',
        });
    }

    const missingConcepts: string[] = [];
    if (personaCoverage === 0) missingConcepts.push('primary user type');
    if (purposeCoverage < 2) missingConcepts.push('core product purpose');
    if (entityCoverage < 2) missingConcepts.push('main entities/objects');
    if (workflowCoverage === 0) missingConcepts.push('primary user actions/workflows');

    if (missingConcepts.length > 0) {
        issues.push({
            code: 'missing_prd_concepts',
            severity: missingConcepts.length >= 3 ? 'high' : 'medium',
            reason: `Screen is weakly grounded in PRD context: missing ${missingConcepts.join(', ')}.`,
            recommendation: 'Tie title, purpose, and key UI regions directly to PRD persona, entities, and workflows.',
        });
    }

    if (/dashboard|home|overview/i.test(screen.name) && context.productTerms.length > 0) {
        const domainMentions = countTermCoverage(screen.name, context.productTerms.slice(0, 20));
        if (domainMentions === 0) {
            issues.push({
                code: 'generic_naming',
                severity: 'medium',
                reason: 'Screen name is generic and does not include product-specific terminology.',
                recommendation: 'Rename screen with domain language from the PRD (entity + workflow).',
            });
        }
    }

    const normalizedHtml = screen.html.toLowerCase();
    if (settings.platform === 'mobile' && !/(max-w-\[420px\]|bottom tab|bottom-0|w-full)/.test(normalizedHtml)) {
        issues.push({
            code: 'platform_mismatch',
            severity: 'medium',
            reason: 'Mobile platform requested but mobile framing cues are weak.',
            recommendation: 'Constrain width and include touch-native navigation patterns for mobile mockups.',
        });
    }
    if (settings.platform === 'desktop' && /(bottom tab|fixed bottom-0)/.test(normalizedHtml)) {
        issues.push({
            code: 'platform_mismatch',
            severity: 'medium',
            reason: 'Desktop platform requested but screen uses mobile navigation assumptions.',
            recommendation: 'Use desktop shell patterns (sidebar/topbar/grid) for desktop outputs.',
        });
    }

    const styleClassCount = (screen.html.match(/class\s*=\s*['"][^'"]+['"]/g) ?? []).length;
    if (settings.fidelity === 'high' && styleClassCount < 10) {
        issues.push({
            code: 'fidelity_mismatch',
            severity: 'medium',
            reason: 'High-fidelity requested, but visual density appears too sparse.',
            recommendation: 'Add richer component hierarchy, realistic data blocks, and stronger visual polish.',
        });
    }

    const penalties = issues.reduce((sum, issue) => sum + (issue.severity === 'high' ? 25 : issue.severity === 'medium' ? 12 : 6), 0);
    const score = Math.max(0, 100 - penalties);

    return {
        screenId: screen.id,
        screenName: screen.name,
        score,
        severity: classifySeverity(score),
        missingConcepts,
        mismatchReasons: issues.map(issue => issue.reason),
        recommendations: [...new Set(issues.map(issue => issue.recommendation))],
        issues,
    };
};

export const critiqueMockupAlignment = (
    screens: MockupScreen[],
    settings: MockupSettings,
    prdContent: string,
    structuredPRD?: StructuredPRD,
): MockupAlignmentCritique => {
    const context = buildConceptContext(prdContent, structuredPRD);
    const screenReports = screens.map(screen => critiqueScreen(screen, context, settings));

    const issues: MockupAlignmentIssue[] = [...screenReports.flatMap(report => report.issues)];
    const missingConcepts = [...new Set(screenReports.flatMap(report => report.missingConcepts))];

    const scopeMismatch =
        (settings.scope === 'single_screen' && screens.length !== 1)
        || (settings.scope === 'multi_screen' && (screens.length < 3 || screens.length > 4))
        || (settings.scope === 'key_workflow' && (screens.length < 3 || screens.length > 5));

    if (scopeMismatch) {
        issues.push({
            code: 'scope_mismatch',
            severity: 'medium',
            reason: `Screen count (${screens.length}) does not match requested scope (${settings.scope}).`,
            recommendation: 'Regenerate with scope-compliant number of screens and clearer sequencing.',
        });
    }

    const lowWorkflowCoverage = screenReports.filter(report => report.missingConcepts.includes('primary user actions/workflows')).length;
    if (settings.scope === 'key_workflow' && lowWorkflowCoverage > Math.floor(screens.length / 2)) {
        issues.push({
            code: 'workflow_gap',
            severity: 'high',
            reason: 'Most screens do not express a coherent end-to-end workflow.',
            recommendation: 'Ensure each screen represents a sequential workflow step and uses continuation cues.',
        });
    }

    const featureGapThreshold = Math.max(1, Math.floor(context.entityTerms.length * 0.15));
    const totalEntityMentions = screens.reduce((sum, screen) => sum + countTermCoverage(
        `${screen.name} ${screen.purpose} ${stripHtml(screen.html)} ${screen.notes ?? ''}`,
        context.entityTerms,
    ), 0);
    if (context.entityTerms.length > 0 && totalEntityMentions <= featureGapThreshold) {
        issues.push({
            code: 'prd_feature_gap',
            severity: 'high',
            reason: 'Screens do not visibly represent key PRD entities/features.',
            recommendation: 'Surface PRD features directly in navigation labels, sections, cards, and action buttons.',
        });
    }

    const penalties = issues.reduce((sum, issue) => sum + (issue.severity === 'high' ? 18 : issue.severity === 'medium' ? 10 : 5), 0);
    const avgScreenScore = screenReports.length
        ? screenReports.reduce((sum, report) => sum + report.score, 0) / screenReports.length
        : 0;
    const alignmentScore = Math.max(0, Math.round(Math.max(0, avgScreenScore - penalties * 0.35)));

    return {
        alignmentScore,
        severity: classifySeverity(alignmentScore),
        missingConcepts,
        mismatchReasons: issues.map(issue => issue.reason),
        recommendations: [...new Set(issues.map(issue => issue.recommendation))],
        issues,
        screens: screenReports,
    };
};
