// CSVの「部屋タイプ名称」→ 内部カテゴリの分類
// マスタに一致しない表記は UNKNOWN として「要確認」扱いにする（仕様書6-2）。

const ROOM_TYPE_CATEGORY = {
  '【4人個室】': 'ROOM4',
  '【6人個室】': 'ROOM6',
  '【ドミトリー】１階部屋': 'DORM_1F',
  '【ドミトリー】２階部屋': 'DORM_2F',
  '【ドミトリー】2人区画（上下）': 'DORM_PAIR',
  '【ドミトリー】3人区画': 'DORM_TRIO',
  '【ドミトリー】4人区画': 'DORM_QUAD',
};

function classifyRoomType(name) {
  if (!name) return 'UNKNOWN';
  const trimmed = name.trim();
  if (ROOM_TYPE_CATEGORY[trimmed]) return ROOM_TYPE_CATEGORY[trimmed];
  // 表記ゆれに多少強くする（全角/半角括弧・空白差異）
  const norm = trimmed.replace(/[\s　]/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）');
  for (const [k, v] of Object.entries(ROOM_TYPE_CATEGORY)) {
    const kn = k.replace(/[\s　]/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）');
    if (norm === kn) return v;
  }
  return 'UNKNOWN';
}

// 商品プラン名称 → 食事集計表の列カテゴリ（キーワードマッチ）
// OTAごとにセール名等の接頭辞が付くため、キーワード部分一致で判定する。
// ここに無いキーワードのプランは「その他」に集計され、明細に元の文言を残すので
// 運営側が随時ここへキーワードを追加すればよい（仕様書6-2の随時更新方針に対応）。
const PLAN_KEYWORDS = [
  { key: '素泊', label: '素泊', patterns: ['素泊まり', '素泊', 'room only', 'Room Only'] },
  { key: '朝食', label: '朝食', patterns: ['朝食付'] }, // "朝食夕食付"等は下の２食系に別途一致させる
  { key: 'kaisen', label: '海鮮丼', patterns: ['おまかせ海鮮丼', '海鮮丼'] },
  { key: 'maguro', label: 'マグロ丼', patterns: ['マグロ丼', '鮪丼'] },
  { key: 'maguro_zanmai', label: 'マグロ三昧', patterns: ['マグロ三昧', '熟成生本マグロ'] },
  { key: 'shokuhi', label: '食比丼', patterns: ['食比'] },
  { key: 'manzoku', label: '大満足コース', patterns: ['大満足コース', '大満足'] },
  { key: 'otona_plate', label: '大人プレート', patterns: ['大人プレート'] },
  { key: 'sushi', label: '寿司', patterns: ['寿司', 'すし'] },
  { key: 'vegan', label: 'ヴィーガン', patterns: ['ヴィーガン', 'Vegan', 'vegan'] },
  { key: 'dorm_asa', label: '朝食付(ドミトリー)', patterns: ['秘密基地のようなドミトリー'] },
];

function classifyPlan(planName, mealField) {
  const src = `${planName || ''} ${mealField || ''}`;
  for (const rule of PLAN_KEYWORDS) {
    if (rule.patterns.some((p) => src.includes(p))) {
      return rule.label;
    }
  }
  if (!planName && !mealField) return 'その他';
  return `その他:${(planName || mealField || '').slice(0, 20)}`;
}

const PLAN_LABELS = [...PLAN_KEYWORDS.map((r) => r.label), 'その他'];

module.exports = {
  ROOM_TYPE_CATEGORY,
  PLAN_LABELS,
  classifyRoomType,
  classifyPlan,
};
