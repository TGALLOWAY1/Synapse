import { create } from 'zustand';
import type { AuthResult, RecruiterUser } from '../lib/recruiterApi';
import {
  fetchSession,
  loginWithEmail,
  logout as logoutRequest,
  signupWithEmail,
} from '../lib/recruiterApi';

type AuthState = {
  user: RecruiterUser | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signupWithEmail: (email: string, password: string, name: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  refreshSession: async () => {
    set({ loading: true });
    try {
      const session = await fetchSession();
      set({ user: session.authenticated ? session.user : null, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  loginWithEmail: async (email, password) => {
    const result = await loginWithEmail({ email, password });
    if (result.ok) {
      set({ user: result.user, loading: false });
    }
    return result;
  },
  signupWithEmail: async (email, password, name) => {
    const result = await signupWithEmail({ email, password, name });
    if (result.ok) {
      set({ user: result.user, loading: false });
    }
    return result;
  },
  logout: async () => {
    await logoutRequest();
    set({ user: null, loading: false });
  },
}));
