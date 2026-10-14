// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    callGemini,
    callGeminiStream,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_STRONG_MODEL,
    getStrongModel,
    resolveMaxOutputTokens,
} from '../geminiClient';
import { migrateGeminiFlashModel, migrateGeminiProModel } from '../modelMigration';
import { getArtifactModelOverrides } from '../artifactModelSettings';
import { CURRENT_MODELS, LEGACY_MODELS } from '../modelCatalog';
import { normalizeError, userMessage } from '../errors';

const LATEST_FLASH = 'gemini-3.8-flash';
const LATEST_FLASH_LITE = 'gemini-3.1-flash-lite';
const FLASH_MIGRATION_KEY = 'GEMINI_MODEL_MIGRATED_2026_10';
const ARGON = 'gemini-4-argon';
const PRO_3_1 = 'gemini-3.1-pro-preview';
const PRO_MIGRATION_KEY = 'GEMINI_PRO_MODEL_MIGRATED_2026_10';

describe('Gemini Flash model default', () => {
    it('defaults to the latest GA Flash model', () => {
        expect(DEFAULT_GEMINI_MODEL).toBe(LATEST_FLASH);
    });

    it('is a GA model id (no preview suffix) and not an older Flash id', () => {
        expect(DEFAULT_GEMINI_MODEL).not.toMatch(/preview/i);
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-3.7-flash');
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-3.6-flash');
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-3.5-flash');
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-3-flash-preview');
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-2.5-flash');
    });
});

describe('migrateGeminiFlashModel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('moves a 3.7 Flash primary selection to 3.8 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.7-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('moves a 3.6 Flash primary selection to 3.8 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.6-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('moves a 3.5 Flash primary selection to 3.8 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.5-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('moves an older preview Flash primary selection to 3.8 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3-flash-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('moves a legacy 2.5 Flash selection to 3.8 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-2.5-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('migrates the fast-tier selection too', () => {
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-3.7-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(LATEST_FLASH);
    });

    it('leaves Pro and GA Flash-Lite selections untouched', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.1-pro-preview');
        localStorage.setItem('GEMINI_FAST_MODEL', LATEST_FLASH_LITE);
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe('gemini-3.1-pro-preview');
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(LATEST_FLASH_LITE);
    });

    it('moves a Flash-Lite preview selection to GA Flash-Lite, never up to Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.1-flash-lite-preview');
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-3.1-flash-lite-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH_LITE);
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(LATEST_FLASH_LITE);
    });

    it('runs even when the previous migration wave already ran', () => {
        // A user who was migrated to 3.7 Flash in the 2026_08 wave still gets
        // moved forward by the 2026_10 wave — the sentinel key is per-wave.
        localStorage.setItem('GEMINI_MODEL_MIGRATED_2026_08', '1');
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.7-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('runs at most once — a later re-selection is respected', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-2.5-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem(FLASH_MIGRATION_KEY)).toBe('1');

        // User deliberately re-picks an older model afterward.
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.7-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe('gemini-3.7-flash');
    });
});

describe('Gemini strong-tier default', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults the Expert (strong) tier to the GA Gemini 4 Argon', () => {
        expect(DEFAULT_STRONG_MODEL).toBe(ARGON);
        expect(getStrongModel()).toBe(ARGON);
    });

    it('lists Argon as current and 3.1 Pro Preview as legacy', () => {
        expect(CURRENT_MODELS.map((m) => m.id)).toContain(ARGON);
        expect(CURRENT_MODELS.map((m) => m.id)).not.toContain(PRO_3_1);
        expect(LEGACY_MODELS.map((m) => m.id)).toContain(PRO_3_1);
    });
});

describe('migrateGeminiProModel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('moves a 3.1 Pro strong-tier selection (the value Settings pins on Save) to Argon', () => {
        localStorage.setItem('GEMINI_STRONG_MODEL', PRO_3_1);
        migrateGeminiProModel();
        expect(localStorage.getItem('GEMINI_STRONG_MODEL')).toBe(ARGON);
    });

    it('moves 3.1 Pro primary and fast-tier selections too', () => {
        localStorage.setItem('GEMINI_MODEL', PRO_3_1);
        localStorage.setItem('GEMINI_FAST_MODEL', PRO_3_1);
        migrateGeminiProModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(ARGON);
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(ARGON);
    });

    it('moves 3.1 Pro per-artifact overrides and keeps the rest', () => {
        localStorage.setItem(
            'GEMINI_ARTIFACT_MODELS',
            JSON.stringify({ data_model: PRO_3_1, design_system: LATEST_FLASH_LITE }),
        );
        migrateGeminiProModel();
        expect(getArtifactModelOverrides()).toEqual({ data_model: ARGON, design_system: LATEST_FLASH_LITE });
    });

    it('leaves Flash and legacy 2.5 Pro selections untouched', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-2.5-pro');
        localStorage.setItem('GEMINI_FAST_MODEL', LATEST_FLASH);
        localStorage.setItem('GEMINI_STRONG_MODEL', LATEST_FLASH);
        migrateGeminiProModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe('gemini-2.5-pro');
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(LATEST_FLASH);
        expect(localStorage.getItem('GEMINI_STRONG_MODEL')).toBe(LATEST_FLASH);
        expect(localStorage.getItem('GEMINI_ARTIFACT_MODELS')).toBeNull();
    });

    it('runs even when the 2026_10 Flash wave already ran', () => {
        localStorage.setItem(FLASH_MIGRATION_KEY, '1');
        localStorage.setItem('GEMINI_STRONG_MODEL', PRO_3_1);
        migrateGeminiProModel();
        expect(localStorage.getItem('GEMINI_STRONG_MODEL')).toBe(ARGON);
    });

    it('runs at most once — re-picking 3.1 Pro afterwards is respected', () => {
        localStorage.setItem('GEMINI_STRONG_MODEL', PRO_3_1);
        migrateGeminiProModel();
        expect(localStorage.getItem(PRO_MIGRATION_KEY)).toBe('1');

        localStorage.setItem('GEMINI_STRONG_MODEL', PRO_3_1);
        migrateGeminiProModel();
        expect(localStorage.getItem('GEMINI_STRONG_MODEL')).toBe(PRO_3_1);
    });
});

const okBody = (usageMetadata?: object) => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    ...(usageMetadata ? { usageMetadata } : {}),
});
const okJson = (usageMetadata?: object): Response =>
    new Response(JSON.stringify(okBody(usageMetadata)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
const okSse = (usageMetadata?: object): Response =>
    new Response(`data: ${JSON.stringify(okBody(usageMetadata))}\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });

describe('Argon output-token floor', () => {
    const sentMaxOutputTokens = (calls: unknown[][]): number | undefined => {
        const [, init] = calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(init.body as string) as { generationConfig?: { maxOutputTokens?: number } };
        return body.generationConfig?.maxOutputTokens;
    };

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('GEMINI_API_KEY', 'test-key');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('raises Argon caps below 32,768 to the floor and leaves other models alone', () => {
        expect(resolveMaxOutputTokens(ARGON, 4096)).toBe(32_768);
        expect(resolveMaxOutputTokens(ARGON, 16_384)).toBe(32_768);
        expect(resolveMaxOutputTokens(ARGON, 32_768)).toBe(32_768);
        expect(resolveMaxOutputTokens(LATEST_FLASH, 4096)).toBe(4096);
        expect(resolveMaxOutputTokens(PRO_3_1, 8192)).toBe(8192);
    });

    it('sends the floored cap on a non-streaming Argon call', async () => {
        const fetchMock = vi.fn(async () => okJson());
        vi.stubGlobal('fetch', fetchMock);
        await callGemini('system', 'prompt', { responseMimeType: 'application/json', model: ARGON, maxOutputTokens: 4096 });
        expect(sentMaxOutputTokens(fetchMock.mock.calls)).toBe(32_768);
    });

    it('sends the floored cap on a streaming Argon call', async () => {
        const fetchMock = vi.fn(async () => okSse());
        vi.stubGlobal('fetch', fetchMock);
        await callGeminiStream(
            'system',
            'prompt',
            { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
            undefined,
            { responseMimeType: 'application/json', model: ARGON, maxOutputTokens: 8192 },
        );
        expect(sentMaxOutputTokens(fetchMock.mock.calls)).toBe(32_768);
    });

    it('keeps the caller cap on a model without a floor', async () => {
        const fetchMock = vi.fn(async () => okJson());
        vi.stubGlobal('fetch', fetchMock);
        await callGemini('system', 'prompt', {
            responseMimeType: 'application/json',
            model: LATEST_FLASH,
            maxOutputTokens: 4096,
        });
        expect(sentMaxOutputTokens(fetchMock.mock.calls)).toBe(4096);
    });
});

describe('token usage', () => {
    // A thinking model reports its reasoning apart from the answer; Gemini
    // bills both at the output rate, so both count as output.
    const usageMetadata = {
        promptTokenCount: 1000,
        candidatesTokenCount: 400,
        thoughtsTokenCount: 2600,
        totalTokenCount: 4000,
    };
    const billed = { inputTokens: 1000, outputTokens: 3000, totalTokens: 4000 };

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('GEMINI_API_KEY', 'test-key');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('counts thinking tokens as output on a non-streaming call', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okJson(usageMetadata)));
        const onUsage = vi.fn();
        await callGemini('system', 'prompt', { model: ARGON, onUsage });
        expect(onUsage).toHaveBeenCalledWith(billed);
    });

    it('counts thinking tokens as output on a streaming call', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okSse(usageMetadata)));
        const onUsage = vi.fn();
        await callGeminiStream(
            'system',
            'prompt',
            { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
            undefined,
            { model: ARGON, onUsage },
        );
        expect(onUsage).toHaveBeenCalledWith(billed);
    });

    it('needs no thinking count from a model that does not report one', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okJson({ promptTokenCount: 10, candidatesTokenCount: 5 })));
        const onUsage = vi.fn();
        await callGemini('system', 'prompt', { model: LATEST_FLASH, onUsage });
        expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    });
});

describe('model catalog', () => {
    it('lists the default and GA Flash-Lite as current, the Flash-Lite preview as legacy', () => {
        const current = CURRENT_MODELS.map((m) => m.id);
        expect(current).toContain(DEFAULT_GEMINI_MODEL);
        expect(current).toContain(LATEST_FLASH_LITE);
        expect(current).not.toContain('gemini-3.1-flash-lite-preview');
        expect(LEGACY_MODELS.map((m) => m.id)).toContain('gemini-3.1-flash-lite-preview');
    });
});

describe('model access guard message', () => {
    it('surfaces a clear access-guard message for model-not-found errors', () => {
        const err = normalizeError(new Error('Gemini API Error: 404 - Publisher model `gemini-3.8-flash` not found'));
        expect(err.category).toBe('model_not_found');
        const msg = userMessage(err);
        expect(msg).toMatch(/could not access the selected model/i);
        expect(msg).toMatch(/API key is valid/i);
        // No silent fallback to an older model id is named in the guidance.
        expect(msg).not.toMatch(/gemini-2\.5-flash/i);
    });
});
