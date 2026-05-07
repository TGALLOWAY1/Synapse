import { describe, it, expect } from 'vitest';
import {
    parseScreenInventory,
    normalizeScreenInventory,
    screenInventoryToMarkdown,
} from '../screenInventoryNormalize';

describe('screenInventoryNormalize', () => {
    describe('parseScreenInventory', () => {
        it('returns null for non-JSON markdown', () => {
            expect(parseScreenInventory('# Screen Inventory\n## Login')).toBeNull();
        });

        it('returns null for malformed JSON', () => {
            expect(parseScreenInventory('{ this is not json')).toBeNull();
        });

        it('returns null for JSON without a recognized shape', () => {
            expect(parseScreenInventory('{"foo":"bar"}')).toBeNull();
        });
    });

    describe('legacy groups → sections', () => {
        it('maps groups[].name → sections[].title and screens through', () => {
            const result = normalizeScreenInventory({
                groups: [
                    {
                        name: 'Auth',
                        screens: [
                            {
                                name: 'Login',
                                purpose: 'Sign in',
                                components: ['Email', 'Password'],
                                priority: 'core',
                                navigationFrom: ['Landing'],
                                navigationTo: ['Dashboard'],
                            },
                        ],
                    },
                ],
            });
            expect(result).not.toBeNull();
            expect(result!.sections).toHaveLength(1);
            const section = result!.sections[0];
            expect(section.title).toBe('Auth');
            const screen = section.screens[0];
            expect(screen.name).toBe('Login');
            // priority 'core' → 'P0'
            expect(screen.priority).toBe('P0');
            // components copied to coreUIElements while keeping the legacy field.
            expect(screen.coreUIElements).toEqual(['Email', 'Password']);
            expect(screen.components).toEqual(['Email', 'Password']);
            // legacy navigation lifted to entry/exit
            expect(screen.entryPoints).toEqual(['Landing']);
            expect(screen.exitPaths).toEqual([{ label: 'Dashboard', target: 'Dashboard' }]);
        });

        it('maps legacy priorities core/secondary/supporting to P0/P1/P2', () => {
            const result = normalizeScreenInventory({
                groups: [{
                    name: 'Mixed',
                    screens: [
                        { name: 'A', purpose: 'a', priority: 'core' },
                        { name: 'B', purpose: 'b', priority: 'secondary' },
                        { name: 'C', purpose: 'c', priority: 'supporting' },
                    ],
                }],
            });
            const screens = result!.sections[0].screens;
            expect(screens.map(s => s.priority)).toEqual(['P0', 'P1', 'P2']);
        });

        it('defaults unknown priority to P1', () => {
            const result = normalizeScreenInventory({
                groups: [{
                    name: 'Unknown',
                    screens: [{ name: 'X', purpose: 'x', priority: 'whatever' }],
                }],
            });
            expect(result!.sections[0].screens[0].priority).toBe('P1');
        });
    });

    describe('new sections shape', () => {
        it('passes through a fully populated screen unchanged', () => {
            const input = {
                sections: [{
                    title: 'Capture',
                    description: 'Mood capture flow',
                    flowSummary: 'Landing → Capture',
                    screens: [{
                        name: 'Capture',
                        type: 'screen',
                        priority: 'P0',
                        purpose: 'capture mood',
                        userIntent: 'share a vibe',
                        states: [
                            { name: 'Default', description: 'Camera active' },
                            { name: 'Camera denied', description: 'No permission', trigger: 'denial' },
                        ],
                        entryPoints: ['Landing'],
                        exitPaths: [
                            { label: 'Submit', target: 'Loading' },
                            { label: 'Denied', target: 'Fallback', condition: 'no permission' },
                        ],
                        coreUIElements: ['Canvas', 'CTA'],
                        outputData: ['mood vector'],
                        risks: ['camera unavailable'],
                        featureRefs: ['F-1', 'F-2'],
                    }],
                }],
            };
            const result = normalizeScreenInventory(input);
            const screen = result!.sections[0].screens[0];
            expect(screen.states).toHaveLength(2);
            expect(screen.states![1].trigger).toBe('denial');
            expect(screen.exitPaths).toHaveLength(2);
            expect(screen.exitPaths![1].condition).toBe('no permission');
            expect(screen.coreUIElements).toEqual(['Canvas', 'CTA']);
            expect(result!.sections[0].flowSummary).toBe('Landing → Capture');
        });

        it('drops sections without a title or screens', () => {
            const result = normalizeScreenInventory({
                sections: [
                    { title: '', screens: [] },
                    { title: 'Real', screens: [{ name: 'A', purpose: 'a', priority: 'P1' }] },
                ],
            });
            expect(result!.sections.map(s => s.title)).toEqual(['Real']);
        });

        it('drops screens without a name', () => {
            const result = normalizeScreenInventory({
                sections: [{
                    title: 'X',
                    screens: [
                        { purpose: 'no name', priority: 'P0' },
                        { name: 'Real', purpose: 'real', priority: 'P0' },
                    ],
                }],
            });
            expect(result!.sections[0].screens.map(s => s.name)).toEqual(['Real']);
        });
    });

    describe('screenInventoryToMarkdown', () => {
        it('renders sections with numbering and labels', () => {
            const md = screenInventoryToMarkdown({
                sections: [{
                    title: 'Auth',
                    description: 'Sign-in flow',
                    flowSummary: 'Landing → Login',
                    screens: [{
                        name: 'Login',
                        priority: 'P0',
                        purpose: 'Sign the user in',
                        userIntent: 'Get into the app fast',
                        states: [
                            { name: 'Default', description: 'Empty fields' },
                            { name: 'Error', description: 'Bad credentials', trigger: 'invalid login' },
                        ],
                        entryPoints: ['Landing'],
                        exitPaths: [{ label: 'Submit', target: 'Dashboard' }],
                        coreUIElements: ['Email', 'Password'],
                        risks: ['Brute force attack'],
                        featureRefs: ['F-1'],
                    }],
                }],
            });
            expect(md).toContain('## 1. Auth');
            expect(md).toContain('Sign-in flow');
            expect(md).toContain('Landing → Login');
            expect(md).toContain('### Login — P0');
            expect(md).toContain('**Purpose:** Sign the user in');
            expect(md).toContain('**User intent:**');
            expect(md).toContain('Submit → Dashboard');
            expect(md).toContain('Brute force attack');
            expect(md).toContain('F-1');
        });

        it('includes type tag when not a regular screen', () => {
            const md = screenInventoryToMarkdown({
                sections: [{
                    title: 'Modals',
                    screens: [{ name: 'Confirm', type: 'modal', priority: 'P1', purpose: 'Confirm action' }],
                }],
            });
            expect(md).toContain('### Confirm — P1 _(modal)_');
        });
    });
});
