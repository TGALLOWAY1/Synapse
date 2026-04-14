export type AuthProvider = 'linkedin' | 'email' | 'google' | 'github';

export type RecruiterUser = {
  userId?: string;
  authProvider?: AuthProvider;
  /** Retained for legacy LinkedIn records; prefer `userId` for new code. */
  linkedinId?: string;
  name: string;
  profileUrl: string | null;
  headline: string;
  company: string | null;
  avatarUrl: string | null;
  email?: string | null;
  emailVerified?: boolean;
  lastActiveAt?: string;
};

/** Forward-looking alias — favor `User` in new code. */
export type User = RecruiterUser;

export type RecruiterDashboardItem = RecruiterUser & {
  sessions: number;
  artifactGenerations: number;
  viewedMockups: number;
  clickedSections: number;
};

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; error: string; field?: 'email' | 'password' | 'name'; message?: string };

export async function fetchSession() {
  const response = await fetch('/api/session', { credentials: 'include' });
  return response.json();
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data: data as T };
}

export async function signupWithEmail(payload: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthResult> {
  try {
    const { status, data } = await postJson<{
      user?: User;
      error?: string;
      field?: 'email' | 'password' | 'name';
      message?: string;
    }>('/api/auth/signup', payload);

    if (status >= 200 && status < 300 && data?.user) {
      return { ok: true, user: data.user };
    }
    return {
      ok: false,
      error: data?.error || 'signup_failed',
      field: data?.field,
      message: data?.message,
    };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function loginWithEmail(payload: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
    const { status, data } = await postJson<{
      user?: User;
      error?: string;
      field?: 'email' | 'password' | 'name';
      message?: string;
    }>('/api/auth/login', payload);

    if (status >= 200 && status < 300 && data?.user) {
      return { ok: true, user: data.user };
    }
    return {
      ok: false,
      error: data?.error || 'invalid_credentials',
      field: data?.field,
      message: data?.message,
    };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // swallow; the client store will be cleared by the caller
  }
}

export async function trackActivity(type: string, metadata: Record<string, unknown> = {}) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, metadata }),
    });
  } catch {
    // swallow tracking failures
  }
}

export async function fetchRecruiters(adminKey: string): Promise<RecruiterDashboardItem[]> {
  const response = await fetch('/api/admin/recruiters', {
    headers: { 'x-admin-key': adminKey },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to load recruiter dashboard data.');
  }

  const data = await response.json();
  return data.recruiters;
}
