import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Bug, Trash2, Download, Copy, Check, Circle, AlertCircle,
    GitCompare, Search, Zap, X,
} from 'lucide-react';
import { useLlmTraces } from './useLlmTraces';
import {
    isTraceCaptureEnabled, setTraceCaptureEnabled, clearAllTraces,
} from '../../lib/trace/traceRecorder';
import {
    groupIntoSessions, filterTraces, diffCalls, type TraceFilter,
} from '../../lib/trace/traceSessions';
import { buildTraceHtmlReport } from '../../lib/trace/traceExport';
import type { LlmTraceCall } from '../../lib/trace/traceTypes';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';

// Developer-only LLM Trace Viewer (`/developer/llm-trace`, owner-gated). Renders
// every captured LLM call from the in-memory registry (hydrated from
// IndexedDB), with filtering, a tabbed per-call inspector, diff mode, a session
// timeline, and standalone-HTML export. Capture is off by default and toggled
// here; nothing about normal app behavior changes.

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString();
const fmtTokens = (c: LlmTraceCall): string =>
    c.usage ? `${c.usage.inputTokens}→${c.usage.outputTokens}` : '—';

function StatusDot({ status }: { status: LlmTraceCall['status'] }) {
    return status === 'error'
        ? <AlertCircle size={13} className="text-red-400 shrink-0" />
        : <Circle size={9} className="text-emerald-400 fill-emerald-400 shrink-0" />;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                if (await copyToClipboard(text)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5"
        >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : label}
        </button>
    );
}

function CodeBlock({ title, content }: { title: string; content: string }) {
    if (!content) return null;
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</h4>
                <CopyButton text={content} />
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[12px] leading-relaxed text-neutral-200 whitespace-pre-wrap break-words">{content}</pre>
        </div>
    );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
    return (
        <div className="flex gap-2 py-1 text-[13px]">
            <span className="w-36 shrink-0 text-neutral-500">{k}</span>
            <span className="min-w-0 break-words text-neutral-200">{v}</span>
        </div>
    );
}

type DetailTab =
    | 'overview' | 'input' | 'prompt' | 'context' | 'request'
    | 'response' | 'parsed' | 'validation' | 'construction';

const TABS: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'input', label: 'Input Summary' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'context', label: 'Context' },
    { id: 'request', label: 'Raw Request' },
    { id: 'response', label: 'Raw Response' },
    { id: 'parsed', label: 'Parsed Result' },
    { id: 'validation', label: 'Validation' },
    { id: 'construction', label: 'Prompt Construction' },
];

function TraceDetail({ call }: { call: LlmTraceCall }) {
    const [tab, setTab] = useState<DetailTab>('overview');
    const v = call.validation ?? {};
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${tab === t.id ? 'bg-indigo-500/20 text-indigo-200' : 'text-neutral-400 hover:bg-white/5'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'overview' && (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <KV k="Purpose" v={call.meta.purpose ?? '—'} />
                    <KV k="Provider" v={call.provider} />
                    <KV k="Model" v={call.model} />
                    <KV k="Mode" v={call.mode} />
                    <KV k="Stage" v={call.meta.stage ?? '—'} />
                    <KV k="Artifact" v={call.meta.artifact ?? '—'} />
                    <KV k="Project" v={call.meta.projectName ?? call.meta.projectId ?? '—'} />
                    <KV k="Started" v={new Date(call.startedAt).toLocaleString()} />
                    <KV k="Ended" v={new Date(call.endedAt).toLocaleString()} />
                    <KV k="Latency" v={fmtMs(call.durationMs)} />
                    <KV k="Token usage" v={call.usage ? `${call.usage.inputTokens} in / ${call.usage.outputTokens} out / ${call.usage.totalTokens} total` : 'unavailable'} />
                    <KV k="Retries" v={call.retryCount} />
                    <KV k="Finish reason" v={call.finishReason ?? '—'} />
                    <KV k="Validation" v={call.status === 'error' ? <span className="text-red-400">error</span> : (v.jsonParsed === false ? <span className="text-amber-400">JSON parse failed</span> : <span className="text-emerald-400">ok</span>)} />
                    {call.error && <KV k="Error" v={<span className="text-red-400">{call.error}</span>} />}
                </div>
            )}

            {tab === 'input' && (
                <div className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Purpose</h4>
                    <p className="text-[13px] text-neutral-200">{call.meta.purpose ?? '—'}</p>
                    <h4 className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Inputs</h4>
                    {call.meta.inputs?.length
                        ? <ul className="list-disc space-y-1 pl-5 text-[13px] text-neutral-200">{call.meta.inputs.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
                        : <p className="text-[13px] text-neutral-500">No input summary was attached to this call.</p>}
                </div>
            )}

            {tab === 'prompt' && (
                <div className="space-y-4">
                    <CodeBlock title="System" content={call.systemInstruction} />
                    <CodeBlock title="User" content={call.promptText} />
                </div>
            )}

            {tab === 'context' && (
                call.meta.contextItems?.length
                    ? <ul className="space-y-2">{call.meta.contextItems.map((i, idx) => (
                        <li key={idx} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[13px]">
                            <span className="font-medium text-neutral-100">{i.label}</span>
                            <span className="text-neutral-500"> — {i.source}</span>
                            {i.detail && <p className="mt-1 text-[12px] text-neutral-400">{i.detail}</p>}
                        </li>
                    ))}</ul>
                    : <p className="text-[13px] text-neutral-500">No structured context items were attached. See Prompt Construction for the assembly breakdown.</p>
            )}

            {tab === 'request' && <CodeBlock title="Raw Request (secrets redacted)" content={call.requestBody} />}
            {tab === 'response' && <CodeBlock title="Raw Response (before parsing)" content={call.rawResponse || '(empty)'} />}

            {tab === 'parsed' && (
                call.parsedJson !== undefined
                    ? <CodeBlock title="Parsed JSON" content={JSON.stringify(call.parsedJson, null, 2)} />
                    : <CodeBlock title="Extracted text" content={call.extractedText || call.rawResponse || '(none)'} />
            )}

            {tab === 'validation' && (
                <div className="space-y-1.5 text-[13px]">
                    {typeof v.jsonParsed === 'boolean' && (
                        <p className={v.jsonParsed ? 'text-emerald-400' : 'text-amber-400'}>{v.jsonParsed ? '✓ JSON parsed' : '⚠ JSON parse failed'}</p>
                    )}
                    {typeof v.schemaValid === 'boolean' && (
                        <p className={v.schemaValid ? 'text-emerald-400' : 'text-amber-400'}>{v.schemaValid ? '✓ Schema valid' : '⚠ Schema mismatch'}</p>
                    )}
                    {v.finishReason && <p className="text-neutral-300">Finish reason: {v.finishReason}</p>}
                    {v.retryReason && <p className="text-amber-400">Retry reason: {v.retryReason}</p>}
                    {(v.parserWarnings ?? []).map((w, i) => <p key={`w${i}`} className="text-amber-400">⚠ {w}</p>)}
                    {(v.repairs ?? []).map((r, i) => <p key={`r${i}`} className="text-sky-400">↺ {r}</p>)}
                    {(v.notes ?? []).map((n, i) => <p key={`n${i}`} className="text-neutral-400">• {n}</p>)}
                    {call.status === 'error' && <p className="text-red-400">✕ {call.error}</p>}
                    {call.retryCount > 0 && <p className="text-neutral-300">Network retries: {call.retryCount}</p>}
                    {call.status === 'success' && v.jsonParsed !== false && !v.parserWarnings?.length && (
                        <p className="text-emerald-400">✓ Call succeeded</p>
                    )}
                </div>
            )}

            {tab === 'construction' && (
                call.meta.promptPieces?.length
                    ? <ul className="space-y-1.5">{call.meta.promptPieces.map((p, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-[13px]">
                            <span className={p.present ? 'text-emerald-400' : 'text-neutral-600'}>{p.present ? '✓' : '✕'}</span>
                            <span className={p.present ? 'text-neutral-200' : 'text-neutral-500'}>{p.label}</span>
                            {p.detail && <span className="text-[11px] text-neutral-500">({p.detail})</span>}
                        </li>
                    ))}</ul>
                    : <p className="text-[13px] text-neutral-500">No prompt-construction breakdown was attached to this call.</p>
            )}
        </div>
    );
}

function DiffView({ a, b }: { a: LlmTraceCall; b: LlmTraceCall }) {
    const rows = useMemo(() => diffCalls(a, b), [a, b]);
    return (
        <div className="space-y-3">
            <p className="text-[12px] text-neutral-400">
                Comparing <span className="text-neutral-200">{a.meta.purpose ?? a.id.slice(0, 8)}</span> ({fmtTime(a.startedAt)}) vs{' '}
                <span className="text-neutral-200">{b.meta.purpose ?? b.id.slice(0, 8)}</span> ({fmtTime(b.startedAt)})
            </p>
            {rows.map((r) => (
                <div key={r.field} className={`rounded-lg border p-2.5 ${r.changed ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}>
                    <div className="mb-1 flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{r.field}</span>
                        {r.changed && <span className="text-[10px] text-amber-400">changed</span>}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 text-[11px] text-neutral-300 whitespace-pre-wrap break-words">{r.a || '—'}</pre>
                        <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 text-[11px] text-neutral-300 whitespace-pre-wrap break-words">{r.b || '—'}</pre>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function LlmTraceViewerPage() {
    const navigate = useNavigate();
    const traces = useLlmTraces();
    const [enabled, setEnabled] = useState(isTraceCaptureEnabled());
    const [filter, setFilter] = useState<TraceFilter>({});
    const [selectedId, setSelectedId] = useState<string | undefined>();
    const [diffMode, setDiffMode] = useState(false);
    const [diffIds, setDiffIds] = useState<string[]>([]);

    const filtered = useMemo(
        () => filterTraces(traces, filter).sort((a, b) => b.createdAt - a.createdAt),
        [traces, filter],
    );
    const sessions = useMemo(() => groupIntoSessions(filtered), [filtered]);
    const selected = useMemo(() => traces.find((t) => t.id === selectedId), [traces, selectedId]);
    const diffA = useMemo(() => traces.find((t) => t.id === diffIds[0]), [traces, diffIds]);
    const diffB = useMemo(() => traces.find((t) => t.id === diffIds[1]), [traces, diffIds]);

    const models = useMemo(() => Array.from(new Set(traces.map((t) => t.model))).sort(), [traces]);
    const stages = useMemo(() => Array.from(new Set(traces.map((t) => t.meta.stage).filter(Boolean))) as string[], [traces]);

    const handleSelect = (call: LlmTraceCall) => {
        if (diffMode) {
            setDiffIds((prev) => {
                if (prev.includes(call.id)) return prev.filter((id) => id !== call.id);
                return [...prev, call.id].slice(-2);
            });
        } else {
            setSelectedId(call.id);
        }
    };

    const download = (html: string, name: string) => {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportAll = () => download(buildTraceHtmlReport(filtered, 'Synapse LLM Trace Report'), 'synapse-llm-traces.html');
    const exportSelected = () => {
        const calls = diffMode ? [diffA, diffB].filter(Boolean) as LlmTraceCall[] : (selected ? [selected] : []);
        if (calls.length) download(buildTraceHtmlReport(calls, 'Synapse LLM Trace — selection'), 'synapse-llm-trace-selection.html');
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/90 backdrop-blur">
                <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
                    <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/5">
                        <ArrowLeft size={15} /> Back
                    </button>
                    <div className="flex items-center gap-2">
                        <Bug size={18} className="text-amber-400" />
                        <h1 className="text-lg font-semibold">LLM Trace Viewer</h1>
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Developer</span>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => { const next = !enabled; setTraceCaptureEnabled(next); setEnabled(next); }}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-neutral-300 hover:bg-white/5'}`}
                        >
                            <Zap size={14} /> Capture {enabled ? 'On' : 'Off'}
                        </button>
                        <button
                            onClick={() => { setDiffMode((d) => !d); setDiffIds([]); }}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${diffMode ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-white/10 text-neutral-300 hover:bg-white/5'}`}
                        >
                            <GitCompare size={14} /> Diff
                        </button>
                        <button onClick={exportAll} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/5">
                            <Download size={14} /> Export
                        </button>
                        <button
                            onClick={() => { void clearAllTraces(); setSelectedId(undefined); setDiffIds([]); }}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-400 hover:bg-white/5"
                        >
                            <Trash2 size={14} /> Clear
                        </button>
                    </div>
                </div>
            </header>

            {!enabled && traces.length === 0 && (
                <div className="mx-auto max-w-[1400px] px-4 pt-4">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-[13px] text-amber-200">
                        Trace capture is <strong>off</strong>. Turn on <strong>Capture</strong> above (or append <code>?llmtrace</code> to any URL), then run a generation — every LLM call will appear here. Capture persists to local IndexedDB so you can inspect past runs; nothing is sent to a server.
                    </div>
                </div>
            )}

            <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[380px_minmax(0,1fr)]">
                {/* Sidebar */}
                <aside className="space-y-3">
                    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2">
                            <Search size={14} className="text-neutral-500" />
                            <input
                                value={filter.text ?? ''}
                                onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
                                placeholder="Search prompts, responses, purpose…"
                                className="w-full bg-transparent py-2 text-[13px] text-neutral-200 outline-none placeholder:text-neutral-600"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={filter.stage ?? ''}
                                onChange={(e) => setFilter((f) => ({ ...f, stage: e.target.value || undefined }))}
                                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-neutral-200"
                            >
                                <option value="">All stages</option>
                                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <select
                                value={filter.model ?? ''}
                                onChange={(e) => setFilter((f) => ({ ...f, model: e.target.value || undefined }))}
                                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-neutral-200"
                            >
                                <option value="">All models</option>
                                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-wrap gap-3 text-[12px] text-neutral-400">
                            <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={!!filter.onlyErrors} onChange={(e) => setFilter((f) => ({ ...f, onlyErrors: e.target.checked }))} /> Errors
                            </label>
                            <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={!!filter.onlyRetries} onChange={(e) => setFilter((f) => ({ ...f, onlyRetries: e.target.checked }))} /> Retries
                            </label>
                            {(filter.text || filter.stage || filter.model || filter.onlyErrors || filter.onlyRetries) && (
                                <button onClick={() => setFilter({})} className="ml-auto flex items-center gap-1 text-neutral-500 hover:text-neutral-300">
                                    <X size={12} /> Reset
                                </button>
                            )}
                        </div>
                    </div>

                    <p className="px-1 text-[11px] uppercase tracking-wide text-neutral-500">
                        {filtered.length} call{filtered.length === 1 ? '' : 's'} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
                    </p>

                    <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-auto pr-1">
                        {sessions.map((session) => (
                            <div key={session.id} className="space-y-1.5">
                                <div className="flex items-center gap-2 border-l-2 border-indigo-500/60 pl-2">
                                    <span className="text-[12px] font-semibold text-neutral-200">{session.label}</span>
                                    <span className="text-[10px] text-neutral-500">{session.calls.length}</span>
                                </div>
                                {session.calls.slice().reverse().map((call) => {
                                    const active = diffMode ? diffIds.includes(call.id) : call.id === selectedId;
                                    return (
                                        <button
                                            key={call.id}
                                            onClick={() => handleSelect(call)}
                                            className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${active ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <StatusDot status={call.status} />
                                                <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-100">{call.meta.purpose ?? call.meta.artifact ?? call.mode}</span>
                                                {diffMode && diffIds.includes(call.id) && (
                                                    <span className="rounded bg-indigo-500/30 px-1 text-[10px] text-indigo-200">{diffIds.indexOf(call.id) + 1}</span>
                                                )}
                                            </div>
                                            <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
                                                <span className="truncate">{call.model}</span>
                                                <span>·</span>
                                                <span>{fmtTime(call.startedAt)}</span>
                                                <span>·</span>
                                                <span>{fmtMs(call.durationMs)}</span>
                                                <span>·</span>
                                                <span>{fmtTokens(call)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        {filtered.length === 0 && (
                            <p className="px-1 py-8 text-center text-[13px] text-neutral-600">No traces match.</p>
                        )}
                    </div>
                </aside>

                {/* Main */}
                <main className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    {diffMode ? (
                        diffA && diffB ? (
                            <DiffView a={diffA} b={diffB} />
                        ) : (
                            <p className="py-16 text-center text-[13px] text-neutral-500">Select two calls from the sidebar to compare them.</p>
                        )
                    ) : selected ? (
                        <>
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <h2 className="truncate text-[15px] font-semibold text-neutral-100">{selected.meta.purpose ?? selected.meta.artifact ?? 'LLM Call'}</h2>
                                    <p className="text-[11px] text-neutral-500">{selected.provider} · {selected.model} · {selected.meta.stage ?? '—'}</p>
                                </div>
                                <button onClick={exportSelected} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-neutral-300 hover:bg-white/5">
                                    <Download size={13} /> Export call
                                </button>
                            </div>
                            <TraceDetail call={selected} />
                        </>
                    ) : (
                        <p className="py-16 text-center text-[13px] text-neutral-500">Select a call from the sidebar to inspect its prompt, context, response, and validation.</p>
                    )}
                </main>
            </div>
        </div>
    );
}
