// =====================================================================
//  update-results  —  Netlify Scheduled Function
//  Runs on a cron (see netlify.toml). On every run it:
//    1. Pulls all World Cup 2026 matches from football-data.org
//       (falls back to the openfootball GitHub feed if that fails)
//    2. Upserts fixtures + final scores into Supabase (service role)
//    3. Derives champion / finalists / semifinalists for bonus scoring
//    4. Sets the bonus lock time to the first kickoff
//  No manual score entry is ever needed.
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const FD_URL = "https://api.football-data.org/v4/competitions/WC/matches";
const OPENFOOTBALL_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// football-data.org stage  ->  our label is identical; we keep their strings.
const KNOCKOUT = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];

// ---- helpers --------------------------------------------------------
function groupLabel(g) {
  if (!g) return null;
  // football-data.org returns e.g. "GROUP_A"
  const m = String(g).match(/GROUP[_ ]?([A-L])/i);
  return m ? `Group ${m[1].toUpperCase()}` : null;
}

function winnerToTeam(match) {
  if (match.winner === "HOME_TEAM") return match.home_team;
  if (match.winner === "AWAY_TEAM") return match.away_team;
  return null;
}

// Map a raw football-data.org match object to our row shape.
function fromFootballData(m) {
  const ft = m.score?.fullTime ?? {};
  return {
    id: m.id,
    stage: m.stage,
    grp: groupLabel(m.group),
    matchday: m.matchday ?? null,
    kickoff: m.utcDate,
    home_team: m.homeTeam?.name ?? null,
    away_team: m.awayTeam?.name ?? null,
    home_crest: m.homeTeam?.crest ?? null,
    away_crest: m.awayTeam?.crest ?? null,
    status: m.status ?? "SCHEDULED",
    home_score: ft.home ?? null,
    away_score: ft.away ?? null,
    winner: m.score?.winner ?? null,
    updated_at: new Date().toISOString(),
  };
}

// Fallback: openfootball gives fixtures + scores but no stable ids,
// so we hash date+teams into a deterministic negative id. Names differ
// from football-data.org, so this path is best-effort (fixtures stay
// usable; scores attach to these same hashed rows).
function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return -Math.abs(h); // negative to avoid clashing with real fd ids
}
function fromOpenfootball(m) {
  const stage = m.group
    ? "GROUP_STAGE"
    : m.round === "Final"
    ? "FINAL"
    : m.round === "Semi-final"
    ? "SEMI_FINALS"
    : m.round === "Quarter-final"
    ? "QUARTER_FINALS"
    : m.round === "Round of 16"
    ? "LAST_16"
    : m.round === "Round of 32"
    ? "LAST_32"
    : "THIRD_PLACE";
  const id = hashId(`${m.date}-${m.team1}-${m.team2}`);
  const sc = m.score?.ft;
  const home_score = Array.isArray(sc) ? sc[0] : null;
  const away_score = Array.isArray(sc) ? sc[1] : null;
  let winner = null;
  if (home_score != null && away_score != null) {
    winner = home_score > away_score ? "HOME_TEAM" : home_score < away_score ? "AWAY_TEAM" : "DRAW";
  }
  return {
    id,
    stage,
    grp: m.group ? `Group ${m.group.replace(/Group\s*/i, "").trim()}` : null,
    matchday: null,
    kickoff: new Date(`${m.date}T00:00:00Z`).toISOString(),
    home_team: m.team1,
    away_team: m.team2,
    home_crest: null,
    away_crest: null,
    status: home_score != null ? "FINISHED" : "SCHEDULED",
    home_score,
    away_score,
    winner,
    updated_at: new Date().toISOString(),
  };
}

async function fetchMatches(token) {
  // ---- primary: football-data.org -----------------------------------
  if (token) {
    try {
      const res = await fetch(FD_URL, { headers: { "X-Auth-Token": token } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.matches) && data.matches.length) {
          return { source: "football-data.org", rows: data.matches.map(fromFootballData) };
        }
      } else {
        console.warn("football-data.org responded", res.status);
      }
    } catch (e) {
      console.warn("football-data.org fetch failed:", e.message);
    }
  }
  // ---- fallback: openfootball ---------------------------------------
  const res = await fetch(OPENFOOTBALL_URL);
  const data = await res.json();
  return { source: "openfootball (fallback)", rows: (data.matches || []).map(fromOpenfootball) };
}

// Derive the actual semifinalists / finalists / champion from knockout rows.
function deriveOutcomes(rows) {
  const teamsIn = (stage) => {
    const out = new Set();
    rows
      .filter((r) => r.stage === stage)
      .forEach((r) => {
        if (r.home_team) out.add(r.home_team);
        if (r.away_team) out.add(r.away_team);
      });
    return [...out];
  };
  const semifinalists = teamsIn("SEMI_FINALS");
  const finalists = teamsIn("FINAL");
  const finalRow = rows.find((r) => r.stage === "FINAL" && r.status === "FINISHED");
  const champion = finalRow ? winnerToTeam(finalRow) : null;
  return { semifinalists, finalists, champion };
}

// Compute live group tables + the 8 best third-placed teams (FIFA-style
// ordering: points, then goal difference, then goals for). Best thirds are
// only finalised from groups that have played all their matches.
function computeGroupTables(rows) {
  const groups = {};
  rows
    .filter((r) => r.stage === "GROUP_STAGE" && r.grp)
    .forEach((r) => {
      const g = (groups[r.grp] ??= new Map());
      const ensure = (t) => {
        if (!t) return null;
        if (!g.has(t)) g.set(t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
        return g.get(t);
      };
      const h = ensure(r.home_team), a = ensure(r.away_team);
      if (h && a && r.status === "FINISHED" && r.home_score != null && r.away_score != null) {
        h.p++; a.p++;
        h.gf += r.home_score; h.ga += r.away_score;
        a.gf += r.away_score; a.ga += r.home_score;
        if (r.home_score > r.away_score) { h.w++; a.l++; h.pts += 3; }
        else if (r.home_score < r.away_score) { a.w++; h.l++; a.pts += 3; }
        else { h.d++; a.d++; h.pts++; a.pts++; }
      }
    });
  const cmp = (x, y) =>
    y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team);

  const groupRows = [];
  const thirds = [];
  for (const [grp, m] of Object.entries(groups)) {
    const ordered = [...m.values()].sort(cmp);
    groupRows.push({
      grp,
      pos1: ordered[0]?.team ?? null,
      pos2: ordered[1]?.team ?? null,
      pos3: ordered[2]?.team ?? null,
      pos4: ordered[3]?.team ?? null,
      updated_at: new Date().toISOString(),
    });
    const complete = m.size === 4 && [...m.values()].every((t) => t.p >= 3);
    if (complete && ordered[2]) thirds.push(ordered[2]);
  }
  const bestThirds = thirds.sort(cmp).slice(0, 8).map((t) => t.team);
  return { groupRows, bestThirds };
}

// ---- main handler ---------------------------------------------------
export default async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOOTBALL_DATA_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Missing Supabase env vars", { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { source, rows } = await fetchMatches(FOOTBALL_DATA_TOKEN);
  if (!rows.length) return new Response("No matches fetched", { status: 502 });

  // Upsert all matches.
  const { error: upErr } = await supabase.from("matches").upsert(rows, { onConflict: "id" });
  if (upErr) {
    console.error("matches upsert error:", upErr);
    return new Response("DB upsert failed: " + upErr.message, { status: 500 });
  }

  // Bonus lock = first kickoff.
  const firstKickoff = rows
    .map((r) => r.kickoff)
    .filter(Boolean)
    .sort()[0];
  if (firstKickoff) {
    await supabase.from("app_config").update({ bonus_locks_at: firstKickoff }).eq("id", 1);
  }

  // Tournament outcomes for bonus scoring (core — always present).
  const outcomes = deriveOutcomes(rows);
  await supabase
    .from("tournament_results")
    .update({
      champion: outcomes.champion,
      finalists: outcomes.finalists,
      semifinalists: outcomes.semifinalists,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  // Extra-prediction outcomes (group standings + best thirds). These depend on
  // predictions.sql having been run; if it hasn't, fail soft so the core
  // matches/bonus pipeline keeps working.
  const { groupRows, bestThirds } = computeGroupTables(rows);
  const { error: btErr } = await supabase
    .from("tournament_results")
    .update({ best_thirds: bestThirds })
    .eq("id", 1);
  if (btErr) console.warn("best_thirds update skipped (run predictions.sql?):", btErr.message);
  if (groupRows.length) {
    const { error: grErr } = await supabase.from("group_results").upsert(groupRows, { onConflict: "grp" });
    if (grErr) console.warn("group_results upsert skipped (run predictions.sql?):", grErr.message);
  }

  const finished = rows.filter((r) => r.status === "FINISHED").length;
  const summary = `OK — source=${source}, matches=${rows.length}, finished=${finished}, champion=${outcomes.champion ?? "—"}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
}

// Run every 30 minutes. Change the cron string to taste.
export const config = { schedule: "*/30 * * * *" };
