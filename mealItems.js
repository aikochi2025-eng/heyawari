// 食事・オプションのカウンター項目マスタ（部屋詳細モーダルの個数カウンターで使用）
// カテゴリ構成は運用中の参考アプリに合わせている。項目を増減する場合はここを編集すればよい。

const MEAL_CATEGORIES = [
  {
    key: 'stayOnly',
    title: '素泊',
    note: '単独のみ',
    color: 'gray',
    items: ['素泊'],
  },
  {
    key: 'dinner',
    title: '夕食メイン',
    note: '朝食との組み合わせOK',
    color: 'blue',
    items: ['海鮮丼', '鮪丼', '食比丼', '大P', '満足コース', '鮪コース', '寿司', 'Vegan', 'キッズカレー', '子P', 'ミニ鯛丼', 'ミニ鮪丼'],
  },
  {
    key: 'breakfast',
    title: '朝食',
    note: '夕食OK・素泊不可',
    color: 'red',
    items: ['B朝食', 'R朝食'],
  },
  {
    key: 'option',
    title: 'オプション',
    note: '最大10個',
    color: 'purple',
    max: 10,
    items: ['鰹', '黒ニナ', '鶏天', '鰤塩', '鮪刺身', 'タオルセット', '大S', '小S'],
  },
];

const ALL_MEAL_ITEMS = MEAL_CATEGORIES.flatMap((c) => c.items);

// 旧・自動分類(classify.js の PLAN_KEYWORDS)のラベル → 新カウンター項目名への初期値マッピング。
// CSVから新規予約が生成された時点で、ここに一致する項目があれば人数分を初期カウントとしてセットする。
// 一致しない場合(未知のプラン等)は 0 のまま。運用側が画面上で手動調整する想定。
const PLAN_LABEL_TO_MEAL_ITEM = {
  '素泊': '素泊',
  '海鮮丼': '海鮮丼',
  'マグロ丼': '鮪丼',
  'マグロ三昧': '鮪コース',
  '食比丼': '食比丼',
  '大満足コース': '満足コース',
  '大人プレート': '大P',
  '寿司': '寿司',
  'ヴィーガン': 'Vegan',
  '朝食': 'B朝食',
  '朝食付(ドミトリー)': 'B朝食',
};

// planLabel と人数から初期の mealCounts オブジェクトを作る(旧方式・フォールバック用)
function seedMealCounts(planLabel, pax) {
  const item = PLAN_LABEL_TO_MEAL_ITEM[planLabel];
  if (!item) return {};
  const n = Math.max(1, pax || 1);
  return { [item]: n };
}

// ---- CSVの「その他明細」(AN列)から実際の注文内容を解析する ----
// AN列には「（夕食[大人]）生本マグロ丼」「（朝食[大人]）おにぎり朝食付き」のように
// 食事ごと・人数分の品名が「／」区切りで入っている(実データで確認済み)。これを1件ずつ
// カウントする方が、商品プラン名称のキーワード分類より確実に実際の注文数を反映できる。
// 一致しない表記は静かに無視する(メモ欄に元の全文が残るので実害はない)。

// 夕食メニューの品名 → カウンター項目 (長い/specificなものを先に判定する)
const DINNER_DISH_RULES = [
  { pattern: '食べ比べ丼', item: '食比丼' },
  { pattern: '大満足コース', item: '満足コース' },
  { pattern: '三昧', item: '鮪コース' },
  { pattern: '生本マグロ丼', item: '鮪丼' },
  { pattern: 'お子様プレート', item: '子P' },
  { pattern: '大人プレート', item: '大P' },
  { pattern: 'おまかせ海鮮丼', item: '海鮮丼' },
  { pattern: '海鮮丼', item: '海鮮丼' },
  { pattern: 'キッズカレー', item: 'キッズカレー' },
  { pattern: 'お子様カレー', item: 'キッズカレー' },
  { pattern: 'ミニ鯛丼', item: 'ミニ鯛丼' },
  { pattern: 'ミニ鮪丼', item: 'ミニ鮪丼' },
  { pattern: '寿司', item: '寿司' },
  { pattern: 'ヴィーガン', item: 'Vegan' },
  { pattern: 'Vegan', item: 'Vegan' },
  { pattern: '夕食なし', item: null }, // 一致はするが加算しない(素泊まり夕食分)
];
// 朝食メニューの品名 → カウンター項目(パン=B朝食、おにぎり=R朝食)
const BREAKFAST_DISH_RULES = [
  { pattern: 'パン朝食付き', item: 'B朝食' },
  { pattern: 'おにぎり朝食付き', item: 'R朝食' },
  { pattern: '朝食なし', item: null },
];
// 冒頭に単独で並ぶ追加オーダー品目 → オプション項目
const OPTION_RULES = [
  { pattern: 'カツオ', item: '鰹' },
  { pattern: '鰹', item: '鰹' },
  { pattern: '黒ニナ', item: '黒ニナ' },
  { pattern: '鶏天', item: '鶏天' },
  { pattern: 'タオルセット', item: 'タオルセット' },
  { pattern: '鰤塩', item: '鰤塩' },
  { pattern: '鮪刺身', item: '鮪刺身' },
];

function matchRule(text, rules) {
  for (const r of rules) {
    if (text.includes(r.pattern)) return r.item;
  }
  return undefined;
}

// レンタル シュノーケルセットは大人用/子供用の表記で大S/小Sに振り分ける
function matchOption(text) {
  if (text.includes('シュノーケル')) {
    if (text.includes('子供')) return '小S';
    if (text.includes('大人')) return '大S';
  }
  return matchRule(text, OPTION_RULES);
}

function parseMealCountsFromDetails(otherDetails) {
  const counts = {};
  if (!otherDetails) return counts;
  const segments = otherDetails.split('／').map((s) => s.trim()).filter(Boolean);
  const add = (item) => { if (item) counts[item] = (counts[item] || 0) + 1; };
  for (const seg of segments) {
    const m = seg.match(/^（(夕食|朝食)\[[^\]]*\]）(.+)$/);
    if (m) {
      const [, mealTime, dish] = m;
      add(mealTime === '夕食' ? matchRule(dish, DINNER_DISH_RULES) : matchRule(dish, BREAKFAST_DISH_RULES));
    } else {
      add(matchOption(seg));
    }
  }
  return counts;
}

// 予約1件分のmealCountsを決める。AN列(その他明細)から実際の注文内容が解析できれば
// それを優先し、解析できない(AN列が空 等)場合のみ商品プラン名称のキーワード分類にフォールバックする。
function seedMealCountsSmart({ otherDetails, planLabel, adults, children }) {
  const parsed = parseMealCountsFromDetails(otherDetails);
  if (Object.keys(parsed).length > 0) return parsed;
  return seedMealCounts(planLabel, (adults || 0) + (children || 0));
}

module.exports = {
  MEAL_CATEGORIES, ALL_MEAL_ITEMS, PLAN_LABEL_TO_MEAL_ITEM,
  seedMealCounts, parseMealCountsFromDetails, seedMealCountsSmart,
};
