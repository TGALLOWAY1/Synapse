/**
 * One-shot localStorage migrations for the Gemini model selection.
 *
 * Each migration is gated by a sentinel key so it runs at most once — a user
 * who deliberately re-selects an older model afterward is respected. All access
 * is wrapped in try/catch because localStorage throws in private-browsing modes.
 */

import type { CoreArtifactSubtype } from '../types';
import { getArtifactModelOverrides, setArtifactModelOverrides } from './artifactModelSettings';

const LATEST_FLASH_MODEL = 'gemini-3.8-flash';
const LATEST_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite';

// Flash model IDs that predate the GA 3.8 Flash default. Users sitting on one
// of these (whether as their primary or fast-tier selection) are moved forward;
// Pro selections are left to `migrateGeminiProModel` below.
const SUPERSEDED_FLASH_MODELS = new Set([
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
]);

// Flash-Lite IDs superseded by the GA 3.1 Flash-Lite (the preview has reduced
// quotas even on paid tier). These stay within the Flash-Lite tier — a
// Flash-Lite selection is never moved up to the pricier Flash.
const SUPERSEDED_FLASH_LITE_MODELS = new Set([
    'gemini-3.1-flash-lite-preview',
]);

// Bumped per migration wave (2026_05 moved pre-3.5 selections to 3.5 Flash;
// 2026_07 moved pre-3.6 selections to 3.6 Flash; 2026_08 moved pre-3.7
// selections to 3.7 Flash; 2026_10 moves pre-3.8 selections, including
// 3.7 Flash, to 3.8 Flash, and the 3.1 Flash-Lite preview to its GA release).
const FLASH_MIGRATION_KEY = 'GEMINI_MODEL_MIGRATED_2026_10';

/**
 * Move anyone whose stored Flash selection predates 3.8 Flash up to the new
 * GA default, and anyone on the Flash-Lite preview to GA Flash-Lite. Applies
 * to both `GEMINI_MODEL` (primary) and `GEMINI_FAST_MODEL` (fast tier used for
 * simpler PRD sections).
 */
export function migrateGeminiFlashModel() {
    try {
        if (localStorage.getItem(FLASH_MIGRATION_KEY)) return;
        for (const key of ['GEMINI_MODEL', 'GEMINI_FAST_MODEL']) {
            const current = localStorage.getItem(key);
            if (current && SUPERSEDED_FLASH_MODELS.has(current)) {
                localStorage.setItem(key, LATEST_FLASH_MODEL);
            } else if (current && SUPERSEDED_FLASH_LITE_MODELS.has(current)) {
                localStorage.setItem(key, LATEST_FLASH_LITE_MODEL);
            }
        }
        localStorage.setItem(FLASH_MIGRATION_KEY, '1');
    } catch {
        // localStorage unavailable (private mode, etc.) — skip migration.
    }
}

const LATEST_STRONG_MODEL = 'gemini-4-argon';

// Pro IDs superseded by the GA Gemini 4 Argon, the new Expert (strong) tier
// default. Settings writes every tier key on Save, so most users carry the old
// default in GEMINI_STRONG_MODEL without ever having picked it — changing
// DEFAULT_STRONG_MODEL alone would never reach them. Gemini 2.5 Pro is a
// deliberate legacy pick and stays put.
const SUPERSEDED_PRO_MODELS = new Set([
    'gemini-3.1-pro-preview',
]);

// Its own sentinel: the 2026_10 Flash wave has already run for most users.
const PRO_MIGRATION_KEY = 'GEMINI_PRO_MODEL_MIGRATED_2026_10';

/**
 * Move every stored Gemini 3.1 Pro Preview selection to Gemini 4 Argon — the
 * three tier keys (`GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_STRONG_MODEL`)
 * and any per-artifact override. 3.1 Pro stays in the legacy catalog, so a
 * user can pick it again afterwards and the one-shot sentinel respects that.
 */
export function migrateGeminiProModel() {
    try {
        if (localStorage.getItem(PRO_MIGRATION_KEY)) return;
        for (const key of ['GEMINI_MODEL', 'GEMINI_FAST_MODEL', 'GEMINI_STRONG_MODEL']) {
            const current = localStorage.getItem(key);
            if (current && SUPERSEDED_PRO_MODELS.has(current)) {
                localStorage.setItem(key, LATEST_STRONG_MODEL);
            }
        }
        const overrides = getArtifactModelOverrides();
        let overridesChanged = false;
        for (const subtype of Object.keys(overrides) as CoreArtifactSubtype[]) {
            const model = overrides[subtype];
            if (model && SUPERSEDED_PRO_MODELS.has(model)) {
                overrides[subtype] = LATEST_STRONG_MODEL;
                overridesChanged = true;
            }
        }
        if (overridesChanged) setArtifactModelOverrides(overrides);
        localStorage.setItem(PRO_MIGRATION_KEY, '1');
    } catch {
        // localStorage unavailable (private mode, etc.) — skip migration.
    }
}
