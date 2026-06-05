-- =====================================================================
--  WORLD CUP 2026 FAMILY PREDICTIONS — DATABASE SCHEMA
--  Run this whole file once in the Supabase SQL Editor.
--  Safe to re-run (uses "if not exists" / "or replace" where possible).
-- =====================================================================

-- ---------- CONFIG (scoring rules + bonus lock time) -----------------
create table if not exists public.app_config (
  id                  int primary key default 1,
  points_result       int not null default 1,   -- correct result (W/D/L)
  points_exact        int not null default 2,    -- exact scoreline
  points_champion     int not null default 5,    -- correct champion
  points_finalist     int not null default 3,    -- per correct finalist
  points_semifinalist int not null default 2,    -- per correct semifinalist
  bonus_locks_at      timestamptz,               -- set automatically to 1st kickoff
  constraint single_row check (id = 1)
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- ---------- PROFILES (one per family member) -------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------- MATCHES (single source of truth, written by the function) -
create table if not exists public.matches (
  id          bigint primary key,          -- football-data.org match id
  stage       text not null,               -- GROUP_STAGE, LAST_32, LAST_16, QUARTER_FINALS, SEMI_FINALS, THIRD_PLACE, FINAL
  grp         text,                        -- "Group A".."Group L" (null for knockouts)
  matchday    int,
  kickoff     timestamptz not null,
  home_team   text,
  away_team   text,
  home_crest  text,
  away_crest  text,
  status      text not null default 'SCHEDULED', -- SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED...
  home_score  int,
  away_score  int,
  winner      text,                         -- HOME_TEAM / AWAY_TEAM / DRAW
  updated_at  timestamptz not null default now()
);
create index if not exists matches_stage_idx on public.matches(stage);
create index if not exists matches_kickoff_idx on public.matches(kickoff);

-- ---------- PREDICTIONS (per user, per match) ------------------------
create table if not exists public.predictions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  match_id   bigint not null references public.matches(id) on delete cascade,
  home_score int not null check (home_score between 0 and 30),
  away_score int not null check (away_score between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);
create index if not exists predictions_match_idx on public.predictions(match_id);

-- ---------- BONUS PREDICTIONS (one row per user) ---------------------
create table if not exists public.bonus_predictions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  champion       text,
  finalist1      text,
  finalist2      text,
  semifinalist1  text,
  semifinalist2  text,
  semifinalist3  text,
  semifinalist4  text,
  updated_at     timestamptz not null default now()
);

-- ---------- ACTUAL TOURNAMENT OUTCOMES (written by the function) -----
create table if not exists public.tournament_results (
  id            int primary key default 1,
  champion      text,
  finalists     text[] default '{}',
  semifinalists text[] default '{}',
  updated_at    timestamptz not null default now(),
  constraint single_row_tr check (id = 1)
);
insert into public.tournament_results (id) values (1) on conflict (id) do nothing;

-- =====================================================================
--  ROW LEVEL SECURITY
-- =====================================================================
alter table public.app_config          enable row level security;
alter table public.profiles            enable row level security;
alter table public.matches             enable row level security;
alter table public.predictions         enable row level security;
alter table public.bonus_predictions   enable row level security;
alter table public.tournament_results  enable row level security;

-- Everyone logged in can read config, matches, results, profiles.
drop policy if exists "read config" on public.app_config;
create policy "read config" on public.app_config for select to authenticated using (true);

drop policy if exists "read matches" on public.matches;
create policy "read matches" on public.matches for select to authenticated using (true);

drop policy if exists "read results" on public.tournament_results;
create policy "read results" on public.tournament_results for select to authenticated using (true);

drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated using (true);

-- Profiles: you may create / edit only your own.
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Predictions: read your own anytime; read others' only AFTER kickoff.
drop policy if exists "read predictions" on public.predictions;
create policy "read predictions" on public.predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select kickoff from public.matches m where m.id = match_id) <= now()
  );

-- Predictions: insert/update/delete only your own, and only BEFORE kickoff.
drop policy if exists "insert own prediction" on public.predictions;
create policy "insert own prediction" on public.predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (select kickoff from public.matches m where m.id = match_id) > now()
  );

drop policy if exists "update own prediction" on public.predictions;
create policy "update own prediction" on public.predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (select kickoff from public.matches m where m.id = match_id) > now()
  );

drop policy if exists "delete own prediction" on public.predictions;
create policy "delete own prediction" on public.predictions
  for delete to authenticated
  using (
    auth.uid() = user_id
    and (select kickoff from public.matches m where m.id = match_id) > now()
  );

-- Bonus: read your own anytime; read others' only after the bonus lock.
drop policy if exists "read bonus" on public.bonus_predictions;
create policy "read bonus" on public.bonus_predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select bonus_locks_at from public.app_config where id = 1) <= now()
  );

drop policy if exists "upsert own bonus" on public.bonus_predictions;
create policy "upsert own bonus" on public.bonus_predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );
drop policy if exists "update own bonus" on public.bonus_predictions;
create policy "update own bonus" on public.bonus_predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );

-- Note: matches / config / tournament_results have NO write policy for
-- normal users. They are written only by the Netlify function, which uses
-- the service-role key and bypasses RLS.

-- =====================================================================
--  LEADERBOARD  (security definer: reads all rows to total points)
-- =====================================================================
create or replace function public.get_leaderboard()
returns table (
  user_id       uuid,
  display_name  text,
  exact_count   int,
  result_count  int,
  match_points  int,
  bonus_points  int,
  total_points  int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.app_config;
  tr  public.tournament_results;
begin
  select * into cfg from public.app_config where id = 1;
  select * into tr  from public.tournament_results where id = 1;

  return query
  with finished as (
    select id, home_score, away_score
    from public.matches
    where status = 'FINISHED' and home_score is not null and away_score is not null
  ),
  scored as (
    select
      p.user_id,
      (p.home_score = f.home_score and p.away_score = f.away_score) as is_exact,
      (
        not (p.home_score = f.home_score and p.away_score = f.away_score)
        and sign((p.home_score - p.away_score)::numeric) = sign((f.home_score - f.away_score)::numeric)
      ) as is_result
    from public.predictions p
    join finished f on f.id = p.match_id
  ),
  per_match as (
    select
      user_id,
      count(*) filter (where is_exact)  as exact_count,
      count(*) filter (where is_result) as result_count
    from scored
    group by user_id
  ),
  per_bonus as (
    select
      bp.user_id,
      (case when tr.champion is not null and bp.champion = tr.champion
            then cfg.points_champion else 0 end)
      + cfg.points_finalist * coalesce((
          select count(distinct t) from unnest(array[bp.finalist1, bp.finalist2]) t
          where t is not null and t = any(tr.finalists)
        ), 0)
      + cfg.points_semifinalist * coalesce((
          select count(distinct t) from unnest(
            array[bp.semifinalist1, bp.semifinalist2, bp.semifinalist3, bp.semifinalist4]) t
          where t is not null and t = any(tr.semifinalists)
        ), 0) as bonus_points
    from public.bonus_predictions bp
  )
  select
    pr.id,
    pr.display_name,
    coalesce(pm.exact_count, 0)::int,
    coalesce(pm.result_count, 0)::int,
    (coalesce(pm.exact_count,0) * cfg.points_exact
      + coalesce(pm.result_count,0) * cfg.points_result)::int as match_points,
    coalesce(pb.bonus_points, 0)::int,
    (coalesce(pm.exact_count,0) * cfg.points_exact
      + coalesce(pm.result_count,0) * cfg.points_result
      + coalesce(pb.bonus_points,0))::int as total_points
  from public.profiles pr
  left join per_match pm on pm.user_id = pr.id
  left join per_bonus pb on pb.user_id = pr.id
  order by total_points desc, coalesce(pm.exact_count,0) desc, pr.display_name asc;
end;
$$;

grant execute on function public.get_leaderboard() to authenticated;
