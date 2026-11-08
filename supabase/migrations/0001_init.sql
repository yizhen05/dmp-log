-- dmp-log 初期スキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- すべてのテーブルは Row Level Security で「自分の行だけ読める・書ける」ようにしています。

create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  top_n       int  not null default 2 check (top_n >= 1),
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists seasons_user_idx on public.seasons(user_id, sort);

create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  season_id     uuid not null references public.seasons(id) on delete cascade,
  date          date,                 -- 開催日（不明なら null）
  week_start    date not null,        -- 集計週の月曜日
  type          text not null default 'cs'
                check (type in ('cs','team','side','ucs','gp','other')),
  event         text not null default '',  -- DMPランキング上の正式な大会名
  org           text not null default '',  -- 主催（妖精、コンパス…）
  venue         text not null default '',  -- 会場の呼び名（橋本、町田…）
  deck          text not null default '',
  wins          int check (wins   >= 0),   -- 勝敗が不明なら null
  losses        int check (losses >= 0),
  participants  int check (participants >= 0),
  rank          int check (rank >= 1),
  judge         boolean not null default true,
  pt            int not null default 0 check (pt >= 0),
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists entries_user_season_idx on public.entries(user_id, season_id, week_start);

-- 大会名から自動で使う短い呼び名（例：ブックオフイオン橋本店 → 橋本）
create table if not exists public.aliases (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind     text not null check (kind in ('org','venue')),
  raw      text not null,
  short    text not null,
  primary key (user_id, kind, raw)
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
for each row execute function public.touch_updated_at();

alter table public.seasons enable row level security;
alter table public.entries enable row level security;
alter table public.aliases enable row level security;

drop policy if exists "own seasons" on public.seasons;
create policy "own seasons" on public.seasons
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.seasons s where s.id = season_id and s.user_id = (select auth.uid()))
  );

drop policy if exists "own aliases" on public.aliases;
create policy "own aliases" on public.aliases
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
