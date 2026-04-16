// Sanitize a Gemini-generated HTML fragment and wrap it in a full HTML
// document suitable for an iframe's `srcDoc`. Kept separate from the component
// file so `react-refresh/only-export-components` stays happy and so the
// helper can be reused by the "Open in new tab" flow in MockupViewer.

import { normalizeMockupHtml } from '../../lib/mockupQuality';

export const buildMockupSrcDoc = (fragment: string): string => {
    const normalized = normalizeMockupHtml(fragment);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mockup preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; background: #e5e7eb; }
    html, body { overflow-y: auto; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    /* Defensive overrides for LLM-emitted shells that trap content above
       the iframe fold. The sandbox iframe is itself the scroll viewport,
       so root shells should grow naturally instead of clipping. */
    body > div.min-h-screen { min-height: 100vh; height: auto; }
    body > div.min-h-screen.flex { min-height: 100vh; }
    /* Belt-and-suspenders: even if the sanitizer misses a token, force any
       main or flex column shell to release the overflow-hidden token. */
    main.overflow-hidden, div.overflow-hidden.flex, div.overflow-hidden.flex-col { overflow: visible !important; }
  </style>
</head>
<body>
${normalized}
</body>
</html>`;
};
