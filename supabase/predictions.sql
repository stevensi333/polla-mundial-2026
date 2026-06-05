-- =====================================================================
--  WORLD CUP 2026 — EXTRA PREDICTIONS (group order, best thirds, bracket)
--  Run this ONCE in the Supabase SQL Editor, AFTER schema.sql.
--  Safe to re-run (idempotent). It only ADDS to the existing schema.
-- =====================================================================

-- ---------- new scoring knobs (added to the single app_config row) ----
alter table public.app_config add column if not exists points_group_pos     int not null default 1; -- per team in correct group position
alter table public.app_config add column if not exists points_group_perfect int not null default 3; -- bonus when a whole group's 1-4 order is exact
alter table public.app_config add column if not exists points_third         int not null default 2; -- per correct "best third-placed" team
alter table public.app_config add column if not exists points_advance       int not null default 2; -- per correct knockout advancement

-- ---------- GROUP ORDER PREDICTIONS (predict final 1st..4th per group) -
create table if not exists public.group_predictions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  grp        text not null,                 -- "Group A".."Group L"
  pos1 text, pos2 text, pos3 text, pos4 text,
  updated_at timestamptz not null default now(),
  primary key (user_id, grp)
);

-- ---------- BEST THIRD-PLACED TEAMS (predict the 8 that advance) -------
create table if not exists public.third_predictions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  teams      text[] not null default '{}',  -- up to 8 team names
  updated_at timestamptz not null default now()
);

-- ---------- KNOCKOUT ADVANCEMENT (predict who advances each tie) -------
create table if not exists public.bracket_predictions (
  user_id      uuid   not null references auth.users(id) on delete cascade,
  match_id     bigint not null references public.matches(id) on delete cascade,
  advance_team text   not null,             -- the team you think advances
  updated_at   timestamptz not null default now(),
  primary key (user_id, match_id)
);

-- ---------- ACTUAL FINAL GROUP STANDINGS (written by the function) ----
create table if not exists public.group_results (
  grp        text primary key,
  pos1 text, pos2 text, pos3 text, pos4 text,
  updated_at timestamptz not null default now()
);

-- ---------- actual best thirds live on tournament_results -------------
alter table public.tournament_results add column if not exists best_thirds text[] default '{}';

-- =====================================================================
--  ROW LEVEL SECURITY
--  group order + best thirds lock at app_config.bonus_locks_at (1st kickoff).
--  bracket advancement locks per-match at that match's kickoff.
-- =====================================================================
alter table public.group_predictions   enable row level security;
alter table public.third_predictions   enable row level security;
alter table public.bracket_predictions enable row level security;
alter table public.group_results       enable row level security;

-- everyone authenticated can read actual group standings
drop policy if exists "read group_results" on public.group_results;
create policy "read group_results" on public.group_results for select to authenticated using (true);

-- helper: is the tournament-wide bonus lock still in the future?
-- (inlined in each policy to keep this file self-contained)

-- ----- group_predictions -----
drop policy if exists "read group preds" on public.group_predictions;
create policy "read group preds" on public.group_predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select bonus_locks_at from public.app_config where id = 1) <= now()
  );

drop policy if exists "insert group preds" on public.group_predictions;
create policy "insert group preds" on public.group_predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );

drop policy if exists "update group preds" on public.group_predictions;
create policy "update group preds" on public.group_predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );

-- ----- third_predictions -----
drop policy if exists "read third preds" on public.third_predictions;
create policy "read third preds" on public.third_predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select bonus_locks_at from public.app_config where id = 1) <= now()
  );

drop policy if exists "insert third preds" on public.third_predictions;
create policy "insert third preds" on public.third_predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );

drop policy if exists "update third preds" on public.third_predictions;
create policy "update third preds" on public.third_predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and coalesce((select bonus_locks_at from public.app_config where id = 1), 'infinity') > now()
  );

-- ----- bracket_predictions (lock per match at kickoff, like score picks) -----
drop policy if exists "read bracket preds" on public.bracket_predictions;
create policy "read bracket preds" on public.bracket_predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select kickoff from public.matches m where m.id = match_id) <= now()
  );

drop policy if exists "insert bracket preds" on public.bracket_predictions;
create policy "insert bracket preds" on public.bracket_predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (select kickoff from public.matches m where m.id = match_id) > now()
  );

drop policy if exists "update bracket preds" on public.bracket_predictions;
create policy "update bracket preds" on public.bracket_predictions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (select kickoff from public.matches m where m.id = match_id) > now()
  );

-- =====================================================================
--  LEADERBOARD v2  — match + bonus + group-order + thirds + bracket
--  Drop first: the return type changed (new columns), so CREATE OR REPLACE
--  alone is rejected by Postgres ("cannot change return type").
-- =====================================================================
drop function if exists public.get_leaderboard();

create or replace function public.get_leaderboard()
returns table (
  user_id       uuid,
  display_name  text,
  exact_count   int,
  result_count  int,
  match_points  int,
  bonus_points  int,
  group_points  int,
  third_points  int,
  bracket_points int,
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
    select id, home_team, away_team, home_score, away_score, winner
    from public.matches
    where status = 'FINISHED' and home_score is not null and away_score is not null
  ),
  -- ---- per-match exact / result ----
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
    select scored.user_id,
           count(*) filter (where is_exact)  as exact_count,
           count(*) filter (where is_result) as result_count
    from scored group by scored.user_id
  ),
  -- ---- bonus (champion / finalists / semifinalists) ----
  per_bonus as (
    select
      bp.user_id,
      (case when tr.champion is not null and bp.champion = tr.champion
            then cfg.points_champion else 0 end)
      + cfg.points_finalist * coalesce((
          select count(distinct t) from unnest(array[bp.finalist1, bp.finalist2]) t
          where t is not null and t = any(tr.finalists)), 0)
      + cfg.points_semifinalist * coalesce((
          select count(distinct t) from unnest(
            array[bp.semifinalist1, bp.semifinalist2, bp.semifinalist3, bp.semifinalist4]) t
          where t is not null and t = any(tr.semifinalists)), 0) as bonus_points
    from public.bonus_predictions bp
  ),
  -- ---- group order: per correct position + perfect-group bonus ----
  per_group as (
    select
      gp.user_id,
      sum(
        (case when gp.pos1 is not null and gp.pos1 = gr.pos1 then cfg.points_group_pos else 0 end)
      + (case when gp.pos2 is not null and gp.pos2 = gr.pos2 then cfg.points_group_pos else 0 end)
      + (case when gp.pos3 is not null and gp.pos3 = gr.pos3 then cfg.points_group_pos else 0 end)
      + (case when gp.pos4 is not null and gp.pos4 = gr.pos4 then cfg.points_group_pos else 0 end)
      + (case when gp.pos1 = gr.pos1 and gp.pos2 = gr.pos2
                and gp.pos3 = gr.pos3 and gp.pos4 = gr.pos4
              then cfg.points_group_perfect else 0 end)
      )::int as group_points
    from public.group_predictions gp
    join public.group_results gr on gr.grp = gp.grp
    group by gp.user_id
  ),
  -- ---- best thirds: per correct team ----
  per_third as (
    select
      tp.user_id,
      cfg.points_third * coalesce((
        select count(distinct t) from unnest(tp.teams) t
        where t is not null and t = any(tr.best_thirds)), 0) as third_points
    from public.third_predictions tp
  ),
  -- ---- bracket: per correct advancement ----
  per_bracket as (
    select
      bk.user_id,
      cfg.points_advance * count(*) filter (
        where bk.advance_team = case
          when f.winner = 'HOME_TEAM' then f.home_team
          when f.winner = 'AWAY_TEAM' then f.away_team
          else null end
      ) as bracket_points
    from public.bracket_predictions bk
    join finished f on f.id = bk.match_id
    group by bk.user_id
  )
  select
    pr.id,
    pr.display_name,
    coalesce(pm.exact_count, 0)::int,
    coalesce(pm.result_count, 0)::int,
    (coalesce(pm.exact_count,0) * cfg.points_exact
      + coalesce(pm.result_count,0) * cfg.points_result)::int as match_points,
    coalesce(pb.bonus_points, 0)::int,
    coalesce(pg.group_points, 0)::int,
    coalesce(pt.third_points, 0)::int,
    coalesce(pk.bracket_points, 0)::int,
    (coalesce(pm.exact_count,0) * cfg.points_exact
      + coalesce(pm.result_count,0) * cfg.points_result
      + coalesce(pb.bonus_points,0)
      + coalesce(pg.group_points,0)
      + coalesce(pt.third_points,0)
      + coalesce(pk.bracket_points,0))::int as total_points
  from public.profiles pr
  left join per_match   pm on pm.user_id = pr.id
  left join per_bonus   pb on pb.user_id = pr.id
  left join per_group   pg on pg.user_id = pr.id
  left join per_third   pt on pt.user_id = pr.id
  left join per_bracket pk on pk.user_id = pr.id
  -- positional ordering (col 10 = total_points, 3 = exact_count, 2 = display_name)
  -- avoids any OUT-parameter name ambiguity.
  order by 10 desc, 3 desc, 2 asc;
end;
$$;

grant execute on function public.get_leaderboard() to authenticated;
