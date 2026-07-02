import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesignDirectionControl } from '../DesignDirectionControl';

// The post-finalization "Design direction" card on the Design System artifact.
// Verifies it surfaces the current direction (or the "AI decides" fallback for
// projects finalized before the preset feature) and wires both actions.

describe('DesignDirectionControl', () => {
    it('shows the human label for a stored preset', () => {
        render(
            <DesignDirectionControl
                presetId="saas_minimal"
                onChangeDirection={() => {}}
                onRegenerate={() => {}}
            />,
        );
        expect(screen.getByText('Modern SaaS')).toBeTruthy();
    });

    it('falls back to an "AI decides" note when no preset is set', () => {
        render(
            <DesignDirectionControl
                onChangeDirection={() => {}}
                onRegenerate={() => {}}
            />,
        );
        expect(screen.getByText(/AI decides/i)).toBeTruthy();
    });

    it('fires the change and regenerate callbacks', () => {
        const onChangeDirection = vi.fn();
        const onRegenerate = vi.fn();
        render(
            <DesignDirectionControl
                presetId="ai_workspace"
                onChangeDirection={onChangeDirection}
                onRegenerate={onRegenerate}
            />,
        );
        fireEvent.click(screen.getByText('Change direction'));
        fireEvent.click(screen.getByText('Regenerate'));
        expect(onChangeDirection).toHaveBeenCalledTimes(1);
        expect(onRegenerate).toHaveBeenCalledTimes(1);
    });
});
