import type { MockupLayoutAction } from '../../../types';
import { esc } from './escape';

// Action renderers produce the controls that live in the screen header.
// Every template here emits a `type="button"` / `type="text"` element with
// fixed Tailwind classes so the header's visual rhythm is identical across
// screens regardless of which action kinds the model picked.

const primaryCtaHtml = (label: string): string =>
    `<button type="button" class="inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white shadow-sm">${esc(label)}</button>`;

const secondaryCtaHtml = (label: string): string =>
    `<button type="button" class="inline-flex items-center rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-900">${esc(label)}</button>`;

const inputHtml = (label: string): string =>
    `<input type="text" aria-label="${esc(label)}" placeholder="${esc(label)}" class="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />`;

const selectHtml = (label: string): string =>
    `<button type="button" aria-label="${esc(label)}" class="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700"><span>${esc(label)}</span><span aria-hidden="true" class="text-neutral-400">▾</span></button>`;

const tabHtml = (label: string): string =>
    `<button type="button" class="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-indigo-200 hover:text-indigo-700">${esc(label)}</button>`;

export const renderAction = (action: MockupLayoutAction): string => {
    switch (action.kind) {
        case 'primary_cta':   return primaryCtaHtml(action.label);
        case 'secondary_cta': return secondaryCtaHtml(action.label);
        case 'input':         return inputHtml(action.label);
        case 'select':        return selectHtml(action.label);
        case 'tab':           return tabHtml(action.label);
    }
};
