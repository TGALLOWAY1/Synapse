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
    applyProjectUser(user?.userId ?? null);
    // Prime/clear runtime provider-key state (Gemini in-memory key, OpenAI
    // configured flag) so AI calls use the right account's credentials.
    if (user) {
      void primeProviderSession();
    } else {
      clearProviderSession();
    }
    set({ user, loading: false });
  };

  return {
    user: DEV_SKIP_AUTH ? DEV_USER : null,
    loading: DEV_SKIP_AUTH ? false : true,
    refreshSession: async () => {
      if (DEV_SKIP_AUTH) {
        setUser(DEV_USER);
        return;
      }
      set({ loading: true });
      try {
        const session = await fetchSession();
        setUser(session.authenticated ? session.user : null);
      } catch {
        setUser(null);
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
