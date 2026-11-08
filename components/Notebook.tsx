"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Alias,
  type Entry,
  type EntryType,
  type Season,
  TSHORT,
  TYPES,
  aliasMap,
  aliasOrg,
  aliasVenue,
  calcPt,
  displayName,
  group,
  inFrame,
  known,
  memoText,
  parseEvent,
  parseLegacy,
  rate,
  shortDate,
  today,
  totals,
  weekLabel,
  weekOf,
  weeks,
} from "@/lib/dmp";

const COLS =
  "id,season_id,date,week_start,type,event,org,venue,deck,wins,losses,participants,rank,judge,pt,note";

type Form = Omit<Entry, "id" | "season_id"> & { id?: string; orgRaw?: string; venueRaw?: string };

const blankForm = (deck: string): Form => ({
  date: today(),
  week_start: weekOf(today()),
  type: "cs",
  event: "",
  org: "",
  venue: "",
  deck,
  wins: 0,
  losses: 0,
  participants: null,
  rank: null,
  judge: true,
  pt: 0,
  note: "",
});

const toInt = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export default function Notebook(props: {
  userLabel: string;
  initialSeasons: Season[];
  initialEntries: Entry[];
  initialAliases: Alias[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [seasons, setSeasons] = useState(props.initialSeasons);
  const [entries, setEntries] = useState(props.initialEntries);
  const [aliases, setAliases] = useState(props.initialAliases);
  const [curId, setCurId] = useState(props.initialSeasons.at(-1)?.id ?? "");
  const [tab, setTab] = useState<"log" | "stat" | "more">("log");
  const [form, setForm] = useState<Form | null>(null);
  const [delArm, setDelArm] = useState(false);
  const [status, setStatus] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const season = seasons.find((s) => s.id === curId) ?? seasons.at(-1);
  const es = useMemo(() => entries.filter((e) => e.season_id === season?.id), [entries, season?.id]);
  const am = useMemo(() => aliasMap(aliases), [aliases]);
  const topN = season?.top_n ?? 2;

  const fail = (what: string, err: { message: string }) =>
    setStatus({ text: `${what}に失敗しました：${err.message}`, warn: true });
  const ok = (text: string) => setStatus({ text });

  /* ---------- シーズン ---------- */
  async function addSeason(name: string) {
    const sort = Math.max(-1, ...seasons.map((s) => s.sort)) + 1;
    const { data, error } = await supabase
      .from("seasons")
      .insert({ name, top_n: season?.top_n ?? 2, sort })
      .select("id,name,top_n,sort")
      .single();
    if (error) return fail("シーズンの作成", error);
    setSeasons([...seasons, data as Season]);
    setCurId(data.id);
    setTab("log");
    ok("シーズンを作成しました");
  }
  async function updateSeason(name: string, top_n: number) {
    if (!season) return;
    const { error } = await supabase.from("seasons").update({ name, top_n }).eq("id", season.id);
    if (error) return fail("保存", error);
    setSeasons(seasons.map((s) => (s.id === season.id ? { ...s, name, top_n } : s)));
    ok("設定を保存しました");
  }

  /* ---------- 記録 ---------- */
  async function saveEntry() {
    if (!form || !season) return;
    if (!form.org) return setStatus({ text: "主催（または大会名）を入れてください", warn: true });
    setBusy(true);
    const { id, orgRaw, venueRaw, ...rest } = form;
    const payload = { ...rest, week_start: rest.date ? weekOf(rest.date) : rest.week_start, season_id: season.id };
    const q = id
      ? supabase.from("entries").update(payload).eq("id", id).select(COLS).single()
      : supabase.from("entries").insert(payload).select(COLS).single();
    const { data, error } = await q;
    if (error) {
      setBusy(false);
      return fail("保存", error);
    }
    const saved = data as Entry;
    setEntries(id ? entries.map((e) => (e.id === id ? saved : e)) : [...entries, saved]);

    // 主催・会場を書き換えていたら呼び名として覚える
    const learn: Alias[] = [];
    if (orgRaw && form.org && form.org !== orgRaw && form.org !== am.org[orgRaw])
      learn.push({ kind: "org", raw: orgRaw, short: form.org });
    if (venueRaw && form.venue && form.venue !== venueRaw && form.venue !== am.venue[venueRaw])
      learn.push({ kind: "venue", raw: venueRaw, short: form.venue });
    if (learn.length) {
      const { error: e2 } = await supabase.from("aliases").upsert(learn, { onConflict: "user_id,kind,raw" });
      if (!e2)
        setAliases([
          ...aliases.filter((a) => !learn.some((b) => b.kind === a.kind && b.raw === a.raw)),
          ...learn,
        ]);
    }
    setBusy(false);
    setForm(null);
    ok("保存しました");
  }
  async function deleteEntry() {
    if (!form?.id) return;
    if (!delArm) return setDelArm(true);
    const { error } = await supabase.from("entries").delete().eq("id", form.id);
    if (error) return fail("削除", error);
    setEntries(entries.filter((e) => e.id !== form.id));
    setForm(null);
    ok("削除しました");
  }
  async function deleteAlias(a: Alias) {
    const { error } = await supabase.from("aliases").delete().eq("kind", a.kind).eq("raw", a.raw);
    if (error) return fail("削除", error);
    setAliases(aliases.filter((b) => !(b.kind === a.kind && b.raw === a.raw)));
  }

  /* ---------- 旧ツールからの取り込み ---------- */
  async function importLegacy(json: string) {
    let parsed: ReturnType<typeof parseLegacy>;
    try {
      parsed = parseLegacy(json);
    } catch {
      return setStatus({ text: "読み込めませんでした。バックアップの文字列をそのまま貼ってください", warn: true });
    }
    setBusy(true);
    const base = Math.max(-1, ...seasons.map((s) => s.sort)) + 1;
    for (const [i, s] of parsed.seasons.entries()) {
      const { data, error } = await supabase
        .from("seasons")
        .insert({ name: s.name, top_n: s.top_n, sort: base + i })
        .select("id")
        .single();
      if (error) {
        setBusy(false);
        return fail("取り込み", error);
      }
      if (s.entries.length) {
        const { error: e2 } = await supabase
          .from("entries")
          .insert(s.entries.map((e) => ({ ...e, season_id: data.id })));
        if (e2) {
          setBusy(false);
          return fail("取り込み", e2);
        }
      }
    }
    if (parsed.aliases.length)
      await supabase.from("aliases").upsert(parsed.aliases, { onConflict: "user_id,kind,raw" });
    window.location.reload();
  }

  /* ---------- 入力フォーム ---------- */
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setCalc = (patch: Partial<Form>) =>
    setForm((f) => {
      if (!f) return f;
      const n = { ...f, ...patch };
      const c = calcPt(n);
      return c ? { ...n, pt: c.pt } : n;
    });
  function fromEvent(ev: string) {
    const p = parseEvent(ev);
    if (!p) return;
    const patch: Partial<Form> = {
      orgRaw: p.org,
      venueRaw: p.venue || p.org,
      org: aliasOrg(am, p.org),
      venue: aliasVenue(am, p.venue, p.org),
    };
    if (/店舗予選/.test(ev)) patch.type = "other";
    else if (/チーム戦/.test(ev) && form?.type === "cs") patch.type = "team";
    setCalc(patch);
  }
  function openNew() {
    const last = [...es].reverse().find((e) => e.deck);
    setDelArm(false);
    setForm(blankForm(last?.deck ?? ""));
  }
  function openEdit(e: Entry) {
    setDelArm(false);
    setForm({ ...e });
  }

  /* ---------- 描画 ---------- */
  const t = totals(es, topN);
  const ws = weeks(es, topN);
  const isLatest = season && season.id === seasons.at(-1)?.id;
  const uniq = (fn: (e: Entry) => string) => [...new Set(entries.map(fn).filter(Boolean))];

  return (
    <div className="wrap">
      <header>
        <h1>dmp-log</h1>
        {seasons.length > 0 && (
          <select className="season" value={season?.id} onChange={(e) => setCurId(e.target.value)}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>
      {status && <div className={"status" + (status.warn ? " warn" : "")}>{status.text}</div>}

      {!season ? (
        <FirstRun onCreate={addSeason} onImport={importLegacy} busy={busy} />
      ) : (
        <>
          <div className="tiles">
            <Tile v={t.n} label="参加" />
            <Tile v={t.known ? `${t.w}-${t.l}` : "—"} label={"勝敗" + (t.known && t.known < t.n ? `（${t.known}大会分）` : "")} />
            <Tile v={rate(t.w, t.l)} label="勝率" />
            <Tile v={t.pts.toLocaleString()} label="pt" />
          </div>
          <div className="tabs">
            {([["log", "記録"], ["stat", "成績まとめ"], ["more", "書き出し・設定"]] as const).map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>

          {tab === "log" && (
            <>
              {isLatest && <WeekHint ws={ws} topN={topN} />}
              {ws.length === 0 && <div className="empty">まだ記録がありません</div>}
              {[...ws].reverse().map((x) => (
                <div className="week" key={x.k}>
                  <div className="wh">
                    <span className="t">{weekLabel(x.k)}</span>
                    <span className="r">{x.known ? `${x.w}-${x.l}` : ""}</span>
                    <span className="p">+{x.pts}pt</span>
                  </div>
                  {x.list.map((e) => {
                    const cls = e.pt > 0 ? (x.counted.has(e.id) ? "c" : "x") : "z";
                    const sub = [
                      shortDate(e.date),
                      e.rank ? `${e.rank}位${e.participants ? `/${e.participants}${e.type === "team" ? "チーム" : "人"}` : ""}` : "",
                      e.deck,
                      e.event,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div className="row" key={e.id} onClick={() => openEdit(e)}>
                        <div className="s">
                          <div>
                            {TSHORT[e.type] && <span className="tag">{TSHORT[e.type]}</span>}
                            {e.org || "（主催未入力）"}
                            {e.venue && e.venue !== e.org && (
                              <>
                                <span className="at">＠</span>
                                {e.venue}
                              </>
                            )}
                            {e.note && ` ${e.note}`}
                          </div>
                          {sub && <small>{sub}</small>}
                        </div>
                        <span className={"wl " + (known(e) ? (e.wins! > e.losses! ? "w" : e.wins! < e.losses! ? "l" : "") : "")}>
                          {known(e) ? `${e.wins}-${e.losses}` : "—"}
                        </span>
                        <span className={"pt " + cls}>{e.pt > 0 ? `${e.pt}pt` : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <p className="muted">
                取り消し線のptは、その週の公認CS上位{topN}大会に入らず加算されていないもの（同ptなら後の大会が優先）。グランプリ・超CSは枠とは別に全部加算。
              </p>
            </>
          )}

          {tab === "stat" && (
            <>
              <h3>主催別</h3>
              <StatTable rows={group(es, (e) => e.org)} first="主催" />
              <h3>会場別</h3>
              <StatTable rows={group(es, (e) => e.venue || e.org)} first="会場" />
              <h3>デッキ別</h3>
              {es.some((e) => e.deck) ? (
                <StatTable rows={group(es, (e) => e.deck)} first="デッキ" />
              ) : (
                <div className="card muted">記録にデッキ名を入れると、ここにデッキ別の勝率が出ます。</div>
              )}
              <p className="muted">
                入賞＝PP-「P」がもらえる順位に入った回数（25〜49人はTOP4、50人〜はTOP8、400人〜はTOP16）。参加人数が空欄の大会は、ptと順位から人数の帯を逆算しています。
              </p>
            </>
          )}

          {tab === "more" && (
            <More
              season={season}
              es={es}
              aliases={aliases}
              userLabel={props.userLabel}
              onSaveSeason={updateSeason}
              onNewSeason={addSeason}
              onDeleteAlias={deleteAlias}
              onImport={importLegacy}
              busy={busy}
            />
          )}

          <button className="fab" onClick={openNew}>
            ＋ 記録
          </button>
        </>
      )}

      {form && (
        <div className="mask on" onClick={(ev) => ev.target === ev.currentTarget && setForm(null)}>
          <div className="sheet">
            <h2>{form.id ? "記録を編集" : "大会を記録"}</h2>
            <div className="f">
              <label>大会名（DMPランキングの表記を貼ると主催・会場を自動で分けます）</label>
              <input
                value={form.event}
                placeholder="例：妖精CS in ブックオフイオン橋本店"
                onChange={(e) => set({ event: e.target.value })}
                onBlur={(e) => fromEvent(e.target.value)}
              />
            </div>
            <div className="two">
              <div className="f">
                <label>主催</label>
                <input list="dl-org" value={form.org} placeholder="例：妖精" onChange={(e) => set({ org: e.target.value })} />
                <DataList id="dl-org" items={uniq((e) => e.org)} />
              </div>
              <div className="f">
                <label>会場</label>
                <input list="dl-venue" value={form.venue} placeholder="例：橋本" onChange={(e) => set({ venue: e.target.value })} />
                <DataList id="dl-venue" items={uniq((e) => e.venue)} />
              </div>
            </div>
            <div className="two">
              <div className="f">
                <label>日付</label>
                <input type="date" value={form.date ?? ""} onChange={(e) => set({ date: e.target.value || null, week_start: e.target.value ? weekOf(e.target.value) : form.week_start })} />
                <div className="wkl">{weekLabel(form.date ? weekOf(form.date) : form.week_start)}の週</div>
              </div>
              <div className="f">
                <label>大会の種類</label>
                <select className="in" value={form.type} onChange={(e) => setCalc({ type: e.target.value as EntryType })}>
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="two">
              <Stepper label="勝ち" value={form.wins} onChange={(v) => set({ wins: v, losses: form.losses ?? 0 })} />
              <Stepper label="負け" value={form.losses} onChange={(v) => set({ losses: v, wins: form.wins ?? 0 })} />
            </div>
            <div className="two">
              <div className="f">
                <label>参加人数（チーム戦はチーム数）</label>
                <input type="number" inputMode="numeric" min={0} value={form.participants ?? ""} onChange={(e) => setCalc({ participants: toInt(e.target.value) })} />
              </div>
              <div className="f">
                <label>最終順位</label>
                <input type="number" inputMode="numeric" min={1} value={form.rank ?? ""} onChange={(e) => setCalc({ rank: toInt(e.target.value) || null })} />
              </div>
            </div>
            <div className="f">
              <label className="chk">
                <input type="checkbox" checked={form.judge} onChange={(e) => setCalc({ judge: e.target.checked })} /> 認定ジャッジあり（×1.2）
              </label>
            </div>
            <div className="f">
              <label>獲得pt（自動計算・手で直してもOK）</label>
              <input type="number" inputMode="numeric" min={0} value={form.pt || ""} placeholder="0" onChange={(e) => set({ pt: toInt(e.target.value) ?? 0 })} />
              <div className="wkl">{calcNote(form)}</div>
            </div>
            <div className="f">
              <label>デッキ（任意）</label>
              <input list="dl-deck" value={form.deck} onChange={(e) => set({ deck: e.target.value })} />
              <DataList id="dl-deck" items={uniq((e) => e.deck)} />
            </div>
            <div className="f">
              <label>メモ（任意）</label>
              <input value={form.note} onChange={(e) => set({ note: e.target.value })} />
              <div className="chips">
                {["🥇", "🥈", "ベスト4", "ベスト8"].map((c) => (
                  <button key={c} type="button" onClick={() => !form.note.includes(c) && set({ note: form.note + c })}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="btns">
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={saveEntry}>
                保存
              </button>
              <button className="btn g" onClick={() => setForm(null)}>
                閉じる
              </button>
              {form.id && (
                <button className="btn d" onClick={deleteEntry}>
                  {delArm ? "本当に削除" : "削除"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function calcNote(f: Form) {
  if (f.type === "other") return "ポイント対象外の大会";
  const c = calcPt(f);
  if (!c) return inFrame(f) ? "参加人数と順位を入れると自動計算" : "順位を入れると自動計算";
  if (!c.top) return "25人未満の公認CSはポイント対象外";
  return `倍率×${c.m}・上位${c.top}名まで → ${c.pt}pt`;
}

function Tile({ v, label }: { v: string | number; label: string }) {
  return (
    <div className="tile">
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}

function WeekHint({ ws, topN }: { ws: ReturnType<typeof weeks>; topN: number }) {
  const ck = weekOf(today());
  const cw = ws.find((x) => x.k === ck);
  const used = cw?.ranked.length ?? 0;
  return (
    <div className="hint">
      今週（{weekLabel(ck)}）の公認CS枠：<b>{used}/{topN}</b>
      {used < topN ? `　あと${topN - used}大会ぶんそのまま加算` : <>　次は <b>{cw!.ranked[topN - 1].pt}pt超</b> で入れ替え</>}
    </div>
  );
}

function StatTable({ rows, first }: { rows: ReturnType<typeof group>; first: string }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{first}</th>
          <th>参加</th>
          <th>勝敗</th>
          <th>勝率</th>
          <th>入賞</th>
          <th>最高pt</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.k}>
            <td>{g.k}</td>
            <td>{g.n}</td>
            <td>{g.kn ? `${g.w}-${g.l}` : "—"}</td>
            <td>{g.kn ? rate(g.w, g.l) : "—"}</td>
            <td>{g.prize}</td>
            <td>{g.best || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  const v = value ?? 0;
  return (
    <div className="f">
      <label>{label}</label>
      <div className="step">
        <button type="button" onClick={() => onChange(Math.max(0, v - 1))}>
          −
        </button>
        <output>{value ?? "—"}</output>
        <button type="button" onClick={() => onChange(v + 1)}>
          ＋
        </button>
      </div>
    </div>
  );
}

function DataList({ id, items }: { id: string; items: string[] }) {
  return (
    <datalist id={id}>
      {items.map((x) => (
        <option key={x} value={x} />
      ))}
    </datalist>
  );
}

function CopyBox({ text, rows }: { text: string; rows?: number }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <textarea readOnly value={text} rows={rows} />
      <div className="btns">
        <button
          className="btn"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => setDone(true),
              () => setDone(false),
            )
          }
        >
          {done ? "コピーしました" : "コピー"}
        </button>
      </div>
    </>
  );
}

function FirstRun({ onCreate, onImport, busy }: { onCreate: (n: string) => void; onImport: (j: string) => void; busy: boolean }) {
  const [name, setName] = useState("26下期");
  const [json, setJson] = useState("");
  return (
    <>
      <h3>最初のシーズンを作る</h3>
      <div className="card">
        <div className="f">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim())}>
          作成
        </button>
      </div>
      <h3>前のツール（Claudeで作った戦績ノート）から取り込む</h3>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          前のツールの「書き出し・設定 → バックアップ」のコピーを貼り付けてください。シーズン・記録・呼び名をまとめて取り込みます。
        </p>
        <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={4} />
        <div className="btns">
          <button className="btn" disabled={busy || !json.trim()} onClick={() => onImport(json)}>
            取り込む
          </button>
        </div>
      </div>
    </>
  );
}

function More(props: {
  season: Season;
  es: Entry[];
  aliases: Alias[];
  userLabel: string;
  onSaveSeason: (name: string, topN: number) => void;
  onNewSeason: (name: string) => void;
  onDeleteAlias: (a: Alias) => void;
  onImport: (j: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(props.season.name);
  const [topN, setTopN] = useState(String(props.season.top_n));
  const [newName, setNewName] = useState("");
  const [json, setJson] = useState("");
  const sorted = [...props.aliases].sort((a, b) => a.kind.localeCompare(b.kind) || a.raw.localeCompare(b.raw));
  return (
    <>
      <h3>メモ形式で書き出し</h3>
      <div className="card">
        <CopyBox text={memoText(props.season, props.es)} />
      </div>

      <h3>呼び名の登録（大会名から自動で使う短い名前）</h3>
      <div className="card">
        {sorted.length === 0 && <div className="muted">まだありません</div>}
        {sorted.map((a) => (
          <div className="alias" key={a.kind + a.raw}>
            <span>
              {a.kind === "org" ? "主催" : "会場"}：{a.raw} → <b>{a.short}</b>
            </span>
            <button onClick={() => props.onDeleteAlias(a)}>削除</button>
          </div>
        ))}
        <p className="muted">記録画面で主催・会場を書き換えて保存すると、ここに自動で追加されます。</p>
      </div>

      <h3>シーズン設定</h3>
      <div className="card">
        <div className="two">
          <div className="f">
            <label>シーズン名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="f">
            <label>週ごとに加算する大会数</label>
            <input type="number" inputMode="numeric" min={1} value={topN} onChange={(e) => setTopN(e.target.value)} />
          </div>
        </div>
        <div className="btns">
          <button className="btn" onClick={() => props.onSaveSeason(name.trim() || props.season.name, Math.max(1, toInt(topN) ?? 2))}>
            設定を保存
          </button>
        </div>
      </div>

      <h3>新しいシーズン</h3>
      <div className="card">
        <div className="f">
          <input value={newName} placeholder="例：27上期" onChange={(e) => setNewName(e.target.value)} />
        </div>
        <button className="btn g" disabled={!newName.trim()} onClick={() => props.onNewSeason(newName.trim())}>
          作成して切り替え
        </button>
      </div>

      <h3>前のツールから取り込む</h3>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          前のツールのバックアップを貼ると、シーズンを追加して取り込みます（今のデータは消えません）。
        </p>
        <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={3} />
        <div className="btns">
          <button className="btn g" disabled={props.busy || !json.trim()} onClick={() => props.onImport(json)}>
            取り込む
          </button>
        </div>
      </div>

      <h3>アカウント</h3>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>{props.userLabel}</p>
        <form action="/auth/signout" method="post">
          <button className="btn d">ログアウト</button>
        </form>
      </div>
    </>
  );
}
