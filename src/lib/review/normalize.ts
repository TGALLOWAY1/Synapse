import { hashReviewValue } from './hash';
import { verifyEvidenceRef } from './manifest';
import type {
    FindingCluster,
    ParsedSpecialistFinding,
    ReviewContextManifest,
    ReviewSeverity,
    ReviewSpecialistId,
    ValidatedSpecialistFinding,
} from './types';

const STOPWORDS = new Set([
    'about', 'after', 'again', 'against', 'being', 'could', 'from', 'have', 'into',
    'must', 'plan', 'project', 'should', 'that', 'their', 'there', 'these', 'this',
    'through', 'user', 'users', 'with', 'would',
]);
const SEVERITY_RANK: Record<ReviewSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function tokens(value: string): Set<string> {
    return new Set((value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(token => !STOPWORDS.has(token)));
}

function similarity(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) return 0;
    let intersection = 0;
    for (const token of left) if (right.has(token)) intersection++;
    return intersection / new Set([...left, ...right]).size;
}

function findingFingerprint(finding: ParsedSpecialistFinding, locatorIds: string[]): string {
    return hashReviewValue({
        titleTokens: [...tokens(finding.title)].sort(),
        affectedFeatureIds: finding.affectedFeatureIds.slice().sort(),
        locatorIds: locatorIds.slice().sort(),
    });
}

export function validateSpecialistFindings(
    manifest: ReviewContextManifest,
    specialistId: ReviewSpecialistId,
    findings: ParsedSpecialistFinding[],
): ValidatedSpecialistFinding[] {
    return findings.map((finding, index) => {
        const evidence = finding.evidence.map(item => verifyEvidenceRef(manifest, item));
        const warnings = evidence
            .filter(item => !item.verified)
            .map(item => `${item.sourceKey}:${item.path || item.locatorId} — ${item.failureReason}`);
        const grounded = evidence.length > 0 && evidence.every(item => item.verified);
        const id = `${specialistId}-${finding.id}-${index + 1}`;
        return {
            ...finding,
            id,
            specialistId,
            evidence,
            grounded,
            validationWarnings: warnings,
            fingerprint: findingFingerprint(finding, evidence.filter(item => item.verified).map(item => item.locatorId)),
        };
    });
}

function sharesEvidence(left: ValidatedSpecialistFinding, right: ValidatedSpecialistFinding): boolean {
    const leftLocators = new Set(left.evidence.filter(item => item.verified).map(item => item.locatorId));
    return right.evidence.some(item => item.verified && leftLocators.has(item.locatorId));
}

function sharesFeature(left: ValidatedSpecialistFinding, right: ValidatedSpecialistFinding): boolean {
    const ids = new Set(left.affectedFeatureIds.map(id => id.toLowerCase()));
    return right.affectedFeatureIds.some(id => ids.has(id.toLowerCase()));
}

function sameUnderlyingIssue(left: ValidatedSpecialistFinding, right: ValidatedSpecialistFinding): boolean {
    if (left.fingerprint === right.fingerprint) return true;
    const titleScore = similarity(tokens(left.title), tokens(right.title));
    const bodyScore = similarity(tokens(`${left.title} ${left.observation}`), tokens(`${right.title} ${right.observation}`));
    const anchoredTogether = sharesEvidence(left, right) || sharesFeature(left, right);
    return titleScore >= 0.65 || (anchoredTogether && bodyScore >= 0.35);
}

const OPPOSING_TERMS: Array<[RegExp, RegExp]> = [
    [/\b(remove|defer|exclude|avoid)\b/i, /\b(add|include|retain|require)\b/i],
    [/\b(optional|nonblocking)\b/i, /\b(required|blocking|mandatory)\b/i],
    [/\bclient(?:-side)?\b/i, /\bserver(?:-side)?\b/i],
    [/\bsynchronous\b/i, /\basynchronous\b/i],
    [/\bcentralized\b/i, /\bdistributed\b/i],
    [/\ballow\b/i, /\b(block|deny|prevent)\b/i],
];

function recommendationsConflict(findings: ValidatedSpecialistFinding[]): boolean {
    for (let i = 0; i < findings.length; i++) {
        for (let j = i + 1; j < findings.length; j++) {
            const left = findings[i].recommendedAction;
            const right = findings[j].recommendedAction;
            if (OPPOSING_TERMS.some(([a, b]) => (a.test(left) && b.test(right)) || (b.test(left) && a.test(right)))) {
                return true;
            }
        }
    }
    return false;
}

export function clusterGroundedFindings(findings: ValidatedSpecialistFinding[]): FindingCluster[] {
    const grounded = findings.filter(finding => finding.grounded);
    const groups: ValidatedSpecialistFinding[][] = [];
    for (const finding of grounded) {
        const group = groups.find(existing => existing.some(member => sameUnderlyingIssue(member, finding)));
        if (group) group.push(finding);
        else groups.push([finding]);
    }

    return groups.map((group): FindingCluster => {
        const sorted = group.slice().sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
        const specialistIds = [...new Set(group.map(finding => finding.specialistId))];
        const conflict = recommendationsConflict(group);
        return {
            id: `issue-${hashReviewValue(group.map(finding => finding.fingerprint).sort())}`,
            title: sorted[0].title,
            findingIds: group.map(finding => finding.id),
            specialistIds,
            severity: sorted[0].severity,
            consensus: conflict ? 'disagreement' : specialistIds.length > 1 ? 'reinforcing' : 'single',
            perspectives: group.map(finding => ({
                specialistId: finding.specialistId,
                findingId: finding.id,
                recommendation: finding.recommendedAction,
            })),
        };
    }).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
