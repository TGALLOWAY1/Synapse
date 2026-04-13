export type RecruiterUser = {
  linkedinId: string;
  name: string;
  profileUrl: string | null;
  headline: string;
  company: string | null;
  avatarUrl: string | null;
  email?: string | null;
  lastActiveAt?: string;
};

export type RecruiterDashboardItem = RecruiterUser & {
  sessions: number;
  artifactGenerations: number;
  viewedMockups: number;
  clickedSections: number;
};

export async function fetchSession() {
  const response = await fetch('/api/session', { credentials: 'include' });
  return response.json();
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
