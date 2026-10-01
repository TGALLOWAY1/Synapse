/**
 * One-shot localStorage migrations for the Gemini model selection.
 *
 * Each migration is gated by a sentinel key so it runs at most once — a user
 * who deliberately re-selects an older model afterward is respected. All access
 * is wrapped in try/catch because localStorage throws in private-browsing modes.
 */

const LATEST_FLASH_MODEL = 'gemini-3.8-flash';
const LATEST_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite';

// Flash model IDs that predate the GA 3.8 Flash default. Users sitting on one
// of these (whether as their primary or fast-tier selection) are moved forward;
// Pro selections are intentionally left untouched.
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
