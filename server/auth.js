import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const cookieName = 'desserts_pos_session';
const sessionDuration = 8 * 60 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest();

export function installRegisterAuth(app, env) {
  const { POS_USER, POS_PASSWORD, POS_OWNER_USER, POS_OWNER_PASSWORD, POS_SECURE_COOKIE } = env;
  if (
    (POS_OWNER_USER || POS_OWNER_PASSWORD) &&
    (!POS_OWNER_USER ||
      POS_OWNER_USER === POS_USER ||
      !POS_OWNER_PASSWORD ||
      POS_OWNER_PASSWORD.length < 12 ||
      POS_OWNER_PASSWORD.startsWith('replace-') ||
      POS_OWNER_PASSWORD === POS_PASSWORD)
  ) {
    throw new Error(
      'Set a distinct owner username and a unique owner password of at least 12 characters.',
    );
  }
  const accounts = new Map([
    ['cashier', { username: digest(POS_USER), password: digest(POS_PASSWORD) }],
  ]);
  if (POS_OWNER_USER && POS_OWNER_PASSWORD) {
    accounts.set('owner', {
      username: digest(POS_OWNER_USER),
      password: digest(POS_OWNER_PASSWORD),
    });
  }
  const basicHash = digest(Buffer.from(`${POS_USER}:${POS_PASSWORD}`).toString('base64'));
  const sessions = new Map();

  function sessionToken(req) {
    return (req.get('cookie') ?? '').match(
      /(?:^|;\s*)desserts_pos_session=([a-f0-9]{64})(?=;|$)/,
    )?.[1];
  }

  function sessionRole(req) {
    const token = sessionToken(req);
    const session = sessions.get(token);
    if (session?.expires > Date.now()) return session.role;
    sessions.delete(token);
    return null;
  }

  const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || POS_SECURE_COOKIE === 'true',
    path: '/',
  });

  app.get('/api/session', (req, res) => {
    const role = sessionRole(req);
    res.json({ signedIn: Boolean(role), role });
  });

  app.post('/api/session', (req, res) => {
    const { username, password, role = 'cashier' } = req.body ?? {};
    const account = accounts.get(role);
    const valid =
      account &&
      typeof username === 'string' &&
      typeof password === 'string' &&
      timingSafeEqual(digest(username), account.username) &&
      timingSafeEqual(digest(password), account.password);

    if (!valid) return res.status(401).json({ error: 'Check your username and password.' });

    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expires <= now) sessions.delete(token);
    }
    sessions.delete(sessionToken(req));
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { expires: now + sessionDuration, role });
    res.cookie(cookieName, token, { ...cookieOptions(req), maxAge: sessionDuration });
    res.json({ signedIn: true, role });
  });

  app.post('/api/session/logout', (req, res) => {
    sessions.delete(sessionToken(req));
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ signedIn: false });
  });

  function requireStaff(req, res, next) {
    const [scheme, value] = (req.get('authorization') ?? '').split(' ');
    if (
      sessionRole(req) ||
      (scheme?.toLowerCase() === 'basic' && value && timingSafeEqual(digest(value), basicHash))
    )
      return next();
    res.status(401).json({ error: 'Staff sign-in required.' });
  }

  function requireOwner(req, res, next) {
    if (sessionRole(req) === 'owner') return next();
    res.status(403).json({ error: 'Only an owner can cancel billed items.' });
  }

  return { requireStaff, requireOwner };
}
