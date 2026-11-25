// スタッフごとのログイン（パスワードはscryptで保存し、セッションはサーバー側で管理）
const crypto = require('crypto');
const db = require('./db');

const COOKIE_NAME = 'heyawari_session';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12時間
const KEYLEN = 64;
const MAX_FAILURES = 5;            // ログイン失敗の上限
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const failures = new Map(); // username -> { count, first }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Cookieにはランダムなトークンを入れ、DBにはそのハッシュだけを保存する
async function createSessionToken(staffId, ms = SESSION_MS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ms).toISOString();
  await db.createSession(sha256(token), staffId, expiresAt);
  return token;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// 有効なセッションのスタッフを返す（無効・期限切れ・無効化済みならnull）
async function currentStaff(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  return db.getSessionStaff(sha256(token), new Date().toISOString());
}

async function requireAuth(req, res, next) {
  try {
    const staff = await currentStaff(req);
    if (!staff) return res.status(401).json({ error: 'ログインが必要です' });
    req.staff = staff;
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: !!req.secure };
}

function isLocked(username) {
  const f = failures.get(username);
  if (!f) return false;
  if (Date.now() - f.first > FAILURE_WINDOW_MS) { failures.delete(username); return false; }
  return f.count >= MAX_FAILURES;
}

function recordFailure(username) {
  const f = failures.get(username);
  if (!f || Date.now() - f.first > FAILURE_WINDOW_MS) failures.set(username, { count: 1, first: Date.now() });
  else f.count += 1;
}

// 存在しないIDでも同じ時間になるよう、ダミーのハッシュで検証する
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

async function login(req, res) {
  try {
    const username = String((req.body || {}).username || '').trim();
    const password = String((req.body || {}).password || '');
    if (!username || !password) return res.status(400).json({ error: 'IDとパスワードを入力してください' });
    if (isLocked(username)) return res.status(429).json({ error: '失敗が続いたため、しばらく待ってから再試行してください' });

    const staff = await db.getStaffByUsername(username);
    const ok = verifyPassword(password, staff ? staff.password_hash : DUMMY_HASH);
    if (!staff || !staff.active || !ok) {
      recordFailure(username);
      return res.status(401).json({ error: 'IDまたはパスワードが違います' });
    }
    failures.delete(username);
    await db.deleteExpiredSessions(new Date().toISOString());
    const token = await createSessionToken(staff.id);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: SESSION_MS });
    res.json({ ok: true, name: staff.display_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function logout(req, res) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) await db.deleteSession(sha256(token));
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSessionToken,
  currentStaff,
  requireAuth,
  login,
  logout,
};
