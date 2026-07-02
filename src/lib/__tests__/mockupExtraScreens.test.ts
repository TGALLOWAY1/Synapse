import { describe, expect, it } from 'vitest';
import {
    mergeExtraScreens,
    mockupScreenFromInventoryScreen,
    readExtraMockupScreens,
} from '../mockupParsing';
import type { MockupPayload, ScreenItem } from '../../types';

const BASE_PAYLOAD: MockupPayload = {
    version: 'mockup_spec_v1',
    title: 'T',
    summary: 'S',
    screens: [
        { id: 'uuid-1', name: 'Dashboard', purpose: 'Main.', sourceScreenId: 'dashboard' },
    ],
};

describe('readExtraMockupScreens', () => {
    it('reads valid extra screens and drops malformed entries', () => {
        const extras = readExtraMockupScreens({
            extraScreens: [
                { id: 'uuid-2', name: 'Settings', purpose: 'Prefs.', sourceScreenId: 'settings' },
                { name: 'No id' },          // dropped: missing id
                'garbage',                   // dropped: not an object
            ],
        });
        expect(extras).toHaveLength(1);
        expect(extras[0].id).toBe('uuid-2');
        expect(extras[0].sourceScreenId).toBe('settings');
    });

    it('returns empty for missing/invalid metadata', () => {
        expect(readExtraMockupScreens(undefined)).toEqual([]);
        expect(readExtraMockupScreens({ extraScreens: 'nope' })).toEqual([]);
    });
});

describe('mergeExtraScreens', () => {
    it('appends extras after the stored screens', () => {
        const merged = mergeExtraScreens(BASE_PAYLOAD, {
            extraScreens: [{ id: 'uuid-2', name: 'Settings', purpose: 'Prefs.', sourceScreenId: 'settings' }],
        });
        expect(merged.screens.map(s => s.id)).toEqual(['uuid-1', 'uuid-2']);
    });

    it('dedupes by screen id and by sourceScreenId', () => {
        const merged = mergeExtraScreens(BASE_PAYLOAD, {
            extraScreens: [
                { id: 'uuid-1', name: 'Dashboard', purpose: 'Dup id.' },
                { id: 'uuid-9', name: 'Dash v2', purpose: 'Dup source.', sourceScreenId: 'dashboard' },
                { id: 'uuid-2', name: 'Settings', purpose: 'Fresh.', sourceScreenId: 'settings' },
            ],
        });
        expect(merged.screens.map(s => s.id)).toEqual(['uuid-1', 'uuid-2']);
    });

    it('returns the SAME payload reference when there is nothing to merge', () => {
        expect(mergeExtraScreens(BASE_PAYLOAD, undefined)).toBe(BASE_PAYLOAD);
        expect(mergeExtraScreens(BASE_PAYLOAD, { extraScreens: [] })).toBe(BASE_PAYLOAD);
    });
});

describe('mockupScreenFromInventoryScreen', () => {
    it('maps inventory fields the same way generateMockup does', () => {
        const screen: ScreenItem = {
            id: 'scr-settings',
            name: 'Settings',
            priority: 'P2',
            type: 'screen',
            purpose: 'Preferences.',
            userIntent: 'Tune my experience.',
            coreUIElements: Array.from({ length: 15 }, (_, i) => `el-${i}`),
        };
        const mockup = mockupScreenFromInventoryScreen(screen, 'uuid-5', 'scr-settings');
        expect(mockup).toMatchObject({
            id: 'uuid-5',
            name: 'Settings',
            purpose: 'Preferences.',
            userIntent: 'Tune my experience.',
            priority: 'P2',
            sourceScreenId: 'scr-settings',
        });
        // Capped at 12 elements, mirroring generateMockup.
        expect(mockup.coreUIElements).toHaveLength(12);
    });

    it('falls back to legacy components and drops legacy priorities', () => {
        const screen: ScreenItem = {
            name: 'Old Screen',
            priority: 'core',
            purpose: 'Legacy.',
            components: ['a', 'b'],
        };
        const mockup = mockupScreenFromInventoryScreen(screen, 'uuid-6', 'old-screen');
        expect(mockup.coreUIElements).toEqual(['a', 'b']);
        expect(mockup.priority).toBeUndefined();
    });
});
