// The user's saved default design preset for FUTURE projects. Persisted in
// localStorage (same simple-preference pattern as SYNAPSE_MOCKUP_IMAGE_MODE in
// artifactModelSettings.ts). The default only preselects the setup step's
// choice — it is never written to a project without an explicit Continue, and
// it is only changed when the user explicitly ticks "Use this as my default".

import { getDesignSystemPreset } from './designSystemPresets';

const DEFAULT_DESIGN_PRESET_KEY = 'SYNAPSE_DEFAULT_DESIGN_PRESET';

/** The saved default preset id, or null when unset/invalid/unavailable. */
export const getDefaultDesignPreset = (): string | null => {
    try {
        const v = localStorage.getItem(DEFAULT_DESIGN_PRESET_KEY);
        // Ignore ids that no longer resolve to a preset (e.g. stale storage).
        return v && getDesignSystemPreset(v) ? v : null;
    } catch {
        return null;
    }
};

export const setDefaultDesignPreset = (presetId: string): void => {
    try {
        if (!getDesignSystemPreset(presetId)) return;
        localStorage.setItem(DEFAULT_DESIGN_PRESET_KEY, presetId);
    } catch {
        /* best-effort preference — ignore quota/availability errors */
    }
};

export const clearDefaultDesignPreset = (): void => {
    try {
        localStorage.removeItem(DEFAULT_DESIGN_PRESET_KEY);
    } catch {
        /* ignore */
    }
};
