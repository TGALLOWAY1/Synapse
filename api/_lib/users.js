import crypto from 'crypto';
import { runMongoAction } from './db.js';
import { createSessionToken, setSessionCookie } from './session.js';

export const COLLECTION = 'recruiters';
export const SESSIONS_COLLECTION = 'recruiter_sessions';

export class EmailInUseError extends Error {
  constructor(message = 'email_in_use') {
    super(message);
    this.name = 'EmailInUseError';
    this.code = 'email_in_use';
  }
}

export class EmailInUseByOtherProviderError extends Error {
  constructor(existingProvider) {
    super('email_in_use_other_provider');
    this.name = 'EmailInUseByOtherProviderError';
    this.code = 'email_in_use_other_provider';
    this.existingProvider = existingProvider;
  }
}

export function generateUserId() {
  return crypto.randomUUID();
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function publicUserProjection() {
  return {
    _id: 0,
    userId: 1,
    authProvider: 1,
    linkedinId: 1,
    name: 1,
    profileUrl: 1,
    headline: 1,
    company: 1,
    avatarUrl: 1,
    email: 1,
    emailVerified: 1,
    lastActiveAt: 1,
  };
}

async function findOne(filter) {
  const result = await runMongoAction('findOne', {
    collection: COLLECTION,
    filter,
    projection: publicUserProjection(),
  });
  return result.document || null;
}

async function findOneFull(filter) {
  const result = await runMongoAction('findOne', {
    collection: COLLECTION,
    filter,
  });
  return result.document || null;
}

export function findUserByUserId(userId) {
  return findOne({ userId });
}

export function findUserByLinkedinId(linkedinId) {
  return findOne({ linkedinId });
}

export function findUserByProvider(authProvider, providerUserId) {
  return findOne({ authProvider, providerUserId });
}

/**
 * Returns the full (including passwordHash) document for an email-provider user.
 * Used only inside the login endpoint for password comparison — never projected
 * out to clients.
 */
export async function findEmailUserForLogin(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return findOneFull({ email: normalized, authProvider: 'email' });
}

export async function findAnyUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return findOne({ email: normalized });
}

/**
 * Create a new email-provider user. Throws EmailInUseError if the email is
 * already registered under ANY provider.
 */
export async function createEmailUser({ email, name, passwordHash }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('createEmailUser: email is required');

  const existing = await findAnyUserByEmail(normalized);
  if (existing) throw new EmailInUseError();

  const now = new Date();
  const userId = generateUserId();
  const doc = {
    userId,
    authProvider: 'email',
    providerUserId: normalized,
    email: normalized,
    emailVerified: false,
    name,
    passwordHash,
    profileUrl: null,
    headline: '',
    company: null,
    avatarUrl: null,
    createdAt: now,
    firstLoginAt: now,
    lastActiveAt: now,
    updatedAt: now,
    loginCount: 1,
  };

  await runMongoAction('insertOne', {
    collection: COLLECTION,
    document: doc,
  });

  return {
    userId,
    authProvider: 'email',
    email: normalized,
    emailVerified: false,
    name,
    profileUrl: null,
    headline: '',
    company: null,
    avatarUrl: null,
    lastActiveAt: now,
  };
}

/**
 * Upsert an OAuth-provider user. Throws EmailInUseByOtherProviderError if the
 * email already belongs to a user under a different auth provider.
 * Returns the public user projection.
 */
export async function upsertOAuthUser({
  authProvider,
  providerUserId,
  email,
  name,
  avatarUrl = null,
  profileUrl = null,
  headline = '',
  company = null,
}) {
  if (!authProvider || !providerUserId) {
    throw new Error('upsertOAuthUser: authProvider and providerUserId are required');
  }

  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  // Is there already a record for this provider + providerUserId?
  const existing = await findUserByProvider(authProvider, providerUserId);

  // Cross-provider collision: email already used by a different provider.
  if (!existing && normalizedEmail) {
    const byEmail = await findAnyUserByEmail(normalizedEmail);
    if (byEmail && byEmail.authProvider !== authProvider) {
      throw new EmailInUseByOtherProviderError(byEmail.authProvider);
    }
  }

  const userId = existing?.userId || generateUserId();

  const setFields = {
    userId,
    authProvider,
    providerUserId,
    name,
    profileUrl,
    headline,
    company,
    avatarUrl,
    email: normalizedEmail,
    emailVerified: true,
    lastActiveAt: now,
    updatedAt: now,
  };

  // Keep legacy linkedinId in sync for existing code paths.
  if (authProvider === 'linkedin') {
    setFields.linkedinId = providerUserId;
  }

  await runMongoAction('updateOne', {
    collection: COLLECTION,
    filter: { authProvider, providerUserId },
    update: {
      $set: setFields,
      $setOnInsert: {
        createdAt: now,
        firstLoginAt: now,
        loginCount: 0,
      },
      $inc: { loginCount: 1 },
    },
    upsert: true,
  });

  return {
    userId,
    authProvider,
    providerUserId,
    name,
    profileUrl,
    headline,
    company,
    avatarUrl,
    email: normalizedEmail,
    emailVerified: true,
    lastActiveAt: now,
    linkedinId: authProvider === 'linkedin' ? providerUserId : undefined,
  };
}

/**
 * Build session claims, sign the cookie, set it on the response, and record a
 * session row in `recruiter_sessions`. Shared by every successful auth path.
 */
export async function issueSessionForUser(req, res, user) {
  const token = createSessionToken({
    userId: user.userId,
    authProvider: user.authProvider,
    name: user.name,
    email: user.email || null,
    avatarUrl: user.avatarUrl || null,
    profileUrl: user.profileUrl || null,
    issuedAt: Date.now(),
    // Back-compat: older code paths that inspect `recruiterId` keep working.
    recruiterId: user.linkedinId || user.userId,
  });

  setSessionCookie(res, token);

  try {
    await runMongoAction('insertOne', {
      collection: SESSIONS_COLLECTION,
      document: {
        userId: user.userId,
        authProvider: user.authProvider,
        recruiterId: user.linkedinId || user.userId,
        startedAt: new Date(),
        userAgent: req?.headers?.['user-agent'] || null,
        ip: req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
      },
    });
  } catch (error) {
    // Session-row insertion is best-effort analytics; don't block login.
    console.error('[recruiter_sessions insert failed]', error);
  }

  return token;
}

/**
 * Strip server-only fields before returning a user to a client.
 */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    userId: user.userId || null,
    authProvider: user.authProvider || null,
    linkedinId: user.linkedinId || null,
    name: user.name || '',
    profileUrl: user.profileUrl || null,
    headline: user.headline || '',
    company: user.company || null,
    avatarUrl: user.avatarUrl || null,
    email: user.email || null,
    emailVerified: user.emailVerified ?? false,
    lastActiveAt: user.lastActiveAt || null,
  };
}
