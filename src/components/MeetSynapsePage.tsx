import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { InfographicGallery } from './infographics';

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
                <div className="max-w-3xl w-full">
                    {/* Title */}
                    <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
                        Meet Synapse
                    </h1>
                    <p className="text-lg text-neutral-400 text-center mb-8 max-w-lg mx-auto">
                        An AI-native product definition environment that transforms your ideas into complete product specifications.
                    </p>

                    {/* Pipeline infographic */}
                    <InfographicGallery />

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
