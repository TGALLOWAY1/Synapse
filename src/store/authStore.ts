import { create } from 'zustand';
import type { AuthResult, RecruiterUser } from '../lib/recruiterApi';
import {
  fetchSession,
  loginWithEmail,
  logout as logoutRequest,
  signupWithEmail,
} from '../lib/recruiterApi';

// DEV BYPASS: set to false to re-enable real authentication
const DEV_SKIP_AUTH = true;

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

export const useAuthStore = create<AuthState>((set) => ({
  user: DEV_SKIP_AUTH ? DEV_USER : null,
  loading: DEV_SKIP_AUTH ? false : true,
  refreshSession: async () => {
    if (DEV_SKIP_AUTH) {
      set({ user: DEV_USER, loading: false });
      return;
    }
    set({ loading: true });
    try {
      const session = await fetchSession();
      set({ user: session.authenticated ? session.user : null, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  loginWithEmail: async (email, password) => {
    if (DEV_SKIP_AUTH) {
      set({ user: DEV_USER, loading: false });
      return { ok: true as const, user: DEV_USER };
    }
    const result = await loginWithEmail({ email, password });
    if (result.ok) {
      set({ user: result.user, loading: false });
    }
    return result;
  },
  signupWithEmail: async (email, password, name) => {
    if (DEV_SKIP_AUTH) {
      set({ user: DEV_USER, loading: false });
      return { ok: true as const, user: DEV_USER };
    }
    const result = await signupWithEmail({ email, password, name });
    if (result.ok) {
      set({ user: result.user, loading: false });
    }
    return result;
  },
  logout: async () => {
    if (DEV_SKIP_AUTH) {
      return; // no-op in dev mode
    }
    await logoutRequest();
    set({ user: null, loading: false });
  },
}));
