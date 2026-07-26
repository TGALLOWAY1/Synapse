import { describe, expect, it } from 'vitest';
import type {
    DataModelContent,
    PlanMeasurementSection,
    PlanSecurityPrivacySection,
    StructuredPRD,
} from '../../../types';
import {
    deriveCrossCuttingObligations,
    deriveCrossCuttingRequirements,
} from '../crossCuttingObligations';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help people build playlists that match a mood.',
    targetUsers: ['Music listeners'],
    coreProblem: 'Playlists do not adapt to how someone feels.',
    features: [
        {
            id: 'f1',
            name: 'Mood capture',
            description: 'Capture a mood in five seconds.',
            userValue: 'Fast start',
            complexity: 'medium',
        },
    ],
    architecture: 'React SPA with a serverless API.',
    risks: [],
    ...overrides,
});

const dataModel = (overrides: Partial<DataModelContent> = {}): DataModelContent => ({
    entities: [
        {
            name: 'MoodSnapshot',
            description: 'One captured mood.',
            fields: [{ name: 'joy_score', type: 'Float', required: true, description: 'Joy 0-1.' }],
            relationships: [],
        },
    ],
    ...overrides,
});

const satisfiedSecurity: PlanSecurityPrivacySection = {
    summary: 'PII is encrypted at rest and access is owner-scoped.',
    controls: [
        {
            id: 'sec_encrypt_pii',
            title: 'Encrypt PII at rest',
            obligation: 'GDPR data-protection requirement in the PRD constraints.',
            implementation: 'Column-level encryption on the users table.',
            requirementIds: ['f1'],
            taskIds: ['task_encrypt_columns'],
            tests: ['Stored email column is unreadable without the app key'],
        },
    ],
};

const satisfiedMeasurement: PlanMeasurementSection = {
    summary: 'Activation and retention are instrumented from day one.',
    metrics: [
        {
            id: 'mm_activation',
            metric: 'Day-1 activation rate',
            eventName: 'playlist_generated',
            properties: ['user_id: string', 'mood_id: string'],
            trigger: 'A playlist finishes generating for a first-time user.',
            validation: 'Verify the event lands in the analytics debug view before launch.',
            taskIds: ['task_add_analytics'],
        },
    ],
};

describe('deriveCrossCuttingObligations — trigger conditions', () => {
    it('requires neither section for a project with no safety, privacy, or metric signals', () => {
        const report = deriveCrossCuttingObligations({ prd: prd(), dataModel: dataModel() });

        expect(report.securityPrivacy.required).toBe(false);
        expect(report.measurement.required).toBe(false);
        expect(report.securityPrivacy.missing).toEqual([]);
        expect(report.measurement.missing).toEqual([]);
        // Not required is never "satisfied" — there is nothing to satisfy.
        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.measurement.satisfied).toBe(false);
        expect(report.unresolved).toEqual([]);
        expect(report.hasUnresolvedObligations).toBe(false);
        expect(report.securityPrivacy.reason).toMatch(/^Not required/);
        expect(report.measurement.reason).toMatch(/^Not required/);
    });

    it('requires security & privacy when the spine carries a restricted safety verdict', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            safety: {
                classification: 'allowed_with_restrictions',
                status: 'restricted',
                detectedConcerns: ['Simulated phishing content'],
            },
        });

        expect(report.securityPrivacy.required).toBe(true);
        expect(report.securityPrivacy.triggers.map(t => t.source)).toEqual(['safety_review']);
        expect(report.securityPrivacy.triggers[0].detail).toContain('Simulated phishing content');
        expect(report.measurement.required).toBe(false);
    });

    it('requires security & privacy for detected concerns even on an allowed spine', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            safety: { classification: 'allowed', status: 'generated', boundaries: ['No credential capture'] },
        });

        expect(report.securityPrivacy.required).toBe(true);
        expect(report.securityPrivacy.triggers[0].detail).toContain('No credential capture');
    });

    it('does not fire the safety trigger for a clean allowed spine', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            safety: { classification: 'allowed', status: 'generated', detectedConcerns: [] },
        });

        expect(report.securityPrivacy.required).toBe(false);
    });

    it('requires security & privacy from PRD privacy requirements and risks', () => {
        const fromConstraint = deriveCrossCuttingObligations({
            prd: prd({ constraints: ['Must be GDPR compliant in the EU'] }),
        });
        expect(fromConstraint.securityPrivacy.triggers.map(t => t.source)).toEqual(['prd_privacy_requirement']);

        const fromNfr = deriveCrossCuttingObligations({
            prd: prd({ nonFunctionalRequirements: ['All PII encrypted in transit and at rest'] }),
        });
        expect(fromNfr.securityPrivacy.triggers.map(t => t.source)).toEqual(['prd_privacy_requirement']);

        const fromRisk = deriveCrossCuttingObligations({
            prd: prd({ risks: ['A security incident would expose listener history'] }),
        });
        expect(fromRisk.securityPrivacy.required).toBe(true);
        expect(fromRisk.securityPrivacy.triggers.map(t => t.source)).toEqual(['prd_privacy_risk']);

        const fromDetailedRisk = deriveCrossCuttingObligations({
            prd: prd({
                risksDetailed: [{
                    risk: 'Consent is not captured before face scanning',
                    likelihood: 'med',
                    impact: 'Regulatory exposure',
                    mitigation: 'Explicit consent step',
                }],
            }),
        });
        expect(fromDetailedRisk.securityPrivacy.triggers.map(t => t.source)).toEqual(['prd_privacy_risk']);
    });

    it('ignores PRD prose with no privacy vocabulary', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({
                constraints: ['Ship on a two-week timeline'],
                risks: ['The recommendation quality may disappoint users'],
            }),
        });
        expect(report.securityPrivacy.required).toBe(false);
    });

    it('requires security & privacy from privacy-classified data-model field groups', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            dataModel: dataModel({
                entities: [{
                    name: 'Listener',
                    description: 'A person using the product.',
                    fields: [{ name: 'email', type: 'String', required: true, description: 'Login email.' }],
                    relationships: [],
                    fieldGroups: [{ name: 'Privacy / Safety', fieldNames: ['email'] }],
                }],
            }),
        });

        expect(report.securityPrivacy.required).toBe(true);
        expect(report.securityPrivacy.triggers.map(t => t.source)).toEqual(['data_model_privacy_fields']);
        expect(report.securityPrivacy.triggers[0].detail).toContain('Listener');
    });

    it('requires security & privacy from entity privacy rules', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            dataModel: dataModel({
                entities: [{
                    name: 'Listener',
                    description: 'A person using the product.',
                    fields: [],
                    relationships: [],
                    privacyRules: ['Soft-delete only — never hard delete'],
                }],
            }),
        });

        expect(report.securityPrivacy.required).toBe(true);
        expect(report.securityPrivacy.triggers.map(t => t.source)).toEqual(['data_model_privacy_rules']);
    });

    it('does not fire on a non-privacy field group', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd(),
            dataModel: dataModel({
                entities: [{
                    name: 'Listener',
                    description: 'A person.',
                    fields: [],
                    relationships: [],
                    fieldGroups: [{ name: 'Key Product Fields', fieldNames: ['display_name'] }],
                }],
            }),
        });
        expect(report.securityPrivacy.required).toBe(false);
    });

    it('requires measurement when the PRD declares success metrics', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: 'Day-1 activation rate', target: '40%' }] }),
        });

        expect(report.measurement.required).toBe(true);
        expect(report.measurement.triggers.map(t => t.source)).toEqual(['prd_success_metrics']);
        expect(report.measurement.triggers[0].detail).toContain('Day-1 activation rate');
        expect(report.securityPrivacy.required).toBe(false);
    });

    it('ignores blank success-metric names and de-duplicates by normalized name', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: '   ' }] }),
        });
        expect(report.measurement.required).toBe(false);

        const deduped = deriveCrossCuttingRequirements({
            prd: prd({ successMetrics: [{ name: 'Day-1 Activation Rate' }, { name: 'day 1 activation rate' }] }),
        });
        expect(deduped.measurement.triggers[0].detail).toContain('1 success metric:');
    });

    it('reports every trigger that fires, without collapsing them into a score', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({
                constraints: ['HIPAA compliance required'],
                nonFunctionalRequirements: ['Audit every access to patient data'],
            }),
            safety: { classification: 'allowed_with_restrictions', status: 'restricted' },
            dataModel: dataModel({
                entities: [{
                    name: 'Patient',
                    description: 'A patient record.',
                    fields: [],
                    relationships: [],
                    fieldGroups: [{ name: 'Privacy / Safety', fieldNames: ['ssn'] }],
                    privacyRules: ['Encrypt at rest'],
                }],
            }),
        });

        expect(report.securityPrivacy.triggers.map(t => t.source)).toEqual([
            'safety_review',
            'prd_privacy_requirement',
            'prd_privacy_requirement',
            'data_model_privacy_fields',
            'data_model_privacy_rules',
        ]);
        expect(report.securityPrivacy).not.toHaveProperty('score');
        expect(report.securityPrivacy).not.toHaveProperty('confidence');
    });
});

describe('deriveCrossCuttingObligations — satisfaction', () => {
    const privacyPrd = prd({ constraints: ['Must be GDPR compliant'] });
    const metricsPrd = prd({ successMetrics: [{ name: 'Day-1 activation rate' }] });

    it('reports an absent-but-required section as an unresolved obligation', () => {
        const report = deriveCrossCuttingObligations({ prd: privacyPrd, plan: {} });

        expect(report.securityPrivacy.required).toBe(true);
        expect(report.securityPrivacy.absent).toBe(true);
        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.securityPrivacy.missing).toHaveLength(1);
        expect(report.securityPrivacy.missing[0]).toContain('no Security & Privacy section');
        expect(report.unresolved.map(s => s.key)).toEqual(['security_privacy']);
        expect(report.hasUnresolvedObligations).toBe(true);
    });

    it('reports an absent-but-required measurement section as an unresolved obligation', () => {
        const report = deriveCrossCuttingObligations({ prd: metricsPrd, plan: undefined });

        expect(report.measurement.absent).toBe(true);
        expect(report.measurement.missing[0]).toContain('no Measurement section');
        expect(report.unresolved.map(s => s.key)).toEqual(['measurement']);
    });

    it('satisfies both sections when every control and metric carries its links', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({
                constraints: ['Must be GDPR compliant'],
                successMetrics: [{ name: 'Day-1 activation rate' }],
            }),
            plan: { securityPrivacy: satisfiedSecurity, measurement: satisfiedMeasurement },
        });

        expect(report.securityPrivacy.satisfied).toBe(true);
        expect(report.securityPrivacy.absent).toBe(false);
        expect(report.securityPrivacy.missing).toEqual([]);
        expect(report.securityPrivacy.itemCount).toBe(1);
        expect(report.measurement.satisfied).toBe(true);
        expect(report.measurement.missing).toEqual([]);
        expect(report.hasUnresolvedObligations).toBe(false);
    });

    it('names the exact missing link on a partially filled control', () => {
        const report = deriveCrossCuttingObligations({
            prd: privacyPrd,
            plan: {
                securityPrivacy: {
                    controls: [{
                        id: 'sec_a',
                        title: 'Encrypt PII at rest',
                        requirementIds: ['f1'],
                    }],
                },
            },
        });

        expect(report.securityPrivacy.absent).toBe(false);
        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.securityPrivacy.missing).toEqual([
            'Control "Encrypt PII at rest": no linked plan tasks, no verification checks.',
        ]);
        expect(report.securityPrivacy.advisories).toEqual([
            'Control "Encrypt PII at rest" does not say how it is implemented.',
        ]);
    });

    it('treats a section with only a summary as present but unresolved', () => {
        const report = deriveCrossCuttingObligations({
            prd: privacyPrd,
            plan: { securityPrivacy: { summary: 'We will be careful.' } },
        });

        expect(report.securityPrivacy.absent).toBe(false);
        expect(report.securityPrivacy.missing[0]).toContain('names no controls');
    });

    it('keeps an unresolved open question blocking', () => {
        const report = deriveCrossCuttingObligations({
            prd: privacyPrd,
            plan: {
                securityPrivacy: {
                    controls: [{
                        id: 'sec_a',
                        title: 'Encrypt PII at rest',
                        requirementIds: ['f1'],
                        taskIds: ['t1'],
                        tests: ['Column is encrypted'],
                    }],
                    openQuestions: ['Which region stores EU data?'],
                },
            },
        });

        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.securityPrivacy.missing[0]).toContain('Which region stores EU data?');
    });

    it('flags a declared success metric with no event mapping', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: 'Day-1 activation rate' }, { name: 'Weekly retention' }] }),
            plan: { measurement: satisfiedMeasurement },
        });

        expect(report.measurement.satisfied).toBe(false);
        expect(report.measurement.missing).toEqual([
            'Success metric "Weekly retention" has no event mapping.',
        ]);
    });

    it('matches a mapping whose metric label extends the declared name', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: 'Weekly active creators' }] }),
            plan: {
                measurement: {
                    metrics: [{
                        id: 'mm_wac',
                        metric: 'Weekly Active Creators (WAC)',
                        eventName: 'session_started',
                        trigger: 'A creator opens the app.',
                        validation: 'Confirmed in the analytics debug view.',
                        properties: ['user_id: string'],
                        taskIds: ['t9'],
                    }],
                },
            },
        });

        expect(report.measurement.satisfied).toBe(true);
    });

    it('reports a parked metric honestly instead of counting it as instrumented', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: 'Weekly retention' }] }),
            plan: { measurement: { openQuestions: ['Weekly retention needs a cohort definition first.'] } },
        });

        expect(report.measurement.absent).toBe(false);
        expect(report.measurement.satisfied).toBe(false);
        expect(report.measurement.missing[0]).toContain('parked as an open question');
    });

    it('names missing per-metric contract fields and keeps properties advisory', () => {
        const report = deriveCrossCuttingObligations({
            prd: prd({ successMetrics: [{ name: 'Day-1 activation rate' }] }),
            plan: {
                measurement: {
                    metrics: [{
                        id: 'mm_a',
                        metric: 'Day-1 activation rate',
                        eventName: 'playlist_generated',
                    }],
                },
            },
        });

        expect(report.measurement.missing).toEqual([
            'Metric "Day-1 activation rate": no trigger, no validation.',
        ]);
        expect(report.measurement.advisories).toEqual([
            'Metric "Day-1 activation rate" declares no event properties.',
            'Metric "Day-1 activation rate" is not linked to a plan task.',
        ]);
    });

    it('flags a linked task id that does not exist in the plan', () => {
        const report = deriveCrossCuttingObligations({
            prd: privacyPrd,
            plan: {
                milestones: [{ tasks: [{ id: 'task_real' }] }],
                securityPrivacy: {
                    controls: [{
                        id: 'sec_a',
                        title: 'Encrypt PII at rest',
                        requirementIds: ['f1'],
                        taskIds: ['task_ghost'],
                        tests: ['Column is encrypted'],
                    }],
                },
            },
        });

        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.securityPrivacy.missing[0]).toContain('links a task that this plan does not contain (task_ghost)');
    });

    it('skips the task-link check when the caller passes no milestones', () => {
        const report = deriveCrossCuttingObligations({
            prd: privacyPrd,
            plan: {
                securityPrivacy: {
                    controls: [{
                        id: 'sec_a',
                        title: 'Encrypt PII at rest',
                        requirementIds: ['f1'],
                        taskIds: ['task_ghost'],
                        tests: ['Column is encrypted'],
                    }],
                },
            },
        });

        expect(report.securityPrivacy.satisfied).toBe(true);
    });

    it('never marks a not-required section unresolved even when the plan omits it', () => {
        const report = deriveCrossCuttingObligations({ prd: prd(), plan: {} });

        expect(report.securityPrivacy.absent).toBe(false);
        expect(report.measurement.absent).toBe(false);
        expect(report.unresolved).toEqual([]);
    });

    it('tolerates entirely empty input', () => {
        const report = deriveCrossCuttingObligations({});
        expect(report.securityPrivacy.required).toBe(false);
        expect(report.measurement.required).toBe(false);
        expect(report.hasUnresolvedObligations).toBe(false);
    });
});
