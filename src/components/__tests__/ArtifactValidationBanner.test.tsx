import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    artifactValidationBlockerSetFingerprint,
} from '../../lib/artifactValidationPolicy';
import type {
    ArtifactValidationBlocker,
    ArtifactValidationDisposition,
} from '../../types';
import { ArtifactValidationBanner } from '../artifacts/ArtifactValidationBanner';

const semantic: ArtifactValidationBlocker = {
    code: 'prd_traceability_unverified',
    message: 'Traceability was not verified.',
};
const structural: ArtifactValidationBlocker = {
    code: 'output_structure_incomplete',
    message: 'No screens were produced.',
};
const needsReview: ArtifactValidationDisposition = {
    blockers: [semantic],
    effectiveStatus: 'needs_review',
    overridePolicy: 'rationale_required',
};

function renderBanner(
    disposition: ArtifactValidationDisposition = needsReview,
    props: Partial<React.ComponentProps<typeof ArtifactValidationBanner>> = {},
) {
    const onRegenerate = vi.fn();
    const onAccept = vi.fn(() => ({
        status: 'accepted' as const,
        artifactId: 'a1',
        versionId: 'v1',
    }));
    const rendered = render(
        <ArtifactValidationBanner
            disposition={disposition}
            canRegenerate
            canAccept
            onRegenerate={onRegenerate}
            onAccept={onAccept}
            {...props}
        />,
    );
    return { ...rendered, onRegenerate, onAccept };
}

describe('ArtifactValidationBanner', () => {
    it('requires and trims rationale before handing authority to the store', async () => {
        const { onAccept } = renderBanner();
        expect(screen.getByText('Traceability was not verified.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Accept with noted issue' }));
        await waitFor(() => expect(
            screen.getByLabelText('Why is this output safe to use?'),
        ).toHaveFocus());
        expect(screen.getByRole('button', { name: 'Record accepted issue' })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Why is this output safe to use?'), {
            target: { value: '  The canonical appendix supplies this mapping.  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Record accepted issue' }));

        expect(onAccept).toHaveBeenCalledWith({
            rationale: 'The canonical appendix supplies this mapping.',
            expectedBlockerFingerprint: artifactValidationBlockerSetFingerprint([semantic]),
        });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows regeneration but not acceptance for non-overridable or mixed blockers', () => {
        const mixed: ArtifactValidationDisposition = {
            blockers: [semantic, structural],
            effectiveStatus: 'needs_review',
            overridePolicy: 'non_overridable',
        };
        renderBanner(mixed);

        expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Accept with noted issue' })).toBeNull();
    });

    it('shows Accepted issue, its rationale, and the original failed checks honestly', () => {
        renderBanner({
            blockers: [semantic],
            effectiveStatus: 'accepted_issue',
            overridePolicy: 'rationale_required',
            accepted: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 10,
                rationale: 'The appendix was reviewed manually.',
                blockerFingerprint: artifactValidationBlockerSetFingerprint([semantic]),
            },
        });

        expect(screen.getByText('Accepted issue')).toBeInTheDocument();
        expect(screen.getByText('The appendix was reviewed manually.')).toBeInTheDocument();
        expect(screen.getByText('Traceability was not verified.')).toBeInTheDocument();
        expect(screen.queryByText(/^(Passed|Validated)$/i)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Accept with noted issue' })).toBeNull();
    });

    it('shows no mutation controls when capabilities do not allow them', () => {
        renderBanner(needsReview, {
            canAccept: false,
            canRegenerate: false,
        });

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('keeps the dialog open with a live stale-version error', () => {
        renderBanner(needsReview, {
            onAccept: vi.fn(() => ({
                status: 'rejected' as const,
                reason: 'blockers_changed' as const,
            })),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Accept with noted issue' }));
        fireEvent.change(screen.getByLabelText('Why is this output safe to use?'), {
            target: { value: 'Reviewed against the canonical appendix.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Record accepted issue' }));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'This artifact changed. Review the current version before accepting an issue.',
        );
    });

    it('traps focus, closes on Escape, and restores focus to the trigger', async () => {
        renderBanner();
        const trigger = screen.getByRole('button', { name: 'Accept with noted issue' });
        fireEvent.click(trigger);
        const textarea = screen.getByLabelText('Why is this output safe to use?');
        await waitFor(() => expect(textarea).toHaveFocus());

        fireEvent.change(textarea, {
            target: { value: 'Reviewed against the canonical appendix.' },
        });
        const close = screen.getByRole('button', { name: 'Close acceptance dialog' });
        const submit = screen.getByRole('button', { name: 'Record accepted issue' });
        close.focus();
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(submit).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(close).toHaveFocus();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('focuses and announces the accepted banner when accepting removes the trigger', async () => {
        const acceptedDisposition: ArtifactValidationDisposition = {
            blockers: [semantic],
            effectiveStatus: 'accepted_issue',
            overridePolicy: 'rationale_required',
            accepted: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 10,
                rationale: 'The appendix was reviewed manually.',
                blockerFingerprint: artifactValidationBlockerSetFingerprint([semantic]),
            },
        };
        const { rerender } = renderBanner(needsReview, {
            onAccept: vi.fn(() => ({
                status: 'accepted' as const,
                artifactId: 'a1',
                versionId: 'v1',
            })),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Accept with noted issue' }));
        fireEvent.change(screen.getByLabelText('Why is this output safe to use?'), {
            target: { value: 'The appendix was reviewed manually.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Record accepted issue' }));
        rerender(
            <ArtifactValidationBanner
                disposition={acceptedDisposition}
                canRegenerate
                canAccept
                onRegenerate={vi.fn()}
                onAccept={vi.fn(() => ({
                    status: 'accepted' as const,
                    artifactId: 'a1',
                    versionId: 'v1',
                }))}
            />,
        );

        const acceptedBanner = screen.getByRole('region', { name: 'Accepted validation issue' });
        await waitFor(() => expect(acceptedBanner).toHaveFocus());
        expect(screen.getByRole('status')).toHaveTextContent('original failed checks remain attached');
    });

    it('uses 44px minimum touch targets for all controls', () => {
        const { container } = renderBanner();
        const bannerButtons = container.querySelectorAll('button');
        for (const button of bannerButtons) expect(button).toHaveClass('min-h-11');

        fireEvent.click(screen.getByRole('button', { name: 'Accept with noted issue' }));
        const dialog = screen.getByRole('dialog');
        for (const control of dialog.querySelectorAll('button, textarea')) {
            expect(control).toHaveClass('min-h-11');
        }
        expect(screen.getByRole('button', { name: 'Close acceptance dialog' }))
            .toHaveClass('min-w-11');
    });
});
