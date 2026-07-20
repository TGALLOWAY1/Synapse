import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesignDirectionControl } from '../DesignDirectionControl';

// The post-finalization "Design direction" row on the Design System artifact.
// Verifies it surfaces the current direction (or the "AI decides" fallback for
// projects finalized before the preset feature) and wires the change action.
// Regeneration is reached through the change-direction flow, which chains into
// ArtifactWorkspace's regenerate confirmation — there is no standalone button.

describe('DesignDirectionControl', () => {
    it('shows the human label for a stored preset', () => {
        render(
            <DesignDirectionControl
                presetId="saas_minimal"
                onChangeDirection={() => {}}
            />,
        );
        expect(screen.getByText('Modern SaaS')).toBeTruthy();
    });

    it('falls back to an "AI decides" note when no preset is set', () => {
        render(<DesignDirectionControl onChangeDirection={() => {}} />);
        expect(screen.getByText(/AI decides/i)).toBeTruthy();
    });

    it('fires the change-direction callback and offers no regenerate button', () => {
        const onChangeDirection = vi.fn();
        render(
            <DesignDirectionControl
                presetId="ai_workspace"
                onChangeDirection={onChangeDirection}
            />,
        );
        fireEvent.click(screen.getByText('Change direction'));
        expect(onChangeDirection).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Regenerate')).toBeNull();
    });
});
