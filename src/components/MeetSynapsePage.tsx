import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Layout, Boxes, History, ArrowRight } from 'lucide-react';

const STAGES = [
    {
        icon: FileText,
        title: 'PRD Generation',
        description: 'Describe your product idea and Synapse generates a structured Product Requirements Document with features, user personas, architecture, and acceptance criteria.',
        color: 'text-indigo-400',
        bg: 'bg-indigo-500/10 border-indigo-500/20',
    },
    {
        icon: Layout,
        title: 'UI Mockups',
        description: 'Generate detailed UI mockups for mobile, desktop, or responsive layouts at varying fidelity levels. Compare versions side by side.',
        color: 'text-blue-400',
        bg: 'bg-blue-500/10 border-blue-500/20',
    },
    {
        icon: Boxes,
        title: 'Artifacts',
        description: 'Produce downstream artifacts: screen inventories, data models, component inventories, implementation plans, design systems, and more.',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
        icon: History,
        title: 'History & Iteration',
        description: 'Track every change with a full timeline. Branch from any section of your PRD, have AI conversations, and merge improvements back.',
        color: 'text-purple-400',
        bg: 'bg-purple-500/10 border-purple-500/20',
    },
];

export function MeetSynapsePage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col">
            {/* Header */}
            <div className="p-6">
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition"
                >
                    <ArrowLeft size={16} />
                    Back to home
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col items-center px-6 pb-16">
                <div className="max-w-2xl w-full">
                    {/* Title */}
                    <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
                        Meet Synapse
                    </h1>
                    <p className="text-lg text-neutral-400 text-center mb-12 max-w-lg mx-auto">
                        An AI-native product definition environment that transforms your ideas into complete product specifications.
                    </p>

                    {/* Pipeline visualization */}
                    <div className="space-y-4">
                        {STAGES.map((stage, i) => {
                            const Icon = stage.icon;
                            return (
                                <div key={stage.title} className="flex items-start gap-4">
                                    {/* Step indicator */}
                                    <div className="flex flex-col items-center shrink-0">
                                        <div className={`w-12 h-12 rounded-xl border ${stage.bg} flex items-center justify-center`}>
                                            <Icon size={22} className={stage.color} />
                                        </div>
                                        {i < STAGES.length - 1 && (
                                            <div className="w-px h-8 bg-neutral-700 mt-2" />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="pt-1">
                                        <h3 className={`text-lg font-semibold mb-1 ${stage.color}`}>
                                            {stage.title}
                                        </h3>
                                        <p className="text-sm text-neutral-400 leading-relaxed">
                                            {stage.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* How it works */}
                    <div className="mt-14 p-6 rounded-2xl border border-neutral-700/50 bg-neutral-800/30">
                        <h2 className="text-xl font-semibold mb-3">How it works</h2>
                        <ol className="space-y-3 text-sm text-neutral-400">
                            <li className="flex gap-3">
                                <span className="text-indigo-400 font-semibold shrink-0">1.</span>
                                <span>Describe your product idea in natural language — or upload an existing brief.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-indigo-400 font-semibold shrink-0">2.</span>
                                <span>Synapse generates a structured PRD with features, personas, and architecture.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-indigo-400 font-semibold shrink-0">3.</span>
                                <span>Highlight any section to branch off, discuss with AI, and merge improvements.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-indigo-400 font-semibold shrink-0">4.</span>
                                <span>Generate mockups, data models, screen inventories, and implementation plans.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="text-indigo-400 font-semibold shrink-0">5.</span>
                                <span>Export everything as markdown or JSON for your team.</span>
                            </li>
                        </ol>
                    </div>

                    {/* CTA */}
                    <div className="mt-10 text-center">
                        <button
                            onClick={() => navigate('/')}
                            className="inline-flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition font-medium"
                        >
                            Get Started
                            <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
