-- =====================================================================
--  FIX: get_leaderboard "column reference user_id is ambiguous" (42702)
--  Run this ONCE in the Supabase SQL Editor. Safe to re-run.
--  (This is the corrected leaderboard function; it supersedes the one in
--   predictions.sql / schema.sql.)
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
  per_third as (
    select
      tp.user_id,
      cfg.points_third * coalesce((
        select count(distinct t) from unnest(tp.teams) t
        where t is not null and t = any(tr.best_thirds)), 0) as third_points
    from public.third_predictions tp
  ),
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
  order by 10 desc, 3 desc, 2 asc;
end;
$$;

grant execute on function public.get_leaderboard() to authenticated;
