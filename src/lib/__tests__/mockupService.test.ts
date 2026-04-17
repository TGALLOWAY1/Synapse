import { describe, expect, it, vi } from 'vitest';
import type { MockupSettings, StructuredPRD } from '../../types';

const callGeminiMock = vi.fn();

vi.mock('../geminiClient', () => ({
    callGemini: (...args: unknown[]) => callGeminiMock(...args),
}));

import { generateMockup } from '../services/mockupService';

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
