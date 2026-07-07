import { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { getLegacyImportOffer, declineLegacyImport, importLegacyProjects } from '../store/projectUserSync';
import { refreshProjectsFromServer } from '../store/projectServerSync';
import { Settings, List, Plus, ArrowUp, Sparkles, Smartphone, Monitor, Loader2, Compass, LogOut, Download, X, FolderOpen, FileText } from 'lucide-react';
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
import { hasGeminiKey, primeGeminiKey } from '../lib/geminiKeyVault';

// Advisory soft cap for the idea prompt. There is no hard *technical* limit:
// PRD generation runs client-side straight to Gemini, whose context window
// (~1M tokens) is orders of magnitude larger than anything typed here. The cap
// is a cost/quality guard — the idea is injected into every PRD section prompt,
// so we warn as the user nears the soft threshold and block submit only at a
// deliberately generous hard limit (well above a detailed brief or an uploaded
// .md/.txt file) to stop pathological pastes. Tune freely.
const PROMPT_WARN_THRESHOLD = 8000;
const PROMPT_MAX_LENGTH = 50000;

// Human-readable name for the account's sign-in method (the header used to
// hardcode "via LinkedIn" regardless of the actual provider).
function providerLabel(provider: AuthProvider | undefined): string {
    switch (provider) {
        case 'github': return 'GitHub';
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

    // Offer to import projects created on this browser before the user signed
    // in. Computed from localStorage (keyed on the user) — there is no silent
    // adoption, so a different account never inherits these without a click.
    const legacyOffer = useMemo(
        () => (user?.userId ? getLegacyImportOffer(user.userId) : { available: false, projectCount: 0 }),
        [user?.userId],
    );
    const [importHandled, setImportHandled] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const showImportBanner = legacyOffer.available && !importHandled;

    const handleImportLegacy = () => {
        if (!user?.userId || isImporting) return;
        setIsImporting(true);
        try {
            const ok = importLegacyProjects(user.userId);
            setImportHandled(true);
            // Push the freshly-imported local projects to the server so they're
            // available on the user's other devices. Reconcile is idempotent and
            // non-destructive — a failure leaves the local copies untouched.
            if (ok) refreshProjectsFromServer();
            useToastStore.getState().addToast({
                type: ok ? 'success' : 'warning',
                title: ok ? 'Projects imported' : 'Nothing to import',
                message: ok
                    ? `${legacyOffer.projectCount} project${legacyOffer.projectCount === 1 ? '' : 's'} added to your account and syncing to your other devices.`
                    : 'These projects may have already been imported by another account on this browser.',
            });
        } finally {
            setIsImporting(false);
        }
    };

    const handleDismissImport = () => {
        if (user?.userId) declineLegacyImport(user.userId);
        setImportHandled(true);
    };

    // Surface the result of an account-link OAuth round-trip (the user returns
    // here signed in, so LoginPage's ?auth_error handler never sees it).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const linked = params.get('auth') === 'linked';
        const linkError = params.get('auth_error');
        const isLinkError = linkError && linkError.includes('link');
        if (!linked && !isLinkError) return;
        useToastStore.getState().addToast(
            linked
                ? {
                    type: 'success',
                    title: 'Sign-in method connected',
                    message: 'Your accounts are now linked. Any projects from the other sign-in method have been merged in.',
                }
                : {
                    type: 'warning',
                    title: 'Could not connect that sign-in method',
                    message: 'Please try again from Settings → Connected sign-in methods.',
                },
        );
        params.delete('auth');
        params.delete('auth_error');
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }, []);

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
    const [showUploadMenu, setShowUploadMenu] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const uploadMenuRef = useRef<HTMLDivElement>(null);

    // Close the upload menu on an outside click.
    useEffect(() => {
        if (!showUploadMenu) return;
        const handleClick = (e: MouseEvent) => {
            if (!uploadMenuRef.current?.contains(e.target as Node)) {
                setShowUploadMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showUploadMenu]);

    // Step 1: validate input + API key, then present the start-mode choice.
    const handleCreateProject = async () => {
        if (!projectName.trim() || !promptText.trim()) return;
        if (promptText.length > PROMPT_MAX_LENGTH) return;

        // The Gemini key may live in the encrypted server vault (held only in
        // memory) or the legacy localStorage fallback — mirror geminiClient's
        // resolution. If the vault hasn't finished priming yet, try once before
        // bouncing a configured user to Settings. (The old code checked
        // localStorage only, which wrongly routed every vault-only user to
        // Settings even though generation would have worked.)
        if (!hasGeminiKey()) {
            await primeGeminiKey();
            if (!hasGeminiKey()) { setIsSettingsOpen(true); return; }
        }

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

        if (!hasGeminiKey()) {
            await primeGeminiKey();
            if (!hasGeminiKey()) { setIsSettingsOpen(true); return; }
        }

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
        void handleCreateProject();
    };

    const promptLength = promptText.length;
    const isOverPromptLimit = promptLength > PROMPT_MAX_LENGTH;
    const isApproachingLimit = promptLength >= PROMPT_WARN_THRESHOLD;

    const canSubmit = projectName.trim() && promptText.trim() && !isOverPromptLimit;
    const needsProjectName = promptText.trim() && !projectName.trim();
    const submitTitle = !promptText.trim()
        ? 'Enter a prompt to generate a PRD'
        : isOverPromptLimit
            ? `Prompt is over the ${PROMPT_MAX_LENGTH.toLocaleString()}-character limit`
            : !projectName.trim()
                ? 'Enter a project name to continue'
                : 'Generate PRD';

    return (
        <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">Synapse</h1>
                </div>
                <div className="flex items-center gap-2">
                    {user && (
                        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-700 text-sm">
                            Signed in as {user.name}{providerLabel(user.authProvider) ? ` via ${providerLabel(user.authProvider)}` : ''}
                        </div>
                    )}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-xl transition-all border border-neutral-200 hover:border-neutral-300"
                        title="Settings"
                    >
                        <Settings size={18} />
                    </button>
                    {user && (
                        <button
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            className="p-2.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-xl transition-all border border-neutral-200 hover:border-neutral-300 disabled:opacity-60 disabled:cursor-wait"
                            title="Sign out"
                        >
                            {isSigningOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
                        </button>
                    )}
                    <button
                        onClick={() => setIsDrawerOpen(true)}
                        className="p-2.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-xl transition-all border border-neutral-200 hover:border-neutral-300"
                        title="Projects"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            {/* Pre-sign-in project import offer (explicit opt-in — never silent) */}
            {showImportBanner && (
                <div className="px-6">
                    <div className="mx-auto max-w-2xl flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                        <Download size={18} className="mt-0.5 shrink-0 text-indigo-500" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-indigo-900">
                                We found {legacyOffer.projectCount} project{legacyOffer.projectCount === 1 ? '' : 's'} saved
                                on this browser that {legacyOffer.projectCount === 1 ? "isn't" : "aren't"} linked to your
                                account yet. Recover {legacyOffer.projectCount === 1 ? 'it' : 'them'} into your account?
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleImportLegacy}
                                    disabled={isImporting}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-wait"
                                >
                                    {isImporting && <Loader2 size={14} className="animate-spin" />}
                                    {isImporting ? 'Importing…' : 'Import projects'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDismissImport}
                                    className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/70 transition"
                                >
                                    Not mine
                                </button>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleDismissImport}
                            className="p-1 text-neutral-400 hover:text-neutral-700 rounded-lg transition"
                            title="Dismiss"
                            aria-label="Dismiss"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Main content — vertically centered */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12 -mt-8">
                <div className="w-full max-w-2xl">
                    {/* Take the interactive tour + View demo project — inline pills */}
                    <div className="flex flex-wrap justify-center items-center gap-2 mb-8">
                        <button
                            type="button"
                            onClick={() => navigate('/tour')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-300 bg-indigo-50 text-sm text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100 cursor-pointer transition"
                        >
                            <Compass size={14} />
                            <span>Take the tour</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenDemo}
                            disabled={isLoadingDemo}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-300 bg-indigo-50 text-sm text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100 transition disabled:opacity-60 disabled:cursor-wait"
                            title="Open the prepopulated demo project — no API key required"
                        >
                            {isLoadingDemo ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                            <span>{isLoadingDemo ? 'Loading demo…' : 'View demo project'}</span>
                        </button>
                    </div>

                    {/* Hero title */}
                    <h2 className="text-4xl md:text-5xl font-bold text-center mb-8">
                        Welcome to Synapse
                    </h2>

                    {/* Example prompt pills */}
                    <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
                        {EXAMPLE_PROMPTS.map((example) => (
                            <button
                                key={example.label}
                                onClick={() => handleExampleClick(example)}
                                className="shrink-0 px-4 py-2 rounded-full border border-neutral-300 bg-white text-sm text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition whitespace-nowrap"
                            >
                                {example.label}
                            </button>
                        ))}
                    </div>

                    {/* Prompt card */}
                    <form onSubmit={handleSubmit}>
                        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                            {/* Project name */}
                            <div className="px-5 pt-4">
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    className={`w-full bg-transparent text-sm text-neutral-900 focus:outline-none ${
                                        needsProjectName
                                            ? 'placeholder-amber-500'
                                            : 'placeholder-neutral-400'
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
                                    needsProjectName ? 'border-amber-400/60' : 'border-neutral-200'
                                }`}
                            />

                            {/* Textarea */}
                            <div className="px-5">
                                <textarea
                                    ref={textareaRef}
                                    value={promptText}
                                    onChange={(e) => setPromptText(e.target.value)}
                                    className="w-full bg-transparent text-neutral-900 placeholder-neutral-400 focus:outline-none resize-none min-h-[160px] text-[15px] leading-relaxed"
                                    placeholder="What product shall we design?"
                                    rows={6}
                                    aria-describedby="prompt-char-counter"
                                />
                            </div>

                            {/* Character counter — advisory. The soft threshold is a cost
                                nudge (the idea is injected into every PRD section), distinct
                                from the generous hard limit that blocks submission. */}
                            {promptLength > 0 && (
                                <div className="px-5 pb-1 flex items-center justify-between gap-3">
                                    <span
                                        className={`text-xs ${isOverPromptLimit ? 'text-red-500' : 'text-amber-600'}`}
                                    >
                                        {isOverPromptLimit
                                            ? `Over the ${PROMPT_MAX_LENGTH.toLocaleString()}-character limit — shorten your prompt to continue.`
                                            : isApproachingLimit
                                                ? 'Long prompt — it’s added to every section, which raises cost.'
                                                : ''}
                                    </span>
                                    <span
                                        id="prompt-char-counter"
                                        aria-live="polite"
                                        className={`text-xs tabular-nums shrink-0 ${
                                            isOverPromptLimit
                                                ? 'text-red-500'
                                                : isApproachingLimit
                                                    ? 'text-amber-500'
                                                    : 'text-neutral-400'
                                        }`}
                                    >
                                        {isApproachingLimit
                                            ? `${promptLength.toLocaleString()} / ${PROMPT_MAX_LENGTH.toLocaleString()}`
                                            : `${promptLength.toLocaleString()} characters`}
                                    </span>
                                </div>
                            )}

                            {/* Bottom toolbar */}
                            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200">
                                <div className="flex items-center gap-2">
                                    {/* File upload */}
                                    <div className="relative" ref={uploadMenuRef}>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".md,.txt,.markdown"
                                            onChange={handleFileUpload}
                                            className="hidden"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowUploadMenu((v) => !v)}
                                            className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-lg transition"
                                            title="Attach a file"
                                            aria-haspopup="menu"
                                            aria-expanded={showUploadMenu}
                                        >
                                            <Plus size={18} />
                                        </button>
                                        {showUploadMenu && (
                                            <div
                                                role="menu"
                                                className="absolute bottom-full left-0 mb-2 w-60 rounded-xl border border-neutral-200 bg-white shadow-lg py-1.5 z-20"
                                            >
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        setShowUploadMenu(false);
                                                        fileInputRef.current?.click();
                                                    }}
                                                    className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-neutral-50 transition rounded-lg"
                                                >
                                                    <FileText size={16} className="mt-0.5 text-neutral-500 shrink-0" />
                                                    <span>
                                                        <span className="block text-sm text-neutral-900">Add text file</span>
                                                        <span className="block text-xs text-neutral-400">Markdown or text files (.md, .txt)</span>
                                                    </span>
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Platform toggle */}
                                    <div className="flex items-center bg-neutral-100 rounded-lg p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setPlatform('app')}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition ${
                                                platform === 'app'
                                                    ? 'bg-white text-neutral-900 shadow-sm'
                                                    : 'text-neutral-500 hover:text-neutral-800'
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
                                                    ? 'bg-white text-neutral-900 shadow-sm'
                                                    : 'text-neutral-500 hover:text-neutral-800'
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
                                        <span className="text-xs text-amber-600 hidden sm:inline">
                                            Add a project name to continue
                                        </span>
                                    )}

                                    {/* Enhance prompt */}
                                    <button
                                        type="button"
                                        onClick={handleEnhance}
                                        disabled={!promptText.trim() || isEnhancing}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
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
