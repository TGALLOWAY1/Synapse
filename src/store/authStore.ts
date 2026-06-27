import { create } from 'zustand';
import type { AuthResult, RecruiterUser } from '../lib/recruiterApi';
import {
  fetchSession,
  loginWithEmail,
  logout as logoutRequest,
  signupWithEmail,
} from '../lib/recruiterApi';
import { applyProjectUser } from './projectUserSync';
import { primeProviderSession, clearProviderSession, clearLocalProviderKeys } from '../lib/providerSession';
import { projectsDebug } from '../lib/projectsDebug';

// Real authentication is ON by default. For local development without the
// MongoDB/session backend running, opt into a bypass by setting
// `VITE_DEV_SKIP_AUTH=true` in `.env.local`. Production builds (`import.meta.env.DEV`
// is false) NEVER bypass auth, regardless of the env var.
const DEV_SKIP_AUTH =
  import.meta.env.DEV && import.meta.env.VITE_DEV_SKIP_AUTH === 'true';

const DEV_USER: RecruiterUser = {
  userId: 'dev-user',
  authProvider: 'email',
  name: 'Dev User',
  email: 'dev@localhost',
  profileUrl: null,
  headline: '',
  company: null,
  avatarUrl: null,
};

type AuthState = {
  user: RecruiterUser | null;
  loading: boolean;
  // Set when the session could NOT be resolved due to a transport/server error
  // (as opposed to a clean "not signed in"). When non-null the UI should show a
  // "couldn't reach the server — retry" state rather than the login page, so a
  // transient blip doesn't look like the user's projects vanished.
  authError: string | null;
  refreshSession: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signupWithEmail: (email: string, password: string, name: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => {
  // Every place the active user changes also retargets the project store to
  // that user's namespace (login adopts any anonymous projects; logout/anon
  // switches away), so accounts never share project data in one browser.
  const setUser = (user: RecruiterUser | null) => {
    projectsDebug('auth: resolved user', { userId: user?.userId ?? null, provider: user?.authProvider });
    applyProjectUser(user?.userId ?? null);
    // Prime/clear runtime provider-key state (Gemini in-memory key, OpenAI
    // configured flag) so AI calls use the right account's credentials.
    if (user) {
      void primeProviderSession();
    } else {
      clearProviderSession();
    }
    set({ user, loading: false, authError: null });
  };

  return {
    user: DEV_SKIP_AUTH ? DEV_USER : null,
    loading: DEV_SKIP_AUTH ? false : true,
    authError: null,
    refreshSession: async () => {
      if (DEV_SKIP_AUTH) {
        setUser(DEV_USER);
        return;
      }
      set({ loading: true, authError: null });
      try {
        const session = await fetchSession();
        setUser(session.authenticated ? session.user : null);
      } catch (err) {
        // Transport/server failure — NOT a clean sign-out. Keep any already
        // signed-in user in place (their localStorage projects are untouched)
        // and record an error so the UI can offer a retry instead of silently
        // showing an empty/logged-out state. We deliberately do NOT call
        // setUser(null), which would swap the project store to the anonymous
        // namespace and make projects look like they vanished.
        const message = err instanceof Error ? err.message : 'network_error';
        projectsDebug('auth: session resolution failed', { message });
        set({ loading: false, authError: message });
      }
    },
    loginWithEmail: async (email, password) => {
      if (DEV_SKIP_AUTH) {
        setUser(DEV_USER);
        return { ok: true as const, user: DEV_USER };
      }
      const result = await loginWithEmail({ email, password });
      if (result.ok) {
        setUser(result.user);
      }
      return result;
    },
    signupWithEmail: async (email, password, name) => {
      if (DEV_SKIP_AUTH) {
        setUser(DEV_USER);
        return { ok: true as const, user: DEV_USER };
      }
      const result = await signupWithEmail({ email, password, name });
      if (result.ok) {
        setUser(result.user);
      }
      return result;
    },
    logout: async () => {
      if (DEV_SKIP_AUTH) {
        return; // no-op in dev mode
      }
      await logoutRequest();
      // Explicit sign-out: also wipe local-browser credential keys so the next
      // account to sign in on this browser can't inherit them. The per-user
      // encrypted server vault is unaffected (it's keyed by userId server-side).
      clearLocalProviderKeys();
      setUser(null);
    },
  };
});
