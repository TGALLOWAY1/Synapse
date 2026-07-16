import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashReviewValue } from '../../lib/review/hash';
import {
    downstreamPlanningContextHash,
    sealDownstreamUpdatePlan,
    sealDownstreamUpdatePlanEvent,
    type DownstreamUpdatePlan,
} from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../../store/projectStore';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { DownstreamUpdatePlanReview } from '../downstream/DownstreamUpdatePlanReview';

const projectId = 'project-update-review';
const spine: SpineVersion = {
    id: 'spine-current-123456', projectId, promptText: 'Plan', responseText: 'Current plan',
    createdAt: 2, isLatest: true, isFinal: true,
};
const artifact: Artifact = {
    id: 'screens-artifact', projectId, type: 'core_artifact', subtype: 'screen_inventory',
    title: 'Screens', status: 'active', currentVersionId: 'screens-v1', createdAt: 1, updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'screens-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null,
    content: JSON.stringify({ sections: [{ title: 'Core', screens: [
        {
            id: 'workspace', name: 'Shared workspace', priority: 'P0', purpose: 'Create locally',
            states: [{ name: 'Invite collaborators', description: 'Invite teammates to edit.' }],
            coreUIElements: ['Local editor'],
        },
        {
            id: 'settings', name: 'Settings', priority: 'P1', purpose: 'Configure the workspace',
            coreUIElements: ['Workspace controls'],
        },
    ] }] }), metadata: {}, sourceRefs: [], generationPrompt: '',
    isPreferred: true, createdAt: 1,
};
const record: PlanningRecord = {
    id: 'decision-sharing', projectId, type: 'decision', status: 'confirmed', title: 'Sharing',
    statement: 'Should workspaces be shared?', resolution: 'Local only', evidence: [],
    sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
};

function makePlan(): DownstreamUpdatePlan {
    return sealDownstreamUpdatePlan({
        schemaVersion: 1, id: 'plan-current', projectId, authoredBy: 'synapse', createdAt: 10,
        source: {
            kind: 'planning_change', summary: 'Collaboration was removed from the first release.',
            targetSpineVersionId: spine.id, targetSpineContentHash: hashReviewValue(spine.responseText),
            planningContextHash: downstreamPlanningContextHash([record]), planningRecordId: record.id,
            confirmed: true,
        },
        artifact: {
            artifactId: artifact.id, artifactVersionId: version.id,
            artifactContentHash: hashReviewValue(version.content), slot: 'screen_inventory', title: artifact.title,
        },
        items: [
            {
                id: 'possible-item', region: { kind: 'screen', screenId: 'settings', screenName: 'Settings', aspect: 'behavior', label: 'Workspace controls' },
                currentInterpretation: 'Settings may expose sharing controls.', whyAffected: 'The audience changed.',
                certainty: 'possible', evidence: [{ id: 'e2', kind: 'plan_diff', quality: 'inferred', summary: 'The screen uses related language.' }],
                ambiguity: 'The reference establishes relevance, not a mismatch.', recommendedAction: 'review_only',
                recommendation: 'Review the controls before changing them.', preservedScope: ['Account preferences remain aligned.'],
                recommendedPriority: 2, implementationCritical: false,
            },
            {
                id: 'definite-item', region: { kind: 'screen', screenId: 'workspace', screenName: 'Shared workspace', aspect: 'state', label: 'Invite collaborators' },
                currentInterpretation: 'The screen still offers invitations.', whyAffected: 'The confirmed local-only plan removes collaboration.',
                certainty: 'definite', evidence: [{ id: 'e1', kind: 'deterministic_reference', quality: 'direct', summary: 'The current screen explicitly names collaboration.' }],
                ambiguity: 'The user still decides how to preserve exploratory work.', recommendedAction: 'remove_obsolete_element',
                recommendation: 'Remove only the invitation state.', preservedScope: ['Local workspace creation remains aligned.', 'Manual screen work remains usable.'],
                recommendedPriority: 1, implementationCritical: true,
            },
        ],
        preservedArtifactSummary: 'Only two named screen regions need attention. Other screen work remains usable.',
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    const plan = makePlan();
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Selective updates', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, artifacts: { [projectId]: [artifact] },
        artifactVersions: { [projectId]: [version] }, planningRecords: { [projectId]: [record] },
        downstreamUpdatePlans: { [projectId]: [plan] }, downstreamUpdatePlanEvents: { [projectId]: [] },
        downstreamArtifactUpdateProposals: {}, downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {}, downstreamArtifactUpdateVerifications: {},
        downstreamArtifactUpdateVerificationEvents: {}, historyEvents: {},
    });
});

function renderReview(overrides: Partial<React.ComponentProps<typeof DownstreamUpdatePlanReview>> = {}) {
    const props = {
        projectId, initialPlanId: 'plan-current', onClose: vi.fn(), onOpenSource: vi.fn(), onOpenOutput: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<DownstreamUpdatePlanReview {...props} />) };
}

describe('DownstreamUpdatePlanReview', () => {
    it('explains bounded scope and orders definite impact before advisory impact', () => {
        renderReview();

        expect(screen.getByRole('dialog', { name: 'Screens' })).toHaveClass('min-w-0');
        expect(screen.getByText('Current plan')).toBeInTheDocument();
        expect(screen.getByText(/Nothing here edits or regenerates this output/)).toBeInTheDocument();
        expect(screen.getByText(/Confirmed source change/)).toBeInTheDocument();
        expect(screen.getByText('Manual screen work remains usable.')).toBeInTheDocument();
        expect(screen.getByText(/Other screen work remains usable/)).toBeInTheDocument();

        const regions = screen.getAllByRole('heading', { level: 3 });
        expect(regions[0]).toHaveTextContent('Shared workspace');
        expect(regions[1]).toHaveTextContent('Settings');
        expect(screen.getByText('Definite impact')).toBeInTheDocument();
        expect(screen.getByText('Review recommended')).toBeInTheDocument();
        expect(screen.getAllByText(/What remains safe/)).toHaveLength(2);
    });

    it('records user dispositions only through append-only plan events and requires rationale', () => {
        const markArtifactCurrentForSpine = vi.spyOn(useProjectStore.getState(), 'markArtifactCurrentForSpine');
        renderReview();
        const item = screen.getByRole('heading', { name: /Shared workspace/ }).closest('article')!;

        fireEvent.click(within(item).getByRole('button', { name: 'Already aligned' }));
        const save = within(item).getByRole('button', { name: 'Record choice' });
        expect(save).toBeDisabled();
        fireEvent.change(within(item).getByLabelText(/Why is this item already aligned/), {
            target: { value: 'The invitation state was already removed manually.' },
        });
        fireEvent.click(save);

        const events = useProjectStore.getState().downstreamUpdatePlanEvents[projectId];
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ actor: 'user', type: 'disposition_recorded', disposition: 'already_aligned' });
        expect(markArtifactCurrentForSpine).not.toHaveBeenCalled();
        expect(screen.getByText(/User rationale:/).parentElement).toHaveTextContent('already removed manually');
    });

    it('keeps certainty ordering fixed while supporting priority changes within a certainty group', () => {
        const originalContent = useProjectStore.getState().artifactVersions[projectId][0].content;
        const original = makePlan();
        const { integrityHash: _integrityHash, ...unsealed } = original;
        void _integrityHash;
        const peerPlan = sealDownstreamUpdatePlan({
            ...unsealed,
            items: [...unsealed.items, {
                ...unsealed.items[0], id: 'possible-peer', recommendedPriority: 3,
                region: { kind: 'screen', screenId: 'profile', screenName: 'Profile', aspect: 'behavior', label: 'Audience language' },
            }],
        });
        useProjectStore.setState({ downstreamUpdatePlans: { [projectId]: [peerPlan] } });
        renderReview();
        const possible = screen.getByRole('heading', { name: /Settings/ }).closest('article')!;
        expect(within(possible).getByRole('button', { name: /Move earlier within this certainty group/ })).toBeDisabled();

        const peer = screen.getByRole('heading', { name: /Profile/ }).closest('article')!;
        fireEvent.click(within(peer).getByRole('button', { name: /Move earlier within this certainty group/ }));

        expect(useProjectStore.getState().downstreamUpdatePlanEvents[projectId].every(event => event.type === 'priority_changed')).toBe(true);
        expect(useProjectStore.getState().artifactVersions[projectId][0].content).toBe(originalContent);
        const regions = screen.getAllByRole('heading', { level: 3 });
        expect(regions.map(region => region.textContent)).toEqual(expect.arrayContaining([
            expect.stringContaining('Shared workspace'),
            expect.stringContaining('Profile'),
            expect.stringContaining('Settings'),
        ]));
        expect(regions.findIndex(region => region.textContent?.includes('Profile')))
            .toBeLessThan(regions.findIndex(region => region.textContent?.includes('Settings')));
    });

    it('opens the durable source and exact output region through explicit callbacks', () => {
        const { props } = renderReview();
        fireEvent.click(screen.getByRole('button', { name: 'Open source decision' }));
        expect(props.onOpenSource).toHaveBeenCalledWith(record.id);

        const item = screen.getByRole('heading', { name: /Shared workspace/ }).closest('article')!;
        fireEvent.click(within(item).getByRole('button', { name: 'Open output' }));
        expect(props.onOpenOutput).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'plan-current' }),
            expect.objectContaining({ id: 'definite-item', region: expect.objectContaining({ screenId: 'workspace' }) }),
        );
    });

    it('keeps stale and historical plans visibly read-only', () => {
        useProjectStore.setState({ spineVersions: { [projectId]: [{ ...spine, id: 'spine-new' }] } });
        renderReview();

        expect(screen.getByText('Historical · read only')).toBeInTheDocument();
        expect(screen.getByText(/no longer describes the current planning spine/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mark planned' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Already aligned' })).not.toBeInTheDocument();
    });

    it('does not display a tampered event as user rationale', () => {
        const plan = useProjectStore.getState().downstreamUpdatePlans[projectId][0];
        const valid = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1, id: 'tampered-event', projectId, planId: plan.id, itemId: 'definite-item',
            actor: 'user', at: 20, expectedPlanIntegrityHash: plan.integrityHash,
            type: 'disposition_recorded', disposition: 'already_aligned', rationale: 'User rationale.',
        });
        if (valid.type !== 'disposition_recorded') throw new Error('Expected a disposition event fixture.');
        useProjectStore.setState({
            downstreamUpdatePlanEvents: {
                [projectId]: [{ ...valid, rationale: 'Model-authored approval.' }],
            },
        });

        renderReview();
        expect(screen.queryByText(/Model-authored approval/)).not.toBeInTheDocument();
        expect(screen.queryByText(/User rationale:/)).not.toBeInTheDocument();
    });

    it('uses one responsive review surface with reachable, labelled primary controls', () => {
        const { container } = renderReview();
        expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Close update plan' })).toHaveClass('min-h-11', 'min-w-11');
        expect(screen.getAllByRole('button', { name: 'Mark planned' })[0]).toHaveClass('min-h-11');
        expect(screen.getAllByText(/Why this region\? Evidence and ambiguity/)).toHaveLength(2);
    });

    it('keeps review-only guidance non-applicable when evidence does not support an exact change', () => {
        renderReview();
        const possible = screen.getByRole('heading', { name: /Settings/ }).closest('article')!;
        fireEvent.click(within(possible).getByRole('button', { name: 'Prepare proposal' }));

        expect(within(possible).getByText('Review only')).toBeInTheDocument();
        expect(within(possible).getByText(/No bounded content change is available/)).toBeInTheDocument();
        expect(within(possible).queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument();
        expect(within(possible).queryByRole('button', { name: 'Apply approved change' })).not.toBeInTheDocument();
        expect(within(possible).getByRole('button', { name: 'Add context' })).toBeInTheDocument();
    });

    it('separates approval from guarded application and creates a child artifact version for one state', () => {
        renderReview();
        const definite = screen.getByRole('heading', { name: /Shared workspace/ }).closest('article')!;
        fireEvent.click(within(definite).getByRole('button', { name: 'Prepare proposal' }));
        expect(within(definite).getByText('Bounded change')).toBeInTheDocument();
        expect(within(definite).getByText(/Remove only this exact region/)).toBeInTheDocument();

        fireEvent.click(within(definite).getByRole('button', { name: 'Accept proposal' }));
        expect(within(definite).getByText(/artifact has not changed yet/)).toBeInTheDocument();
        expect(useProjectStore.getState().artifactVersions[projectId]).toHaveLength(1);

        fireEvent.click(within(definite).getByRole('button', { name: 'Apply approved change' }));
        expect(within(definite).getByText(/Alignment still requires verification/)).toBeInTheDocument();
        const versions = useProjectStore.getState().artifactVersions[projectId];
        expect(versions).toHaveLength(2);
        expect(versions[1].parentVersionId).toBe(version.id);
        expect(JSON.parse(versions[1].content).sections[0].screens[0].states).toEqual([]);
        expect(JSON.parse(versions[1].content).sections[0].screens[1])
            .toEqual(JSON.parse(version.content).sections[0].screens[1]);
        expect(useProjectStore.getState().downstreamArtifactUpdateVerifications[projectId] ?? []).toEqual([]);
    });
});
