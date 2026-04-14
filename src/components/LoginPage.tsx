import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Linkedin } from 'lucide-react';

type Tab = 'signin' | 'signup';

export function LoginPage() {
    const navigate = useNavigate();
    const [tab, setTab] = useState<Tab>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const primaryLabel = tab === 'signin' ? 'Sign In' : 'Sign Up';
    const comingSoonTitle = 'Email/password sign-in is coming soon — use LinkedIn for now';

    return (
        <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-neutral-900">
            <div className="w-full max-w-md">
                {/* Logo + name + tagline */}
                <div className="flex flex-col items-center mb-8">
                    <img src="/icon.png" alt="Synapse" className="w-14 h-14 mb-4" />
                    <h1 className="text-3xl font-bold tracking-tight text-center">Synapse</h1>
                    <p className="text-sm text-neutral-400 text-center mt-2">
                        AI-native product definition
                    </p>
                </div>

                {/* Login card */}
                <div className="rounded-3xl bg-neutral-900/80 backdrop-blur-xl border border-white/10 p-6 space-y-5">
                    {/* Sign In / Sign Up tabs */}
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
                        <button
                            type="button"
                            onClick={() => setTab('signin')}
                            className={`py-2 rounded-lg text-sm font-medium transition ${
                                tab === 'signin'
                                    ? 'bg-white/10 text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('signup')}
                            className={`py-2 rounded-lg text-sm font-medium transition ${
                                tab === 'signup'
                                    ? 'bg-white/10 text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    {/* Email */}
                    <div className="relative">
                        <Mail
                            size={16}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                        />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email"
                            className="w-full bg-black/40 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"
                            autoComplete="email"
                        />
                    </div>

                    {/* Password */}
                    <div className="relative">
                        <Lock
                            size={16}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                        />
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full bg-black/40 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"
                            autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                        />
                    </div>

                    {/* Primary button (disabled stub) */}
                    <button
                        type="button"
                        disabled
                        title={comingSoonTitle}
                        className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-white transition"
                    >
                        {primaryLabel}
                    </button>

                    {/* Forgot password */}
                    {tab === 'signin' && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                disabled
                                title={comingSoonTitle}
                                className="text-xs text-neutral-400 disabled:cursor-not-allowed hover:text-indigo-300 transition"
                            >
                                Forgot password?
                            </button>
                        </div>
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-xs text-neutral-500">or</span>
                        <div className="flex-1 h-px bg-white/10" />
                    </div>

                    {/* LinkedIn */}
                    <a
                        href="/api/auth/linkedin"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#0a66c2]/50 bg-[#0a66c2]/15 text-[#9bc9f5] hover:bg-[#0a66c2]/25 transition text-sm font-medium"
                    >
                        <Linkedin size={16} />
                        Continue with LinkedIn
                    </a>
                </div>

                {/* Below-card actions */}
                <div className="mt-6 flex flex-col items-center gap-2">
                    <button
                        type="button"
                        onClick={() => navigate('/about')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-sm text-indigo-300 hover:border-indigo-400/60 hover:text-indigo-200 transition"
                    >
                        Meet Synapse
                    </button>
                    <button
                        type="button"
                        disabled
                        title="Coming soon"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm text-neutral-400 cursor-not-allowed"
                    >
                        Demo project (coming soon)
                    </button>
                </div>
            </div>
        </div>
    );
}
