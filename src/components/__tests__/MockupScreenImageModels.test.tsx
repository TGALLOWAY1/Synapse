import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MockupScreenImage } from '../mockups/MockupScreenImage';
import { useMockupImageStore } from '../../store/mockupImageStore';
import { useProjectStore } from '../../store/projectStore';
import { setImageProviderConfigured } from '../../lib/openaiClient';
import { clearGeminiKey } from '../../lib/geminiKeyVault';
import { buildImageKey } from '../../lib/mockupImageStore';
import type { MockupImageProvider, MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../../types';

const VERSION_ID = 'v1';
const screen1: MockupScreen = { id: 's1', name: 'Dashboard', purpose: 'Overview' };
const payload: MockupPayload = { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: [screen1] };
const settings: MockupSettings = { platform: 'desktop', fidelity: 'mid', scope: 'multi_screen' };
const SCOPE = `${VERSION_ID}:${screen1.id}:`;

const record = (provider: MockupImageProvider, quality: MockupImageQuality = 'low', generatedAt = 1): MockupImageRecord => ({
    key: buildImageKey(VERSION_ID, screen1.id, quality, provider),
    projectId: 'p1',
    artifactId: 'a1',
    versionId: VERSION_ID,
    screenId: screen1.id,
    dataUrl: `data:image/${provider === 'gemini' ? 'jpeg' : 'png'};base64,AAAA`,
    quality,
    prompt: 'prompt',
    model: provider === 'gemini' ? 'gemini-nano-banana-2.1' : 'gpt-image-2',
    generatedAt,
});

const generate = vi.fn(async () => {});

function seed(records: MockupImageRecord[], extra: Partial<ReturnType<typeof useMockupImageStore.getState>> = {}) {
    useMockupImageStore.setState({
        images: Object.fromEntries(records.map((r) => [r.key, r])),
        inFlight: {},
        errors: {},
        selected: {},
        loadedVersions: { [VERSION_ID]: true },
        loadForVersion: vi.fn(async () => {}),
        clearError: vi.fn(),
        generate,
        ...extra,
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
    localStorage.clear();
    clearGeminiKey();
    setImageProviderConfigured(true);
    localStorage.setItem('GEMINI_API_KEY', 'gemini-key');
    useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Proj', createdAt: 1 } } });
});

describe('MockupScreenImage — choosing an image model', () => {
    it('empty state: the main action routes primary → fallback, and the other model can be picked explicitly', () => {
        seed([]);
        renderImage();

        expect(screen.getByText(/with GPT Image 2, falling back to Nano Banana 2\.1/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Generate AI image/ }));
        expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 'low', provider: undefined }));

        fireEvent.click(screen.getByRole('button', { name: 'Use Nano Banana 2.1' }));
        expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 'low', provider: 'gemini' }));
    });

    it('ready state: names the model and offers the other model while it has no render', () => {
        seed([record('openai')]);
        renderImage();

        expect(screen.getByText('GPT Image 2 · Low quality')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try Nano Banana 2.1' }));
        expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 'low', provider: 'gemini' }));

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
        expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 'low', provider: 'openai' }));
    });

    it('disables the other model when its key is missing', () => {
        localStorage.clear();
        seed([record('openai')]);
        renderImage();

        const tryBtn = screen.getByRole('button', { name: 'Try Nano Banana 2.1' }) as HTMLButtonElement;
        expect(tryBtn.disabled).toBe(true);
        expect(tryBtn.title).toBe('Add a Gemini API key in Settings to use Nano Banana 2.1');
    });

    it('switches between renders from both models (the newest shows by default)', () => {
        seed([record('openai', 'low', 1), record('gemini', 'low', 2)]);
        renderImage();

        const group = screen.getByRole('group', { name: 'Switch render' });
        expect(within(group).getByRole('button', { name: 'Nano Banana 2.1 · Low' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('Nano Banana 2.1 · Low quality')).toBeTruthy();
        // Both models have a render, so no "Try" offer remains.
        expect(screen.queryByRole('button', { name: /^Try / })).toBeNull();

        fireEvent.click(within(group).getByRole('button', { name: 'GPT Image 2 · Low' }));
        expect(useMockupImageStore.getState().selected[SCOPE]).toBe(`${SCOPE}low`);
        expect(screen.getByText('GPT Image 2 · Low quality')).toBeTruthy();
    });

    it('says when the fallback model has taken over', () => {
        seed([], {
            inFlight: {
                [SCOPE]: { quality: 'low', startedAt: 1, abort: new AbortController(), provider: 'gemini', fallbackFrom: 'openai' },
            },
        });
        renderImage();

        expect(screen.getByText('Google Nano Banana 2.1 · usually 20–40s')).toBeTruthy();
        expect(screen.getByText(/GPT Image 2 failed — trying your fallback model,/)).toBeTruthy();
    });

    it('confirms a high-quality Nano Banana render with Google billing copy', () => {
        seed([record('gemini', 'high')]);
        renderImage();

        fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Generate a HIGH-quality image with Google Nano Banana 2.1?')).toBeTruthy();
        expect(generate).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));
        expect(generate).toHaveBeenCalledWith(expect.objectContaining({ quality: 'high', provider: 'gemini' }));
    });

    it('shows a failed attempt even while an earlier render is displayed', () => {
        seed([record('openai')], { errors: { [SCOPE]: 'Gemini image generation has no free tier' } });
        renderImage();

        expect(screen.getByText('Gemini image generation has no free tier')).toBeTruthy();
    });
});
