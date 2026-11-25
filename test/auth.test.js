// ログイン必須化のテスト（予約の読み書きAPI・画面がログインなしで使えないことを確認）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const testDb = path.join(os.tmpdir(), `heyawari-test-${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${testDb}`;
delete process.env.TURSO_AUTH_TOKEN;

const db = require('../db');
const auth = require('../auth');
const { app } = require('../server');

let server;
let base;

before(async () => {
  await db.init();
  await db.createStaff('alice', 'アリス', auth.hashPassword('correct-horse-1'));
  await db.createStaff('bob', 'ボブ', auth.hashPassword('bob-password-99'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0]; // heyawari_session=...
  return { res, cookie, setCookie };
}

const noRedirect = { redirect: 'manual' };

test('ログインなしでは予約データのAPIが使えない（読み取り・書き込み・アップロード）', async () => {
  const get = await fetch(`${base}/api/assignments/2026-01-01`);
  assert.equal(get.status, 401);

  const range = await fetch(`${base}/api/assignments-range?start=2026-01-01&days=3`);
  assert.equal(range.status, 401);

  const put = await fetch(`${base}/api/assignments/2026-01-01/101`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestName: 'テスト' }),
  });
  assert.equal(put.status, 401);

  const swap = await fetch(`${base}/api/assignments/2026-01-01/swap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomA: 101, roomB: 102 }),
  });
  assert.equal(swap.status, 401);

  const del = await fetch(`${base}/api/assignments/2026-01-01/101`, { method: 'DELETE' });
  assert.equal(del.status, 401);

  const gen = await fetch(`${base}/api/generate/2026-01-01`, { method: 'POST' });
  assert.equal(gen.status, 401);

  const upload = await fetch(`${base}/api/upload`, { method: 'POST' });
  assert.equal(upload.status, 401);

  const dates = await fetch(`${base}/api/dates`);
  assert.equal(dates.status, 401);
});

test('ログインなしでは画面（index.html）が返らずログイン画面へ送られる', async () => {
  const res = await fetch(`${base}/`, noRedirect);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login.html');

  const direct = await fetch(`${base}/index.html`, noRedirect);
  assert.equal(direct.status, 302);
});

test('ログイン画面・ヘルスチェック・静的ファイルは誰でも開ける', async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const loginPage = await fetch(`${base}/login.html`);
  assert.equal(loginPage.status, 200);
  const js = await fetch(`${base}/app.js`);
  assert.equal(js.status, 200);
});

test('誤ったパスワード・存在しないIDではログインできない', async () => {
  const wrong = await login('alice', 'wrong-password');
  assert.equal(wrong.res.status, 401);
  assert.equal(wrong.cookie, '');

  const unknown = await login('nobody', 'correct-horse-1');
  assert.equal(unknown.res.status, 401);
});

test('正しいログイン後は予約API・画面が使える。ログアウトすると使えなくなる', async () => {
  const { res, cookie, setCookie } = await login('alice', 'correct-horse-1');
  assert.equal(res.status, 200);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.ok(cookie.startsWith('heyawari_session='));

  const me = await fetch(`${base}/api/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).username, 'alice');

  const get = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(get.status, 200);

  const page = await fetch(`${base}/`, { headers: { cookie }, ...noRedirect });
  assert.equal(page.status, 200);

  const out = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 200);

  // ログアウト後は同じCookieが無効になる（サーバー側で削除済み）
  const after = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(after.status, 401);
});

test('偽造・改ざんされたCookieは使えない', async () => {
  const forged = await fetch(`${base}/api/assignments/2026-01-01`, {
    headers: { cookie: 'heyawari_session=AAAAforgedTokenAAAA' },
  });
  assert.equal(forged.status, 401);
});

test('期限切れのセッションは使えない', async () => {
  const staff = await db.getStaffByUsername('alice');
  const token = await auth.createSessionToken(staff.id, -1000); // 既に期限切れ
  const res = await fetch(`${base}/api/assignments/2026-01-01`, {
    headers: { cookie: `heyawari_session=${token}` },
  });
  assert.equal(res.status, 401);
});

test('スタッフを無効化すると、既存のログインも即座に使えなくなる', async () => {
  const { res, cookie } = await login('bob', 'bob-password-99');
  assert.equal(res.status, 200);
  const before = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(before.status, 200);

  await db.updateStaff('bob', { active: false });
  const after = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(after.status, 401);

  const blocked = await login('bob', 'bob-password-99');
  assert.equal(blocked.res.status, 401);

  await db.updateStaff('bob', { active: true });
  const restored = await login('bob', 'bob-password-99');
  assert.equal(restored.res.status, 200);
});

test('パスワードを変えると、そのスタッフの既存ログインは失効する', async () => {
  const { cookie } = await login('alice', 'correct-horse-1');
  const ok = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(ok.status, 200);

  await db.updateStaff('alice', { passwordHash: auth.hashPassword('new-password-2026') });
  const stale = await fetch(`${base}/api/assignments/2026-01-01`, { headers: { cookie } });
  assert.equal(stale.status, 401);

  const old = await login('alice', 'correct-horse-1');
  assert.equal(old.res.status, 401);
  const renewed = await login('alice', 'new-password-2026');
  assert.equal(renewed.res.status, 200);
});

test('パスワードはハッシュで保存され、平文は残らない', async () => {
  const row = await db.getStaffByUsername('alice');
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('correct-horse-1'));
  assert.ok(!row.password_hash.includes('new-password-2026'));
  assert.equal(auth.verifyPassword('new-password-2026', row.password_hash), true);
  assert.equal(auth.verifyPassword('wrong', row.password_hash), false);
});

test('連続して失敗するとログインを一時的に止める', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await login('bob', 'guess-guess-1');
  assert.equal(last.res.status, 429);
});
