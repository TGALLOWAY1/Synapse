import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearDefaultDesignPreset,
    getDefaultDesignPreset,
    setDefaultDesignPreset,
} from '../designPresetPreference';

describe('default design preset preference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns null when nothing is saved', () => {
        expect(getDefaultDesignPreset()).toBeNull();
    });

    it('round-trips a valid preset id', () => {
        setDefaultDesignPreset('creative_studio');
        expect(getDefaultDesignPreset()).toBe('creative_studio');
    });

    it('refuses to save an unknown preset id', () => {
        setDefaultDesignPreset('not-a-preset');
        expect(getDefaultDesignPreset()).toBeNull();
    });

    it('ignores a stale stored id that no longer resolves to a preset', () => {
        localStorage.setItem('SYNAPSE_DEFAULT_DESIGN_PRESET', 'retired_preset');
        expect(getDefaultDesignPreset()).toBeNull();
    });

    it('clears the saved default', () => {
        setDefaultDesignPreset('consumer_mobile');
        clearDefaultDesignPreset();
        expect(getDefaultDesignPreset()).toBeNull();
    });
});
