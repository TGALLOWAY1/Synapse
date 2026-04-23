import type { MockupLayoutScreen } from '../../../types';
import { renderAction } from './actions';
import { renderSection } from './sections';
import { esc } from './escape';

// Shells wrap a screen's sections + header actions in one of three vetted
// layouts. Every shell emits exactly one `min-h-screen` root div; never an
// inner `overflow-hidden` on a flex container (the #1 preview-blanking
// pattern flagged in docs/mockup-failure-map-2026-04-17.md).

const renderHeaderActions = (screen: MockupLayoutScreen): string =>
    screen.actions.map(renderAction).join('\n    ');

const renderMain = (screen: MockupLayoutScreen): string => {
    const primary = screen.sections.filter(s => s.role === 'primary').map(renderSection).join('\n');
    const support = screen.sections.filter(s => s.role !== 'primary').map(renderSection).join('\n');
    return `<main class="p-6 md:p-8 grid gap-4 md:grid-cols-3">
  ${primary}
  ${support}
</main>`;
};

const sidebarTopbarShellHtml = (screen: MockupLayoutScreen): string => {
    const navItems = screen.shell.navLabels
        .map((label, idx) => {
            const active = idx === 0
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-neutral-600 hover:bg-neutral-100';
            return `<li><a class="block rounded-lg px-3 py-2 text-sm font-medium ${active}">${esc(label)}</a></li>`;
        })
        .join('\n        ');
    return `<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">
  <div class="flex">
    <aside class="w-60 shrink-0 border-r border-neutral-200 bg-white px-4 py-5 space-y-6">
      <div class="px-2">
        <p class="text-xs uppercase tracking-wide text-neutral-500">Workspace</p>
        <p class="text-sm font-semibold text-neutral-900">${esc(screen.shell.productName)}</p>
      </div>
      <nav>
        <ul class="space-y-1">
        ${navItems}
        </ul>
      </nav>
    </aside>
    <div class="flex-1">
      <header class="flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 md:px-8 py-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-neutral-500">${esc(screen.shell.productName)}</p>
          <h1 class="text-xl font-semibold tracking-tight text-neutral-900">${esc(screen.name)}</h1>
        </div>
        <div class="flex items-center gap-2">
          ${renderHeaderActions(screen)}
        </div>
      </header>
      ${renderMain(screen)}
    </div>
  </div>
</div>`;
};

const topbarOnlyShellHtml = (screen: MockupLayoutScreen): string => {
    const navItems = screen.shell.navLabels
        .map((label, idx) => {
            const active = idx === 0
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-neutral-600 hover:text-neutral-900';
            return `<a class="border-b-2 ${active} px-1 pb-3 text-sm font-medium">${esc(label)}</a>`;
        })
        .join('\n          ');
    return `<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">
  <header class="border-b border-neutral-200 bg-white">
    <div class="flex items-center justify-between gap-4 px-6 md:px-8 pt-4">
      <div class="flex items-center gap-6">
        <p class="text-sm font-semibold text-neutral-900">${esc(screen.shell.productName)}</p>
        <p class="text-xs uppercase tracking-wide text-neutral-500">${esc(screen.name)}</p>
      </div>
      <div class="flex items-center gap-2">
        ${renderHeaderActions(screen)}
      </div>
    </div>
    <nav class="px-6 md:px-8">
      <div class="flex items-end gap-6 pt-3">
        ${navItems}
      </div>
    </nav>
  </header>
  ${renderMain(screen)}
</div>`;
};

const mobileTabShellHtml = (screen: MockupLayoutScreen): string => {
    // Mobile shell: single-column, sticky header, bottom tab bar of up to 5 items.
    const tabs = screen.shell.navLabels
        .slice(0, 5)
        .map((label, idx) => {
            const active = idx === 0 ? 'text-indigo-700' : 'text-neutral-500';
            return `<button type="button" class="flex flex-col items-center gap-1 ${active}">
      <span class="h-6 w-6 rounded-full bg-current opacity-20"></span>
      <span class="text-[10px] font-medium">${esc(label)}</span>
    </button>`;
        })
        .join('\n    ');
    const sectionsHtml = screen.sections.map(renderSection).join('\n');
    return `<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">
  <div class="mx-auto max-w-[420px] pb-24">
    <header class="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-xs uppercase tracking-wide text-neutral-500">${esc(screen.shell.productName)}</p>
          <h1 class="text-lg font-semibold tracking-tight text-neutral-900">${esc(screen.name)}</h1>
        </div>
        <div class="flex items-center gap-2">
          ${renderHeaderActions(screen)}
        </div>
      </div>
    </header>
    <main class="p-4 space-y-4">
      ${sectionsHtml}
    </main>
  </div>
  <nav class="fixed inset-x-0 bottom-0 mx-auto max-w-[420px] border-t border-neutral-200 bg-white px-2 py-2 flex items-center justify-around">
    ${tabs}
  </nav>
</div>`;
};

export const renderShell = (screen: MockupLayoutScreen): string => {
    switch (screen.shell.type) {
        case 'sidebar_topbar':   return sidebarTopbarShellHtml(screen);
        case 'topbar_only':      return topbarOnlyShellHtml(screen);
        case 'mobile_tab_shell': return mobileTabShellHtml(screen);
    }
};
