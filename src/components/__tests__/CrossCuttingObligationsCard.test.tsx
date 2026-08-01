import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PlanMeasurementSection, PlanSecurityPrivacySection, StructuredPRD } from '../../types';
import { deriveCrossCuttingObligations } from '../../lib/planning/crossCuttingObligations';
import { CrossCuttingObligationsCard } from '../artifacts/CrossCuttingObligationsCard';

const basePrd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Playlists that match a mood.',
    targetUsers: ['Listeners'],
    coreProblem: 'Playlists ignore feelings.',
    features: [{
        id: 'f1',
        name: 'Mood capture',
        description: 'Capture a mood fast.',
        userValue: 'Speed',
        complexity: 'low',
    }],
    architecture: 'SPA',
    risks: [],
    ...overrides,
});

const SECURITY: PlanSecurityPrivacySection = {
    summary: 'PII is encrypted at rest and access is owner-scoped.',
    controls: [{
        id: 'sec_encrypt_pii',
        title: 'Encrypt PII at rest',
        obligation: 'GDPR requirement from the PRD constraints.',
        implementation: 'Column-level encryption on the listeners table.',
        requirementIds: ['f1'],
        taskIds: ['task_encrypt_columns'],
        tests: ['Stored email is unreadable without the app key'],
    }],
};

const MEASUREMENT: PlanMeasurementSection = {
    metrics: [{
        id: 'mm_activation',
        metric: 'Day-1 activation rate',
        eventName: 'playlist_generated',
        properties: ['user_id: string'],
        trigger: 'A playlist finishes generating.',
        validation: 'Seen in the analytics debug view before launch.',
        taskIds: ['task_add_analytics'],
    }],
};

const requiredPrd = () => basePrd({
    constraints: ['Must be GDPR compliant'],
    successMetrics: [{ name: 'Day-1 activation rate' }],
});

describe('CrossCuttingObligationsCard — the compact flag', () => {
    it('renders nothing when neither section is required and the plan carries neither', () => {
        const report = deriveCrossCuttingObligations({ prd: basePrd(), plan: {} });
        const { container } = render(<CrossCuttingObligationsCard report={report} />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/Security & Privacy obligations/i)).toBeNull();
        expect(screen.queryByText(/Measurement/i)).toBeNull();
    });

    it('flags a required-and-satisfied section quietly, with its content reachable', () => {
        const report = deriveCrossCuttingObligations({
            prd: requiredPrd(),
            plan: { securityPrivacy: SECURITY, measurement: MEASUREMENT },
        });
        render(
            <CrossCuttingObligationsCard
                report={report}
                securityPrivacy={SECURITY}
                measurement={MEASUREMENT}
            />,
        );

        expect(screen.getByTestId('plan-obligation-security_privacy'))
            .toHaveAttribute('data-obligation-state', 'covered');
        expect(screen.getByTestId('plan-obligation-measurement'))
            .toHaveAttribute('data-obligation-state', 'covered');
        expect(screen.getAllByText('Covered')).toHaveLength(2);
        // A satisfied obligation is never offered a "fix it" action.
        expect(screen.queryByTestId('plan-obligation-address-security_privacy')).toBeNull();

        // Collapsed by default; the content is one click away, not gone.
        expect(screen.queryByText('Encrypt PII at rest')).toBeNull();
        fireEvent.click(screen.getByTestId('plan-obligation-toggle-security_privacy'));
        expect(screen.getByText('Encrypt PII at rest')).toBeTruthy();
        expect(screen.getByText('f1')).toBeTruthy();
        expect(screen.getByText('task_encrypt_columns')).toBeTruthy();
        expect(screen.getByText('Stored email is unreadable without the app key')).toBeTruthy();

        fireEvent.click(screen.getByTestId('plan-obligation-toggle-measurement'));
        expect(screen.getByText('playlist_generated')).toBeTruthy();
        expect(screen.getByText(/A playlist finishes generating/)).toBeTruthy();
        expect(screen.getByText(/Seen in the analytics debug view/)).toBeTruthy();
    });

    it('flags a not-required section that the plan volunteered content for', () => {
        const report = deriveCrossCuttingObligations({
            // No success metrics declared → Measurement is not required, but the
            // plan carries a section anyway, so it stays reachable.
            prd: basePrd(),
            plan: { measurement: MEASUREMENT },
        });
        render(<CrossCuttingObligationsCard report={report} measurement={MEASUREMENT} />);

        const flag = screen.getByTestId('plan-obligation-measurement');
        expect(flag).toHaveAttribute('data-obligation-state', 'not_required');
        expect(screen.getByText('Not required')).toBeTruthy();
        expect(screen.queryByTestId('plan-obligation-address-measurement')).toBeNull();

        fireEvent.click(screen.getByTestId('plan-obligation-toggle-measurement'));
        expect(screen.getByText('playlist_generated')).toBeTruthy();
    });

    it('flags an unresolved obligation compactly — a chip, not an amber panel', () => {
        const report = deriveCrossCuttingObligations({ prd: requiredPrd(), plan: {} });
        render(<CrossCuttingObligationsCard report={report} onAddressObligation={vi.fn()} />);

        const security = screen.getByTestId('plan-obligation-security_privacy');
        expect(security).toHaveAttribute('data-obligation-state', 'unresolved');
        // Absent sections read "Not in the plan"; the old full-width amber box
        // and its nested amber "GAPS (n)" sub-box are gone.
        expect(screen.getAllByText('Not in the plan')).toHaveLength(2);
        expect(screen.queryByText('Unresolved obligation')).toBeNull();
        expect(security.className).not.toMatch(/bg-amber/);
        // The one amber surface left in the row is the chip itself.
        expect(security.querySelectorAll('[class*="bg-amber"]')).toHaveLength(1);
        // The gap detail is not shouted on load, but is one click away.
        expect(screen.queryByText(/no Security & Privacy section/)).toBeNull();

        fireEvent.click(screen.getByTestId('plan-obligation-toggle-security_privacy'));
        expect(screen.getByText('Missing from the plan')).toBeTruthy();
        expect(screen.getByText(/no Security & Privacy section/)).toBeTruthy();
        // The trigger evidence is still there, so the requirement is never unexplained.
        expect(screen.getByText(/PRD requirement: "Must be GDPR compliant"/)).toBeTruthy();
        // Severity is expressed once — the detail points at the blocker list
        // rather than restating the consequence and the remedy.
        expect(screen.getByText(/Counted in the Final Review blockers above/)).toBeTruthy();
        expect(screen.queryByText(/Synapse does not fill these in for you/)).toBeNull();
    });

    it('counts named gaps on the chip and keeps partial plan content reachable', () => {
        const partial: PlanSecurityPrivacySection = {
            controls: [{ id: 'sec_a', title: 'Encrypt PII at rest', requirementIds: ['f1'] }],
        };
        const report = deriveCrossCuttingObligations({
            prd: basePrd({ constraints: ['Must be GDPR compliant'] }),
            plan: { securityPrivacy: partial },
        });
        render(<CrossCuttingObligationsCard report={report} securityPrivacy={partial} />);

        expect(screen.getByText('1 gap')).toBeTruthy();
        fireEvent.click(screen.getByTestId('plan-obligation-toggle-security_privacy'));
        expect(screen.getByText('Gaps (1)')).toBeTruthy();
        expect(screen.getByText(/no linked plan tasks, no verification checks/)).toBeTruthy();
        // The control the plan does carry is still visible.
        expect(screen.getByText('Encrypt PII at rest')).toBeTruthy();
        expect(screen.getByText('f1')).toBeTruthy();
        // Measurement isn't required here, so it renders nothing.
        expect(screen.queryByTestId('plan-obligation-measurement')).toBeNull();
    });

    it('routes the flagged obligation out to the Decision Center on an explicit click', () => {
        const onAddressObligation = vi.fn();
        const report = deriveCrossCuttingObligations({ prd: requiredPrd(), plan: {} });
        render(
            <CrossCuttingObligationsCard report={report} onAddressObligation={onAddressObligation} />,
        );

        // Rule 13: nothing is created by rendering the flag.
        expect(onAddressObligation).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('plan-obligation-address-measurement'));
        expect(onAddressObligation).toHaveBeenCalledTimes(1);
        expect(onAddressObligation.mock.calls[0]?.[0]).toMatchObject({
            key: 'measurement',
            required: true,
            satisfied: false,
        });
    });

    it('offers no write action when the project cannot persist planning state', () => {
        const report = deriveCrossCuttingObligations({ prd: requiredPrd(), plan: {} });
        render(<CrossCuttingObligationsCard report={report} />);

        // Still flagged — the signal is not weakened, only the action removed.
        expect(screen.getByTestId('plan-obligation-security_privacy'))
            .toHaveAttribute('data-obligation-state', 'unresolved');
        expect(screen.queryByTestId('plan-obligation-address-security_privacy')).toBeNull();
        expect(screen.queryByTestId('plan-obligation-address-measurement')).toBeNull();
        expect(screen.queryByText('Address in Decision Center')).toBeNull();
    });

    it('reports a rejected flag instead of silently doing nothing', () => {
        const report = deriveCrossCuttingObligations({ prd: requiredPrd(), plan: {} });
        render(
            <CrossCuttingObligationsCard
                report={report}
                onAddressObligation={() => ({ status: 'rejected', reason: 'source_changed' })}
            />,
        );

        fireEvent.click(screen.getByTestId('plan-obligation-address-measurement'));
        expect(screen.getByRole('alert')).toHaveTextContent(/This plan changed since you opened it/);
    });
});

describe('the obligation flag → Decision Center wiring', () => {
    const workspace = readFileSync(
        resolve(process.cwd(), 'src/components/ArtifactWorkspace.tsx'),
        'utf8',
    );
    const handler = workspace.slice(
        workspace.indexOf('onAddressObligation:'),
        workspace.indexOf('const validationDisposition'),
    );

    it('creates the planning record only inside the click handler (rule 13)', () => {
        // The derivation runs on render; the WRITE must not. If the call ever
        // moves out of the handler body, an obligation would auto-create a
        // PlanningRecord just by opening the plan.
        expect(handler).toContain('flagCrossCuttingObligationConcern(');
        expect(workspace).not.toMatch(
            /useMemo\([^)]*flagCrossCuttingObligationConcern/,
        );
        // The concern shape comes from the shared adapter, not inlined here.
        expect(workspace).not.toContain('crossCuttingObligationPlanningSourceKey({');
    });

    it('opens the Decision Center on the new record with a return target', () => {
        expect(handler).toContain('onOpenPlanningRecord(result.planningRecordId');
        expect(handler).toContain("kind: 'artifact'");
        expect(handler).toContain("nodeId: 'implementation_plan'");
        expect(handler).toContain('label: `Back to ${artifact.title}`');
        // A rejected flag navigates nowhere; the card reports it instead.
        expect(handler).toContain("if (result.status !== 'rejected')");
    });

    it('gates the action on the capability policy, never a demo-id check', () => {
        expect(handler).not.toContain('DEMO_PROJECT_ID');
        const guard = workspace.slice(
            workspace.lastIndexOf('...(', workspace.indexOf('onAddressObligation:')),
            workspace.indexOf('onAddressObligation:'),
        );
        expect(guard).toContain('capabilities.canPersistWorkflowState');
        expect(guard).toContain('onOpenPlanningRecord');
    });
});
