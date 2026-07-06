// Build a standalone, offline HTML report from a set of traces. Pure (returns a
// string) so it can be unit-tested and downloaded from the viewer. The report
// embeds all displayed information and works with no network access.

import type { LlmTraceCall } from './traceTypes';
import { groupIntoSessions } from './traceSessions';

const esc = (s: unknown): string =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const fmtTime = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');

const codeBlock = (label: string, content: string): string =>
    content
        ? `<div class="block"><div class="block-label">${esc(label)}</div><pre>${esc(content)}</pre></div>`
        : '';

const renderCall = (c: LlmTraceCall): string => {
    const usage = c.usage
        ? `${c.usage.inputTokens} in / ${c.usage.outputTokens} out / ${c.usage.totalTokens} total`
        : '—';
    const parsed = c.parsedJson !== undefined ? JSON.stringify(c.parsedJson, null, 2) : '';
    const v = c.validation ?? {};
    const validationLines = [
        typeof v.jsonParsed === 'boolean' ? `JSON parsed: ${v.jsonParsed ? 'yes' : 'no'}` : '',
        typeof v.schemaValid === 'boolean' ? `Schema valid: ${v.schemaValid ? 'yes' : 'no'}` : '',
        v.finishReason ? `Finish reason: ${v.finishReason}` : '',
        v.retryReason ? `Retry reason: ${v.retryReason}` : '',
        ...(v.parserWarnings ?? []).map((w) => `Warning: ${w}`),
        ...(v.repairs ?? []).map((r) => `Repair: ${r}`),
        ...(v.notes ?? []).map((n) => `Note: ${n}`),
    ].filter(Boolean);

    return `
<section class="call ${c.status}">
  <h3>${esc(c.meta.purpose || c.meta.artifact || c.mode)} <span class="badge ${c.status}">${esc(c.status)}</span></h3>
  <table class="kv">
    <tr><td>Provider</td><td>${esc(c.provider)}</td></tr>
    <tr><td>Model</td><td>${esc(c.model)}</td></tr>
    <tr><td>Stage</td><td>${esc(c.meta.stage ?? '—')}</td></tr>
    <tr><td>Artifact</td><td>${esc(c.meta.artifact ?? '—')}</td></tr>
    <tr><td>Started</td><td>${esc(fmtTime(c.startedAt))}</td></tr>
    <tr><td>Duration</td><td>${esc(c.durationMs)} ms</td></tr>
    <tr><td>Tokens</td><td>${esc(usage)}</td></tr>
    <tr><td>Retries</td><td>${esc(c.retryCount)}</td></tr>
    <tr><td>Finish reason</td><td>${esc(c.finishReason ?? '—')}</td></tr>
  </table>
  ${c.meta.inputs?.length ? `<div class="block"><div class="block-label">Inputs</div><ul>${c.meta.inputs.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
  ${c.meta.promptPieces?.length ? `<div class="block"><div class="block-label">Prompt Construction</div><ul>${c.meta.promptPieces.map((p) => `<li>${p.present ? '✓' : '✕'} ${esc(p.label)}${p.detail ? ` — ${esc(p.detail)}` : ''}</li>`).join('')}</ul></div>` : ''}
  ${c.meta.contextItems?.length ? `<div class="block"><div class="block-label">Context</div><ul>${c.meta.contextItems.map((i) => `<li><strong>${esc(i.label)}</strong> — ${esc(i.source)}${i.detail ? `: ${esc(i.detail)}` : ''}</li>`).join('')}</ul></div>` : ''}
  ${codeBlock('System Instruction', c.systemInstruction)}
  ${codeBlock('Prompt', c.promptText)}
  ${codeBlock('Raw Request', c.requestBody)}
  ${codeBlock('Raw Response', c.rawResponse)}
  ${codeBlock('Parsed Result', parsed)}
  ${c.error ? codeBlock('Error', c.error) : ''}
  ${validationLines.length ? `<div class="block"><div class="block-label">Validation</div><ul>${validationLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
</section>`;
};

export const buildTraceHtmlReport = (calls: LlmTraceCall[], title = 'Synapse LLM Trace Report'): string => {
    const sessions = groupIntoSessions(calls);
    const generatedAt = fmtTime(calls.length ? Math.max(...calls.map((c) => c.endedAt)) : 0);
    const body = sessions
        .map(
            (s) => `
<div class="session">
  <h2>${esc(s.label)} <span class="muted">(${s.calls.length} call${s.calls.length === 1 ? '' : 's'})</span></h2>
  <div class="muted small">${esc(fmtTime(s.startedAt))} → ${esc(fmtTime(s.endedAt))}</div>
  ${s.calls.map(renderCall).join('')}
</div>`,
        )
        .join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0a; color: #e5e5e5; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  header { padding: 20px 24px; border-bottom: 1px solid #262626; position: sticky; top: 0; background: #0a0a0aee; backdrop-filter: blur(6px); }
  header h1 { margin: 0; font-size: 18px; }
  main { padding: 24px; max-width: 1000px; margin: 0 auto; }
  .muted { color: #888; font-weight: 400; }
  .small { font-size: 12px; }
  .session { margin-bottom: 40px; }
  .session > h2 { font-size: 15px; border-left: 3px solid #6366f1; padding-left: 10px; }
  .call { border: 1px solid #262626; border-radius: 12px; padding: 16px; margin: 14px 0; background: #121212; }
  .call.error { border-color: #7f1d1d; }
  .call h3 { margin: 0 0 12px; font-size: 14px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #1e293b; color: #93c5fd; }
  .badge.error { background: #450a0a; color: #fca5a5; }
  table.kv { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  table.kv td { padding: 2px 8px 2px 0; vertical-align: top; }
  table.kv td:first-child { color: #888; width: 130px; white-space: nowrap; }
  .block { margin-top: 12px; }
  .block-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #a3a3a3; margin-bottom: 4px; }
  pre { background: #0a0a0a; border: 1px solid #262626; border-radius: 8px; padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; }
  ul { margin: 4px 0; padding-left: 18px; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="muted small">${calls.length} call${calls.length === 1 ? '' : 's'} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} · generated ${esc(generatedAt)}</div>
</header>
<main>${body || '<p class="muted">No traces.</p>'}</main>
</body>
</html>`;
};
