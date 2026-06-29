import { useState } from 'react';
import type { MockupPayload, MockupSettings, StalenessState } from '../../types';
import { StalenessBadge } from '../StalenessBadge';
import { MockupScreenImage } from './MockupScreenImage';
import { MockupImageStatusChip } from './MockupImageStatusChip';

type Props = {
    payload: MockupPayload;
    settings: MockupSettings;
    staleness: StalenessState;
    versionNumber: number;
    createdAt: number;
    sourceSpineVersionId?: string;
    actions?: React.ReactNode;
    versionId?: string;
    projectId?: string;
    artifactId?: string;
};

const CHIP = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-neutral-200 bg-neutral-50 text-neutral-500 font-medium';

const FIDELITY_LABELS: Record<string, string> = {
    low: 'Wireframe', mid: 'Structured', high: 'Polished',
};
const SCOPE_LABELS: Record<string, string> = {
    single_screen: 'Single Screen', multi_screen: 'Multi-Screen', key_workflow: 'Key Workflow',
};

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MockupViewer({
    payload,
    settings,
    staleness,
    versionNumber,
    createdAt,
    sourceSpineVersionId,
    actions,
    versionId,
    projectId,
    artifactId,
}: Props) {
    const aiImageEnabled = !!(projectId && artifactId && versionId);
    const [activeIdx, setActiveIdx] = useState(0);

    const safeIdx = Math.min(activeIdx, Math.max(0, payload.screens.length - 1));
    const activeScreen = payload.screens[safeIdx];
    const hasMultiple = payload.screens.length > 1;

    if (!activeScreen) {
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500">
                This mockup version has no screens.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                <div className="min-w-0">
                    <h3 className="text-base font-bold text-neutral-900 tracking-tight truncate">
                        {payload.title}
                    </h3>
                    {payload.summary && (
                        <p className="text-sm text-neutral-500 mt-0.5 line-clamp-2">{payload.summary}</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    <span className={CHIP}>{settings.platform}</span>
                    <span className={CHIP}>{FIDELITY_LABELS[settings.fidelity] ?? settings.fidelity}</span>
                    <span className={CHIP}>{SCOPE_LABELS[settings.scope] ?? settings.scope}</span>
                    <StalenessBadge staleness={staleness} />
                    {versionId && <MockupImageStatusChip versionId={versionId} screens={payload.screens} />}
                    <span className="text-[10px] text-neutral-400 ml-auto tabular-nums">
                        v{versionNumber} · {formatDate(createdAt)}
                    </span>
                </div>
            </div>

            <div className="px-5 pt-3 pb-2 flex items-center gap-2 flex-wrap">
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
                                    {screen.name}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-xs text-neutral-500 font-medium">{activeScreen.name}</div>
                )}
            </div>

            <div className="px-5 pb-4">
                {aiImageEnabled && projectId && artifactId && versionId ? (
                    <MockupScreenImage
                        key={`${activeScreen.id}:img`}
                        projectId={projectId}
                        artifactId={artifactId}
                        versionId={versionId}
                        screen={activeScreen}
                        payload={payload}
                        settings={settings}
                    />
                ) : (
                    <div className="bg-white rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 text-center">
                        AI image preview is unavailable in this context.
                    </div>
                )}
            </div>

            {(activeScreen.purpose || activeScreen.userIntent || activeScreen.notes) && (
                <div className="px-5 pb-4 space-y-1">
                    {activeScreen.purpose && (
                        <p className="text-sm text-neutral-600">{activeScreen.purpose}</p>
                    )}
                    {activeScreen.userIntent && (
                        <p className="text-xs text-neutral-500 italic">User intent: {activeScreen.userIntent}</p>
                    )}
                    {activeScreen.notes && (
                        <p className="text-xs text-neutral-400 italic">{activeScreen.notes}</p>
                    )}
                </div>
            )}

            {(activeScreen.coreUIElements?.length || activeScreen.componentRefs?.length) && (
                <div className="px-5 pb-4 grid gap-3 md:grid-cols-2">
                    {activeScreen.coreUIElements && activeScreen.coreUIElements.length > 0 && (
                        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1">
                                Core UI elements
                            </p>
                            <ul className="text-xs text-neutral-700 space-y-0.5">
                                {activeScreen.coreUIElements.map((el, i) => (
                                    <li key={i}>· {el}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {activeScreen.componentRefs && activeScreen.componentRefs.length > 0 && (
                        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1">
                                Components used
                            </p>
                            <ul className="text-xs text-neutral-700 space-y-0.5">
                                {activeScreen.componentRefs.map((c, i) => (
                                    <li key={i} className="font-mono">· {c}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {actions && (
                <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex items-center gap-2 flex-wrap">
                    {actions}
                </div>
            )}
            <div className="px-5 py-2 text-[11px] text-neutral-400 border-t border-neutral-100 flex items-center gap-1.5">
                <span>v{versionNumber}</span>
                <span className="text-neutral-300">·</span>
                <span>{formatDate(createdAt)}</span>
                {sourceSpineVersionId && (
                    <>
                        <span className="text-neutral-300">·</span>
                        <span>PRD {sourceSpineVersionId.slice(0, 8)}</span>
                    </>
                )}
            </div>
        </div>
    );
}
