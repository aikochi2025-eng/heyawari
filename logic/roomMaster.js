// 部屋マスタ定義
// 1階: 101-108 の8部屋。104と105の間に部屋と同サイズの「納戸」があり、部屋番号としては存在しない。
//      → 101-102-103-104 と 105-106-107-108 は連番だが、104と105は物理的に隣接していない（納戸を挟む）。
// 2階: 201-209 の9部屋。納戸は無く、201〜209は連続して隣接している。
//      納戸の直上に位置する部屋が205（1階の104と105の間＝2階の204と206の間、の直上）。
// 401: 4人個室（内部に1人用個室4つ、鍵付きで1グループ貸切）
// 601: 6人個室（内部に1人用個室6つ、鍵付きで1グループ貸切）
//
// この配置は仕様書の記述（「104と105の間に納戸」「納戸の上部は205」）と、
// 実際の部屋割り実例（108⇄209, 107⇄208, 106⇄207, 105⇄206, 104⇄204 の直上対応）から確認済み。

const FLOOR1_BLOCK_A = [101, 102, 103, 104]; // 納戸の手前
const FLOOR1_BLOCK_B = [105, 106, 107, 108]; // 納戸の奥
const FLOOR1_ROOMS = [...FLOOR1_BLOCK_A, ...FLOOR1_BLOCK_B];

const FLOOR2_ROOMS = [201, 202, 203, 204, 205, 206, 207, 208, 209]; // 連続

const ROOM_401 = 401;
const ROOM_601 = 601;

// RV: 108号室の下に配置する完全手動入力枠。CSVからの自動割当対象には含まれない。
const ROOM_RV = 'RV';

const ALL_DORM_ROOMS = [...FLOOR1_ROOMS, ...FLOOR2_ROOMS];
const ALL_ROOMS = [...ALL_DORM_ROOMS, ROOM_401, ROOM_601, ROOM_RV];

// 直上対応（1階の部屋番号 → 直上の2階の部屋番号）。納戸の直上は205。
const ABOVE_MAP = {
  101: 201, 102: 202, 103: 203, 104: 204,
  // 納戸(104と105の間) の直上 → 205
  105: 206, 106: 207, 107: 208, 108: 209,
};
const CLOSET_ABOVE = 205; // 納戸の直上部屋

// 1階の隣接ブロック（この配列内でのみ「連続部屋」とみなす。ブロックをまたいだ連続扱いはしない）
const FLOOR1_ADJACENCY_BLOCKS = [FLOOR1_BLOCK_A, FLOOR1_BLOCK_B];
// 2階は納戸が無いため全体が1つの連続ブロック
const FLOOR2_ADJACENCY_BLOCKS = [FLOOR2_ROOMS];

// 各部屋の定員（大人）。個室(401/601)は添い寝可能な子供人数も別途定義。
// 通常のドミトリー個室(1人用個室)は基本1名だが、幼児・子供の添い寝を1名まで許容する運用実態に合わせて余裕を持たせている。
// 実態と異なる場合は下記を調整してください。
const ROOM_CAPACITY = {
  default: { adults: 1, children: 1, infants: 1 },
  401: { adults: 4, children: 2, infants: 2 },
  601: { adults: 6, children: 3, infants: 3 },
  // RVは大人+子供+幼児の合計で20名まで（個別上限も念のため20とし、合計は total で制限する）
  RV: { adults: 20, children: 20, infants: 20, total: 20 },
};

function getRoomCapacity(roomNo) {
  return ROOM_CAPACITY[roomNo] || ROOM_CAPACITY.default;
}

function roomFloor(roomNo) {
  if (FLOOR1_ROOMS.includes(roomNo)) return 1;
  if (FLOOR2_ROOMS.includes(roomNo)) return 2;
  if (roomNo === ROOM_401) return '4人個室';
  if (roomNo === ROOM_601) return '6人個室';
  if (roomNo === ROOM_RV) return 'RV';
  return null;
}

module.exports = {
  FLOOR1_ROOMS,
  FLOOR2_ROOMS,
  FLOOR1_BLOCK_A,
  FLOOR1_BLOCK_B,
  FLOOR1_ADJACENCY_BLOCKS,
  FLOOR2_ADJACENCY_BLOCKS,
  ROOM_401,
  ROOM_601,
  ROOM_RV,
  ALL_DORM_ROOMS,
  ALL_ROOMS,
  ABOVE_MAP,
  CLOSET_ABOVE,
  ROOM_CAPACITY,
  getRoomCapacity,
  roomFloor,
};
