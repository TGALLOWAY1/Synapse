import { describe, expect, it } from 'vitest';
import { clusterGroundedFindings, validateSpecialistFindings } from '../normalize';
import { parseSpecialistOutput, SpecialistOutputValidationError } from '../specialistOutput';
import { makeManifest, validResponse } from './reviewTestUtils';

describe('specialist output and clustering', () => {
    it('accepts a strong plan with zero findings', () => {
        const output = parseSpecialistOutput(JSON.stringify({
            coverageSummary: 'The reviewed area is sufficiently resolved.',
            resolvedAreas: ['Error recovery is explicit.'],
            findings: [],
        }));
        expect(output.findings).toEqual([]);
    });

    it('rejects invalid closed-set fields', () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        expect(() => parseSpecialistOutput(validResponse(locator, { severity: 'dramatic' })))
            .toThrow(SpecialistOutputValidationError);
    });

    it('accepts inferred assumptions as a distinct finding type', () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const output = parseSpecialistOutput(validResponse(locator, { type: 'assumption' }));
        expect(output.findings[0].type).toBe('assumption');
    });

    it('clusters grounded duplicates while preserving conflicting perspectives', () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const parsed = parseSpecialistOutput(validResponse(locator));
        const product = validateSpecialistFindings(manifest, 'product_scope', parsed.findings);
        const aiParsed = parseSpecialistOutput(validResponse(locator, {
            title: 'Summary accuracy needs an evaluation decision',
            recommendedAction: 'Defer the evaluation requirement until after launch.',
        }));
        const ai = validateSpecialistFindings(manifest, 'ai_model_risk', aiParsed.findings);
        const clusters = clusterGroundedFindings([...product, ...ai]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].findingIds).toHaveLength(2);
        expect(clusters[0].consensus).toBe('disagreement');
        expect(clusters[0].perspectives.map(item => item.specialistId)).toEqual(['product_scope', 'ai_model_risk']);
    });

    it('keeps unsupported findings auditable but out of trusted clusters', () => {
        const manifest = makeManifest();
        const locator = manifest.locators.find(item => item.path === 'prd.risks')!;
        const parsed = parseSpecialistOutput(validResponse(locator));
        parsed.findings[0].evidence[0].excerpt = 'This requirement does not exist in the source.';
        parsed.findings[0].evidence[0].excerptHash = undefined;
        const findings = validateSpecialistFindings(manifest, 'ai_model_risk', parsed.findings);
        expect(findings[0].grounded).toBe(false);
        expect(findings[0].validationWarnings[0]).toContain('excerpt_mismatch');
        expect(clusterGroundedFindings(findings)).toEqual([]);
    });

    it('does not merge unrelated findings solely because they share a generic title', () => {
        const manifest = makeManifest();
        const risk = manifest.locators.find(item => item.path === 'prd.risks')!;
        const vision = manifest.locators.find(item => item.path === 'prd.vision')!;
        const accuracy = validateSpecialistFindings(manifest, 'product_scope', parseSpecialistOutput(validResponse(risk, {
            title: 'Missing requirement',
            observation: 'Summary accuracy has no acceptance threshold.',
            affectedFeatureIds: [],
        })).findings);
        const retention = validateSpecialistFindings(manifest, 'security_privacy', parseSpecialistOutput(validResponse(vision, {
            title: 'Missing requirement',
            observation: 'Patient note retention has no deletion policy.',
            affectedFeatureIds: [],
        })).findings);
        expect(clusterGroundedFindings([...accuracy, ...retention])).toHaveLength(2);
    });
});
