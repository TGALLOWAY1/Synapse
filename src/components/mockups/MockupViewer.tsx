import { useCallback, useMemo, useState } from 'react';
import { Eye, Code2, ExternalLink } from 'lucide-react';
import type { MockupPayload, MockupSettings, StalenessState } from '../../types';
import { StalenessBadge } from '../StalenessBadge';
import { MockupHtmlPreview } from './MockupHtmlPreview';
import { buildMockupSrcDoc } from './buildMockupSrcDoc';

type Props = {
    payload: MockupPayload;
    settings: MockupSettings;
    staleness: StalenessState;
    versionNumber: number;
    createdAt: number;
    sourceSpineVersionId?: string;
    actions?: React.ReactNode;
};

type Mode = 'preview' | 'code';

const SETTING_CHIP = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-neutral-600 font-medium';

export function MockupViewer({
    payload,
    settings,
    staleness,
    versionNumber,
    createdAt,
    sourceSpineVersionId,
    actions,
}: Props) {
    const [activeIdx, setActiveIdx] = useState(0);
    const [mode, setMode] = useState<Mode>('preview');

    // Clamp in case of payload mutation.
    const safeIdx = Math.min(activeIdx, Math.max(0, payload.screens.length - 1));
    const activeScreen = payload.screens[safeIdx];
    const hasMultiple = payload.screens.length > 1;

    const openInNewTab = useCallback(() => {
        if (!activeScreen) return;
        const doc = buildMockupSrcDoc(activeScreen.html);
        const blob = new Blob([doc], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        // Revoke once the new tab has had time to load. If window.open was
        // blocked we still revoke so we don't leak the object URL.
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        if (!win) {
            console.warn('[mockup] window.open blocked; object URL created but not opened');
        }
    }, [activeScreen]);

    const codeString = useMemo(() => activeScreen?.html ?? '', [activeScreen]);

    if (!activeScreen) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500">
                This mockup version has no screens.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            {/* Title strip */}
            <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-neutral-900 tracking-tight truncate">
                            {payload.title}
                        </h3>
                        {payload.summary && (
                            <p className="text-sm text-neutral-500 mt-0.5">{payload.summary}</p>
                        )}
                    </div>
                    {/* Preview / Code toggle */}
                    <div className="shrink-0 flex items-center bg-neutral-100 rounded-lg p-0.5 text-xs font-medium">
                        <button
                            type="button"
                            onClick={() => setMode('preview')}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
                                mode === 'preview'
                                    ? 'bg-white text-neutral-900 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                        >
                            <Eye size={12} />
                            Preview
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('code')}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
                                mode === 'code'
                                    ? 'bg-white text-neutral-900 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                        >
                            <Code2 size={12} />
                            Code
                        </button>
                    </div>
                </div>

                {/* Settings chips */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    <span className={SETTING_CHIP}>{settings.platform}</span>
                    <span className={SETTING_CHIP}>{settings.fidelity}-fi</span>
                    <span className={SETTING_CHIP}>{settings.scope.replace('_', ' ')}</span>
                    <StalenessBadge staleness={staleness} />
                    <span className="text-[10px] text-neutral-400 ml-auto">
                        v{versionNumber} · {new Date(createdAt).toLocaleDateString()}
                    </span>
                </div>
            </div>

            {/* Screen nav + open-in-tab */}
            <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-wrap">
                {hasMultiple ? (
                    <div className="flex items-center gap-1 flex-wrap">
                        {payload.screens.map((screen, idx) => {
                            const selected = idx === safeIdx;
                            return (
                                <button
                                    key={screen.id}
                                    type="button"
                                    onClick={() => setActiveIdx(idx)}
                                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                                        selected
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-medium'
                                            : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                                    }`}
                                >
                                    {idx + 1}. {screen.name}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-xs text-neutral-500 font-medium">{activeScreen.name}</div>
                )}
                <button
                    type="button"
                    onClick={openInNewTab}
                    className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 px-2 py-1 rounded-md hover:bg-neutral-50 transition"
                    title="Open this screen in a new tab"
                >
                    <ExternalLink size={12} />
                    Open
                </button>
            </div>

            {/* Preview / Code body */}
            <div className="px-5 pb-4">
                {mode === 'preview' ? (
                    <MockupHtmlPreview
                        key={activeScreen.id}
                        html={activeScreen.html}
                        platform={settings.platform}
                    />
                ) : (
                    <pre className="text-xs font-mono bg-neutral-900 text-neutral-100 rounded-lg p-4 overflow-auto max-h-[680px] whitespace-pre-wrap break-all">
                        {codeString}
                    </pre>
                )}
            </div>

            {/* Screen description + notes */}
            {(activeScreen.purpose || activeScreen.notes) && (
                <div className="px-5 pb-4 space-y-1.5">
                    {hasMultiple && (
                        <div className="text-xs font-semibold text-neutral-700">{activeScreen.name}</div>
                    )}
                    {activeScreen.purpose && (
                        <p className="text-sm text-neutral-600">{activeScreen.purpose}</p>
                    )}
                    {activeScreen.notes && (
                        <p className="text-xs text-neutral-500 italic">Note: {activeScreen.notes}</p>
                    )}
                </div>
            )}

            {/* Actions + provenance */}
            {actions && (
                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex items-center gap-2 flex-wrap">
                    {actions}
                </div>
            )}
            <div className="px-5 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">
                Generated from PRD {sourceSpineVersionId ?? 'unknown'} · v{versionNumber} · {new Date(createdAt).toLocaleString()}
            </div>
        </div>
    );
}
