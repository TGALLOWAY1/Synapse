import { hashPassword } from '../_lib/password.js';
import { json, methodNotAllowed } from '../_lib/response.js';
import {
  parseJsonBody,
  validateEmail,
  validateName,
  validatePassword,
} from '../_lib/validate.js';
import {
  createEmailUser,
  issueSessionForUser,
  toPublicUser,
  EmailInUseError,
} from '../_lib/users.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // Throttle account creation so a single host can't flood the user table.
  if (
    enforceRateLimit(req, res, {
      scope: 'auth_signup_ip',
      limit: 5,
      windowMs: 10 * 60_000,
      errorBody: { error: 'rate_limited' },
    })
  ) {
    return;
  }

  try {
    const body = await parseJsonBody(req);

    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) return json(res, 400, { error: 'invalid_email', field: 'email', message: emailCheck.error });

    const passwordCheck = validatePassword(body?.password);
    if (!passwordCheck.ok) return json(res, 400, { error: 'weak_password', field: 'password', message: passwordCheck.error });

    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return json(res, 400, { error: 'invalid_name', field: 'name', message: nameCheck.error });

    const passwordHash = hashPassword(passwordCheck.value);

    let user;
    try {
      user = await createEmailUser({
        email: emailCheck.value,
        name: nameCheck.value,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof EmailInUseError) {
        return json(res, 409, { error: 'email_in_use', field: 'email' });
      }
      throw error;
    }

    await issueSessionForUser(req, res, user);
    return json(res, 201, { user: toPublicUser(user) });
  } catch (error) {
    console.error('[Signup failed]', error);
    return json(res, 500, { error: 'signup_failed' });
  }
}
