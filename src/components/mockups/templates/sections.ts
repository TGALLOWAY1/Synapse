import type { MockupLayoutSection } from '../../../types';
import { esc } from './escape';

// Each section renderer takes a typed slot payload and returns a single
// <section> element. Class tokens are fixed literals so Tailwind JIT picks
// them up reliably inside the iframe CDN runtime.

const sectionShell = (role: 'primary' | 'support' | 'utility', heading: string, body: string): string => {
    const wide = role === 'primary';
    const padClass = wide ? 'md:col-span-2' : '';
    return `<section class="rounded-xl border border-neutral-200 bg-white p-5 space-y-4 ${padClass}">
  <header class="flex items-center justify-between">
    <h2 class="text-sm font-semibold text-neutral-900 tracking-tight">${esc(heading)}</h2>
  </header>
  ${body}
</section>`;
};

const statGridHtml = (section: Extract<MockupLayoutSection, { component: 'stat_grid' }>): string => {
    const tiles = section.data.rows
        .map(row => {
            const delta = row.delta
                ? `<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">${esc(row.delta)}</span>`
                : '';
            return `<div class="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-1">
  <p class="text-xs uppercase tracking-wide text-neutral-500">${esc(row.label)}</p>
  <div class="flex items-baseline justify-between gap-2">
    <p class="text-2xl font-semibold tracking-tight text-neutral-900">${esc(row.value)}</p>
    ${delta}
  </div>
</div>`;
        })
        .join('\n');
    return sectionShell(section.role, section.heading, `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">${tiles}</div>`);
};

const dataTableHtml = (section: Extract<MockupLayoutSection, { component: 'data_table' }>): string => {
    const headCells = section.data.columns
        .map(col => `<th class="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">${esc(col)}</th>`)
        .join('');
    const bodyRows = section.data.rows
        .map((row, idx) => {
            const zebra = idx % 2 === 0 ? 'bg-white' : 'bg-neutral-50';
            const cells = row.cells
                .map(cell => `<td class="px-3 py-2 text-sm text-neutral-700">${esc(cell)}</td>`)
                .join('');
            return `<tr class="${zebra} border-t border-neutral-100">${cells}</tr>`;
        })
        .join('\n');
    const table = `<div class="overflow-hidden rounded-lg border border-neutral-200">
  <table class="w-full">
    <thead class="bg-neutral-50"><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</div>`;
    return sectionShell(section.role, section.heading, table);
};

const activityFeedHtml = (section: Extract<MockupLayoutSection, { component: 'activity_feed' }>): string => {
    const items = section.data.entries
        .map(entry => `<li class="flex items-start gap-3">
  <div class="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold inline-flex items-center justify-center">${esc(entry.actor.slice(0, 2).toUpperCase())}</div>
  <div class="flex-1 text-sm">
    <p class="text-neutral-900"><span class="font-medium">${esc(entry.actor)}</span> ${esc(entry.verb)} <span class="font-medium">${esc(entry.target)}</span></p>
    <p class="text-xs text-neutral-500">${esc(entry.when)}</p>
  </div>
</li>`)
        .join('\n');
    return sectionShell(section.role, section.heading, `<ul class="space-y-3">${items}</ul>`);
};

const filtersBarHtml = (section: Extract<MockupLayoutSection, { component: 'filters_bar' }>): string => {
    const filters = section.data.filters
        .map(filter => {
            const options = filter.options
                .map((opt, idx) => {
                    const active = idx === 0
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                        : 'border-neutral-200 bg-white text-neutral-700';
                    return `<button type="button" class="inline-flex items-center rounded-full border ${active} px-3 py-1 text-xs font-medium">${esc(opt)}</button>`;
                })
                .join('');
            return `<div class="space-y-2">
  <p class="text-xs font-medium uppercase tracking-wide text-neutral-500">${esc(filter.label)}</p>
  <div class="flex flex-wrap gap-2">${options}</div>
</div>`;
        })
        .join('\n');
    return sectionShell(section.role, section.heading, `<div class="grid gap-4 md:grid-cols-2">${filters}</div>`);
};

const detailPanelHtml = (section: Extract<MockupLayoutSection, { component: 'detail_panel' }>): string => {
    const rows = section.data.fields
        .map(field => `<div class="flex items-start justify-between gap-3 border-b border-neutral-100 py-2 last:border-b-0">
  <p class="text-xs uppercase tracking-wide text-neutral-500">${esc(field.label)}</p>
  <p class="text-sm text-neutral-900 text-right">${esc(field.value)}</p>
</div>`)
        .join('\n');
    return sectionShell(section.role, section.heading, `<div class="rounded-lg border border-neutral-200 bg-neutral-50 px-4">${rows}</div>`);
};

const emptyStateHtml = (section: Extract<MockupLayoutSection, { component: 'empty_state' }>): string => {
    const cta = section.data.primaryActionLabel
        ? `<button type="button" class="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">${esc(section.data.primaryActionLabel)}</button>`
        : '';
    const body = `<div class="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center space-y-3">
  <h3 class="text-base font-semibold text-neutral-900">${esc(section.data.heading)}</h3>
  <p class="text-sm text-neutral-600">${esc(section.data.body)}</p>
  ${cta}
</div>`;
    return sectionShell(section.role, section.heading, body);
};

export const renderSection = (section: MockupLayoutSection): string => {
    switch (section.component) {
        case 'stat_grid':     return statGridHtml(section);
        case 'data_table':    return dataTableHtml(section);
        case 'activity_feed': return activityFeedHtml(section);
        case 'filters_bar':   return filtersBarHtml(section);
        case 'detail_panel':  return detailPanelHtml(section);
        case 'empty_state':   return emptyStateHtml(section);
    }
};
