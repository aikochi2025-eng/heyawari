// スタッフアカウントの管理（サーバーのシェル、またはローカルで実行）
//   node scripts/staff.js add <ログインID> <表示名>   … パスワードは対話入力
//   node scripts/staff.js passwd <ログインID>
//   node scripts/staff.js disable <ログインID>        … 退職者など。セッションも即時失効
//   node scripts/staff.js enable <ログインID>
//   node scripts/staff.js list
// パスワードを環境変数で渡す場合: STAFF_PASSWORD=... node scripts/staff.js add ...
const readline = require('readline');
const db = require('../db');
const { hashPassword } = require('../auth');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

async function getPassword(prompt) {
  if (process.env.STAFF_PASSWORD) return process.env.STAFF_PASSWORD;
  return askPassword(prompt);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const [cmd, username, ...rest] = process.argv.slice(2);
  if (!cmd) fail('使い方: node scripts/staff.js add|passwd|disable|enable|list ...');

  await db.init();

  if (cmd === 'list') {
    const rows = await db.listStaff();
    for (const r of rows) console.log(`${r.id}\t${r.username}\t${r.display_name}\t${r.active ? '有効' : '無効'}`);
    return;
  }

  if (!username) fail('ログインIDを指定してください');
  if (!USERNAME_RE.test(username)) fail('ログインIDは英数字と _ . - の3〜32文字にしてください');

  if (cmd === 'add') {
    const displayName = rest.join(' ');
    if (!displayName) fail('表示名を指定してください');
    if (await db.getStaffByUsername(username)) fail(`${username} は既に存在します`);
    const pw = await getPassword('新しいパスワード（8文字以上）: ');
    if (!pw || pw.length < 8) fail('パスワードは8文字以上にしてください');
    await db.createStaff(username, displayName, hashPassword(pw));
    console.log(`作成しました: ${username}（${displayName}）`);
  } else if (cmd === 'passwd') {
    if (!(await db.getStaffByUsername(username))) fail(`${username} が見つかりません`);
    const pw = await getPassword('新しいパスワード（8文字以上）: ');
    if (!pw || pw.length < 8) fail('パスワードは8文字以上にしてください');
    await db.updateStaff(username, { passwordHash: hashPassword(pw) });
    console.log(`パスワードを変更しました: ${username}（既存のログインは失効しました）`);
  } else if (cmd === 'disable' || cmd === 'enable') {
    if (!(await db.getStaffByUsername(username))) fail(`${username} が見つかりません`);
    await db.updateStaff(username, { active: cmd === 'enable' });
    console.log(`${cmd === 'enable' ? '有効' : '無効'}にしました: ${username}`);
  } else {
    fail(`不明なコマンド: ${cmd}`);
  }
}

main().then(() => process.exit(0)).catch((e) => fail(e.message));
