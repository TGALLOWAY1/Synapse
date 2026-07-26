import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImplementationPlanRenderer } from '../renderers/ImplementationPlanRenderer';
import type { PlanFinalReviewContext } from '../renderers/implementationPlan/FinalReviewCard';
import type { StructuredImplementationPlan } from '../../types';
import { BUILD_PACKET_APPROVAL_KEY } from '../../lib/planning/buildPacketApproval';
import type {
    BuildPacketBlocker,
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
    actionTarget: { kind: 'readiness_commitment' },
});

const packet = (blockers: BuildPacketBlocker[], warnings: BuildPacketWarning[] = []): BuildPacketReadiness => ({
    isPacketComplete: blockers.length === 0,
    status: blockers.length === 0 ? 'complete' : 'incomplete',
    headline: blockers.length === 0 ? 'Implementation packet complete' : 'Implementation packet incomplete',
    summary: 'Packet summary sentence.',
    criteria: [],
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

describe('Final Review — the CTA state machine on the plan surface', () => {
    it('promotes "Resolve N blockers" when the packet is incomplete', () => {
        renderPlan({
            packet: packet([
                blocker('b1', 'artifacts_present', { kind: 'artifact_slot', nodeId: 'data_model' }),
                blocker('b2', 'api_contract', { kind: 'artifact_slot', nodeId: 'data_model', section: 'api_contract' }),
            ]),
            manifest: MANIFEST,
        });
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toHaveAttribute('data-cta-state', 'resolve_blockers');
        expect(primary).toHaveTextContent('Resolve 2 blockers');
        expect(screen.getByText('Packet summary sentence.')).toBeInTheDocument();
    });

    it('promotes "Approve build packet" when the packet is complete and unapproved', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() });
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toHaveAttribute('data-cta-state', 'approve');
        expect(primary).toHaveTextContent('Approve build packet');
        expect(primary).toBeEnabled();
    });

    it('promotes the first implementation prompt once approved', () => {
        renderPlan({
            packet: packet([]),
            manifest: MANIFEST,
            approval: { approvedAt: 1_700_000_000_000, manifest: MANIFEST },
            canApprove: true,
            onApprove: vi.fn(),
        });
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toHaveAttribute('data-cta-state', 'start_build');
        expect(primary).toHaveTextContent('Copy first implementation prompt');
        expect(screen.getByText('Packet approved')).toBeInTheDocument();
    });

    it('renders exactly one primary-styled action in every state', () => {
        const states: PlanFinalReviewContext[] = [
            { packet: packet([blocker('b1', 'first_slice', { kind: 'readiness_commitment' })]), manifest: MANIFEST },
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            {
                packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn(),
                approval: { approvedAt: 1, manifest: MANIFEST },
            },
        ];
        for (const context of states) {
            const { container, unmount } = renderPlan(context, { onConvertToTasks: vi.fn() });
            // The indigo-filled button is the visual primary; there must be one.
            const primaries = container.querySelectorAll('button.bg-indigo-600');
            expect(primaries).toHaveLength(1);
            expect(primaries[0]).toBe(screen.getByTestId('final-review-primary'));
            unmount();
        }
    });

    it('keeps copy plan, review prompts and convert to tasks secondary even when ready', () => {
        const onConvertToTasks = vi.fn();
        const { container } = renderPlan(
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            { onConvertToTasks },
        );
        for (const id of ['review_prompts', 'convert_tasks', 'copy_plan']) {
            const button = screen.getByTestId(`final-review-secondary-${id}`);
            expect(button).toBeInTheDocument();
            expect(button.className).not.toContain('bg-indigo-600');
        }
        // Copying the plan before approval is possible — from a demoted control.
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
            // Only Final Review's own primary is indigo-filled — the Prompts tab
            // and every pack card use the secondary variant in both states.
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

describe('Final Review — the one blocker list', () => {
    const blockers = [
        blocker('b1', 'artifacts_present', { kind: 'artifact_slot', nodeId: 'data_model' }),
        blocker('b2', 'requirement_coverage', { kind: 'feature', featureId: 'f1' }),
        blocker('b3', 'reasoning_committed', { kind: 'readiness_commitment' }),
    ];

    it('expands the ordered blocker list from the primary action', () => {
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget: vi.fn() });
        expect(screen.queryByTestId('final-review-blockers')).not.toBeInTheDocument();
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(primary);
        expect(primary).toHaveAttribute('aria-expanded', 'true');
        // Rendered in the evaluator's criterion order, unchanged.
        const rendered = screen.getAllByTestId('final-review-blocker');
        expect(rendered.map(item => item.getAttribute('data-criterion'))).toEqual([
            'artifacts_present', 'requirement_coverage', 'reasoning_committed',
        ]);
    });

    it('shows each blocker title, consequence and remedy', () => {
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget: vi.fn() });
        fireEvent.click(screen.getByTestId('final-review-primary'));
        expect(screen.getByText('b1 title')).toBeInTheDocument();
        expect(screen.getByText('b1 consequence')).toBeInTheDocument();
        expect(screen.getByText(/b1 remedy/)).toBeInTheDocument();
    });

    it('wires each entry to its own navigable action target', () => {
        const onNavigateTarget = vi.fn();
        renderPlan({ packet: packet(blockers), manifest: MANIFEST, onNavigateTarget });
        fireEvent.click(screen.getByTestId('final-review-primary'));
        const actions = screen.getAllByTestId('final-review-blocker-action');
        expect(actions.map(action => action.textContent?.trim())).toEqual([
            'Open Data Model', 'Review first-release scope', 'Open Review readiness',
        ]);
        fireEvent.click(actions[1]);
        expect(onNavigateTarget).toHaveBeenCalledWith({ kind: 'feature', featureId: 'f1' });
        fireEvent.click(actions[2]);
        expect(onNavigateTarget).toHaveBeenLastCalledWith({ kind: 'readiness_commitment' });
    });

    it('labels an artifact-section target by the section it opens', () => {
        renderPlan({
            packet: packet([
                blocker('b1', 'api_contract', { kind: 'artifact_slot', nodeId: 'data_model', section: 'api_contract' }),
                blocker('b2', 'first_slice', { kind: 'artifact_slot', nodeId: 'implementation_plan', section: 'first_milestone', milestoneId: 'm_setup' }),
            ]),
            manifest: MANIFEST,
            onNavigateTarget: vi.fn(),
        });
        fireEvent.click(screen.getByTestId('final-review-primary'));
        expect(screen.getAllByTestId('final-review-blocker-action').map(a => a.textContent?.trim())).toEqual([
            'Open the API contract', 'Open the first milestone',
        ]);
    });

    it('records warnings separately from blockers', () => {
        renderPlan({ packet: packet([], [warning('w1')]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() });
        expect(screen.getByText('Recorded, not blocking')).toBeInTheDocument();
        expect(screen.getByText(/w1 impact/)).toBeInTheDocument();
        // A warning never becomes a blocker, so the CTA still offers approval.
        expect(screen.getByTestId('final-review-primary')).toHaveAttribute('data-cta-state', 'approve');
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
    });

    it('reports a changed output against the version the approval pinned', () => {
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
        expect(screen.getByText('Approval superseded')).toBeInTheDocument();
        expect(screen.getByTestId('final-review-primary')).toHaveTextContent('Re-approve build packet');
    });
});

describe('Final Review — the approval action', () => {
    it('records the approval through the supplied writer', () => {
        const onApprove = vi.fn();
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove });
        fireEvent.click(screen.getByTestId('final-review-primary'));
        expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('cannot be taken in a read-only project', () => {
        const onApprove = vi.fn();
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: false, onApprove });
        const primary = screen.getByTestId('final-review-primary');
        expect(primary).toBeDisabled();
        expect(primary).toHaveAttribute('data-cta-action', 'approve');
        fireEvent.click(primary);
        expect(onApprove).not.toHaveBeenCalled();
        expect(screen.getByText(/read-only/)).toBeInTheDocument();
    });

    it('cannot be taken when no writer is wired even if the capability reads true', () => {
        renderPlan({ packet: packet([]), manifest: MANIFEST, canApprove: true });
        expect(screen.getByTestId('final-review-primary')).toBeDisabled();
    });

    it('never treats prompt review or task conversion as an approval', () => {
        const onConvertToTasks = vi.fn();
        renderPlan(
            { packet: packet([]), manifest: MANIFEST, canApprove: true, onApprove: vi.fn() },
            { onConvertToTasks },
        );
        fireEvent.click(screen.getByTestId('final-review-secondary-review_prompts'));
        fireEvent.click(screen.getByTestId('final-review-secondary-convert_tasks'));
        // Still awaiting the one genuine approval.
        expect(screen.getByTestId('final-review-primary')).toHaveAttribute('data-cta-state', 'approve');
        expect(screen.getByTestId('final-review-manifest')).toHaveTextContent('nothing approved yet');
    });
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
