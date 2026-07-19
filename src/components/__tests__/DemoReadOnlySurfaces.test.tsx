import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { useProjectStore } from '../../store/projectStore';
import type { SpineVersion, StructuredPRD } from '../../types';
import { DemoReadOnlyNotice } from '../DemoReadOnlyNotice';
import { DependencyGraphView } from '../dependency/DependencyGraphView';
import { VersionHistoryPanel } from '../versions';

const structuredPRD = { productName: 'Demo' } as StructuredPRD;

describe('read-only demo surfaces', () => {
    it('communicates the policy once at workspace level', () => {
        render(<DemoReadOnlyNotice />);

        expect(screen.getByRole('status')).toHaveTextContent('read-only example project');
        expect(screen.getByRole('status')).toHaveTextContent('without changing the saved project');
    });

    it('keeps dependency inspection usable while hiding generation controls', () => {
        const spine: SpineVersion = {
            id: 'spine-1',
            projectId: DEMO_PROJECT_ID,
            promptText: 'idea',
            responseText: 'prd',
            structuredPRD,
            isLatest: true,
            isFinal: true,
            createdAt: 1,
        };
        useProjectStore.setState({
            projects: { [DEMO_PROJECT_ID]: { id: DEMO_PROJECT_ID, name: 'Demo', createdAt: 1 } },
            spineVersions: { [DEMO_PROJECT_ID]: [spine] },
            artifacts: { [DEMO_PROJECT_ID]: [] },
            artifactVersions: { [DEMO_PROJECT_ID]: [] },
            jobs: {},
        });

        render(
            <DependencyGraphView
                projectId={DEMO_PROJECT_ID}
                spineVersionId={spine.id}
                prdContent={spine.responseText}
                structuredPRD={structuredPRD}
                onOpenNode={() => {}}
            />,
        );

        expect(screen.queryByText(/Update 6 impacted/)).toBeNull();
        fireEvent.click(screen.getByText('Impact View'));
        expect(screen.getByText('Graph View')).toBeEnabled();
        fireEvent.click(screen.getAllByText('Data Model')[0]);
        expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    });

    it('allows version comparison but omits restore', () => {
        render(
            <VersionHistoryPanel
                title="Artifact version history"
                entries={[
                    { id: 'v2', label: 'Version 2', isCurrent: true, createdAt: 2 },
                    { id: 'v1', label: 'Version 1', isCurrent: false, createdAt: 1 },
                ]}
                restoreKind="artifact"
                getCompareInput={() => ({ kind: 'text', before: 'old', after: 'new' })}
                onClose={() => {}}
            />,
        );

        expect(screen.getByRole('button', { name: /Compare/ })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    });
});
