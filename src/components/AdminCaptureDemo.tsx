/**
 * Dev-only capture helper: runs the full Synapse pipeline end-to-end using the
 * caller's own Gemini key (already stored in localStorage) and downloads a
 * freshly serialized `demoProject.ts` containing the result.
 *
 * The produced file replaces `src/data/demoProject.ts` and is committed. At
 * runtime, `loadDemoProject()` hydrates the store from that fixture so any
 * visitor can view a finished project without providing their own key.
 *
 * This route is tree-shaken out of production builds via the
 * `import.meta.env.DEV` guard in App.tsx.
 */

import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Loader2, ChevronLeft, Download } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { generateStructuredPRD, structuredPRDToMarkdown, generateMockup, generateCoreArtifact } from '../lib/llmProvider';
import { MOCKUP_HTML_V1, type MockupSettings } from '../types';
import { CORE_ARTIFACT_PIPELINE, getArtifactMeta } from '../lib/coreArtifactPipeline';
import { DEMO_PROJECT_ID } from '../data/demoProject';
import type { StructuredPRD } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Fitness-tracker prompt used as the demo seed. Matches the shape of the
// existing EXAMPLE_PROMPTS entry in HomePage so users recognize it.
const DEMO_PROMPT =
    'A fitness tracking app with workout logging, progress photos, social challenges, leaderboards, AI-powered form analysis from video, and personalized training programs.';
const DEMO_PROJECT_NAME = 'Demo: Fitness tracker';
const DEMO_PLATFORM = 'app' as const;

type Step = {
    label: string;
    status: 'pending' | 'running' | 'done' | 'error';
    detail?: string;
};

const INITIAL_STEPS: Step[] = [
    { label: 'Generate structured PRD', status: 'pending' },
    { label: 'Mark PRD as final', status: 'pending' },
    { label: 'Generate mockup (mobile / key workflow)', status: 'pending' },
    ...CORE_ARTIFACT_PIPELINE.map((m) => ({
        label: `Generate ${m.title}`,
        status: 'pending' as const,
    })),
    { label: 'Serialize + download fixture', status: 'pending' },
];

export function AdminCaptureDemo() {
    const navigate = useNavigate();
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
    const [downloadReady, setDownloadReady] = useState(false);

    const patchStep = (index: number, patch: Partial<Step>) => {
        setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    };

    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;

    const run = async () => {
        if (!apiKey) {
            setError('No Gemini API key found in localStorage. Open Settings on the home page and add one before running capture.');
            return;
        }

        setRunning(true);
        setError(null);
        setDownloadReady(false);
        setSteps(INITIAL_STEPS.map((s) => ({ ...s })));

        const store = useProjectStore.getState();

        // Clean any prior demo project in the store so we start from zero.
        store.deleteProject(DEMO_PROJECT_ID);

        // 1) create project + generate PRD
        let projectId: string;
        let spineId: string;
        let structuredPRD: StructuredPRD;
        try {
            patchStep(0, { status: 'running' });
            const result = store.createProject(DEMO_PROJECT_NAME, DEMO_PROMPT, DEMO_PLATFORM);
            projectId = result.projectId;
            spineId = result.spineId;
            structuredPRD = await generateStructuredPRD(DEMO_PROMPT, undefined, DEMO_PLATFORM);
            const prdMarkdown = structuredPRDToMarkdown(structuredPRD);
            useProjectStore.getState().updateSpineStructuredPRD(projectId, spineId, structuredPRD, prdMarkdown);
            patchStep(0, { status: 'done' });
        } catch (e) {
            patchStep(0, { status: 'error', detail: e instanceof Error ? e.message : String(e) });
            setError('PRD generation failed. See console for details.');
            console.error(e);
            setRunning(false);
            return;
        }

        // 2) mark final
        try {
            patchStep(1, { status: 'running' });
            useProjectStore.getState().markSpineFinal(projectId, spineId, true);
            patchStep(1, { status: 'done' });
        } catch (e) {
            patchStep(1, { status: 'error', detail: e instanceof Error ? e.message : String(e) });
            setRunning(false);
            return;
        }

        const prdContent = structuredPRDToMarkdown(structuredPRD);

        // 3) mockup
        try {
            patchStep(2, { status: 'running' });
            const settings: MockupSettings = {
                platform: 'mobile',
                fidelity: 'mid',
                scope: 'key_workflow',
            };
            const { payload } = await generateMockup(prdContent, settings, structuredPRD);
            const { artifactId: mockupArtifactId } = useProjectStore
                .getState()
                .createArtifact(projectId, 'mockup', payload.title?.trim() || 'Fitness Tracker Workflow');
            useProjectStore.getState().createArtifactVersion(
                projectId,
                mockupArtifactId,
                JSON.stringify(payload),
                { settings, format: MOCKUP_HTML_V1 },
                [
                    {
                        id: uuidv4(),
                        sourceArtifactId: projectId,
                        sourceArtifactVersionId: spineId,
                        sourceType: 'spine',
                    },
                ],
                `Generate ${settings.fidelity} ${settings.platform} mockup for ${settings.scope.replace('_', ' ')}`,
            );
            patchStep(2, { status: 'done' });
        } catch (e) {
            patchStep(2, { status: 'error', detail: e instanceof Error ? e.message : String(e) });
            setError('Mockup generation failed.');
            console.error(e);
            setRunning(false);
            return;
        }

        // 4) 7 core artifacts, in dependency-valid order
        const generatedArtifacts: Record<string, string> = {};
        for (let i = 0; i < CORE_ARTIFACT_PIPELINE.length; i++) {
            const meta = CORE_ARTIFACT_PIPELINE[i];
            const stepIndex = 3 + i;
            try {
                patchStep(stepIndex, { status: 'running' });
                const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD, {
                    generatedArtifacts,
                });
                generatedArtifacts[meta.subtype] = content;
                const { artifactId } = useProjectStore
                    .getState()
                    .createArtifact(projectId, 'core_artifact', getArtifactMeta(meta.subtype).title, meta.subtype);
                useProjectStore.getState().createArtifactVersion(
                    projectId,
                    artifactId,
                    content,
                    { subtype: meta.subtype },
                    [
                        {
                            id: uuidv4(),
                            sourceArtifactId: projectId,
                            sourceArtifactVersionId: spineId,
                            sourceType: 'spine',
                        },
                    ],
                    `Generate ${getArtifactMeta(meta.subtype).title} from PRD`,
                );
                patchStep(stepIndex, { status: 'done' });
            } catch (e) {
                patchStep(stepIndex, {
                    status: 'error',
                    detail: e instanceof Error ? e.message : String(e),
                });
                setError(`Core artifact ${meta.subtype} failed.`);
                console.error(e);
                setRunning(false);
                return;
            }
        }

        // 5) serialize + download
        const serializeStep = 3 + CORE_ARTIFACT_PIPELINE.length;
        try {
            patchStep(serializeStep, { status: 'running' });
            const state = useProjectStore.getState();
            const fileContent = buildFixtureFile({
                projectId,
                spineId,
                project: state.projects[projectId]!,
                spineVersions: state.spineVersions[projectId] ?? [],
                artifacts: state.artifacts[projectId] ?? [],
                artifactVersions: state.artifactVersions[projectId] ?? [],
                historyEvents: state.historyEvents[projectId] ?? [],
            });
            triggerDownload('demoProject.ts', fileContent);
            patchStep(serializeStep, { status: 'done' });
            setDownloadReady(true);
        } catch (e) {
            patchStep(serializeStep, {
                status: 'error',
                detail: e instanceof Error ? e.message : String(e),
            });
            setError('Serialization failed.');
            console.error(e);
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-10">
            <div className="max-w-2xl mx-auto">
                <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-white mb-6"
                >
                    <ChevronLeft size={16} /> Back
                </button>

                <h1 className="text-2xl font-bold mb-1">Capture demo project</h1>
                <p className="text-sm text-neutral-400 mb-6">
                    Runs the full pipeline (PRD → mockup → 7 core artifacts) using your current Gemini API key,
                    then downloads a <code className="text-xs">demoProject.ts</code> fixture file. Move the downloaded
                    file to <code className="text-xs">src/data/demoProject.ts</code> and commit it.
                </p>

                {!apiKey && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 mb-4">
                        No Gemini API key found. Add one in Settings on the home page before running.
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
                        {error}
                    </div>
                )}

                <button
                    onClick={run}
                    disabled={running || !apiKey}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-white transition"
                >
                    {running && <Loader2 size={16} className="animate-spin" />}
                    {running ? 'Capturing...' : 'Generate demo project'}
                </button>

                {downloadReady && (
                    <div className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-300">
                        <Download size={14} /> Fixture downloaded — move it to <code className="text-xs">src/data/demoProject.ts</code>.
                    </div>
                )}

                <ol className="mt-8 space-y-2">
                    {steps.map((s, i) => (
                        <li
                            key={i}
                            className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm"
                        >
                            <span className={`mt-0.5 inline-block h-2 w-2 rounded-full shrink-0 ${
                                s.status === 'done'
                                    ? 'bg-emerald-400'
                                    : s.status === 'running'
                                        ? 'bg-indigo-400 animate-pulse'
                                        : s.status === 'error'
                                            ? 'bg-red-400'
                                            : 'bg-neutral-600'
                            }`} />
                            <div className="min-w-0">
                                <div className="text-neutral-200">{s.label}</div>
                                {s.detail && <div className="text-xs text-neutral-500 mt-0.5 break-words">{s.detail}</div>}
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}

// ---- Serialization helpers ----

function triggerDownload(filename: string, contents: string) {
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

interface CaptureSource {
    projectId: string;
    spineId: string;
    project: import('../types').Project;
    spineVersions: import('../types').SpineVersion[];
    artifacts: import('../types').Artifact[];
    artifactVersions: import('../types').ArtifactVersion[];
    historyEvents: import('../types').HistoryEvent[];
}

/**
 * Rewrite every reference to the freshly-created projectId so it points at the
 * stable DEMO_PROJECT_ID. This keeps the fixture deterministic across
 * re-captures and lets `loadDemoProject()` key on a stable id.
 */
function rewriteIds<T>(value: T, fromProjectId: string): T {
    if (Array.isArray(value)) {
        return value.map((v) => rewriteIds(v, fromProjectId)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (typeof v === 'string' && v === fromProjectId) {
                out[k] = DEMO_PROJECT_ID;
            } else {
                out[k] = rewriteIds(v, fromProjectId);
            }
        }
        return out as T;
    }
    if (typeof value === 'string' && value === fromProjectId) {
        return DEMO_PROJECT_ID as unknown as T;
    }
    return value;
}

function buildFixtureFile(src: CaptureSource): string {
    const projectRewritten = rewriteIds({ ...src.project, id: DEMO_PROJECT_ID, createdAt: 0, currentStage: 'artifacts' as const }, src.projectId);
    const spinesRewritten = src.spineVersions.map((s) =>
        rewriteIds({ ...s, projectId: DEMO_PROJECT_ID, createdAt: 0 }, src.projectId),
    );
    const artifactsRewritten = src.artifacts.map((a) =>
        rewriteIds({ ...a, projectId: DEMO_PROJECT_ID, createdAt: 0, updatedAt: 0 }, src.projectId),
    );
    const versionsRewritten = src.artifactVersions.map((v) =>
        rewriteIds({ ...v, createdAt: 0 }, src.projectId),
    );
    const historyRewritten = src.historyEvents.map((h) =>
        rewriteIds({ ...h, projectId: DEMO_PROJECT_ID, createdAt: 0 }, src.projectId),
    );

    return `/**
 * Static demo-project fixture.
 *
 * Auto-generated by the /admin/capture-demo helper. Do not hand-edit unless
 * you know what you're doing — regenerate via the helper instead.
 *
 * The fixture hydrates a finished Synapse project ("Demo: Fitness tracker")
 * so visitors can explore the end-to-end pipeline without a Gemini API key.
 */

import type {
    Project,
    SpineVersion,
    Artifact,
    ArtifactVersion,
    HistoryEvent,
} from '../types';

export const DEMO_PROJECT_ID = ${JSON.stringify(DEMO_PROJECT_ID)};

export const DEMO_PROJECT_CAPTURED = true;

export const demoProject: Project = ${JSON.stringify(projectRewritten, null, 4)};

export const demoSpineVersions: SpineVersion[] = ${JSON.stringify(spinesRewritten, null, 4)};

export const demoArtifacts: Artifact[] = ${JSON.stringify(artifactsRewritten, null, 4)};

export const demoArtifactVersions: ArtifactVersion[] = ${JSON.stringify(versionsRewritten, null, 4)};

export const demoHistoryEvents: HistoryEvent[] = ${JSON.stringify(historyRewritten, null, 4)};
`;
}
