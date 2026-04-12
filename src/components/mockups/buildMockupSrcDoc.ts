// Sanitize a Gemini-generated HTML fragment and wrap it in a full HTML
// document suitable for an iframe's `srcDoc`. Kept separate from the component
// file so `react-refresh/only-export-components` stays happy and so the
// helper can be reused by the "Open in new tab" flow in MockupViewer.

/** Maximum HTML size we'll render. Anything larger is almost certainly a
 *  model hallucination or degenerate output and could lock up the browser. */
const MAX_FRAGMENT_LENGTH = 200_000;

export const sanitizeHtmlFragment = (html: string): string => {
    // Hard cap — truncate absurdly large fragments before running regexes.
    let out = html.length > MAX_FRAGMENT_LENGTH
        ? html.slice(0, MAX_FRAGMENT_LENGTH) + '\n<!-- truncated: exceeded maximum safe length -->'
        : html;

    // Strip any stray <!doctype>, <html>, <head>, <body> wrappers the model
    // may include despite instructions.
    out = out.replace(/<!doctype[^>]*>/gi, '');
    out = out.replace(/<\/?(html|head|body)\b[^>]*>/gi, '');

    // Strip disallowed tags entirely — both paired and self-closing forms.
    out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    out = out.replace(/<script\b[^>]*\/?>/gi, '');                    // self-closing / unclosed
    out = out.replace(/<style\b[\s\S]*?<\/style>/gi, '');
    out = out.replace(/<style\b[^>]*\/?>/gi, '');
    out = out.replace(/<(link|meta|iframe|object|embed|base|noscript|form)\b[^>]*>/gi, '');
    out = out.replace(/<\/(iframe|object|embed|noscript|form)>/gi, '');

    // Strip inline event handlers: onclick="...", onLoad='...', etc.
    out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
    out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

    // Neutralize javascript: and data: URLs in href/src/action (quoted & unquoted).
    out = out.replace(/(href|src|action)\s*=\s*"\s*(javascript|data):[^"]*"/gi, '$1="#"');
    out = out.replace(/(href|src|action)\s*=\s*'\s*(javascript|data):[^']*'/gi, "$1='#'");
    out = out.replace(/(href|src|action)\s*=\s*(javascript|data):[^\s>]*/gi, '$1="#"');

    return out;
};

// Build the full document that goes into the iframe's srcDoc. Tailwind loads
// from the CDN; the iframe's sandbox does NOT include `allow-same-origin`, so
// even with `allow-scripts` the iframe cannot reach into the parent app.
export const buildMockupSrcDoc = (fragment: string): string => {
    const sanitized = sanitizeHtmlFragment(fragment);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mockup preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body { margin: 0; padding: 0; background: #f5f5f5; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  </style>
</head>
<body>
${sanitized}
</body>
</html>`;
};
