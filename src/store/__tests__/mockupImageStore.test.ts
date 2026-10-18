// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../../types';

// In-memory fake of the IndexedDB layer (key builders stay real), stub image
// clients, and no-op sync — so generation runs end to end without IDB/network.
vi.mock('../../lib/mockupImageStore', async (importActual) => {
    const actual = await importActual<typeof import('../../lib/mockupImageStore')>();
    const db = new Map<string, MockupImageRecord>();
    return {
        ...actual,
        putImage: async (record: MockupImageRecord) => { db.set(record.key, record); },
        getImage: async (key: string) => db.get(key),
        listImagesForVersion: async (versionId: string) => [...db.values()].filter((r) => r.versionId === versionId),
    };
});

const { callOpenAIImage, callGeminiImage, openaiKey } = vi.hoisted(() => ({
    callOpenAIImage: vi.fn(),
    callGeminiImage: vi.fn(),
    openaiKey: { configured: true },
}));
vi.mock('../../lib/openaiClient', () => ({
    callOpenAIImage,
    hasOpenAIKey: () => openaiKey.configured,
}));
vi.mock('../../lib/geminiClient', async (importActual) => ({
    ...(await importActual<typeof import('../../lib/geminiClient')>()),
    callGeminiImage,
}));
vi.mock('../projectImageSync', () => ({ notifyMockupImageGenerated: () => undefined }));
vi.mock('../../lib/designTokens', () => ({ selectPreferredDesignTokens: () => undefined }));

import { useMockupImageStore } from '../mockupImageStore';
import { useProjectStore } from '../projectStore';
import { NO_IMAGE_MODEL_MESSAGE } from '../../lib/mockupImageGeneration';
import { clearGeminiKey } from '../../lib/geminiKeyVault';

const screen: MockupScreen = { id: 's1', name: 'Route Builder', purpose: 'Compose a route.' };
const payload: MockupPayload = { version: 'mockup_spec_v1', title: 'TrailPlan', summary: 'Hiking routes.', screens: [screen] };
const settings: MockupSettings = { platform: 'mobile', fidelity: 'mid', scope: 'multi_screen' };
const SCOPE = 'v1:s1:';

const generate = (extra: { provider?: 'openai' | 'gemini' } = {}) =>
    useMockupImageStore.getState().generate({
        projectId: 'p1', artifactId: 'a1', versionId: 'v1', screen, payload, settings, quality: 'low', ...extra,
    });

beforeEach(() => {
    localStorage.clear();
    clearGeminiKey();
    localStorage.setItem('GEMINI_API_KEY', 'gemini-key');
    openaiKey.configured = true;
    callOpenAIImage.mockReset().mockResolvedValue('T1BFTkFJ');
    callGeminiImage.mockReset().mockResolvedValue({ b64: 'R0VNSU5J', mimeType: 'image/jpeg' });
    useMockupImageStore.setState({ images: {}, inFlight: {}, errors: {}, selected: {}, loadedVersions: {} });
    useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Test', createdAt: 1 } } });
});

describe('mockupImageStore.generate — image model routing', () => {
    it('runs the primary (GPT Image 2) by default and shows the new render', async () => {
        await generate();

        const record = useMockupImageStore.getState().images['v1:s1:low'];
        expect(record).toMatchObject({ model: 'gpt-image-2', dataUrl: 'data:image/png;base64,T1BFTkFJ' });
        expect(useMockupImageStore.getState().selected[SCOPE]).toBe('v1:s1:low');
        expect(callGeminiImage).not.toHaveBeenCalled();
    });

    it('falls back to Nano Banana 2.1 when the primary fails, under its own key', async () => {
        callOpenAIImage.mockRejectedValue(new Error('OpenAI quota / rate limit hit.'));
        await generate();

        const state = useMockupImageStore.getState();
        expect(state.images['v1:s1:low']).toBeUndefined();
        const record = state.images['v1:s1:low:gemini'];
        expect(record).toMatchObject({ model: 'gemini-nano-banana-2.1', dataUrl: 'data:image/jpeg;base64,R0VNSU5J' });
        // The Gemini attempt got the Nano Banana prompt, not the gpt-image-2 one.
        expect(record.prompt).toMatch(/^Create a UI design mockup: a flat, straight-on screen capture/);
        expect(state.errors[SCOPE]).toBeFalsy();
    });

    it('marks the in-flight attempt as the fallback while it runs', async () => {
        callOpenAIImage.mockRejectedValue(new Error('down'));
        let finish!: (v: { b64: string; mimeType: string }) => void;
        callGeminiImage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

        const pending = generate();
        await vi.waitFor(() => expect(callGeminiImage).toHaveBeenCalled());
        expect(useMockupImageStore.getState().inFlight[SCOPE]).toMatchObject({ provider: 'gemini', fallbackFrom: 'openai' });

        finish({ b64: 'R0VNSU5J', mimeType: 'image/jpeg' });
        await pending;
        expect(useMockupImageStore.getState().inFlight[SCOPE]).toBeUndefined();
    });

    it('runs an explicit model choice only — no silent swap on failure', async () => {
        callGeminiImage.mockRejectedValue(new Error('Gemini image generation has no free tier'));
        await generate({ provider: 'gemini' });

        expect(callOpenAIImage).not.toHaveBeenCalled();
        expect(useMockupImageStore.getState().errors[SCOPE]).toBe('Gemini image generation has no free tier');
    });

    it('keeps renders from both models side by side', async () => {
        await generate({ provider: 'openai' });
        await generate({ provider: 'gemini' });

        const state = useMockupImageStore.getState();
        expect(Object.keys(state.images).sort()).toEqual(['v1:s1:low', 'v1:s1:low:gemini']);
        expect(state.listForScreen('v1', 's1')).toHaveLength(2);
        expect(state.selected[SCOPE]).toBe('v1:s1:low:gemini');

        state.select('v1', 's1', 'v1:s1:low');
        expect(useMockupImageStore.getState().selected[SCOPE]).toBe('v1:s1:low');
    });

    it('skips a keyless primary and uses the fallback directly', async () => {
        openaiKey.configured = false;
        await generate();

        expect(callOpenAIImage).not.toHaveBeenCalled();
        expect(useMockupImageStore.getState().images['v1:s1:low:gemini']).toBeDefined();
    });

    it('records an actionable error when no image model has a key', async () => {
        openaiKey.configured = false;
        localStorage.clear();
        await generate();

        expect(callOpenAIImage).not.toHaveBeenCalled();
        expect(callGeminiImage).not.toHaveBeenCalled();
        expect(useMockupImageStore.getState().errors[SCOPE]).toBe(NO_IMAGE_MODEL_MESSAGE);
    });

    it('clears render selections with the evicted versions', () => {
        useMockupImageStore.setState({ selected: { 'v1:s1:': 'v1:s1:low', 'v2:s1:': 'v2:s1:low' } });
        useMockupImageStore.getState().clearVersions(['v1']);
        expect(useMockupImageStore.getState().selected).toEqual({ 'v2:s1:': 'v2:s1:low' });
    });
});
