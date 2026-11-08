// DMPランキングの集計ロジック（UI・DBに依存しない純粋な関数だけ）

export type EntryType = "cs" | "team" | "side" | "ucs" | "gp" | "other";

export interface Season {
  id: string;
  name: string;
  top_n: number;
  sort: number;
}

export interface Entry {
  id: string;
  season_id: string;
  date: string | null;
  week_start: string;
  type: EntryType;
  event: string;
  org: string;
  venue: string;
  deck: string;
  wins: number | null;
  losses: number | null;
  participants: number | null;
  rank: number | null;
  judge: boolean;
  pt: number;
  note: string;
}

export interface Alias {
  kind: "org" | "venue";
  raw: string;
  short: string;
}

export const TYPES: [EntryType, string][] = [
  ["cs", "公認CS"],
  ["team", "公認CS（チーム戦）"],
  ["side", "GP・超CSサイドの公認CS"],
  ["ucs", "超CS・ウルトラCS"],
  ["gp", "グランプリ"],
  ["other", "ポイント対象外"],
];
export const TSHORT: Partial<Record<EntryType, string>> = {
  team: "チーム",
  side: "サイド",
  ucs: "超CS",
  gp: "GP",
  other: "対象外",
};

/* ---------- 日付・週 ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());

/** その日を含む週の月曜日（集計週は月曜〜日曜） */
export function weekOf(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return ymd(dt);
}
export function weekLabel(k: string): string {
  const [y, m, d] = k.split("-").map(Number);
  const a = new Date(y, m - 1, d);
  const b = new Date(y, m - 1, d + 6);
  return `${a.getMonth() + 1}/${a.getDate()}〜${b.getMonth() + 1}/${b.getDate()}`;
}
export const shortDate = (ds: string | null) =>
  ds ? `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}` : "";

/* ---------- 勝敗 ---------- */
export const known = (e: Entry) => typeof e.wins === "number" && typeof e.losses === "number";
export const rate = (w: number, l: number) => (w + l ? `${Math.round((w / (w + l)) * 1000) / 10}%` : "-");

/* ---------- 大会名 → 主催・会場 ---------- */
export function parseEvent(name: string): { org: string; venue: string } | null {
  let t = String(name || "")
    .replace(/【[^】]*】/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (/店舗予選/.test(t)) return { org: "全国大会予選", venue: "" };
  t = t.replace(/^第\d+回\s*/, "").replace(/\s*supported by.*$/i, "");
  let org: string;
  let rest = "";
  const m = t.match(/^(.*?)\s*CS\s*(.*)$/i);
  if (m) {
    org = m[1];
    rest = m[2];
  } else {
    const k = t.search(/\s+in(\s|$)|(?<=[^\x00-\x7f])in(?=[^\x00-\x7f])/i);
    if (k > 0) {
      org = t.slice(0, k);
      rest = " " + t.slice(k).trim();
    } else org = t;
  }
  org = org.replace(/^デュエマ/, "").replace(/デュエマ$/, "").replace(/^DM(?=[^\x00-\x7f])/, "").trim();
  const mi = rest.match(/(?:^|\s)in\s*(.+)$/i);
  const venue = (mi ? mi[1] : rest.replace(/^\d+人チーム戦/, "").replace(/^\d+周年.*$/, "")).trim();
  return { org, venue };
}

export type AliasMap = { org: Record<string, string>; venue: Record<string, string> };
export function aliasMap(list: Alias[]): AliasMap {
  const m: AliasMap = { org: {}, venue: {} };
  for (const a of list) m[a.kind][a.raw] = a.short;
  return m;
}
export const aliasOrg = (am: AliasMap, raw: string) => am.org[raw] || raw;
export const aliasVenue = (am: AliasMap, raw: string, orgRaw: string) =>
  raw ? am.venue[raw] || raw : (orgRaw && am.venue[orgRaw]) || "";
export const displayName = (e: Pick<Entry, "org" | "venue">) =>
  (e.org || "（主催未入力）") + (e.venue && e.venue !== e.org ? `＠${e.venue}` : "");

/* ---------- ポイント計算（2026年下期以降の表） ---------- */
export const inFrame = (e: Pick<Entry, "type">) => e.type !== "ucs" && e.type !== "gp" && e.type !== "other";
const BASE: [number, number][] = [
  [1, 1000], [2, 500], [4, 250], [8, 150], [16, 100], [32, 50], [64, 30], [128, 20], [256, 10],
];
const baseOf = (rank: number) => BASE.find(([r]) => rank <= r)?.[1] ?? 0;

/** [倍率, ポイント獲得者数] */
export function mult(type: EntryType, n: number): [number, number] {
  if (type === "gp") return [15, 256];
  if (type === "ucs") return [10, 256];
  if (type === "other") return [0, 0];
  if (n < 25) return [0, 0];
  if (n < 30) return [0.4, 16];
  if (n < 40) return [0.6, 16];
  if (n < 50) return [0.8, 16];
  if (n < 60) return [1, 32];
  if (n < 100) return [1.2 + 0.2 * Math.floor((n - 60) / 10), 32];
  if (n < 200) return [2 + 0.2 * Math.floor((n - 100) / 10), 64];
  if (n < 300) return [4 + 0.1 * Math.floor((n - 200) / 10), 128];
  if (n < 400) return [5 + 0.1 * Math.floor((n - 300) / 10), 128];
  if (n < 500) return [6 + 0.1 * Math.floor((n - 400) / 10), 256];
  return [7, 256];
}

export function calcPt(f: Pick<Entry, "type" | "rank" | "participants" | "judge">) {
  if (f.type === "other") return { pt: 0, m: 0, top: 0 };
  const r = f.rank || 0;
  const n = f.participants || 0;
  const big = f.type === "ucs" || f.type === "gp";
  if (!r || (!n && !big)) return null;
  const [m, top] = mult(f.type, n);
  const b = r <= top ? baseOf(r) : 0;
  return { pt: Math.round(b * m * (f.judge ? 1.2 : 1)), m: Math.round(m * 10) / 10, top };
}

/* ---------- 入賞（公認CSサポートの PP-「P」配布ライン） ---------- */
// 25〜49名 TOP4 / 50名〜 TOP8 / 400名〜 TOP16
const RAWS: number[] = (() => {
  const a = [0.4, 0.6, 0.8, 1];
  for (let x = 1.2; x < 3.81; x += 0.2) a.push(+x.toFixed(1));
  for (let x = 4; x < 6.91; x += 0.1) a.push(+x.toFixed(1));
  a.push(7, 10, 15);
  return a;
})();
const lineByN = (n: number) => (n < 25 ? 0 : n < 50 ? 4 : n < 400 ? 8 : 16);
const lineByRaw = (r: number) => (r >= 10 ? 0 : r < 1 ? 4 : r < 6 ? 8 : 16);

export function prizeLine(e: Entry): number {
  if (e.type === "other" || e.type === "gp" || e.type === "ucs") return 0;
  if (e.participants) return lineByN(e.participants);
  if (!(e.pt > 0) || !e.rank) return 0;
  // 人数が空欄なら、ptと順位から倍率を逆算して人数の帯を推定
  const b = baseOf(e.rank);
  if (!b) return 0;
  const m = e.pt / b;
  const ok = (r: number) => RAWS.some((v) => Math.abs(v - r) < 0.011);
  const r = e.judge && ok(m / 1.2) ? m / 1.2 : ok(m) ? m : ok(m / 1.2) ? m / 1.2 : 0;
  return r ? lineByRaw(r) : 0;
}
export const isPrize = (e: Entry) => {
  const n = prizeLine(e);
  return !!(e.rank && n && e.rank <= n);
};

/* ---------- 週ごとの集計 ---------- */
export interface Week {
  k: string;
  list: Entry[];
  counted: Set<string>;
  pts: number;
  w: number;
  l: number;
  known: number;
  ranked: Entry[];
}

export function weeks(es: Entry[], topN: number): Week[] {
  const idx = new Map(es.map((e, i) => [e.id, i]));
  const by = new Map<string, Entry[]>();
  for (const e of es) {
    const arr = by.get(e.week_start) ?? [];
    arr.push(e);
    by.set(e.week_start, arr);
  }
  return [...by.keys()].sort().map((k) => {
    const list = by
      .get(k)!
      .slice()
      .sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || idx.get(a.id)! - idx.get(b.id)!);
    // 公認CSは週の上位N大会だけ。同ptなら後の大会を優先
    const ranked = list
      .filter((e) => e.pt > 0 && inFrame(e))
      .sort(
        (a, b) =>
          b.pt - a.pt || (b.date || "").localeCompare(a.date || "") || idx.get(b.id)! - idx.get(a.id)!,
      )
      .slice(0, topN);
    const big = list.filter((e) => e.pt > 0 && !inFrame(e));
    const counted = new Set([...ranked, ...big].map((e) => e.id));
    const pts = [...ranked, ...big].reduce((s, e) => s + e.pt, 0);
    let w = 0, l = 0, kn = 0;
    for (const e of list) if (known(e)) { w += e.wins!; l += e.losses!; kn++; }
    return { k, list, counted, pts, w, l, known: kn, ranked };
  });
}

export function totals(es: Entry[], topN: number) {
  let w = 0, l = 0, k = 0;
  for (const e of es) if (known(e)) { w += e.wins!; l += e.losses!; k++; }
  const pts = weeks(es, topN).reduce((s, x) => s + x.pts, 0);
  return { n: es.length, w, l, known: k, pts };
}

export interface GroupRow { k: string; n: number; w: number; l: number; kn: number; prize: number; best: number }
export function group(es: Entry[], key: (e: Entry) => string): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const e of es) {
    const k = key(e) || "（未入力）";
    const g = m.get(k) ?? { k, n: 0, w: 0, l: 0, kn: 0, prize: 0, best: 0 };
    g.n++;
    if (known(e)) { g.w += e.wins!; g.l += e.losses!; g.kn++; }
    if (isPrize(e)) g.prize++;
    g.best = Math.max(g.best, e.pt);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.best - a.best);
}

export function memoText(season: Season, es: Entry[]): string {
  const t = totals(es, season.top_n);
  let out = `# ${season.name}\n総合\n参加${t.n}\n${t.known ? `${t.w}-${t.l}\n` : ""}合計${t.pts}pt\n`;
  let cum = 0;
  for (const x of weeks(es, season.top_n)) {
    out += `\n${weekLabel(x.k)} ${cum ? cum + "+" : "+"}${x.pts}pt${x.known ? ` ${x.w}-${x.l}` : ""}\n`;
    cum += x.pts;
    for (const e of x.list)
      out +=
        displayName(e) +
        (known(e) ? ` ${e.wins}-${e.losses}` : "") +
        (e.rank ? ` ${e.rank}位` : "") +
        (e.pt > 0 ? ` ${e.pt}pt` : "") +
        (e.note || "") +
        (e.deck ? ` [${e.deck}]` : "") +
        "\n";
  }
  return out;
}

/* ---------- 旧「DMP戦績ノート」(Claudeのアーティファクト版) のバックアップJSON ---------- */
interface LegacyEntry {
  wk?: string; date?: string; type?: string; event?: string; org?: string; venue?: string; shop?: string;
  deck?: string; w?: number | null; l?: number | null; ppl?: number | string; rank?: number | string;
  judge?: boolean; pt?: number; note?: string;
}
interface LegacyState {
  seasons: { name: string; topN?: number; entries: LegacyEntry[] }[];
  alias?: { org?: Record<string, string>; venue?: Record<string, string> };
}

export function parseLegacy(json: string) {
  const d = JSON.parse(json) as LegacyState;
  if (!d || !Array.isArray(d.seasons)) throw new Error("形式が違います");
  const num = (v: unknown) => (typeof v === "number" ? v : v === "" || v == null ? null : Number(v) || null);
  const seasons = d.seasons.map((s, i) => ({
    name: s.name,
    top_n: s.topN || 2,
    sort: i,
    entries: s.entries.map((e) => ({
      date: e.date || null,
      week_start: e.date ? weekOf(e.date) : /^\d{4}-\d{2}-\d{2}$/.test(e.wk || "") ? e.wk! : today(),
      type: (["cs", "team", "side", "ucs", "gp", "other"].includes(e.type || "") ? e.type : "cs") as EntryType,
      event: e.event || "",
      org: e.org ?? e.shop ?? "",
      venue: e.venue || "",
      deck: e.deck || "",
      wins: typeof e.w === "number" ? e.w : null,
      losses: typeof e.l === "number" ? e.l : null,
      participants: num(e.ppl),
      rank: num(e.rank),
      judge: e.judge ?? true,
      pt: e.pt || 0,
      note: e.note || "",
    })),
  }));
  const aliases: Alias[] = [];
  for (const kind of ["org", "venue"] as const)
    for (const [raw, short] of Object.entries(d.alias?.[kind] ?? {})) aliases.push({ kind, raw, short });
  return { seasons, aliases };
}
