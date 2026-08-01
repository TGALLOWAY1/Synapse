import { describe, expect, it } from 'vitest';
import type {
    ArtifactSlotKey,
    DataModelContent,
    Feature,
    PlanMeasurementSection,
    StructuredPRD,
    TaskStatus,
} from '../../../types';
import type { DependencyNodeEvaluation, DependencyNodeId } from '../../artifactDependencyGraph';
import type { ApiEndpointLike } from '../../apiContractCompleteness';
import {
    BUILD_PACKET_CRITERION_ORDER,
    buildPacketRequiredSlots,
    deriveBuildPacketReadiness,
    isInScopeRequirement,
    resolveInScopeRequirements,
    type BuildPacketArtifactState,
    type BuildPacketCriterionId,
    type BuildPacketPlanInput,
    type BuildPacketReadiness,
    type BuildPacketReadinessInput,
} from '../buildPacketReadiness';

// ---------------------------------------------------------------------------
// A freshly generated, well-formed project.
//
// This fixture is the plan's §7 risk mitigation made executable: the first
// risk listed is that the W6 gate is stricter than the generator, which would
// make every project un-buildable. Every field below is something the current
// generator is actually prompted (and schema-required) to produce, so if a
// criterion ever stops being satisfiable by a normal generation run, the
// per-criterion tests underneath break.
// ---------------------------------------------------------------------------

const SPINE_ID = 'spine-1';

const feature = (overrides: Partial<Feature> & Pick<Feature, 'id' | 'name'>): Feature => ({
    description: `${overrides.name} description`,
    userValue: 'Clear user value',
    complexity: 'medium',
    priority: 'must',
    tier: 'mvp',
    confirmed: true,
    ...overrides,
});

const F1_CRITERION = 'A mood is captured in under five seconds';
const F2_CRITERION = 'A playlist is generated for a captured mood';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help people build playlists that match a mood.',
    targetUsers: ['Music listeners who journal'],
    coreProblem: 'Playlists do not adapt to how someone feels right now.',
    features: [
        feature({ id: 'f1', name: 'Mood capture', acceptanceCriteria: [F1_CRITERION] }),
        feature({ id: 'f2', name: 'Resonance playlist', acceptanceCriteria: [F2_CRITERION] }),
    ],
    architecture: 'React SPA with a serverless API.',
    risks: [],
    successMetrics: [{ name: 'Day-1 activation rate', target: '45%' }],
    ...overrides,
});

const measurement: PlanMeasurementSection = {
    summary: 'Activation is instrumented from the first slice.',
    metrics: [{
        id: 'mm_activation',
        metric: 'Day-1 activation rate',
        eventName: 'mood_captured',
        properties: ['user_id: string', 'mood_id: string'],
        trigger: 'A first-time user finishes capturing a mood.',
        validation: 'Confirm the event lands in the analytics debug view before launch.',
        taskIds: ['task_persist_moods'],
    }],
};

const completeEndpoint = (overrides: Partial<ApiEndpointLike> & Pick<ApiEndpointLike, 'method' | 'path'>): ApiEndpointLike => ({
    description: 'Endpoint description',
    entity: 'MoodSnapshot',
    auth: { authentication: 'Bearer JWT required', authorization: 'Snapshot owner only' },
    requestSchema: '{ joy_score: Float }',
    responseSchema: '{ id: string, joy_score: Float }',
    errors: ['404 — snapshot does not exist', '401 — missing token'],
    pagination: 'none',
    idempotency: 'not idempotent — creates a new record per call',
    rateLimit: '60/min per user',
    requirementIds: ['f1'],
    tests: ['Posting a mood returns the stored snapshot'],
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
        {
            name: 'ResonancePlaylist',
            description: 'A playlist generated from a mood.',
            fields: [{ name: 'track_ids', type: 'String[]', required: true, description: 'Tracks.' }],
            relationships: [],
        },
    ],
    apiEndpoints: [],
    ...overrides,
});

const endpoints = (): ApiEndpointLike[] => [
    completeEndpoint({ method: 'POST', path: '/api/moods' }),
    completeEndpoint({
        method: 'GET',
        path: '/api/playlists/:id',
        entity: 'ResonancePlaylist',
        requirementIds: ['f2'],
    }),
];

const plan = (): BuildPacketPlanInput => ({
    milestones: [
        {
            id: 'm_capture',
            name: 'Mood capture end to end',
            goal: 'Ship the mood capture screen and persistence.',
            dependencies: [],
            tasks: [
                {
                    id: 'task_capture_screen',
                    title: 'Build the mood capture screen',
                    status: 'todo',
                    linkedArtifacts: { prd: ['f1'], dataModel: ['MoodSnapshot'], mockups: ['Mood Capture'] },
                },
                {
                    id: 'task_persist_moods',
                    title: 'Persist mood snapshots through POST /api/moods',
                    status: 'todo',
                    dependencies: ['task_capture_screen'],
                    linkedArtifacts: { prd: ['f1'], dataModel: ['MoodSnapshot'] },
                },
            ],
            linkedArtifacts: {
                screens: ['Mood Capture'],
                dataModels: ['MoodSnapshot'],
                apis: ['POST /api/moods'],
            },
            definitionOfDone: [F1_CRITERION, 'A captured mood survives a reload'],
            qualityGates: [{ id: 'qg_capture_tests', title: 'Mood capture has unit tests', category: 'testing', required: true }],
            validationCommands: ['npm test'],
            promptPacks: [{
                id: 'pp_capture',
                title: 'Mood capture',
                purpose: 'Implement the mood capture screen.',
                prompt: '# Prompt: Mood capture',
                acceptanceCriteria: [F1_CRITERION],
            }],
        },
        {
            id: 'm_playlist',
            name: 'Resonance playlist generation',
            dependencies: ['m_capture'],
            tasks: [{
                id: 'task_generate_playlist',
                title: 'Generate a playlist from a captured mood',
                status: 'todo',
                linkedArtifacts: { prd: ['f2'], dataModel: ['ResonancePlaylist'] },
            }],
            linkedArtifacts: { screens: ['Playlist'], dataModels: ['ResonancePlaylist'] },
            definitionOfDone: [F2_CRITERION],
            qualityGates: [{ id: 'qg_playlist_tests', title: 'Playlist generation has tests', category: 'testing', required: true }],
        },
    ],
    measurement,
});

const evaluation = (
    nodeId: DependencyNodeId,
    overrides: Partial<DependencyNodeEvaluation> = {},
): DependencyNodeEvaluation => ({
    nodeId,
    status: 'up_to_date',
    reasons: [],
    impactedBy: [],
    manuallyEdited: false,
    versionNumber: 1,
    ...overrides,
});

const freshness = (
    overrides: Partial<Record<ArtifactSlotKey, Partial<DependencyNodeEvaluation>>> = {},
) => {
    const evaluations = new Map<DependencyNodeId, DependencyNodeEvaluation>();
    evaluations.set('prd', evaluation('prd', { status: 'source' }));
    for (const slot of buildPacketRequiredSlots()) {
        evaluations.set(slot, evaluation(slot, overrides[slot] ?? {}));
    }
    return {
        evaluations,
        artifactIdBySlot: Object.fromEntries(
            buildPacketRequiredSlots().map(slot => [slot, `artifact-${slot}`]),
        ) as Partial<Record<ArtifactSlotKey, string>>,
    };
};

const artifacts = (
    overrides: Partial<Record<ArtifactSlotKey, Partial<BuildPacketArtifactState>>> = {},
): BuildPacketArtifactState[] => buildPacketRequiredSlots().map(slot => ({
    nodeId: slot,
    artifactId: `artifact-${slot}`,
    versionId: `version-${slot}`,
    validation: { blockers: [], effectiveStatus: 'clear' as const },
    ...overrides[slot],
}));

const wellFormedInput = (
    overrides: Partial<BuildPacketReadinessInput> = {},
): BuildPacketReadinessInput => ({
    prd: prd(),
    artifacts: artifacts(),
    freshness: freshness(),
    dataModel: dataModel(),
    apiEndpoints: endpoints(),
    plan: plan(),
    committedReadiness: {
        reviewId: 'readiness-review-1',
        spineVersionId: SPINE_ID,
        conclusion: 'ready_to_build',
        committedAt: 1_700_000_000_000,
    },
    currentSpineVersionId: SPINE_ID,
    evaluatedAt: 1_700_000_001_000,
    ...overrides,
});

const criterion = (result: BuildPacketReadiness, id: BuildPacketCriterionId) =>
    result.criteria.find(item => item.id === id)!;

const blockersFor = (result: BuildPacketReadiness, id: BuildPacketCriterionId) =>
    result.blockers.filter(item => item.criterionId === id);

// ---------------------------------------------------------------------------
// §7 mitigation: the gate must not be stricter than the generator.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — a freshly generated, well-formed project', () => {
    it('reports the packet complete with no blockers', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput());

        expect(result.blockers).toEqual([]);
        expect(result.isPacketComplete).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.nextBlocker).toBeUndefined();
    });

    it.each(BUILD_PACKET_CRITERION_ORDER)('satisfies the %s criterion', id => {
        const result = deriveBuildPacketReadiness(wellFormedInput());
        const item = criterion(result, id);

        expect(item.blocking).toBe(false);
        expect(item.status).not.toBe('attention');
        expect(item.blockerIds).toEqual([]);
        expect(item.evidence.length).toBeGreaterThan(0);
        expect(item.actionTarget).toBeTruthy();
    });

    it('raises no warnings for a well-formed packet', () => {
        expect(deriveBuildPacketReadiness(wellFormedInput()).warnings).toEqual([]);
    });

    it('covers every criterion exactly once, in report order', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput());

        expect(result.criteria.map(item => item.id)).toEqual([...BUILD_PACKET_CRITERION_ORDER]);
    });
});

// ---------------------------------------------------------------------------
// Two separate evaluators, two separate answers.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — separation from planning readiness', () => {
    it('never exposes an isReadyToBuild field (that name belongs to the reasoning projection)', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput());

        expect('isReadyToBuild' in result).toBe(false);
        expect('phase' in result).toBe(false);
    });

    it('publishes no composite score, weight, or confidence number', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput()) as unknown as Record<string, unknown>;

        for (const [key, value] of Object.entries(result)) {
            if (typeof value !== 'number') continue;
            expect(key).toBe('evaluatedAt');
        }
    });

    it('is derived: the same input yields the same ids', () => {
        const input = wellFormedInput({ plan: null });
        const first = deriveBuildPacketReadiness(input);
        const second = deriveBuildPacketReadiness(input);

        expect(second.blockers.map(item => item.id)).toEqual(first.blockers.map(item => item.id));
    });
});

// ---------------------------------------------------------------------------
// §W8 — self-reported task progress is NEVER evidence.
//
// Synapse never runs a build, a test, or a command, so a task's progress state
// is a user claim (see `lib/taskProgressLanguage.ts`). If this evaluator ever
// started reading it, a project could tick its way to a green packet. These
// tests lock the module header's §W8 rule: flipping every task's stored status
// must change NOTHING about the evaluation.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — self-reported task progress is never evidence', () => {
    const withEveryTaskStatus = (
        planInput: BuildPacketPlanInput,
        status: TaskStatus,
    ): BuildPacketPlanInput => ({
        ...planInput,
        milestones: (planInput.milestones ?? []).map(milestone => ({
            ...milestone,
            tasks: (milestone.tasks ?? []).map(task => ({ ...task, status })),
        })),
    });

    // Every stored value, including the import-only legacy `blocked`.
    const statuses: TaskStatus[] = ['todo', 'in_progress', 'done', 'blocked'];

    it.each(statuses)(
        'a well-formed packet evaluates identically with every task stored as %s',
        (status) => {
            const baseline = deriveBuildPacketReadiness(wellFormedInput());
            const reported = deriveBuildPacketReadiness(wellFormedInput({
                plan: withEveryTaskStatus(plan(), status),
            }));

            expect(reported).toEqual(baseline);
        },
    );

    it('does not clear a blocker when every task is marked implemented', () => {
        // An in-scope requirement with no acceptance criterion — a genuine
        // coverage blocker that ticking tasks must not resolve.
        const input = (status: TaskStatus): BuildPacketReadinessInput => wellFormedInput({
            prd: prd({
                features: [
                    feature({ id: 'f1', name: 'Mood capture', acceptanceCriteria: [F1_CRITERION] }),
                    feature({ id: 'f2', name: 'Resonance playlist', acceptanceCriteria: [] }),
                ],
            }),
            plan: withEveryTaskStatus(plan(), status),
        });

        const planned = deriveBuildPacketReadiness(input('todo'));
        const implemented = deriveBuildPacketReadiness(input('done'));

        expect(planned.isPacketComplete).toBe(false);
        expect(implemented.isPacketComplete).toBe(false);
        expect(implemented.blockers).toEqual(planned.blockers);
        expect(criterion(implemented, 'requirement_coverage').status).toBe('attention');
    });

    it('cites no task progress in its evidence, whatever the stored statuses say', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: withEveryTaskStatus(plan(), 'done'),
        }));
        const summaries = result.criteria.flatMap(item => item.evidence.map(e => e.summary));

        expect(summaries.length).toBeGreaterThan(0);
        for (const summary of summaries) {
            expect(summary).not.toMatch(/self-reported|marked implemented|in_progress|\bticked\b/i);
        }
    });

    it('accepts no tasks or progress field on its input contract', () => {
        // The transport itself is the guardrail: adding a progress input would
        // have to change this list, which is the review moment §W8 wants.
        const input = wellFormedInput() as unknown as Record<string, unknown>;

        for (const key of Object.keys(input)) {
            expect(key).not.toMatch(/task|progress|checkbox|checklist/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Criterion 1 — required artifacts exist and are non-errored.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — required outputs', () => {
    it('blocks a missing output and points at its slot', () => {
        const remaining = buildPacketRequiredSlots().filter(slot => slot !== 'data_model');
        const result = deriveBuildPacketReadiness(wellFormedInput({
            artifacts: artifacts().filter(state => state.nodeId !== 'data_model'),
            freshness: {
                evaluations: new Map(
                    remaining.map(slot => [slot as DependencyNodeId, evaluation(slot)]),
                ),
            },
        }));

        const blocker = blockersFor(result, 'artifacts_present')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(blocker.title).toContain('Data Model');
        expect(blocker.actionTarget).toMatchObject({ kind: 'artifact_slot', nodeId: 'data_model' });
    });

    it('blocks an errored output even when the caller reports it as present', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            freshness: freshness({ user_flows: { status: 'error' } }),
        }));

        expect(blockersFor(result, 'artifacts_present').map(item => item.title))
            .toEqual(['User Flows failed to generate']);
    });

    it('blocks while a required output is still generating', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            freshness: freshness({ mockup: { status: 'generating' } }),
        }));

        expect(blockersFor(result, 'artifacts_present')[0].title).toContain('still generating');
    });
});

// ---------------------------------------------------------------------------
// Criterion 2 — currency. Consumed from the one freshness engine, reading BOTH
// status and impactedBy.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — packet input currency', () => {
    it('reports NOT ready when an approved PRD has a stale data model', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            freshness: freshness({
                data_model: {
                    status: 'needs_update',
                    reasons: [{ kind: 'prd_changed', detail: 'Generated from Version 1; Version 2 is current.' }],
                },
            }),
        }));

        const blocker = blockersFor(result, 'sources_current')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(criterion(result, 'sources_current').blocking).toBe(true);
        expect(blocker.title).toBe('Data Model is out of date');
        expect(blocker.consequence).toContain('Version 2 is current');
        expect(blocker.actionTarget).toMatchObject({ kind: 'artifact_slot', nodeId: 'data_model' });
        // The reasoning-side criteria are untouched: this is a packet fact.
        expect(criterion(result, 'reasoning_committed').blocking).toBe(false);
    });

    it('blocks a plan that reads up_to_date while a MISSING dependency shows only in impactedBy', () => {
        // The freshness engine short-circuits when an upstream snapshot is
        // absent, so the plan keeps `up_to_date` and the problem lands in
        // `impactedBy` alone (plan §W2). Status-only checks miss exactly this.
        const result = deriveBuildPacketReadiness(wellFormedInput({
            freshness: freshness({
                implementation_plan: { status: 'up_to_date', impactedBy: ['user_flows'] },
            }),
        }));

        const blocker = blockersFor(result, 'sources_current')[0];
        expect(blocker.title).toBe('Implementation Plan depends on an input that is not sound');
        expect(blocker.consequence).toContain('User Flows');
        expect(blocker.actionTarget).toMatchObject({ kind: 'artifact_slot', nodeId: 'user_flows' });
    });

    it('reports a missing output once — as presence, not also as a currency problem', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            artifacts: artifacts().filter(state => state.nodeId !== 'user_flows'),
            freshness: freshness({
                user_flows: { status: 'missing' },
                implementation_plan: { impactedBy: ['user_flows'] },
            }),
        }));

        expect(blockersFor(result, 'artifacts_present').map(item => item.title))
            .toEqual(['User Flows has not been generated']);
        // The dependent still reads up_to_date, and is still caught — via impactedBy.
        expect(blockersFor(result, 'sources_current').map(item => item.title))
            .toEqual(['Implementation Plan depends on an input that is not sound']);
    });

    it('fails closed when no freshness evaluation is supplied', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({ freshness: null }));

        expect(criterion(result, 'sources_current').blocking).toBe(true);
        expect(blockersFor(result, 'sources_current')[0].title)
            .toBe('Output currency could not be verified');
    });

    it('warns (never blocks) on a manually edited but current output', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            freshness: freshness({ screen_inventory: { manuallyEdited: true } }),
        }));

        expect(result.isPacketComplete).toBe(true);
        const warning = result.warnings.find(item => item.criterionId === 'sources_current')!;
        expect(warning.title).toContain('manual edits');
        expect(warning.owner).toBe('user');
    });
});

// ---------------------------------------------------------------------------
// Criterion 3 — blocking validation issues.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — output validation', () => {
    it('blocks an unresolved blocking validation issue', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            artifacts: artifacts({
                user_flows: {
                    validation: {
                        blockers: [{ code: 'user_flows_error_paths_missing', message: 'User flows do not include any error paths.' }],
                        effectiveStatus: 'needs_review',
                    },
                },
            }),
        }));

        const blocker = blockersFor(result, 'validation_clear')[0];
        expect(blocker.title).toBe('User Flows failed blocking validation');
        expect(blocker.consequence).toContain('error paths');
    });

    it('blocks on the freshness engine needs_review status even with no caller disposition', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            artifacts: artifacts({ data_model: { validation: undefined } }),
            freshness: freshness({ data_model: { status: 'needs_review' } }),
        }));

        expect(blockersFor(result, 'validation_clear')[0].title)
            .toBe('Data Model failed blocking validation');
    });

    it('records a user-accepted validation issue as a warning carrying the recorded rationale', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            artifacts: artifacts({
                data_model: {
                    validation: {
                        blockers: [{ code: 'prd_traceability_unverified', message: 'Artifact references none of the PRD features — no traceability to the PRD.' }],
                        accepted: {
                            schemaVersion: 1,
                            actor: 'user',
                            acceptedAt: 1_700_000_000_000,
                            rationale: 'Traceability is handled by the screen contracts for this project.',
                            blockerFingerprint: 'fingerprint',
                        },
                        effectiveStatus: 'accepted_issue',
                    },
                },
            }),
            freshness: freshness({ data_model: { status: 'needs_review' } }),
        }));

        expect(blockersFor(result, 'validation_clear')).toEqual([]);
        const warning = result.warnings.find(item => item.criterionId === 'validation_clear')!;
        expect(warning.rationale).toBe('Traceability is handled by the screen contracts for this project.');
        expect(warning.owner).toBe('user');
    });
});

// ---------------------------------------------------------------------------
// Criterion 4 — in-scope requirement coverage.
// ---------------------------------------------------------------------------

describe('isInScopeRequirement / resolveInScopeRequirements', () => {
    it('counts tier mvp, priority must, and features declaring neither field', () => {
        expect(isInScopeRequirement({ tier: 'mvp', priority: 'could' })).toBe(true);
        expect(isInScopeRequirement({ tier: 'later', priority: 'must' })).toBe(true);
        expect(isInScopeRequirement({})).toBe(true);
    });

    it('excludes should/could and v1/later features that declare a field', () => {
        expect(isInScopeRequirement({ tier: 'v1' })).toBe(false);
        expect(isInScopeRequirement({ priority: 'should' })).toBe(false);
        expect(isInScopeRequirement({ tier: 'later', priority: 'could' })).toBe(false);
    });

    it('falls back to every feature when nothing matches — the same fallback the planning scope criterion uses', () => {
        const features = [
            feature({ id: 'f1', name: 'A', tier: 'v1', priority: 'should' }),
            feature({ id: 'f2', name: 'B', tier: 'later', priority: 'could' }),
        ];
        const resolution = resolveInScopeRequirements(features);

        expect(resolution.usedAllFeaturesFallback).toBe(true);
        expect(resolution.inScope).toHaveLength(2);
        expect(resolution.outOfScope).toEqual([]);
    });
});

describe('deriveBuildPacketReadiness — requirement coverage', () => {
    it('reports NOT ready when an in-scope requirement maps to no task', () => {
        const planWithoutPlaylist = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: { ...planWithoutPlaylist, milestones: planWithoutPlaylist.milestones!.slice(0, 1) },
        }));

        const blocker = blockersFor(result, 'requirement_coverage')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(blocker.title).toBe('"Resonance playlist" is not implemented by any task');
        expect(blocker.actionTarget).toMatchObject({
            kind: 'artifact_slot',
            nodeId: 'implementation_plan',
            section: 'coverage',
        });
    });

    it('blocks an in-scope requirement that declares no acceptance criterion', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            prd: prd({
                features: [
                    feature({ id: 'f1', name: 'Mood capture', acceptanceCriteria: [] }),
                    feature({ id: 'f2', name: 'Resonance playlist', acceptanceCriteria: [F2_CRITERION] }),
                ],
            }),
        }));

        const blocker = blockersFor(result, 'requirement_coverage')[0];
        expect(blocker.title).toBe('"Mood capture" declares no acceptance criterion');
        expect(blocker.actionTarget).toMatchObject({ kind: 'feature', featureId: 'f1' });
    });

    it('blocks when nothing in the packet verifies a covered requirement', () => {
        const source = plan();
        const stripped = source.milestones!.map(milestone => ({
            ...milestone,
            definitionOfDone: undefined,
            qualityGates: undefined,
            promptPacks: undefined,
            validationCommands: undefined,
        }));
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: { ...source, milestones: stripped },
        }));

        expect(blockersFor(result, 'requirement_coverage').map(item => item.title)).toEqual([
            'Nothing in the packet verifies "Mood capture"',
            'Nothing in the packet verifies "Resonance playlist"',
        ]);
    });

    it('reports out-of-scope coverage as a warning, never a blocker', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            prd: prd({
                features: [
                    feature({ id: 'f1', name: 'Mood capture', acceptanceCriteria: [F1_CRITERION] }),
                    feature({
                        id: 'f2',
                        name: 'Resonance playlist',
                        tier: 'later',
                        priority: 'could',
                        acceptanceCriteria: [F2_CRITERION],
                    }),
                    feature({
                        id: 'f3',
                        name: 'Collaborative queues',
                        tier: 'v1',
                        priority: 'should',
                        acceptanceCriteria: ['Two listeners can share a queue'],
                    }),
                ],
            }),
        }));

        expect(blockersFor(result, 'requirement_coverage')).toEqual([]);
        expect(result.isPacketComplete).toBe(true);
        const titles = result.warnings
            .filter(item => item.criterionId === 'requirement_coverage')
            .map(item => item.title);
        expect(titles).toContain('"Collaborative queues" is not implemented by any task');
    });

    it('warns when a requirement is covered but its PRD criteria are not traced into the packet', () => {
        const source = plan();
        const rewritten = source.milestones!.map(milestone => ({
            ...milestone,
            definitionOfDone: ['Everything works'],
            promptPacks: undefined,
        }));
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: { ...source, milestones: rewritten },
        }));

        expect(blockersFor(result, 'requirement_coverage')).toEqual([]);
        const warning = result.warnings.find(item => (
            item.criterionId === 'requirement_coverage' && item.title.includes('not traced')
        ))!;
        expect(warning.owner).toBe('synapse');
        expect(warning.impact.length).toBeGreaterThan(0);
        expect(warning.rationale.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Criterion 5 — first-slice API contracts.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — first-slice API contracts', () => {
    it('reports NOT ready for an incomplete contract on an endpoint the first slice reaches', () => {
        const [, playlist] = endpoints();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            apiEndpoints: [
                {
                    method: 'POST',
                    path: '/api/moods',
                    description: 'Create a mood snapshot',
                    entity: 'MoodSnapshot',
                    requirementIds: ['f1'],
                },
                playlist,
            ],
        }));

        const blocker = blockersFor(result, 'api_contract')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(blocker.title).toBe('POST /api/moods has an incomplete contract');
        expect(blocker.consequence).toContain('authentication');
        expect(blocker.consequence).toContain('response schema');
        expect(blocker.actionTarget).toMatchObject({
            kind: 'artifact_slot',
            nodeId: 'data_model',
            section: 'api_contract',
        });
    });

    it('reports a later-slice endpoint gap as a warning, not a blocker', () => {
        const [moods] = endpoints();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            apiEndpoints: [
                moods,
                {
                    method: 'GET',
                    path: '/api/playlists/:id',
                    description: 'Read a playlist',
                    entity: 'ResonancePlaylist',
                    requirementIds: ['f2'],
                },
            ],
        }));

        expect(blockersFor(result, 'api_contract')).toEqual([]);
        const warning = result.warnings.find(item => item.criterionId === 'api_contract')!;
        expect(warning.title).toContain('GET /api/playlists/:id');
        expect(warning.rationale).toContain('not reachable from the first slice');
    });

    it('blocks a data model that declares no API endpoints at all', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({ apiEndpoints: [] }));

        expect(blockersFor(result, 'api_contract')[0].title)
            .toBe('The data model declares no API endpoints');
    });

    it('says out loud when no endpoint could be tied to the first slice', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            apiEndpoints: [completeEndpoint({
                method: 'GET',
                path: '/api/unrelated',
                entity: 'SomethingElse',
                requirementIds: [],
            })],
        }));

        expect(blockersFor(result, 'api_contract')).toEqual([]);
        const warning = result.warnings.find(item => item.criterionId === 'api_contract')!;
        expect(warning.title).toBe('No endpoint could be tied to the first slice');
        expect(warning.impact).toContain('NOT gated');
    });
});

// ---------------------------------------------------------------------------
// Criterion 6 — cross-cutting obligations (W5).
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — cross-cutting obligations', () => {
    it('blocks a project with success metrics and no measurement mapping', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: { ...source, measurement: undefined },
        }));

        const blocker = blockersFor(result, 'cross_cutting')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(blocker.title).toBe('Measurement not discharged');
        expect(blocker.consequence).toContain('no declared success metric');
    });

    it('blocks a safety-flagged project with no security controls linked to tasks', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            safety: {
                status: 'restricted',
                classification: 'allowed_with_restrictions',
                detectedConcerns: ['Handles self-reported mental-health signals'],
            },
        }));

        expect(blockersFor(result, 'cross_cutting').map(item => item.title))
            .toContain('Security & Privacy obligations not discharged');
    });

    it('requires neither section when the project triggers neither', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            prd: prd({ successMetrics: [] }),
            plan: { ...source, measurement: undefined },
        }));

        const item = criterion(result, 'cross_cutting');
        expect(item.blocking).toBe(false);
        expect(item.status).toBe('not_started');
    });
});

// ---------------------------------------------------------------------------
// Criterion 7 — first slice is executable.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — first slice', () => {
    it('blocks a first milestone that depends on another milestone', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: {
                ...source,
                milestones: [{ ...source.milestones![0], dependencies: ['m_playlist'] }, source.milestones![1]],
            },
        }));

        const blocker = blockersFor(result, 'first_slice')[0];
        expect(blocker.title).toBe('"Mood capture end to end" cannot start yet');
        expect(blocker.actionTarget).toMatchObject({ section: 'first_milestone', milestoneId: 'm_capture' });
    });

    it('blocks a dangling milestone dependency', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: {
                ...source,
                milestones: [{ ...source.milestones![0], dependencies: ['m_nonexistent'] }, source.milestones![1]],
            },
        }));

        expect(blockersFor(result, 'first_slice')[0].consequence).toContain('not in this plan');
    });

    it('blocks a first-milestone task that depends on work outside the slice', () => {
        const source = plan();
        const first = source.milestones![0];
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: {
                ...source,
                milestones: [
                    {
                        ...first,
                        tasks: [
                            { ...first.tasks[0], dependencies: ['task_generate_playlist'] },
                            first.tasks[1],
                        ],
                    },
                    source.milestones![1],
                ],
            },
        }));

        expect(blockersFor(result, 'first_slice')[0].title)
            .toContain('tasks that depend on work outside the slice');
    });

    it('blocks a first milestone with no way to tell when it is done', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: {
                ...source,
                milestones: [
                    {
                        ...source.milestones![0],
                        definitionOfDone: undefined,
                        qualityGates: undefined,
                        promptPacks: undefined,
                        validationCommands: undefined,
                    },
                    source.milestones![1],
                ],
            },
        }));

        expect(blockersFor(result, 'first_slice').map(item => item.title))
            .toContain('"Mood capture end to end" has no way to tell when it is done');
    });

    it('warns — never blocks — when the first milestone is not a vertical slice', () => {
        const source = plan();
        const result = deriveBuildPacketReadiness(wellFormedInput({
            plan: {
                ...source,
                milestones: [
                    {
                        ...source.milestones![0],
                        linkedArtifacts: { dataModels: ['MoodSnapshot'] },
                        tasks: source.milestones![0].tasks.map(task => ({
                            ...task,
                            linkedArtifacts: { prd: task.linkedArtifacts?.prd, dataModel: ['MoodSnapshot'] },
                        })),
                    },
                    source.milestones![1],
                ],
            },
        }));

        expect(blockersFor(result, 'first_slice')).toEqual([]);
        const warning = result.warnings.find(item => item.criterionId === 'first_slice')!;
        expect(warning.title).toContain('may not be a user-visible slice');
        expect(warning.owner).toBe('user');
    });

    it('blocks when there is no plan at all', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({ plan: null }));

        expect(blockersFor(result, 'first_slice')[0].title)
            .toBe('The packet has no first implementation slice');
        expect(criterion(result, 'requirement_coverage').blocking).toBe(true);
        expect(criterion(result, 'api_contract').blocking).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Criterion 8 — committed, not projected. The authority question.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — committed product reasoning', () => {
    it('blocks when nothing is committed, even though the live projection reads ready', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: null,
            planningProjectionReadyToBuild: true,
        }));

        const blocker = blockersFor(result, 'reasoning_committed')[0];
        expect(result.isPacketComplete).toBe(false);
        expect(blocker.title).toBe('The product reasoning has not been committed');
        // The projection may only inform when a commit action is OFFERED.
        expect(blocker.remedy).toContain('ready to commit');
        expect(criterion(result, 'reasoning_committed').evidence[0].summary)
            .toContain('never that one happened');
    });

    it('blocks identically whether or not the projection reads ready', () => {
        const withProjection = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: null,
            planningProjectionReadyToBuild: true,
        }));
        const withoutProjection = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: null,
            planningProjectionReadyToBuild: false,
        }));

        expect(withProjection.isPacketComplete).toBe(false);
        expect(withoutProjection.isPacketComplete).toBe(false);
        expect(criterion(withProjection, 'reasoning_committed').blocking).toBe(true);
        expect(criterion(withoutProjection, 'reasoning_committed').blocking).toBe(true);
    });

    it('fails CLOSED when the commitment is unverifiable, even with a commitment present', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({ commitmentUnverifiable: true }));

        expect(blockersFor(result, 'reasoning_committed')[0].title)
            .toBe('The readiness commitment cannot be verified');
        expect(result.isPacketComplete).toBe(false);
    });

    it('blocks a commitment bound to a different plan version', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: {
                reviewId: 'readiness-review-0',
                spineVersionId: 'spine-0',
                conclusion: 'ready_to_build',
                committedAt: 1,
            },
        }));

        expect(blockersFor(result, 'reasoning_committed')[0].title)
            .toBe('The commitment belongs to a different plan version');
    });

    it('accepts a not_ready commitment as a warning when its rationale is recorded', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: {
                reviewId: 'readiness-review-1',
                spineVersionId: SPINE_ID,
                conclusion: 'not_ready',
                committedAt: 1,
                acceptedRiskRationale: 'The pricing assumption stays open; we ship the free tier first.',
            },
        }));

        expect(blockersFor(result, 'reasoning_committed')).toEqual([]);
        expect(result.isPacketComplete).toBe(true);
        const warning = result.warnings.find(item => item.criterionId === 'reasoning_committed')!;
        expect(warning.title).toBe('Committed with accepted risk');
        expect(warning.rationale).toContain('pricing assumption');
    });

    it('blocks a not_ready commitment with no recorded rationale', () => {
        const result = deriveBuildPacketReadiness(wellFormedInput({
            committedReadiness: {
                reviewId: 'readiness-review-1',
                spineVersionId: SPINE_ID,
                conclusion: 'not_ready',
                committedAt: 1,
            },
        }));

        expect(blockersFor(result, 'reasoning_committed')[0].title)
            .toBe('Committed with accepted risk, with no recorded rationale');
    });
});

// ---------------------------------------------------------------------------
// Report discipline.
// ---------------------------------------------------------------------------

describe('deriveBuildPacketReadiness — report discipline', () => {
    const scenarios: Array<[string, BuildPacketReadinessInput]> = [
        ['well formed', wellFormedInput()],
        ['no plan', wellFormedInput({ plan: null })],
        ['no freshness', wellFormedInput({ freshness: null })],
        ['not committed', wellFormedInput({ committedReadiness: null })],
        ['no prd', wellFormedInput({ prd: null })],
        ['empty input', {}],
    ];

    it.each(scenarios)('every warning records owner, impact and rationale (%s)', (_label, input) => {
        for (const warning of deriveBuildPacketReadiness(input).warnings) {
            expect(warning.owner).toMatch(/^(user|synapse)$/);
            expect(warning.impact.trim().length).toBeGreaterThan(0);
            expect(warning.rationale.trim().length).toBeGreaterThan(0);
            expect(warning.actionTarget).toBeTruthy();
        }
    });

    it.each(scenarios)('every blocker carries a remedy and an action target (%s)', (_label, input) => {
        for (const blocker of deriveBuildPacketReadiness(input).blockers) {
            expect(blocker.consequence.trim().length).toBeGreaterThan(0);
            expect(blocker.remedy.trim().length).toBeGreaterThan(0);
            expect(blocker.actionTarget).toBeTruthy();
        }
    });

    it.each(scenarios)('every blocking criterion owns at least one blocker (%s)', (_label, input) => {
        const result = deriveBuildPacketReadiness(input);
        for (const item of result.criteria) {
            expect(item.blocking).toBe(item.blockerIds.length > 0);
            for (const id of item.blockerIds) {
                expect(result.blockers.some(blocker => blocker.id === id)).toBe(true);
            }
        }
    });

    it.each(scenarios)('every criterion carries evidence and an action target (%s)', (_label, input) => {
        for (const item of deriveBuildPacketReadiness(input).criteria) {
            expect(item.evidence.length).toBeGreaterThan(0);
            expect(item.actionTarget).toBeTruthy();
            for (const evidence of item.evidence) {
                expect(evidence.summary.trim().length).toBeGreaterThan(0);
                expect(evidence.quality).toMatch(/^(direct|inferred|incomplete)$/);
            }
        }
    });

    it('orders blockers by criterion and exposes the first as nextBlocker', () => {
        const result = deriveBuildPacketReadiness({});
        const positions = result.blockers.map(blocker =>
            BUILD_PACKET_CRITERION_ORDER.indexOf(blocker.criterionId));

        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(result.nextBlocker).toBe(result.blockers[0]);
    });

    it('handles a completely empty project without throwing', () => {
        const result = deriveBuildPacketReadiness({});

        expect(result.isPacketComplete).toBe(false);
        expect(result.blockers.length).toBeGreaterThan(0);
    });
});
