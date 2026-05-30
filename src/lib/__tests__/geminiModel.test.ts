import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_GEMINI_MODEL } from '../geminiClient';
import { migrateGeminiFlashModel } from '../modelMigration';
import { normalizeError, userMessage } from '../errors';

const LATEST_FLASH = 'gemini-3.5-flash';
const FLASH_MIGRATION_KEY = 'GEMINI_MODEL_MIGRATED_2026_05';

describe('Gemini Flash model default', () => {
    it('defaults to the latest GA Flash model', () => {
        expect(DEFAULT_GEMINI_MODEL).toBe(LATEST_FLASH);
    });

    it('is a GA model id (no preview suffix) and not an older Flash id', () => {
        expect(DEFAULT_GEMINI_MODEL).not.toMatch(/preview/i);
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-3-flash-preview');
        expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini-2.5-flash');
    });
});

describe('migrateGeminiFlashModel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('moves an older preview Flash primary selection to 3.5 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3-flash-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('moves a legacy 2.5 Flash selection to 3.5 Flash', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-2.5-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe(LATEST_FLASH);
    });

    it('migrates the fast-tier selection too', () => {
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-3-flash-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe(LATEST_FLASH);
    });

    it('leaves Pro and Flash-Lite selections untouched', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-3.1-pro-preview');
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-3.1-flash-lite-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe('gemini-3.1-pro-preview');
        expect(localStorage.getItem('GEMINI_FAST_MODEL')).toBe('gemini-3.1-flash-lite-preview');
    });

    it('runs at most once — a later re-selection is respected', () => {
        localStorage.setItem('GEMINI_MODEL', 'gemini-2.5-flash');
        migrateGeminiFlashModel();
        expect(localStorage.getItem(FLASH_MIGRATION_KEY)).toBe('1');

        // User deliberately re-picks an older model afterward.
        localStorage.setItem('GEMINI_MODEL', 'gemini-3-flash-preview');
        migrateGeminiFlashModel();
        expect(localStorage.getItem('GEMINI_MODEL')).toBe('gemini-3-flash-preview');
    });
});

describe('model access guard message', () => {
    it('surfaces a clear access-guard message for model-not-found errors', () => {
        const err = normalizeError(new Error('Gemini API Error: 404 - Publisher model `gemini-3.5-flash` not found'));
        expect(err.category).toBe('model_not_found');
        const msg = userMessage(err);
        expect(msg).toMatch(/could not access the selected model/i);
        expect(msg).toMatch(/API key is valid/i);
        // No silent fallback to an older model id is named in the guidance.
        expect(msg).not.toMatch(/gemini-2\.5-flash/i);
    });
});
