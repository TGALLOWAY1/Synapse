import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MockupScreenImage } from '../mockups/MockupScreenImage';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { useProjectStore } from '../../store/projectStore';
import { setImageProviderConfigured } from '../../lib/openaiClient';
import type { MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../../types';

const VERSION_ID = 'v1';
const screen1: MockupScreen = { id: 's1', name: 'Dashboard', purpose: 'Overview' };
const payload: MockupPayload = { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: [screen1] };
const settings: MockupSettings = { platform: 'desktop', fidelity: 'mid', scope: 'multi_screen' };

const record = (quality: MockupImageQuality): MockupImageRecord => ({
    key: `${VERSION_ID}:${screen1.id}:${quality}`,
    projectId: 'p1',
    artifactId: 'a1',
    versionId: VERSION_ID,
    screenId: screen1.id,
    dataUrl: 'data:image/png;base64,AAAA',
    quality,
    prompt: 'prompt',
    generatedAt: 1,
});

const generate = vi.fn(async () => {});

function seed(qualities: MockupImageQuality[]) {
    useMockupImageStore.setState({
        images: Object.fromEntries(qualities.map((q) => [record(q).key, record(q)])),
        inFlight: {},
        errors: {},
        loadedVersions: { [VERSION_ID]: true },
        // The real loader reads IndexedDB; the cache above is already hydrated.
        loadForVersion: vi.fn(async () => {}),
        clearError: vi.fn(),
        generate,
    });
}

function renderImage() {
    return render(
        <MockupScreenImage
            projectId="p1"
            artifactId="a1"
            versionId={VERSION_ID}
            screen={screen1}
            payload={payload}
            settings={settings}
        />,
    );
}

beforeEach(() => {
    generate.mockClear();
    setImageProviderConfigured(true);
    useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Proj', createdAt: 1 } } });
});

describe('MockupScreenImage high-quality regenerate confirmation', () => {
    it('asks before spending on a high-quality render, with the original paid-operation copy', () => {
        seed(['high']);
        const { container } = renderImage();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Generate a HIGH-quality image with OpenAI gpt-image-2?')).toBeTruthy();
        expect(within(dialog).getByText(
            'This is a paid OpenAI operation billed to your own account (typically a few cents per image).',
        )).toBeTruthy();
        // Rendered into <body>, outside the screen card it was opened from.
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(generate).not.toHaveBeenCalled();
    });

    it('does not generate on Cancel or Escape', () => {
        seed(['high']);
        renderImage();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();

        expect(generate).not.toHaveBeenCalled();
    });

    it('generates at high quality only after the confirmation', () => {
        seed(['high']);
        renderImage();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Generate' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledWith(expect.objectContaining({ quality: 'high', versionId: VERSION_ID }));
    });

    it('regenerates a low-quality render immediately — only the paid high-quality path is confirmed', () => {
        seed(['low']);
        renderImage();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledWith(expect.objectContaining({ quality: 'low' }));
    });
});
