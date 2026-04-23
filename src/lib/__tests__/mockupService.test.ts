import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockupSettings, StructuredPRD } from '../../types';

const callGeminiMock = vi.fn();

vi.mock('../geminiClient', () => ({
    callGemini: (...args: unknown[]) => callGeminiMock(...args),
}));

import { generateMockup } from '../services/mockupService';

beforeEach(() => {
    callGeminiMock.mockReset();
    localStorage.removeItem('MOCKUP_ENGINE');
});

afterEach(() => {
    localStorage.removeItem('MOCKUP_ENGINE');
});

const settings: MockupSettings = {
    platform: 'desktop',
    fidelity: 'mid',
    scope: 'multi_screen',
};

const structuredPRD: StructuredPRD = {
    vision: 'Coordinate clinic intake and triage decisions in one place.',
    coreProblem: 'Care coordinators lose time jumping between intake notes and triage actions.',
    targetUsers: ['Care coordinator'],
    features: [
        {
            id: 'f1',
            name: 'Triage queue',
            description: 'Prioritize incoming patient cases by urgency and ownership.',
            userValue: 'Respond to urgent patients faster.',
            complexity: 'medium',
        },
    ],
    architecture: 'Web app',
    risks: ['Incomplete intake data'],
};

describe('mockupService alignment integration', () => {
    it('returns structured critique alongside payload', async () => {
        callGeminiMock.mockResolvedValueOnce(JSON.stringify({
            version: 'mockup_html_v1',
            title: 'Clinic Triage Concept',
            summary: 'Queue-first layout for care coordinators.',
            screens: [
                {
                    name: 'Triage Queue',
                    purpose: 'Care coordinator reviews urgent patient cases and assigns triage owner.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Triage Queue</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Assign case owner</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Patient case</td><td>Urgency</td></tr></tbody></table></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Triage actions</li></ul></aside></main></div>',
                },
                {
                    name: 'Case Detail Review',
                    purpose: 'Care coordinator validates intake details and logs triage recommendation.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Case Detail Review</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Submit triage recommendation</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Intake note summary</li><li>Risk indicators</li></ul></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Escalation checklist</li></ul></aside></main></div>',
                },
                {
                    name: 'Handoff Confirmation',
                    purpose: 'Care coordinator confirms triage handoff and tracks pending follow-ups.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Handoff Confirmation</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Close handoff</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Assigned clinician</td><td>Status</td></tr></tbody></table></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Follow-up tasks</li></ul></aside></main></div>',
                },
            ],
        }));

        const result = await generateMockup('Clinic triage PRD', settings, structuredPRD);

        expect(result.payload.screens).toHaveLength(3);
        expect(result.critique.alignmentScore).toBeGreaterThan(0);
        expect(result.critique.screens).toHaveLength(3);
    });

    it('fails when alignment is critically poor', async () => {
        callGeminiMock.mockResolvedValueOnce(JSON.stringify({
            version: 'mockup_html_v1',
            title: 'Generic App',
            summary: 'Overview',
            screens: [
                {
                    name: 'Overview Dashboard',
                    purpose: 'Track KPIs for teams.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Overview Dashboard</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Create</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Revenue</td><td>Users</td></tr></tbody></table></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Analytics panel</li></ul></aside></main></div>',
                },
                {
                    name: 'Analytics Home',
                    purpose: 'Review trends and metrics.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Analytics Home</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Export</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Active users</td><td>Conversion</td></tr></tbody></table></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Team workspace summary</li></ul></aside></main></div>',
                },
                {
                    name: 'Settings',
                    purpose: 'Configure account preferences.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Settings</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Save</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Notification defaults</li></ul></section><aside class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Account settings</li></ul></aside></main></div>',
                },
            ],
        }));

        const result = await generateMockup('Clinic triage PRD', settings, structuredPRD);
        expect(result.usedFallback).toBe(true);
        expect(result.payload.screens[0].name).toBe('Fallback Workspace');
        expect(result.warnings.some(w => w.includes('safe fallback'))).toBe(true);
    });

    it('passes deterministic generation controls to Gemini JSON mode', async () => {
        callGeminiMock.mockResolvedValueOnce(JSON.stringify({
            version: 'mockup_html_v1',
            title: 'Clinic Triage Concept',
            summary: 'Queue-first layout for care coordinators.',
            screens: [
                {
                    name: 'Triage Queue',
                    purpose: 'Care coordinator reviews urgent patient cases and assigns triage owner.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Triage Queue</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Assign case owner</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Patient case</td><td>Urgency</td></tr></tbody></table></section><section class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Triage actions</li></ul></section></main></div>',
                },
            ],
        }));

        await generateMockup('Clinic triage PRD', settings, structuredPRD);
        const call = callGeminiMock.mock.calls[0];
        expect(call[2]).toMatchObject({ temperature: 0.2, topP: 0.8, topK: 32 });
    });
});

describe('mockupService spec engine', () => {
    const buildSpecResponse = () => JSON.stringify({
        version: 'mockup_layout_spec_v1',
        tokenSet: 'token_set_v1',
        title: 'Clinic Triage Concept',
        summary: 'Queue-first layout for care coordinators.',
        screens: [
            {
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
                            columns: ['Patient case', 'Urgency', 'Triage owner'],
                            tableRows: [
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
                actions: [{ kind: 'primary_cta', label: 'Assign case owner' }],
            },
            {
                name: 'Case Detail Review',
                purpose: 'Care coordinator validates intake details and logs triage recommendation.',
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
                        heading: 'Patient case details',
                        component: 'detail_panel',
                        data: {
                            fields: [
                                { label: 'Patient', value: 'Alex Chen' },
                                { label: 'Urgency', value: 'Critical' },
                                { label: 'Triage owner', value: 'Dr. Kim' },
                                { label: 'Intake note', value: 'Chest pain, 45 min duration' },
                            ],
                        },
                    },
                    {
                        role: 'support',
                        heading: 'Escalation checklist',
                        component: 'activity_feed',
                        data: {
                            entries: [
                                { actor: 'Nurse Ellis', verb: 'verified', target: 'vitals', when: '5m ago' },
                                { actor: 'Dr. Kim', verb: 'approved', target: 'escalation', when: '8m ago' },
                            ],
                        },
                    },
                ],
                actions: [{ kind: 'primary_cta', label: 'Submit triage recommendation' }],
            },
        ],
    });

    const settingsLocal: MockupSettings = {
        platform: 'desktop',
        fidelity: 'mid',
        scope: 'multi_screen',
    };

    const structuredPRDLocal: StructuredPRD = {
        vision: 'Coordinate clinic intake and triage decisions in one place.',
        coreProblem: 'Care coordinators lose time jumping between intake notes and triage actions.',
        targetUsers: ['Care coordinator'],
        features: [
            {
                id: 'f1',
                name: 'Triage queue',
                description: 'Prioritize incoming patient cases by urgency and ownership.',
                userValue: 'Respond to urgent patients faster.',
                complexity: 'medium',
            },
        ],
        architecture: 'Web app',
        risks: ['Incomplete intake data'],
    };

    it('uses the layout-spec schema when MOCKUP_ENGINE=spec', async () => {
        localStorage.setItem('MOCKUP_ENGINE', 'spec');
        callGeminiMock.mockResolvedValueOnce(buildSpecResponse());

        const result = await generateMockup('Clinic triage PRD', settingsLocal, structuredPRDLocal);

        const call = callGeminiMock.mock.calls[0];
        const passedSchema = (call[2] as { responseSchema: { properties: { version: { enum: string[] } } } }).responseSchema;
        expect(passedSchema.properties.version.enum).toContain('mockup_layout_spec_v1');
        expect(result.payload.screens).toHaveLength(2);
        expect(result.payload.screens[0].html).toContain('Assign case owner');
        expect(result.payload.screens[1].html).toContain('Submit triage recommendation');
        expect(result.usedFallback).toBe(false);
        expect(result.strategyVersion).toBe('mockup_strategy_spec_v1');
    });

    it('spec engine output is deterministic across regeneration with identical model output', async () => {
        localStorage.setItem('MOCKUP_ENGINE', 'spec');
        callGeminiMock.mockResolvedValueOnce(buildSpecResponse());
        callGeminiMock.mockResolvedValueOnce(buildSpecResponse());

        const first = await generateMockup('Clinic triage PRD', settingsLocal, structuredPRDLocal);
        const second = await generateMockup('Clinic triage PRD', settingsLocal, structuredPRDLocal);

        // ids are uuids and differ per run — compare structure-only html with
        // the id fields stripped.
        const normalize = (html: string) => html.replace(/\s+/g, ' ').trim();
        expect(first.payload.screens.length).toBe(second.payload.screens.length);
        first.payload.screens.forEach((screen, i) => {
            expect(normalize(screen.html)).toBe(normalize(second.payload.screens[i].html));
        });
    });

    it('falls back to HTML engine when spec engine fails repeatedly', async () => {
        localStorage.setItem('MOCKUP_ENGINE', 'spec');
        // Spec engine gets 3 failing attempts, then HTML engine takes over
        // and the first HTML-engine response succeeds.
        callGeminiMock.mockResolvedValueOnce('not valid json');
        callGeminiMock.mockResolvedValueOnce('still not json');
        callGeminiMock.mockResolvedValueOnce('{bad');
        callGeminiMock.mockResolvedValueOnce(JSON.stringify({
            version: 'mockup_html_v1',
            title: 'Clinic Triage Concept',
            summary: 'Queue-first layout for care coordinators.',
            screens: [
                {
                    name: 'Triage Queue',
                    purpose: 'Care coordinator reviews urgent patient cases and assigns triage owner.',
                    html: '<div class="min-h-screen bg-neutral-50 text-neutral-900"><header class="px-6 py-4 border-b border-neutral-200 flex items-center justify-between"><h1 class="text-xl font-semibold">Triage Queue</h1><button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 text-white">Assign case owner</button></header><main class="p-6 grid grid-cols-3 gap-4"><section class="col-span-2 rounded-xl border border-neutral-200 bg-white p-5"><table class="w-full text-sm"><tbody><tr><td>Patient case</td><td>Urgency</td></tr></tbody></table></section><section class="rounded-xl border border-neutral-200 bg-white p-5"><ul class="space-y-2"><li>Triage actions</li></ul></section></main></div>',
                },
            ],
        }));

        const result = await generateMockup('Clinic triage PRD', settingsLocal, structuredPRDLocal);
        expect(callGeminiMock.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(result.warnings.some(w => w.includes('Spec attempt'))).toBe(true);
        expect(result.warnings.some(w => w.includes('falling back to HTML engine'))).toBe(true);
        expect(result.payload.screens[0].name).toBe('Triage Queue');
    });
});
