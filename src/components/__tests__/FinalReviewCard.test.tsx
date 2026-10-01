import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImplementationPlanRenderer } from '../renderers/ImplementationPlanRenderer';
import type { PlanFinalReviewContext } from '../renderers/implementationPlan/FinalReviewCard';
import type { StructuredImplementationPlan } from '../../types';
import { BUILD_PACKET_APPROVAL_KEY } from '../../lib/planning/buildPacketApproval';
import type {
    BuildPacketBlocker,
    BuildPacketCriterion,
    BuildPacketReadiness,
    BuildPacketWarning,
} from '../../lib/planning/buildPacketReadiness';
import type { CrossCuttingObligationStatus } from '../../lib/planning/crossCuttingObligations';

// The Final Review surface (plan §W7) is exercised through the renderer it
// actually ships behind, so the prop threading stays covered too.

beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    Element.prototype.scrollIntoView = vi.fn();
});

const PLAN: StructuredImplementationPlan = {
    overview: { summary: 'Build in thin slices.' },
    summary: { buildStrategy: 'Walking skeleton first.' },
    milestones: [
        {
            id: 'm_setup',
            name: 'Project Setup',
            goal: 'Scaffold the app.',
            tasks: [{ id: 't1', title: 'Initialize Vite app', status: 'todo' }],
            promptPacks: [{
                id: 'pp_setup',
                title: 'Scaffold the project',
                purpose: 'Create the initial repo structure.',
                prompt: '# Prompt: Scaffold',
                acceptanceCriteria: ['App boots locally'],
            }],
        },
    ],
    architecture: [],
    risks: [],
};

const content = `# Implementation Plan\n\n\`\`\`json synapse-plan\n${JSON.stringify(PLAN)}\n\`\`\``;

const blocker = (
    id: string,
    criterionId: BuildPacketBlocker['criterionId'],
    actionTarget: BuildPacketBlocker['actionTarget'],
): BuildPacketBlocker => ({
    id,
    criterionId,
    title: `${id} title`,
    consequence: `${id} consequence`,
    remedy: `${id} remedy`,
    evidenceQuality: 'incomplete',
    actionTarget,
});

const warning = (id: string): BuildPacketWarning => ({
    id,
    criterionId: 'cross_cutting',
    title: `${id} title`,
    owner: 'user',
    impact: `${id} impact`,
    rationale: `${id} rationale`,
    actionTarget: { kind: 'artifact_slot', nodeId: 'implementation_plan' },
});

const CRITERIA: BuildPacketCriterion['id'][] = [
    'artifacts_present', 'sources_current', 'validation_clear', 'requirement_coverage',
    'api_contract', 'cross_cutting', 'first_slice',
];

const packet = (blockers: BuildPacketBlocker[], warnings: BuildPacketWarning[] = []): BuildPacketReadiness => ({
    isPacketComplete: blockers.length === 0,
    status: blockers.length === 0 ? 'complete' : 'incomplete',
    headline: blockers.length === 0 ? 'Implementation packet complete' : 'Implementation packet incomplete',
    summary: 'Packet summary sentence.',
    criteria: CRITERIA.map(id => {
        const own = blockers.filter(item => item.criterionId === id);
        return {
            id,
            label: `${id} label`,
            status: own.length > 0 ? 'attention' : 'met',
            blocking: own.length > 0,
            explanation: `${id} explanation`,
            evidence: [{ id: `${id}-evidence`, quality: 'inferred', summary: `${id} evidence`, sourceType: 'plan' }],
            actionTarget: { kind: 'artifact_slot', nodeId: 'implementation_plan' },
            blockerIds: own.map(item => item.id),
            warningIds: warnings.filter(item => item.criterionId === id).map(item => item.id),
        };
    }),
    blockers,
    warnings,
    nextBlocker: blockers[0],
    evaluatedAt: 1_700_000_000_000,
});

const MANIFEST = [
    { nodeId: 'data_model' as const, title: 'Data Model', artifactId: 'a-dm', versionId: 'v-dm', versionLabel: 'v1' },
    { nodeId: 'implementation_plan' as const, title: 'Implementation Plan', artifactId: 'a-plan', versionId: 'v-plan', versionLabel: 'v2' },
];

const renderPlan = (context: PlanFinalReviewContext, extra: { onConvertToTasks?: () => void } = {}) =>
    render(
        <ImplementationPlanRenderer
            content={content}
            finalReview={context}
            prdVersionLabel="Version 3"
            onConvertToTasks={extra.onConvertToTasks}
        />,
    );

describe('Final Review — one primary, never gated on the packet report', () => {
    it('promotes the first implementation prompt even while packet checks are open', () => {
        renderPlan({
            packet: packet([
                blocker('b1', 'artifacts_present', { kind: 'artifact_slot', nodeId: 'data_model' }),
                blocker('b2', 'api_contract', { kind: 'artifact_slot', nodeId: 'data_model', section: 'api_contract' }),
            ]),
            manifest: MANIFEST,
        });
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toHaveAttribute('data-cta-action', 'start_build');
        expect(primary).toHaveTextContent('Copy first implementation prompt');
        expect(primary).toBeEnabled();
        expect(screen.getByRole('region', { name: 'Final Review' }).textContent).not.toMatch(/Resolve \d+ blocker/);
        expect(screen.getByText(/2 packet checks are still open \(estimated\)/)).toBeInTheDocument();
    });

    it('copies the prompt from the primary action', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST });
        fireEvent.click(screen.getByTestId('final-review-primary'));
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('promotes the same build step when every check passes and when approved', () => {
        for (const context of [
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            {
                packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn(),
                approval: { approvedAt: 1_700_000_000_000, manifest: MANIFEST },
            },
        ] satisfies PlanFinalReviewContext[]) {
            const { unmount } = renderPlan(context);
            expect(screen.getByTestId('final-review-primary')).toHaveTextContent('Copy first implementation prompt');
            unmount();
        }
    });

    it('renders exactly one primary-styled action in every state', () => {
        const states: PlanFinalReviewContext[] = [
            { packet: packet([blocker('b1', 'first_slice', { kind: 'artifact_slot', nodeId: 'implementation_plan' })]), manifest: MANIFEST },
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            {
                packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn(),
                approval: { approvedAt: 1, manifest: MANIFEST },
            },
            { manifest: MANIFEST },
        ];
        for (const context of states) {
            const { container, unmount } = renderPlan(context, { onConvertToTasks: vi.fn() });
            const primaries = container.querySelectorAll('button.bg-indigo-600');
            expect(primaries).toHaveLength(1);
            expect(primaries[0]).toBe(screen.getByTestId('final-review-primary'));
            unmount();
        }
    });

    it('keeps copy plan, review prompts and convert to tasks secondary and always available', () => {
        const onConvertToTasks = vi.fn();
        const { container } = renderPlan(
            { packet: packet([blocker('b1', 'sources_current', { kind: 'artifact_slot', nodeId: 'data_model' })]), manifest: MANIFEST },
            { onConvertToTasks },
        );
        for (const id of ['review_prompts', 'convert_tasks', 'copy_plan']) {
            const button = screen.getByTestId(`final-review-secondary-${id}`);
            expect(button).toBeEnabled();
            expect(button.className).not.toContain('bg-indigo-600');
        }
        fireEvent.click(screen.getByTestId('final-review-secondary-copy_plan'));
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('final-review-secondary-convert_tasks'));
        expect(onConvertToTasks).toHaveBeenCalled();
        expect(container.querySelectorAll('button.bg-indigo-600')).toHaveLength(1);
    });

    it('keeps every prompt-copy control non-primary, approved or not', () => {
        const unapproved = { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() };
        const approved = { ...unapproved, approval: { approvedAt: 1, manifest: MANIFEST } };
        for (const context of [unapproved, approved]) {
            const { container, unmount } = renderPlan(context);
            fireEvent.click(screen.getByRole('button', { name: /Prompts/ }));
            expect(container.querySelectorAll('button.bg-indigo-600')).toHaveLength(1);
            expect(screen.getByRole('button', { name: /Copy next prompt/ }).className)
                .not.toContain('bg-indigo-600');
            expect(screen.getByRole('button', { name: /Copy Prompt/ }).className)
                .not.toContain('bg-indigo-600');
            unmount();
        }
    });

    it('keeps exactly one primary on the Roadmap tab too', () => {
        const { container } = renderPlan({
            packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn(),
            approval: { approvedAt: 1, manifest: MANIFEST },
        });
        fireEvent.click(screen.getByRole('button', { name: /Roadmap/ }));
        expect(container.querySelectorAll('button.bg-indigo-600')).toHaveLength(1);
    });
});

describe('Final Review — the advisory packet checklist', () => {
    const blockers = [
        blocker('b1', 'artifacts_present', { kind: 'artifact_slot', nodeId: 'data_model' }),
        blocker('b2', 'requirement_coverage', { kind: 'feature', featureId: 'f1' }),
        blocker('b3', 'first_slice', { kind: 'artifact_slot', nodeId: 'implementation_plan', section: 'first_milestone', milestoneId: 'm_setup' }),
    ];

    it('lists every check in criterion order, marked estimated', () => {
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget: vi.fn() });
        const checks = screen.getAllByTestId('final-review-check');
        expect(checks.map(item => item.getAttribute('data-criterion'))).toEqual(CRITERIA);
        expect(checks.filter(item => item.getAttribute('data-open') === 'true').map(item => item.getAttribute('data-criterion')))
            .toEqual(['artifacts_present', 'requirement_coverage', 'first_slice']);
        expect(screen.getByTestId('final-review-status')).toHaveTextContent('4 of 7 checks pass');
        expect(screen.getByTestId('final-review-status')).toHaveTextContent('estimated');
    });

    it('shows each open check with its title, consequence and fix', () => {
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget: vi.fn() });
        expect(screen.getByText('b1 title')).toBeInTheDocument();
        expect(screen.getByText(/b1 consequence/)).toBeInTheDocument();
        expect(screen.getByText(/b1 remedy/)).toBeInTheDocument();
        // Met checks stay one line.
        expect(screen.queryByText('validation_clear explanation')).toBeNull();
    });

    it('wires each fix to its own navigable target — an artifact slot or a PRD feature', () => {
        const onNavigateTarget = vi.fn();
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget });
        const actions = screen.getAllByTestId('final-review-blocker-action');
        expect(actions.map(action => action.textContent?.trim())).toEqual([
            'Open Data Model', 'Open this feature', 'Open the first milestone',
        ]);
        fireEvent.click(actions[1]);
        expect(onNavigateTarget).toHaveBeenCalledWith({ kind: 'feature', featureId: 'f1' });
        fireEvent.click(actions[2]);
        expect(onNavigateTarget).toHaveBeenLastCalledWith({
            kind: 'artifact_slot', nodeId: 'implementation_plan', section: 'first_milestone', milestoneId: 'm_setup',
        });
    });

    it('reads "All checks pass" for a complete packet', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST });
        expect(screen.getByTestId('final-review-status')).toHaveTextContent('All checks pass');
    });

    it('records warnings separately from open checks', () => {
        renderPlan({ packet: packet([], [warning('w1')]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() });
        expect(screen.getByText('Recorded, not counted')).toBeInTheDocument();
        expect(screen.getByText(/w1 impact/)).toBeInTheDocument();
        expect(screen.getByTestId('final-review-status')).toHaveTextContent('All checks pass');
    });

    it('renders no checklist when no packet was evaluated, and still offers the build step', () => {
        renderPlan({ manifest: MANIFEST });
        expect(screen.queryByTestId('final-review-checks')).toBeNull();
        expect(screen.getByTestId('final-review-primary')).toBeEnabled();
    });
});

describe('Final Review — the pinned artifact-version manifest', () => {
    it('lists the current versions as unapproved before an approval exists', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() });
        expect(screen.getByTestId('final-review-manifest')).toHaveTextContent('nothing approved yet');
        const row = screen.getByTestId('final-review-manifest-row-data_model');
        expect(row).toHaveAttribute('data-drift', 'unpinned');
        expect(row).toHaveTextContent('Data Model');
        expect(row).toHaveTextContent('v1');
    });

    it('shows the versions an approval covers, and the PRD version with them', () => {
        renderPlan({
            packet: packet([]),
            manifest: MANIFEST,
            approval: { approvedAt: 1, manifest: MANIFEST, prdVersionLabel: 'Version 3' },
            canApprove: true,
            onApprove: vi.fn(),
        });
        expect(screen.getByTestId('final-review-manifest-row-data_model')).toHaveAttribute('data-drift', 'match');
        expect(screen.getByTestId('final-review-manifest-row-implementation_plan')).toHaveAttribute('data-drift', 'match');
        expect(screen.getByTestId('final-review-manifest')).toHaveTextContent('Version 3');
        expect(screen.getByText('Packet approved')).toBeInTheDocument();
    });

    it('reports "changed since approval" against the version the approval pinned', () => {
        renderPlan({
            packet: packet([]),
            manifest: [{ ...MANIFEST[0], versionId: 'v-dm-2', versionLabel: 'v2' }, MANIFEST[1]],
            approval: { approvedAt: 1, manifest: MANIFEST },
            canApprove: true,
            onApprove: vi.fn(),
        });
        const row = screen.getByTestId('final-review-manifest-row-data_model');
        expect(row).toHaveAttribute('data-drift', 'changed');
        expect(row).toHaveTextContent('v1');
        expect(row).toHaveTextContent('v2');
        expect(screen.getAllByText('Changed since approval').length).toBeGreaterThan(0);
        expect(screen.getByTestId('final-review-approve')).toHaveTextContent('Re-approve build packet');
    });
});

describe('Final Review — the optional approval', () => {
    it('records the approval through the supplied writer', () => {
        const onApprove = vi.fn();
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove });
        const approve = screen.getByTestId('final-review-approve');
        expect(approve).toHaveTextContent('Approve build packet');
        expect(approve).toHaveTextContent('(optional)');
        fireEvent.click(approve);
        expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('stays available while packet checks are open', () => {
        const onApprove = vi.fn();
        renderPlan({
            packet: packet([blocker('b1', 'sources_current', { kind: 'artifact_slot', nodeId: 'data_model' })]),
            manifest: MANIFEST,
            canApprove: true,
            onApprove,
        });
        fireEvent.click(screen.getByTestId('final-review-approve'));
        expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('cannot be taken in a read-only project', () => {
        const onApprove = vi.fn();
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: false, onApprove });
        const approve = screen.getByTestId('final-review-approve');
        expect(approve).toBeDisabled();
        fireEvent.click(approve);
        expect(onApprove).not.toHaveBeenCalled();
        expect(screen.getByText(/read-only/)).toBeInTheDocument();
        // The build step is never disabled by read-only.
        expect(screen.getByTestId('final-review-primary')).toBeEnabled();
    });

    it('cannot be taken when no writer is wired even if the capability reads true', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true });
        expect(screen.getByTestId('final-review-approve')).toBeDisabled();
    });

    it('disappears once a current approval covers the versions', () => {
        renderPlan({
            packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn(),
            approval: { approvedAt: 1, manifest: MANIFEST },
        });
        expect(screen.queryByTestId('final-review-approve')).toBeNull();
    });

    it('never treats prompt review or task conversion as an approval', () => {
        const onConvertToTasks = vi.fn();
        renderPlan(
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            { onConvertToTasks },
        );
        fireEvent.click(screen.getByTestId('final-review-secondary-review_prompts'));
        fireEvent.click(screen.getByTestId('final-review-secondary-convert_tasks'));
        expect(screen.getByTestId('final-review-approve')).toHaveTextContent('Approve build packet');
        expect(screen.getByTestId('final-review-manifest')).toHaveTextContent('nothing approved yet');
    });
});

const unresolvedSecurityPrivacy = (): CrossCuttingObligationStatus => ({
    key: 'security_privacy',
    label: 'Security & Privacy',
    required: true,
    satisfied: false,
    absent: true,
    itemCount: 0,
    reason: 'This project handles personal data.',
    triggers: [{ source: 'data_model_privacy_fields', detail: 'Entity User stores an email address.' }],
    missing: ['No security controls are named.'],
    advisories: [],
});

const satisfiedMeasurement = (): CrossCuttingObligationStatus => ({
    key: 'measurement',
    label: 'Measurement',
    required: false,
    satisfied: true,
    absent: true,
    itemCount: 0,
    reason: 'No success metrics are declared.',
    triggers: [],
    missing: [],
    advisories: [],
});

describe('Final Review — folded-in surfaces', () => {
    it('is the single home for the cross-cutting obligations card', () => {
        const securityPrivacy: CrossCuttingObligationStatus = {
            key: 'security_privacy',
            label: 'Security & Privacy',
            required: true,
            satisfied: false,
            absent: true,
            itemCount: 0,
            reason: 'This project handles personal data.',
            triggers: [{ source: 'data_model_privacy_fields', detail: 'Entity User stores an email address.' }],
            missing: ['No security controls are named.'],
            advisories: [],
        };
        const measurement: CrossCuttingObligationStatus = {
            key: 'measurement',
            label: 'Measurement',
            required: false,
            satisfied: true,
            absent: true,
            itemCount: 0,
            reason: 'No success metrics are declared.',
            triggers: [],
            missing: [],
            advisories: [],
        };
        renderPlan({
            packet: packet([]),
            manifest: MANIFEST,
            canApprove: true,
            onApprove: vi.fn(),
            obligations: {
                securityPrivacy,
                measurement,
                unresolved: [securityPrivacy],
                hasUnresolvedObligations: true,
            },
        });
        const card = screen.getByLabelText('Security & Privacy');
        expect(card).toBeInTheDocument();
        // It sits inside Final Review, not as a sibling above the plan.
        expect(screen.getByRole('region', { name: 'Final Review' })).toContainElement(card);
    });

    it('states the obligation severity once — checklist loud, section flag quiet', () => {
        const securityPrivacy = unresolvedSecurityPrivacy();
        renderPlan({
            packet: packet([
                blocker('cc1', 'cross_cutting', { kind: 'artifact_slot', nodeId: 'implementation_plan' }),
            ]),
            manifest: MANIFEST,
            obligations: {
                securityPrivacy,
                measurement: satisfiedMeasurement(),
                unresolved: [securityPrivacy],
                hasUnresolvedObligations: true,
            },
        });

        // 1. The signal is NOT weakened: the status still counts the open
        //    check, and the checklist carries it without any click.
        expect(screen.getByTestId('final-review-status')).toHaveTextContent('6 of 7 checks pass');
        expect(screen.getByText(/1 packet check is still open/)).toBeInTheDocument();

        // 2. The checklist is the authoritative statement of severity.
        const checks = screen.getByTestId('final-review-checks');
        expect(checks).toHaveTextContent('cc1 consequence');
        expect(checks).toHaveTextContent('cc1 remedy');

        // 3. The section flag next to it is quiet: a chip, and the consequence
        //    and remedy are not restated in the plan body.
        const flag = screen.getByTestId('plan-obligation-security_privacy');
        expect(flag).toHaveAttribute('data-obligation-state', 'unresolved');
        expect(flag).toHaveTextContent('Not in the plan');
        expect(flag).not.toHaveTextContent('cc1 consequence');
        expect(flag).not.toHaveTextContent('cc1 remedy');
    });

    it('hands the obligation flag its Decision Center action, and withholds it when read-only', () => {
        const securityPrivacy = unresolvedSecurityPrivacy();
        const onAddressObligation = vi.fn();
        const obligations = {
            securityPrivacy,
            measurement: satisfiedMeasurement(),
            unresolved: [securityPrivacy],
            hasUnresolvedObligations: true,
        };

        const view = renderPlan({ packet: packet([]), manifest: MANIFEST, obligations, onAddressObligation });
        fireEvent.click(screen.getByTestId('plan-obligation-address-security_privacy'));
        expect(onAddressObligation).toHaveBeenCalledWith(securityPrivacy);

        // A project that cannot persist gets the flag with no write action.
        view.unmount();
        renderPlan({ packet: packet([]), manifest: MANIFEST, obligations });
        expect(screen.getByTestId('plan-obligation-security_privacy')).toBeInTheDocument();
        expect(screen.queryByTestId('plan-obligation-address-security_privacy')).toBeNull();
    });

    it('keeps the traceability matrix reachable as an expandable detail', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() });
        const toggle = screen.getByTestId('final-review-coverage-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText(/Change Impact/)).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/Change Impact/)).toBeInTheDocument();
    });
});

describe('the approval overlay key', () => {
    it('is the key the workspace writes and the card reads', () => {
        // Guards against the two sides drifting onto different metadata keys.
        expect(BUILD_PACKET_APPROVAL_KEY).toBe('buildPacketApproval');
    });
});
