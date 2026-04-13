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
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  </style>
</head>
<body>
${normalized}
</body>
</html>`;
};
