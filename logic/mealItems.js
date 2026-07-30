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
    items: ['鰹', '黒ニナ', '鶏天', '鰤塩', '鮪刺身', 'タルセット', '大S', '小S'],
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

// planLabel と人数から初期の mealCounts オブジェクトを作る
function seedMealCounts(planLabel, pax) {
  const item = PLAN_LABEL_TO_MEAL_ITEM[planLabel];
  if (!item) return {};
  const n = Math.max(1, pax || 1);
  return { [item]: n };
}

module.exports = { MEAL_CATEGORIES, ALL_MEAL_ITEMS, PLAN_LABEL_TO_MEAL_ITEM, seedMealCounts };
