import { describe, expect, it } from 'vitest';
import {
    MockupSpecParseError,
    parseLayoutSpec,
    renderLayoutSpec,
} from '../mockupLayoutRenderer';
import type { MockupLayoutSpec } from '../../types';

const validSpec: MockupLayoutSpec = {
    version: 'mockup_layout_spec_v1',
    tokenSet: 'token_set_v1',
    title: 'Clinic Triage Concept',
    summary: 'Queue-first layout for care coordinators.',
    screens: [
        {
            id: 'screen-1',
            name: 'Triage Queue',
            purpose: 'Care coordinator reviews urgent patient cases and assigns triage owner.',
            shell: {
                type: 'sidebar_topbar',
                platform: 'desktop',
                accent: 'indigo',
                productName: 'Triage',
                navLabels: ['Queue', 'Assigned', 'Follow-ups', 'Settings'],
            },
            sections: [
                {
                    role: 'primary',
                    heading: 'Urgent patient cases',
                    component: 'data_table',
                    data: {
                        columns: ['Patient', 'Urgency', 'Owner'],
                        rows: [
                            { cells: ['Alex Chen', 'Critical', 'Dr. Kim'] },
                            { cells: ['Priya Patel', 'High', 'Unassigned'] },
                        ],
                    },
                },
                {
                    role: 'support',
                    heading: 'Recent triage activity',
                    component: 'activity_feed',
                    data: {
                        entries: [
                            { actor: 'Dr. Kim', verb: 'assigned', target: 'case 1142', when: '2m ago' },
                            { actor: 'Nurse Ellis', verb: 'flagged', target: 'case 1139', when: '14m ago' },
                        ],
                    },
                },
            ],
            actions: [
                { kind: 'primary_cta', label: 'Assign case owner' },
                { kind: 'secondary_cta', label: 'Export queue' },
            ],
        },
    ],
};

describe('mockupLayoutRenderer', () => {
    describe('renderLayoutSpec', () => {
        it('produces a MockupPayload with one HTML fragment per screen', () => {
            const payload = renderLayoutSpec(validSpec);
            expect(payload.version).toBe('mockup_html_v1');
            expect(payload.title).toBe(validSpec.title);
            expect(payload.screens).toHaveLength(1);
            expect(payload.screens[0].html).toContain('min-h-screen');
            expect(payload.screens[0].html).toContain('Triage Queue');
            expect(payload.screens[0].html).toContain('Assign case owner');
        });

        it('is deterministic — identical spec produces byte-identical HTML', () => {
            const a = renderLayoutSpec(validSpec).screens[0].html;
            const b = renderLayoutSpec(validSpec).screens[0].html;
            expect(a).toBe(b);
        });

        it('escapes slot content to prevent HTML injection', () => {
            const malicious: MockupLayoutSpec = {
                ...validSpec,
                screens: [
                    {
                        ...validSpec.screens[0],
                        name: 'Triage <script>alert(1)</script>',
                    },
                ],
            };
            const html = renderLayoutSpec(malicious).screens[0].html;
            expect(html).not.toContain('<script>alert(1)</script>');
            expect(html).toContain('&lt;script&gt;');
        });

        it('emits exactly one min-h-screen root per screen', () => {
            const html = renderLayoutSpec(validSpec).screens[0].html;
            const rootMatches = html.match(/min-h-screen/g) ?? [];
            expect(rootMatches.length).toBe(1);
        });

        it('renders each shell type differently', () => {
            const sidebar = renderLayoutSpec(validSpec).screens[0].html;
            const topbar = renderLayoutSpec({
                ...validSpec,
                screens: [{
                    ...validSpec.screens[0],
                    shell: { ...validSpec.screens[0].shell, type: 'topbar_only' },
                }],
            }).screens[0].html;
            const mobile = renderLayoutSpec({
                ...validSpec,
                screens: [{
                    ...validSpec.screens[0],
                    shell: { ...validSpec.screens[0].shell, type: 'mobile_tab_shell', platform: 'mobile' },
                }],
            }).screens[0].html;
            expect(sidebar).not.toBe(topbar);
            expect(sidebar).not.toBe(mobile);
            expect(topbar).not.toBe(mobile);
            expect(sidebar).toContain('<aside');
            expect(mobile).toContain('max-w-[420px]');
        });
    });

    describe('parseLayoutSpec', () => {
        const validRaw = JSON.stringify({
            version: 'mockup_layout_spec_v1',
            tokenSet: 'token_set_v1',
            title: 'Spec Title',
            summary: 'Spec summary.',
            screens: [
                {
                    name: 'Screen A',
                    purpose: 'The purpose.',
                    shell: {
                        type: 'sidebar_topbar',
                        platform: 'desktop',
                        accent: 'indigo',
                        productName: 'Product',
                        navLabels: ['One', 'Two', 'Three'],
                    },
                    sections: [
                        {
                            role: 'primary',
                            heading: 'Primary stats',
                            component: 'stat_grid',
                            data: {
                                rows: [
                                    { label: 'Active', value: '128' },
                                    { label: 'Escalated', value: '14', delta: '+3%' },
                                ],
                            },
                        },
                        {
                            role: 'support',
                            heading: 'Filters',
                            component: 'filters_bar',
                            data: {
                                filters: [{ label: 'Status', options: ['Open', 'Closed'] }],
                            },
                        },
                    ],
                    actions: [{ kind: 'primary_cta', label: 'Create case' }],
                },
            ],
        });

        it('parses a valid spec and renders an HTML payload', () => {
            const result = parseLayoutSpec(validRaw, 'Fallback');
            expect(result.payload.screens).toHaveLength(1);
            expect(result.spec.screens[0].name).toBe('Screen A');
            expect(result.payload.screens[0].html).toContain('Primary stats');
            expect(result.payload.screens[0].html).toContain('Create case');
            expect(result.warnings).toHaveLength(0);
        });

        it('throws MockupSpecParseError on invalid JSON', () => {
            expect(() => parseLayoutSpec('{not json', 'x')).toThrow(MockupSpecParseError);
        });

        it('throws when no screens survive parsing', () => {
            const raw = JSON.stringify({
                version: 'mockup_layout_spec_v1',
                tokenSet: 'token_set_v1',
                title: 't',
                summary: 's',
                screens: [
                    { name: '' },
                    { purpose: 'no name' },
                ],
            });
            expect(() => parseLayoutSpec(raw, 'x')).toThrow(MockupSpecParseError);
        });

        it('drops sections with invalid slot data and fails the screen if fewer than 2 remain', () => {
            const raw = JSON.stringify({
                version: 'mockup_layout_spec_v1',
                tokenSet: 'token_set_v1',
                title: 't',
                summary: 's',
                screens: [
                    {
                        name: 'Bad screen',
                        purpose: 'p',
                        shell: {
                            type: 'sidebar_topbar',
                            platform: 'desktop',
                            accent: 'indigo',
                            productName: 'P',
                            navLabels: ['a', 'b', 'c'],
                        },
                        sections: [
                            { role: 'primary', heading: 'OK stats', component: 'stat_grid', data: { rows: [
                                { label: 'Active', value: '1' },
                                { label: 'Total', value: '2' },
                            ] } },
                            { role: 'support', heading: 'Bad table', component: 'data_table', data: {} },
                        ],
                        actions: [{ kind: 'primary_cta', label: 'Go' }],
                    },
                ],
            });
            expect(() => parseLayoutSpec(raw, 'x')).toThrow(MockupSpecParseError);
        });

        it('drops screens with unknown shell type or no actions and keeps valid ones', () => {
            const validScreen = JSON.parse(validRaw).screens[0];
            const raw = JSON.stringify({
                version: 'mockup_layout_spec_v1',
                tokenSet: 'token_set_v1',
                title: 't',
                summary: 's',
                screens: [
                    validScreen,
                    { ...validScreen, name: 'No actions', actions: [] },
                ],
            });
            const result = parseLayoutSpec(raw, 'x');
            expect(result.payload.screens).toHaveLength(1);
            expect(result.warnings.some(w => w.includes('No actions'))).toBe(true);
        });
    });
});
