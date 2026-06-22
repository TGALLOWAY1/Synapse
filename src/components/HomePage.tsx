import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { Settings, List, Plus, ArrowUp, Sparkles, Smartphone, Monitor, Loader2, Compass, LogOut } from 'lucide-react';
import type { AuthProvider } from '../lib/recruiterApi';
import { SettingsModal } from './SettingsModal';
import { ProjectDrawer } from './ProjectDrawer';
import { PreflightModeChoice } from './preflight/PreflightModeChoice';
import { runPrdGeneration } from '../lib/runPrdGeneration';
import { normalizeError } from '../lib/errors';
import type { ProjectPlatform, PreflightMode } from '../types';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { DEMO_PROJECT_ID } from '../data/demoProject';

// Human-readable name for the account's sign-in method (the header used to
// hardcode "via LinkedIn" regardless of the actual provider).
function providerLabel(provider: AuthProvider | undefined): string {
    switch (provider) {
        case 'github': return 'GitHub';
        case 'google': return 'Google';
        case 'linkedin': return 'LinkedIn';
        case 'email': return '';
        default: return '';
    }
}

const EXAMPLE_PROMPTS = [
    {
        label: 'Mobile marketplace for local artisans...',
        full: 'A mobile-friendly marketplace app for local artisans to sell handmade goods, with search filters, seller profiles, in-app messaging, and secure checkout with multiple payment options.',
        platform: 'app' as ProjectPlatform,
    },
    {
        label: 'A mood-based music playlist app...',
        full: 'A mood-based music playlist app that uses emotion detection from selfies and text input to generate personalized playlists. Includes social sharing, collaborative playlists, and integration with Spotify and Apple Music.',
        platform: 'app' as ProjectPlatform,
    },
    {
        label: 'Team project management dashboard...',
        full: 'A real-time project management dashboard for distributed teams with kanban boards, time tracking, resource allocation, sprint planning, and automated status reports with AI-generated insights.',
        platform: 'web' as ProjectPlatform,
    },
    {
        label: 'Fitness tracking with social features...',
        full: 'A fitness tracking app with workout logging, progress photos, social challenges, leaderboards, AI-powered form analysis from video, and personalized training programs.',
        platform: 'app' as ProjectPlatform,
    },
    {
        label: 'Recipe sharing community platform...',
        full: 'A recipe sharing platform where users can post, discover, and save recipes with smart grocery list generation, meal planning, nutritional breakdowns, and step-by-step cooking mode with timers.',
        platform: 'web' as ProjectPlatform,
    },
];

export function HomePage() {
    const { createProject, initPreflightSession, loadDemoProject } = useProjectStore();
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);

    const [isLoadingDemo, setIsLoadingDemo] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSignOut = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await logout();
            // On success the auth store clears `user`, and the app's HomeRoute
            // re-renders the LoginPage automatically — no manual navigation.
        } catch (err) {
            console.error('[handleSignOut] failed', err);
            useToastStore.getState().addToast({
                type: 'warning',
                title: 'Sign out failed',
                message: err instanceof Error ? err.message : 'Please try again.',
            });
            setIsSigningOut(false);
        }
    };

    const handleOpenDemo = async () => {
        if (isLoadingDemo) return;
        setIsLoadingDemo(true);
        try {
            const { available } = await loadDemoProject();
            if (!available) {
                useToastStore.getState().addToast({
                    type: 'warning',
                    title: 'Demo not available yet',
                    message: 'No demo snapshot has been pinned. The Synapse owner can pin one from the Cloud Snapshots panel.',
                });
                return;
            }
            navigate(`/p/${DEMO_PROJECT_ID}`);
        } catch (err) {
            console.error('[handleOpenDemo] failed', err);
            useToastStore.getState().addToast({
                type: 'warning',
                title: 'Could not load demo',
                message: err instanceof Error ? err.message : 'Unknown error',
            });
        } finally {
            setIsLoadingDemo(false);
        }
    };

    const [projectName, setProjectName] = useState('');
    const [promptText, setPromptText] = useState('');
    const [platform, setPlatform] = useState<ProjectPlatform>('app');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [isChoosingMode, setIsChoosingMode] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Step 1: validate input + API key, then present the start-mode choice.
    const handleCreateProject = () => {
        if (!projectName.trim() || !promptText.trim()) return;

        const apiKey = localStorage.getItem('GEMINI_API_KEY');
        if (!apiKey) { setIsSettingsOpen(true); return; }

        setIsChoosingMode(true);
    };

    // Step 2a: Generate Immediately — existing behavior, unchanged flow.
    const startImmediateGeneration = () => {
        const sourcePrompt = promptText.trim();
        const { projectId, spineId } = createProject(projectName.trim(), sourcePrompt, platform);
        navigate(`/p/${projectId}`);
        void runPrdGeneration({ projectId, spineId, sourcePrompt, platform });
    };

    // Step 2b: Quick/Deep — seed a preflight session and hand off to the
    // workspace clarification flow. No PRD is generated yet.
    const startPreflight = (mode: 'quick' | 'deep') => {
        const sourcePrompt = promptText.trim();
        const { projectId, spineId } = createProject(projectName.trim(), sourcePrompt, platform);
        initPreflightSession(projectId, spineId, mode, sourcePrompt);
        navigate(`/p/${projectId}`);
    };

    const handleChooseMode = (mode: PreflightMode) => {
        setIsChoosingMode(false);
        if (mode === 'none') startImmediateGeneration();
        else startPreflight(mode);
    };

    const handleEnhance = async () => {
        if (!promptText.trim() || isEnhancing) return;

        const apiKey = localStorage.getItem('GEMINI_API_KEY');
        if (!apiKey) { setIsSettingsOpen(true); return; }

        setIsEnhancing(true);
        try {
            const { enhancePrompt } = await import('../lib/llmProvider');
            const enhanced = await enhancePrompt(promptText.trim());
            setPromptText(enhanced);
        } catch (e) {
            const err = normalizeError(e);
            console.error('[Enhance prompt failed]', err.raw);
            // Toast integration added in Phase 5 — for now uses toastStore directly
            import('../store/toastStore').then(({ useToastStore }) => {
                useToastStore.getState().addToast({
                    type: 'warning',
                    title: 'Prompt enhancement failed',
                    message: 'Your original prompt was kept.',
                });
            }).catch(() => { /* toast store not yet available */ });
        } finally {
            setIsEnhancing(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setPromptText((prev) => prev ? `${prev}\n\n${content}` : content);
        };
        reader.readAsText(file);

        // Reset so the same file can be re-uploaded
        e.target.value = '';
    };

    const handleExampleClick = (example: typeof EXAMPLE_PROMPTS[number]) => {
        setPromptText(example.full);
        setPlatform(example.platform);
        textareaRef.current?.focus();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleCreateProject();
    };

    const canSubmit = projectName.trim() && promptText.trim();
    const needsProjectName = promptText.trim() && !projectName.trim();
    const submitTitle = !promptText.trim()
        ? 'Enter a prompt to generate a PRD'
        : !projectName.trim()
            ? 'Enter a project name to continue'
            : 'Generate PRD';

    return (
        <div className="min-h-screen flex flex-col">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">Synapse</h1>
                </div>
                <div className="flex items-center gap-2">
                    {user && (
                        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-sm">
                            Signed in as {user.name}{providerLabel(user.authProvider) ? ` via ${providerLabel(user.authProvider)}` : ''}
                        </div>
                    )}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-white/5 hover:border-white/10"
                        title="Settings"
                    >
                        <Settings size={18} />
                    </button>
                    {user && (
                        <button
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            className="p-2.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-white/5 hover:border-white/10 disabled:opacity-60 disabled:cursor-wait"
                            title="Sign out"
                        >
                            {isSigningOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
                        </button>
                    )}
                    <button
                        onClick={() => setIsDrawerOpen(true)}
                        className="p-2.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-white/5 hover:border-white/10"
                        title="Projects"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            {/* Main content — vertically centered */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12 -mt-8">
                <div className="w-full max-w-2xl">
                    {/* Take the interactive tour */}
                    <div className="flex justify-center mb-8">
                        <button
                            type="button"
                            onClick={() => navigate('/tour')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-sm text-indigo-300 hover:border-indigo-400/60 hover:text-indigo-200 cursor-pointer transition"
                        >
                            <Compass size={14} />
                            <span>Take the tour</span>
                        </button>
                    </div>

                    {/* Hero title */}
                    <h2 className="text-4xl md:text-5xl font-bold text-center mb-8">
                        Welcome to Synapse
                    </h2>

                    {/* Example prompt pills */}
                    <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
                        <button
                            type="button"
                            onClick={handleOpenDemo}
                            disabled={isLoadingDemo}
                            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-sm text-indigo-300 hover:border-indigo-400/60 hover:text-indigo-200 transition whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
                            title="Open the prepopulated demo project — no API key required"
                        >
                            {isLoadingDemo && <Loader2 size={14} className="animate-spin" />}
                            {isLoadingDemo ? 'Loading demo…' : 'View demo project'}
                        </button>
                        {EXAMPLE_PROMPTS.map((example) => (
                            <button
                                key={example.label}
                                onClick={() => handleExampleClick(example)}
                                className="shrink-0 px-4 py-2 rounded-full border border-neutral-600 bg-neutral-800/40 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white transition whitespace-nowrap"
                            >
                                {example.label}
                            </button>
                        ))}
                    </div>

                    {/* Prompt card */}
                    <form onSubmit={handleSubmit}>
                        <div className="rounded-2xl border border-neutral-700 bg-neutral-800/50 overflow-hidden">
                            {/* Project name */}
                            <div className="px-5 pt-4">
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    className={`w-full bg-transparent text-sm text-neutral-300 focus:outline-none ${
                                        needsProjectName
                                            ? 'placeholder-amber-400/80'
                                            : 'placeholder-neutral-600'
                                    }`}
                                    placeholder={
                                        needsProjectName
                                            ? 'Project name required to continue...'
                                            : 'Project name...'
                                    }
                                    aria-required="true"
                                    aria-invalid={needsProjectName ? 'true' : 'false'}
                                />
                            </div>

                            {/* Divider */}
                            <div
                                className={`mx-5 my-2 border-t transition-colors ${
                                    needsProjectName ? 'border-amber-500/40' : 'border-neutral-700/50'
                                }`}
                            />

                            {/* Textarea */}
                            <div className="px-5">
                                <textarea
                                    ref={textareaRef}
                                    value={promptText}
                                    onChange={(e) => setPromptText(e.target.value)}
                                    className="w-full bg-transparent text-neutral-100 placeholder-neutral-500 focus:outline-none resize-none min-h-[160px] text-[15px] leading-relaxed"
                                    placeholder="What product shall we design?"
                                    rows={6}
                                />
                            </div>

                            {/* Bottom toolbar */}
                            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-700/50">
                                <div className="flex items-center gap-2">
                                    {/* File upload */}
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".md,.txt,.markdown"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="p-2 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                                        title="Upload .md or .txt file"
                                    >
                                        <Plus size={18} />
                                    </button>

                                    {/* Platform toggle */}
                                    <div className="flex items-center bg-neutral-700/40 rounded-lg p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setPlatform('app')}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition ${
                                                platform === 'app'
                                                    ? 'bg-neutral-600 text-white'
                                                    : 'text-neutral-400 hover:text-neutral-200'
                                            }`}
                                        >
                                            <Smartphone size={14} />
                                            App
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPlatform('web')}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition ${
                                                platform === 'web'
                                                    ? 'bg-neutral-600 text-white'
                                                    : 'text-neutral-400 hover:text-neutral-200'
                                            }`}
                                        >
                                            <Monitor size={14} />
                                            Web
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Inline hint when prompt is ready but name is missing */}
                                    {needsProjectName && (
                                        <span className="text-xs text-amber-400/90 hidden sm:inline">
                                            Add a project name to continue
                                        </span>
                                    )}

                                    {/* Enhance prompt */}
                                    <button
                                        type="button"
                                        onClick={handleEnhance}
                                        disabled={!promptText.trim() || isEnhancing}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Enhance prompt with AI"
                                    >
                                        {isEnhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                        {isEnhancing ? 'Enhancing...' : 'Enhance'}
                                    </button>

                                    {/* Submit */}
                                    <button
                                        type="submit"
                                        disabled={!canSubmit}
                                        className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-30 disabled:cursor-not-allowed"
                                        title={submitTitle}
                                        aria-label={submitTitle}
                                    >
                                        <ArrowUp size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            {/* Modals & Drawers */}
            {isChoosingMode && (
                <PreflightModeChoice
                    onChoose={handleChooseMode}
                    onClose={() => setIsChoosingMode(false)}
                />
            )}
            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            <ProjectDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
        </div>
    );
}
