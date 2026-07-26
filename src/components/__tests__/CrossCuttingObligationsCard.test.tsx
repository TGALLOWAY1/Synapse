import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('CrossCuttingObligationsCard', () => {
    it('renders nothing when neither section is required and the plan carries neither', () => {
        const report = deriveCrossCuttingObligations({ prd: basePrd(), plan: {} });
        const { container } = render(<CrossCuttingObligationsCard report={report} />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/Security & Privacy obligations/i)).toBeNull();
        expect(screen.queryByText(/Measurement/i)).toBeNull();
    });

    it('renders the controls and metrics with their links when required and satisfied', () => {
        const report = deriveCrossCuttingObligations({
            prd: basePrd({
                constraints: ['Must be GDPR compliant'],
                successMetrics: [{ name: 'Day-1 activation rate' }],
            }),
            plan: { securityPrivacy: SECURITY, measurement: MEASUREMENT },
        });
        render(
            <CrossCuttingObligationsCard
                report={report}
                securityPrivacy={SECURITY}
                measurement={MEASUREMENT}
            />,
        );

        expect(screen.getByRole('region', { name: 'Security & Privacy obligations' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Measurement' })).toBeTruthy();
        expect(screen.getAllByText('Covered')).toHaveLength(2);
        expect(screen.queryByText('Unresolved obligation')).toBeNull();

        // Control + its three links.
        expect(screen.getByText('Encrypt PII at rest')).toBeTruthy();
        expect(screen.getByText('f1')).toBeTruthy();
        expect(screen.getByText('task_encrypt_columns')).toBeTruthy();
        expect(screen.getByText('Stored email is unreadable without the app key')).toBeTruthy();

        // Metric + its event contract.
        expect(screen.getByText('playlist_generated')).toBeTruthy();
        expect(screen.getByText(/A playlist finishes generating/)).toBeTruthy();
        expect(screen.getByText(/Seen in the analytics debug view/)).toBeTruthy();
    });

    it('renders an explicit unresolved obligation when a required section is absent', () => {
        const report = deriveCrossCuttingObligations({
            prd: basePrd({
                constraints: ['Must be GDPR compliant'],
                successMetrics: [{ name: 'Day-1 activation rate' }],
            }),
            plan: {},
        });
        render(<CrossCuttingObligationsCard report={report} />);

        expect(screen.getAllByText('Unresolved obligation')).toHaveLength(2);
        expect(screen.getAllByText('Missing from the plan')).toHaveLength(2);
        expect(screen.getByText(/no Security & Privacy section/)).toBeTruthy();
        expect(screen.getByText(/no Measurement section/)).toBeTruthy();
        // The trigger evidence is shown, so the requirement is never unexplained.
        expect(screen.getByText(/PRD requirement: "Must be GDPR compliant"/)).toBeTruthy();
        expect(screen.getByText(/declares 1 success metric/)).toBeTruthy();
        // Never an empty section: no "Covered" state leaks through.
        expect(screen.queryByText('Covered')).toBeNull();
    });

    it('shows named gaps alongside the partial content of a required section', () => {
        const partial: PlanSecurityPrivacySection = {
            controls: [{ id: 'sec_a', title: 'Encrypt PII at rest', requirementIds: ['f1'] }],
        };
        const report = deriveCrossCuttingObligations({
            prd: basePrd({ constraints: ['Must be GDPR compliant'] }),
            plan: { securityPrivacy: partial },
        });
        render(<CrossCuttingObligationsCard report={report} securityPrivacy={partial} />);

        expect(screen.getByText('Unresolved obligation')).toBeTruthy();
        expect(screen.getByText('Gaps (1)')).toBeTruthy();
        expect(screen.getByText(/no linked plan tasks, no verification checks/)).toBeTruthy();
        // The control the plan does carry is still visible.
        expect(screen.getByText('Encrypt PII at rest')).toBeTruthy();
        expect(screen.getByText('f1')).toBeTruthy();
        // Measurement isn't required here, so it renders nothing.
        expect(screen.queryByRole('region', { name: 'Measurement' })).toBeNull();
    });
});
