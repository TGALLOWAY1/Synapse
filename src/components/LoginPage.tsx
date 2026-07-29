import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Box, Eye, Github, Linkedin, Loader2, Lock, Mail, Play, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { DEMO_PROJECT_ID } from '../data/demoProject';

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
    github_callback_failed: 'GitHub sign-in failed. Please try again.',
    github_config: 'GitHub sign-in is not configured.',
    github_missing_code: 'GitHub sign-in was cancelled.',
    github_invalid_state: 'GitHub sign-in failed a security check.',
};

function friendlyError(code: string | undefined, message?: string): string {
    if (!code) return message || 'Something went wrong. Please try again.';
    if (ERROR_COPY[code]) return ERROR_COPY[code];
    // Synthetic codes from the OAuth callback when the provider returned
    // ?error=… instead of ?code=… (e.g. linkedin_provider_error_unauthorized_scope_error).
    // Surface the provider's own error label so the user/operator can act on it.
    const providerErrorMatch = /^(linkedin|github)_provider_error_(.+)$/.exec(code);
    if (providerErrorMatch) {
        const [, provider, reason] = providerErrorMatch;
        const providerLabel = provider === 'linkedin' ? 'LinkedIn' : 'GitHub';
        return `${providerLabel} sign-in failed: ${reason.replace(/_/g, ' ')}. Check server logs for details.`;
    }
    return message || 'Something went wrong. Please try again.';
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

    // Demo hydration is route-owned (`DemoRouteGate` on /p/<DEMO_PROJECT_ID>),
    // so this button only navigates — direct links, bookmarks, refreshes, and
    // button entry all share the same route-level loading path.
    const handleOpenDemo = () => {
        navigate(`/p/${DEMO_PROJECT_ID}`);
    };

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
        <div className="relative min-h-screen overflow-x-hidden bg-[#f7faff] text-slate-900">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(255,255,255,0.98),rgba(239,246,255,0.92)_48%,rgba(226,236,255,0.9)_100%)]" />
            <div className="pointer-events-none absolute inset-x-[-20%] top-28 h-48 rotate-[-3deg] bg-[linear-gradient(100deg,transparent,rgba(34,211,238,0.16),rgba(59,130,246,0.13),rgba(124,58,237,0.12),transparent)] blur-xl" />
            <div className="pointer-events-none absolute left-1/2 top-28 h-64 w-[56rem] -translate-x-1/2 rounded-full border border-sky-200/50 opacity-60 [mask-image:linear-gradient(90deg,transparent,black,transparent)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(14,165,233,0.22),transparent_2.2rem),radial-gradient(circle_at_79%_16%,rgba(124,58,237,0.16),transparent_2rem),radial-gradient(circle_at_86%_39%,rgba(45,212,191,0.2),transparent_1.6rem)]" />

            <div className="relative z-10 flex min-h-screen flex-col items-center justify-start px-5 py-8 sm:justify-center sm:px-6 sm:py-10">
                <div className="w-full max-w-sm space-y-5 sm:max-w-[43.5rem] sm:space-y-7">
                    {/* Name + tagline */}
                    <div className="flex flex-col items-center text-center">
                        <img src="/icon.svg" alt="Synapse icon" className="mb-3 h-28 w-28 rounded-[1.75rem] drop-shadow-2xl sm:mb-4 sm:h-36 sm:w-36 md:h-44 md:w-44" />
                        <h1 className="bg-gradient-to-r from-sky-500 via-blue-600 to-violet-600 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl">Synapse</h1>
                        <p className="mt-2 text-base text-slate-500 sm:mt-3 sm:text-xl md:text-2xl">
                            From plain-language to product blueprint
                        </p>
                    </div>

                    {/* Tour + Demo actions */}
                    <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-center sm:gap-4">
                        <button
                            type="button"
                            onClick={() => navigate('/tour')}
                            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-blue-200 bg-white/45 px-3 py-3 text-sm font-semibold text-blue-700 shadow-sm shadow-blue-200/50 backdrop-blur transition hover:border-blue-300 hover:bg-white/70 sm:gap-3 sm:px-8 sm:text-lg"
                        >
                            <Play size={22} className="text-blue-500" />
                            Take the tour
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenDemo}
                            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-cyan-200 bg-white/45 px-3 py-3 text-sm font-semibold text-teal-600 shadow-sm shadow-cyan-200/50 backdrop-blur transition hover:border-cyan-300 hover:bg-white/70 sm:gap-3 sm:px-8 sm:text-lg"
                        >
                            <Box size={22} />
                            Demo project
                        </button>
                    </div>

                    {/* Login card */}
                    <form
                        onSubmit={handleSubmit}
                        className="space-y-4 rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-2xl shadow-slate-300/45 backdrop-blur-xl sm:space-y-5 sm:p-6 md:p-8"
                        noValidate
                    >
                    {/* Sign In / Sign Up tabs */}
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-100/80 border border-slate-200">
                        <button
                            type="button"
                            onClick={() => {
                                setTab('signin');
                                clearErrors();
                            }}
                            className={`py-2.5 rounded-xl text-sm font-medium transition ${
                                tab === 'signin'
                                    ? 'bg-white text-blue-700 shadow-md shadow-blue-200/60'
                                    : 'text-slate-500 hover:text-slate-700'
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
                            className={`py-2.5 rounded-xl text-sm font-medium transition ${
                                tab === 'signup'
                                    ? 'bg-white text-blue-700 shadow-md shadow-blue-200/60'
                                    : 'text-slate-500 hover:text-slate-700'
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
                            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        >
                            {banner}
                        </div>
                    )}

                    {/* Name (sign-up only) */}
                    {tab === 'signup' && (
                        <div>
                            <label htmlFor="login-name" className="sr-only">
                                Name
                            </label>
                            <div className="relative">
                                <UserIcon
                                    size={16}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                                />
                                <input
                                    id="login-name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Name"
                                    autoComplete="name"
                                    aria-invalid={fieldErrors.name ? true : undefined}
                                    aria-describedby={fieldErrors.name ? 'login-name-error' : undefined}
                                    className={`w-full bg-white/80 border rounded-2xl pl-12 pr-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 transition ${
                                        fieldErrors.name
                                            ? 'border-red-300 focus:ring-red-300/50 focus:border-red-400'
                                            : 'border-slate-200 focus:ring-blue-300/60 focus:border-blue-400'
                                    }`}
                                />
                            </div>
                            {fieldErrors.name && (
                                <p id="login-name-error" className="mt-1.5 text-xs text-red-600">
                                    {fieldErrors.name}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Email */}
                    <div>
                        <label htmlFor="login-email" className="sr-only">
                            Email
                        </label>
                        <div className="relative">
                            <Mail
                                size={16}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                            />
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email"
                                autoComplete="email"
                                aria-invalid={fieldErrors.email ? true : undefined}
                                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                                className={`w-full bg-white/80 border rounded-2xl pl-12 pr-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 transition ${
                                    fieldErrors.email
                                        ? 'border-red-300 focus:ring-red-300/50 focus:border-red-400'
                                        : 'border-slate-200 focus:ring-blue-300/60 focus:border-blue-400'
                                }`}
                            />
                        </div>
                        {fieldErrors.email && (
                            <p id="login-email-error" className="mt-1.5 text-xs text-red-600">
                                {fieldErrors.email}
                            </p>
                        )}
                    </div>

                    {/* Password */}
                    <div>
                        <label htmlFor="login-password" className="sr-only">
                            Password
                        </label>
                        <div className="relative">
                            <Lock
                                size={16}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                            />
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                                aria-invalid={fieldErrors.password ? true : undefined}
                                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                                className={`w-full bg-white/80 border rounded-2xl pl-12 pr-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 transition ${
                                    fieldErrors.password
                                        ? 'border-red-300 focus:ring-red-300/50 focus:border-red-400'
                                        : 'border-slate-200 focus:ring-blue-300/60 focus:border-blue-400'
                                }`}
                            />
                        <Eye size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                        {fieldErrors.password && (
                            <p id="login-password-error" className="mt-1.5 text-xs text-red-600">
                                {fieldErrors.password}
                            </p>
                        )}
                    </div>

                    {/* Primary button */}
                    <button
                        type="submit"
                        disabled={disabled}
                        className="relative inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-300/60 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:py-4 sm:text-lg"
                    >
                        {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                        <span>{primaryLabel}</span>
                        <ArrowRight size={22} className="absolute right-5" />
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-slate-200" />
                        <span className="text-sm text-slate-500 sm:text-base">or</span>
                        <div className="flex-1 h-px bg-slate-200" />
                    </div>

                    {/* GitHub */}
                    <a
                        href="/api/auth/github"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 bg-white/90 text-slate-900 hover:bg-white transition text-base font-medium shadow-sm sm:text-lg"
                    >
                        <Github size={16} />
                        Continue with GitHub
                    </a>

                    {/* LinkedIn */}
                    <a
                        href="/api/auth/linkedin"
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 bg-white/90 text-slate-900 hover:bg-white transition text-base font-medium shadow-sm sm:text-lg"
                    >
                        <Linkedin size={16} />
                        Continue with LinkedIn
                    </a>

                    <div className="flex items-center justify-center gap-2 pt-1 text-center text-xs text-slate-500 sm:text-sm">
                        <ShieldCheck size={18} className="text-violet-500" />
                        Your data is secure. We never share your information.
                    </div>
                </form>
            </div>
        </div>
        </div>
    );
}
