import { verifyPassword } from '../_lib/password.js';
import { json, methodNotAllowed } from '../_lib/response.js';
import { parseJsonBody, validateEmail } from '../_lib/validate.js';
import {
  findEmailUserForLogin,
  issueSessionForUser,
  toPublicUser,
} from '../_lib/users.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const body = await parseJsonBody(req);

    const emailCheck = validateEmail(body?.email);
    if (!emailCheck.ok) {
      return json(res, 401, { error: 'invalid_credentials' });
    }
    if (typeof body?.password !== 'string' || body.password.length === 0) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    const user = await findEmailUserForLogin(emailCheck.value);
    if (!user || !user.passwordHash) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    const match = verifyPassword(body.password, user.passwordHash);
    if (!match) {
      return json(res, 401, { error: 'invalid_credentials' });
    }

    await issueSessionForUser(req, res, user);
    return json(res, 200, { user: toPublicUser(user) });
  } catch (error) {
    console.error('[Login failed]', error);
    return json(res, 500, { error: 'login_failed' });
  }
}
