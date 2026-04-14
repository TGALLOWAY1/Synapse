import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Github, Linkedin, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

type Tab = 'signin' | 'signup';
type FieldName = 'email' | 'password' | 'name';

const ERROR_COPY: Record<string, string> = {
    email_in_use: 'An account with this email already exists.',
    email_in_use_other_provider: 'This email is already registered with a different sign-in method.',
    invalid_credentials: 'Email or password is incorrect.',
    invalid_email: 'Please enter a valid email address.',
    weak_password: 'Password must be at least 8 characters.',
    invalid_name: 'Please enter your name.',
    network_error: 'Network error. Please try again.',
    signup_failed: 'Something went wrong creating your account. Please try again.',
    login_failed: 'Something went wrong signing you in. Please try again.',
    linkedin_callback_failed: 'LinkedIn sign-in failed. Please try again.',
    linkedin_config: 'LinkedIn sign-in is not configured.',
    linkedin_missing_code: 'LinkedIn sign-in was cancelled.',
    linkedin_invalid_state: 'LinkedIn sign-in failed a security check.',
    google_callback_failed: 'Google sign-in failed. Please try again.',
    google_config: 'Google sign-in is not configured.',
    google_missing_code: 'Google sign-in was cancelled.',
    google_invalid_state: 'Google sign-in failed a security check.',
    github_callback_failed: 'GitHub sign-in failed. Please try again.',
    github_config: 'GitHub sign-in is not configured.',
    github_missing_code: 'GitHub sign-in was cancelled.',
    github_invalid_state: 'GitHub sign-in failed a security check.',
};

function friendlyError(code: string | undefined, message?: string): string {
    if (!code) return message || 'Something went wrong. Please try again.';
    return ERROR_COPY[code] || message || 'Something went wrong. Please try again.';
}

function GoogleIcon({ size = 16 }: { size?: number }) {
    // Google "G" logo (brand colors). Inline SVG — lucide-react ships only a
    // monochrome Chrome glyph, and we want the recognizable multi-color mark.
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
            <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
        </svg>
    );
}

export function LoginPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const loginAction = useAuthStore((s) => s.loginWithEmail);
    const signupAction = useAuthStore((s) => s.signupWithEmail);

    const [tab, setTab] = useState<Tab>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [banner, setBanner] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});

    // Surface auth errors passed back from OAuth redirects via `?auth_error=...`.
    useEffect(() => {
        const code = searchParams.get('auth_error');
        if (code) {
            setBanner(friendlyError(code));
            const next = new URLSearchParams(searchParams);
            next.delete('auth_error');
            next.delete('auth');
            setSearchParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const primaryLabel = tab === 'signin' ? 'Sign In' : 'Sign Up';

    const disabled = useMemo(() => submitting, [submitting]);

    function clearErrors() {
        setBanner(null);
        setFieldErrors({});
    }

    function validateClient(): boolean {
        const errors: Partial<Record<FieldName, string>> = {};
        const trimmedEmail = email.trim();
        if (!trimmedEmail) errors.email = 'Email is required.';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) errors.email = 'Please enter a valid email address.';
        if (!password) errors.password = 'Password is required.';
        else if (tab === 'signup' && password.length < 8) errors.password = 'Password must be at least 8 characters.';
        if (tab === 'signup' && !name.trim()) errors.name = 'Name is required.';
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        clearErrors();
        if (!validateClient()) return;

        setSubmitting(true);
        const result =
            tab === 'signin'
                ? await loginAction(email.trim(), password)
                : await signupAction(email.trim(), password, name.trim());
        setSubmitting(false);

        if (!result.ok) {
            if (result.field) {
                setFieldErrors({ [result.field]: friendlyError(result.error, result.message) });
            } else {
                setBanner(friendlyError(result.error, result.message));
            }
            return;
        }

        // On success, `HomeRoute` will switch to HomePage automatically because
        // the auth store now has a user.
    }

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
                <form
                    onSubmit={handleSubmit}
                    className="rounded-3xl bg-neutral-900/80 backdrop-blur-xl border border-white/10 p-6 space-y-5"
                    noValidate
                >
                    {/* Sign In / Sign Up tabs */}
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
                        <button
                            type="button"
                            onClick={() => {
                                setTab('signin');
                                clearErrors();
                            }}
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
                            onClick={() => {
                                setTab('signup');
                                clearErrors();
                            }}
                            className={`py-2 rounded-lg text-sm font-medium transition ${
                                tab === 'signup'
                                    ? 'bg-white/10 text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    {/* Error banner */}
                    {banner && (
                        <div
                            role="alert"
                            aria-live="polite"
                            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                        >
                            {banner}
                        </div>
                    )}

                    {/* Name (sign-up only) */}
                    {tab === 'signup' && (
                        <div>
                            <div className="relative">
                                <UserIcon
                                    size={16}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                                />
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Name"
                                    autoComplete="name"
                                    className={`w-full bg-black/40 border rounded-xl pl-11 pr-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 transition ${
                                        fieldErrors.name
                                            ? 'border-red-500/60 focus:ring-red-500/40 focus:border-red-500/60'
                                            : 'border-white/10 focus:ring-indigo-500/50 focus:border-indigo-500/50'
                                    }`}
                                />
                            </div>
                            {fieldErrors.name && (
                                <p className="mt-1.5 text-xs text-red-300">{fieldErrors.name}</p>
                            )}
                        </div>
                    )}

                    {/* Email */}
                    <div>
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
                                autoComplete="email"
                                className={`w-full bg-black/40 border rounded-xl pl-11 pr-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 transition ${
                                    fieldErrors.email
                                        ? 'border-red-500/60 focus:ring-red-500/40 focus:border-red-500/60'
                                        : 'border-white/10 focus:ring-indigo-500/50 focus:border-indigo-500/50'
                                }`}
                            />
                        </div>
                        {fieldErrors.email && (
                            <p className="mt-1.5 text-xs text-red-300">{fieldErrors.email}</p>
                        )}
                    </div>

                    {/* Password */}
                    <div>
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
                                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                                className={`w-full bg-black/40 border rounded-xl pl-11 pr-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 transition ${
                                    fieldErrors.password
                                        ? 'border-red-500/60 focus:ring-red-500/40 focus:border-red-500/60'
                                        : 'border-white/10 focus:ring-indigo-500/50 focus:border-indigo-500/50'
                                }`}
                            />
                        </div>
                        {fieldErrors.password && (
                            <p className="mt-1.5 text-xs text-red-300">{fieldErrors.password}</p>
                        )}
                    </div>

                    {/* Primary button */}
                    <button
                        type="submit"
                        disabled={disabled}
                        className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-white transition inline-flex items-center justify-center gap-2"
                    >
                        {submitting && <Loader2 size={16} className="animate-spin" />}
                        {primaryLabel}
                    </button>

                    {/* Forgot password (intentionally disabled — future work) */}
                    {tab === 'signin' && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                disabled
                                title="Password reset is coming soon"
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

                    {/* Google */}
                    <a
                        href="/api/auth/google"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white text-neutral-800 hover:bg-neutral-100 transition text-sm font-medium"
                    >
                        <GoogleIcon size={16} />
                        Continue with Google
                    </a>

                    {/* GitHub */}
                    <a
                        href="/api/auth/github"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-neutral-800 text-white hover:bg-neutral-700 transition text-sm font-medium"
                    >
                        <Github size={16} />
                        Continue with GitHub
                    </a>

                    {/* LinkedIn */}
                    <a
                        href="/api/auth/linkedin"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#0a66c2]/50 bg-[#0a66c2]/15 text-[#9bc9f5] hover:bg-[#0a66c2]/25 transition text-sm font-medium"
                    >
                        <Linkedin size={16} />
                        Continue with LinkedIn
                    </a>
                </form>

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
