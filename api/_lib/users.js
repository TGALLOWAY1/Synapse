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

// OAuth providers hand us arbitrary URLs that end up rendered as <a href> and
// <img src>. Only let http(s) URLs through so that even if a provider (or a
// malicious actor via provider-side profile fields) tries to slip in a
// javascript:/data: URL, it never reaches the DB or the DOM.
const MAX_URL_LEN = 2048;
export function sanitizeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LEN) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Plain strings from OAuth providers (name, headline, company). Trims,
// drops control characters that could affect log output, and caps length.
const MAX_FIELD_LEN = 512;
export function sanitizeProviderString(value) {
  if (typeof value !== 'string') return '';
  // Strip C0 control characters except tab/newline (the rendered text
  // shouldn't contain them, and they confuse logs + some renderers).
  const cleaned = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return cleaned.slice(0, MAX_FIELD_LEN);
}

function publicUserProjection() {
  return {
    _id: 0,
    userId: 1,
    authProvider: 1,
    providerUserId: 1,
    linkedinId: 1,
    name: 1,
    profileUrl: 1,
    headline: 1,
    company: 1,
    avatarUrl: 1,
    email: 1,
    emailVerified: 1,
    lastActiveAt: 1,
    // Account-linking fields (see "Stable account identity" below). Optional /
    // back-compat: older docs lack them.
    linkedIdentities: 1,
    mergedUserIds: 1,
    mergedInto: 1,
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

/**
 * Resolve the account that owns a given provider identity, recognizing BOTH the
 * account's primary identity (top-level authProvider/providerUserId) and any
 * additional identities linked into it (`linkedIdentities`). Accounts that were
 * merged into another (tombstoned with `mergedInto`) are excluded so a linked
 * identity always resolves to the surviving account.
 *
 * This is what makes one human map to one stable `userId` across sign-in
 * methods: once a provider is linked, signing in with it returns the SAME
 * account (and therefore the same client project namespace).
 */
export function findUserByProviderIdentity(authProvider, providerUserId) {
  return findOne({
    mergedInto: { $exists: false },
    $or: [
      { authProvider, providerUserId },
      { linkedIdentities: { $elemMatch: { authProvider, providerUserId } } },
    ],
  });
}

/** Back-compat alias — now identity-aware (recognizes linked identities). */
export function findUserByProvider(authProvider, providerUserId) {
  return findUserByProviderIdentity(authProvider, providerUserId);
}

/** Whether `account` (primary or linked) already owns the given provider id. */
function accountOwnsIdentity(account, authProvider, providerUserId) {
  if (!account) return false;
  if (account.authProvider === authProvider && account.providerUserId === providerUserId) return true;
  return Array.isArray(account.linkedIdentities)
    && account.linkedIdentities.some(
      (i) => i && i.authProvider === authProvider && i.providerUserId === providerUserId,
    );
}

/** A client-facing summary of every sign-in method linked to an account. */
function buildLinkedProviders(user) {
  const out = [];
  const seen = new Set();
  const push = (authProvider, email) => {
    if (!authProvider || seen.has(authProvider)) return;
    seen.add(authProvider);
    out.push({ authProvider, email: email || null });
  };
  if (user?.authProvider) push(user.authProvider, user.email);
  if (Array.isArray(user?.linkedIdentities)) {
    for (const i of user.linkedIdentities) push(i?.authProvider, i?.email);
  }
  return out;
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

  const safeName = sanitizeProviderString(name);
  const now = new Date();
  const userId = generateUserId();
  const doc = {
    userId,
    authProvider: 'email',
    providerUserId: normalized,
    email: normalized,
    emailVerified: false,
    name: safeName,
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
    name: safeName,
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
  // Sanitize anything provider-supplied that ends up on the client as markup.
  // Only http(s) URLs survive; everything else stored as null.
  const safeAvatarUrl = sanitizeExternalUrl(avatarUrl);
  const safeProfileUrl = sanitizeExternalUrl(profileUrl);
  const safeName = sanitizeProviderString(name);
  const safeHeadline = sanitizeProviderString(headline);
  const safeCompany = company ? sanitizeProviderString(company) : null;
  avatarUrl = safeAvatarUrl;
  profileUrl = safeProfileUrl;
  name = safeName;
  headline = safeHeadline;
  company = safeCompany || null;
  const now = new Date();

  // Is there already an account that owns this provider identity (as its
  // primary identity OR a linked one)?
  const existing = await findUserByProviderIdentity(authProvider, providerUserId);

  // Found via a LINKED identity (this provider was previously linked into an
  // account whose primary sign-in is a different provider). Resolve to that
  // canonical account — do NOT create a second doc — so the user keeps one
  // stable userId (and one project namespace) across sign-in methods.
  if (existing && !(existing.authProvider === authProvider && existing.providerUserId === providerUserId)) {
    return await touchLinkedSignIn(existing, authProvider);
  }

  // No account owns this identity yet. If a verified-email account exists under
  // a DIFFERENT provider, auto-link into it (safe: both sides email-verified)
  // rather than minting a divergent userId. An UNVERIFIED existing account
  // (e.g. an email/password signup with no verification flow) is NOT safe to
  // auto-link — that would be an account-takeover vector — so we keep blocking
  // it; the user can connect the methods explicitly while signed in instead.
  if (!existing && normalizedEmail) {
    const byEmail = await findAnyUserByEmail(normalizedEmail);
    if (byEmail && byEmail.authProvider !== authProvider) {
      if (byEmail.emailVerified) {
        return await attachIdentityToAccount(byEmail, {
          authProvider,
          providerUserId,
          email: normalizedEmail,
        });
      }
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
      },
      // $inc creates loginCount as 1 on insert and increments it on every
      // subsequent login. Do NOT also seed loginCount via $setOnInsert — Mongo
      // rejects the same field path in two update operators ("would create a
      // conflict at 'loginCount'").
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
    // Carry through any pre-existing linking state so the session reflects it.
    linkedIdentities: existing?.linkedIdentities || [],
    mergedUserIds: existing?.mergedUserIds || [],
  };
}

export class IdentityAlreadyLinkedError extends Error {
  constructor() {
    super('identity_already_linked');
    this.name = 'IdentityAlreadyLinkedError';
    this.code = 'identity_already_linked';
  }
}

/**
 * Record a sign-in that arrived via a provider LINKED into `account` (whose
 * primary provider differs). Touches lastActive/loginCount only — the account's
 * primary profile is left intact — and returns the canonical account with the
 * just-used provider as the active one for session display.
 */
async function touchLinkedSignIn(account, activeProvider) {
  const now = new Date();
  await runMongoAction('updateOne', {
    collection: COLLECTION,
    filter: { userId: account.userId },
    update: { $set: { lastActiveAt: now, updatedAt: now }, $inc: { loginCount: 1 } },
  });
  return { ...accountToSessionUser(account), authProvider: activeProvider, lastActiveAt: now };
}

/**
 * Attach a new provider identity to an existing account (auto-link by verified
 * email, or explicit linking). Idempotent via $addToSet. Returns the canonical
 * account with the newly-linked provider active for session display.
 */
export async function attachIdentityToAccount(account, { authProvider, providerUserId, email = null }) {
  const now = new Date();
  if (!accountOwnsIdentity(account, authProvider, providerUserId)) {
    await runMongoAction('updateOne', {
      collection: COLLECTION,
      filter: { userId: account.userId },
      update: {
        $addToSet: {
          linkedIdentities: { authProvider, providerUserId, email: normalizeEmail(email) },
        },
        $set: { lastActiveAt: now, updatedAt: now },
        $inc: { loginCount: 1 },
      },
    });
  }
  const merged = {
    ...account,
    linkedIdentities: [
      ...(account.linkedIdentities || []),
      { authProvider, providerUserId, email: normalizeEmail(email) },
    ],
  };
  return { ...accountToSessionUser(merged), authProvider, lastActiveAt: now };
}

/**
 * Explicitly link a provider identity (just authenticated via OAuth) into the
 * already-signed-in `account`. Safe because the caller proves control of BOTH:
 * a verified session for `account` AND a completed OAuth handshake for the
 * provider. If the identity already belongs to a DIFFERENT account, that account
 * is merged into `account` non-destructively (its identities move over, its
 * userId is recorded in `mergedUserIds`, and it is tombstoned with `mergedInto`
 * so its sign-in resolves to the survivor). Returns the canonical account.
 */
export async function linkProviderIdentity(account, { authProvider, providerUserId, email = null }) {
  if (accountOwnsIdentity(account, authProvider, providerUserId)) {
    return { ...accountToSessionUser(account), authProvider };
  }
  const owner = await findUserByProviderIdentity(authProvider, providerUserId);
  if (owner && owner.userId === account.userId) {
    return { ...accountToSessionUser(account), authProvider };
  }
  if (owner && owner.userId !== account.userId) {
    return await mergeAccountInto(account, owner, authProvider);
  }
  return await attachIdentityToAccount(account, { authProvider, providerUserId, email });
}

/**
 * Non-destructively merge `absorbed` into `survivor`: move every identity of the
 * absorbed account into the survivor's `linkedIdentities`, record the absorbed
 * `userId` in `survivor.mergedUserIds` (the client uses this to merge the
 * absorbed project namespace), and tombstone the absorbed doc with `mergedInto`
 * so future sign-ins resolve to the survivor. The absorbed doc is kept (not
 * deleted) so its server-side data is never destroyed.
 */
async function mergeAccountInto(survivor, absorbed, activeProvider) {
  const now = new Date();
  const absorbedIdentities = [
    { authProvider: absorbed.authProvider, providerUserId: absorbed.providerUserId, email: absorbed.email || null },
    ...(absorbed.linkedIdentities || []),
  ].filter((i) => i.authProvider && i.providerUserId);

  await runMongoAction('updateOne', {
    collection: COLLECTION,
    filter: { userId: survivor.userId },
    update: {
      $addToSet: {
        linkedIdentities: { $each: absorbedIdentities },
        mergedUserIds: absorbed.userId,
      },
      $set: { lastActiveAt: now, updatedAt: now },
    },
  });
  // Tombstone the absorbed account so it no longer resolves on sign-in.
  await runMongoAction('updateOne', {
    collection: COLLECTION,
    filter: { userId: absorbed.userId },
    update: { $set: { mergedInto: survivor.userId, updatedAt: now } },
  });

  const merged = {
    ...survivor,
    linkedIdentities: [...(survivor.linkedIdentities || []), ...absorbedIdentities],
    mergedUserIds: [...(survivor.mergedUserIds || []), absorbed.userId],
  };
  return { ...accountToSessionUser(merged), authProvider: activeProvider, lastActiveAt: now };
}

/** Shape an account doc into the object shared by every auth return path. */
function accountToSessionUser(account) {
  return {
    userId: account.userId,
    authProvider: account.authProvider,
    providerUserId: account.providerUserId,
    name: account.name || '',
    profileUrl: account.profileUrl || null,
    headline: account.headline || '',
    company: account.company || null,
    avatarUrl: account.avatarUrl || null,
    email: account.email || null,
    emailVerified: account.emailVerified ?? false,
    lastActiveAt: account.lastActiveAt || null,
    linkedinId: account.linkedinId,
    linkedIdentities: account.linkedIdentities || [],
    mergedUserIds: account.mergedUserIds || [],
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
    // Account-linking surface: every connected sign-in method, plus the ids of
    // any accounts merged into this one (the client merges their project
    // namespaces so already-split projects are recovered). Both default to a
    // single-provider / empty shape for legacy docs.
    linkedProviders: buildLinkedProviders(user),
    mergedUserIds: Array.isArray(user.mergedUserIds) ? user.mergedUserIds : [],
  };
}
