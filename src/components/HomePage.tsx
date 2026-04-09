import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { Settings, List, Plus, ArrowUp, Sparkles, X, Smartphone, Monitor } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { ProjectDrawer } from './ProjectDrawer';
import type { ProjectPlatform } from '../types';

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

const MEET_DISMISSED_KEY = 'synapse-meet-dismissed';

export function HomePage() {
    const { createProject } = useProjectStore();
    const navigate = useNavigate();

    const [projectName, setProjectName] = useState('');
    const [promptText, setPromptText] = useState('');
    const [platform, setPlatform] = useState<ProjectPlatform>('app');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [meetDismissed, setMeetDismissed] = useState(
        () => localStorage.getItem(MEET_DISMISSED_KEY) === 'true'
    );

    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleCreateProject = async () => {
        if (!projectName.trim() || !promptText.trim()) return;

        const apiKey = localStorage.getItem('GEMINI_API_KEY');
        if (!apiKey) { setIsSettingsOpen(true); return; }

        const { projectId, spineId } = createProject(projectName.trim(), promptText.trim(), platform);
        navigate(`/p/${projectId}`);

        import('../lib/llmProvider').then(({ generateStructuredPRD, structuredPRDToMarkdown }) => {
            generateStructuredPRD(promptText.trim(), undefined, platform)
                .then((structuredPRD) => {
                    const markdown = structuredPRDToMarkdown(structuredPRD);
                    useProjectStore.getState().updateSpineStructuredPRD(projectId, spineId, structuredPRD, markdown);
                })
                .catch((e) => {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    useProjectStore.getState().updateSpineText(
                        projectId, spineId,
                        `**Error generating PRD:**\n${errorMsg}\n\nPlease verify your API Key in Settings or check your network connection.`
                    );
                });
        }).catch((e) => {
            const errorMsg = e instanceof Error ? e.message : String(e);
            useProjectStore.getState().updateSpineText(
                projectId, spineId,
                `**Error loading generation module:**\n${errorMsg}\n\nPlease try refreshing the page.`
            );
        });
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
        } catch {
            // Silently fail — user can retry
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

    const dismissMeet = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMeetDismissed(true);
        localStorage.setItem(MEET_DISMISSED_KEY, 'true');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleCreateProject();
    };

    const canSubmit = projectName.trim() && promptText.trim();

    return (
        <div className="min-h-screen flex flex-col">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">Synapse</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-xl transition-all border border-white/5 hover:border-white/10"
                        title="Settings"
                    >
                        <Settings size={18} />
                    </button>
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
                    {/* Meet Synapse banner */}
                    {!meetDismissed && (
                        <div className="flex justify-center mb-8">
                            <div
                                onClick={() => navigate('/about')}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-sm text-indigo-300 hover:border-indigo-400/60 hover:text-indigo-200 cursor-pointer transition"
                            >
                                <span>Meet Synapse</span>
                                <button
                                    onClick={dismissMeet}
                                    className="p-0.5 hover:bg-white/10 rounded transition"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Hero title */}
                    <h2 className="text-4xl md:text-5xl font-bold text-center mb-8">
                        Welcome to Synapse..
                    </h2>

                    {/* Example prompt pills */}
                    <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
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
                                    className="w-full bg-transparent text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none"
                                    placeholder="Project name..."
                                />
                            </div>

                            {/* Divider */}
                            <div className="mx-5 my-2 border-t border-neutral-700/50" />

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
                                    {/* Enhance prompt */}
                                    <button
                                        type="button"
                                        onClick={handleEnhance}
                                        disabled={!promptText.trim() || isEnhancing}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Enhance prompt with AI"
                                    >
                                        <Sparkles size={14} className={isEnhancing ? 'animate-spin' : ''} />
                                        {isEnhancing ? 'Enhancing...' : 'Enhance'}
                                    </button>

                                    {/* Submit */}
                                    <button
                                        type="submit"
                                        disabled={!canSubmit}
                                        className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="Generate PRD"
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
            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            <ProjectDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
        </div>
    );
}
