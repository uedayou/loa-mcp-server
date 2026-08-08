// The 47 prefectures of Japan (1都1道2府43県). This enumeration is
// effectively immutable, so it's hardcoded rather than fetched at runtime.
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
  "沖縄県",
] as const;

// Finds the prefecture that is a prefix of the given entity path, if any.
export function findPrefecturePrefix(entityPath: string): string | undefined {
  return PREFECTURES.find((pref) => entityPath.startsWith(pref));
}

// Whether `name` is exactly one of the 47 prefecture names (not a
// municipality/ward/town within one). Used to gate features that are only
// meaningful at the prefecture level (e.g. dropSmallIslands, see
// islandFilter.ts) — a resolved AddressFeature's `properties.name` for a
// prefecture-level entity is the bare prefecture name itself (verified live,
// e.g. "東京都" -> properties.name === "東京都" with no `municipality` set).
export function isPrefectureName(name: string | undefined): boolean {
  return name !== undefined && (PREFECTURES as readonly string[]).includes(name);
}
