// =====================================================================
//  Family World Cup 2026 — front-end app logic
//  Uses Supabase (Auth + Postgres) directly from the browser.
//  Row Level Security in the database enforces all the rules; the anon
//  key here is public on purpose.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.APP_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  alert("Open assets/config.js and add your Supabase URL + anon key first.");
}
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const STAGE_LABEL = {
  LAST_32: "Round of 32", LAST_16: "Round of 16", QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals", THIRD_PLACE: "Third place", FINAL: "Final",
};
const STAGE_ORDER = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
const isKnockout = (m) => m.stage && m.stage !== "GROUP_STAGE";
const stageLabel = (s) => STAGE_LABEL[s] || String(s).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const state = {
  user: null, profile: null,
  config: null, results: null,
  matches: [], myPreds: new Map(), othersPreds: new Map(),
  bonus: null, names: new Map(), authMode: "login",
  groupPreds: new Map(), thirdPred: { teams: [] },
  bracketPreds: new Map(), bracketOthers: new Map(),
};

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isLocked = (m) => new Date(m.kickoff).getTime() <= Date.now();
const bonusLocked = () => state.config?.bonus_locks_at && new Date(state.config.bonus_locks_at).getTime() <= Date.now();
function fmtKick(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ---- Saudi Arabia time (Asia/Riyadh, UTC+3) ----
const SA_TZ = "Asia/Riyadh";
const saDateKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SA_TZ }); // YYYY-MM-DD
const fmtSADate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone: SA_TZ, weekday: "long", day: "numeric", month: "long" });
const fmtSATime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { timeZone: SA_TZ, hour: "2-digit", minute: "2-digit" });

// Live group standings computed from finished group matches.
function groupStandings(groupName) {
  const ms = state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp === groupName);
  const table = new Map();
  const crests = new Map();
  const ensure = (t) => {
    if (!table.has(t)) table.set(t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    return table.get(t);
  };
  ms.forEach((m) => {
    if (m.home_team) { ensure(m.home_team); if (m.home_crest) crests.set(m.home_team, m.home_crest); }
    if (m.away_team) { ensure(m.away_team); if (m.away_crest) crests.set(m.away_team, m.away_crest); }
    if (m.status === "FINISHED" && m.home_score != null && m.away_score != null) {
      const h = ensure(m.home_team), a = ensure(m.away_team);
      h.p++; a.p++;
      h.gf += m.home_score; h.ga += m.away_score;
      a.gf += m.away_score; a.ga += m.home_score;
      if (m.home_score > m.away_score) { h.w++; a.l++; h.pts += 3; }
      else if (m.home_score < m.away_score) { a.w++; h.l++; a.pts += 3; }
      else { h.d++; a.d++; h.pts++; a.pts++; }
    }
  });
  const rows = [...table.values()].sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team)
  );
  return { rows, crests };
}
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show" + (isErr ? " error" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = "toast"), 2400);
}
function pointsFor(pred, m) {
  if (!pred || m.home_score == null || m.away_score == null) return 0;
  const P = state.config;
  if (pred.home_score === m.home_score && pred.away_score === m.away_score) return P.points_exact;
  const a = Math.sign(pred.home_score - pred.away_score);
  const b = Math.sign(m.home_score - m.away_score);
  return a === b ? P.points_result : 0;
}

// =====================================================================
//  AUTH
// =====================================================================
function showAuth() { $("#auth-view").classList.remove("hidden"); $("#app-view").classList.add("hidden"); }
function showApp() { $("#auth-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); }

$$(".seg-btn").forEach((b) =>
  b.addEventListener("click", () => {
    state.authMode = b.dataset.mode;
    $$(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    $("#name-field").style.display = state.authMode === "signup" ? "block" : "none";
    $("#auth-submit").textContent = state.authMode === "signup" ? "Create account" : "Log in";
    $("#password").autocomplete = state.authMode === "signup" ? "new-password" : "current-password";
    $("#auth-msg").textContent = "";
  })
);

$("#auth-submit").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const name = $("#display-name").value.trim();
  const msg = $("#auth-msg");
  msg.className = "msg"; msg.textContent = "";
  if (!email || !password) { msg.className = "msg error"; msg.textContent = "Email and password required."; return; }

  $("#auth-submit").disabled = true;
  try {
    if (state.authMode === "signup") {
      if (!name) { throw new Error("Please enter your name."); }
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      state._pendingName = name;
      if (!data.session) {
        msg.textContent = "Account created. Check your email to confirm, then log in.";
        return; // email confirmation is on
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) {
    msg.className = "msg error"; msg.textContent = e.message || "Something went wrong.";
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#logout").addEventListener("click", () => sb.auth.signOut());

sb.auth.onAuthStateChange(async (_evt, session) => {
  if (session?.user) {
    state.user = session.user;
    await ensureProfile();
    showApp();
    await loadAll();
  } else {
    state.user = null;
    showAuth();
  }
});

async function ensureProfile() {
  const { data } = await sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (data) { state.profile = data; return; }
  const name = state._pendingName || state.user.email.split("@")[0];
  const { data: created } = await sb
    .from("profiles").upsert({ id: state.user.id, display_name: name }).select().maybeSingle();
  state.profile = created || { id: state.user.id, display_name: name };
}

// =====================================================================
//  DATA LOADING
// =====================================================================
async function loadAll() {
  $("#who").textContent = state.profile?.display_name || "";
  const [{ data: conf }, { data: res }, { data: matches }, { data: profiles }] = await Promise.all([
    sb.from("app_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("tournament_results").select("*").eq("id", 1).maybeSingle(),
    sb.from("matches").select("*").order("kickoff", { ascending: true }),
    sb.from("profiles").select("id,display_name"),
  ]);
  state.config = conf || { points_result: 1, points_exact: 2, points_champion: 5, points_finalist: 3, points_semifinalist: 2 };
  state.results = res || {};
  state.matches = matches || [];
  state.names = new Map((profiles || []).map((p) => [p.id, p.display_name]));

  await loadPredictions();
  await loadBonus();
  await loadExtraPreds();
  renderActiveTab();
}

// Group-order, best-thirds, and bracket picks. Fails soft if predictions.sql
// hasn't been applied yet (tables missing) so the rest of the app still works.
async function loadExtraPreds() {
  const [gp, tp, bk] = await Promise.all([
    sb.from("group_predictions").select("user_id,grp,pos1,pos2,pos3,pos4").eq("user_id", state.user.id),
    sb.from("third_predictions").select("teams").eq("user_id", state.user.id).maybeSingle(),
    sb.from("bracket_predictions").select("match_id,user_id,advance_team"),
  ]);
  state.groupPreds = new Map();
  (gp.data || []).forEach((r) => state.groupPreds.set(r.grp, r));
  state.thirdPred = tp.data || { teams: [] };
  state.bracketPreds = new Map();
  state.bracketOthers = new Map();
  (bk.data || []).forEach((p) => {
    if (p.user_id === state.user.id) state.bracketPreds.set(p.match_id, p.advance_team);
    else {
      if (!state.bracketOthers.has(p.match_id)) state.bracketOthers.set(p.match_id, []);
      state.bracketOthers.get(p.match_id).push(p);
    }
  });
}

async function loadPredictions() {
  // RLS returns: all of MY picks + OTHERS' picks only for matches past kickoff.
  const { data } = await sb.from("predictions").select("match_id,user_id,home_score,away_score");
  state.myPreds = new Map();
  state.othersPreds = new Map();
  (data || []).forEach((p) => {
    if (p.user_id === state.user.id) {
      state.myPreds.set(p.match_id, p);
    } else {
      if (!state.othersPreds.has(p.match_id)) state.othersPreds.set(p.match_id, []);
      state.othersPreds.get(p.match_id).push(p);
    }
  });
}

async function loadBonus() {
  const { data } = await sb.from("bonus_predictions").select("*").eq("user_id", state.user.id).maybeSingle();
  state.bonus = data || {};
}

// =====================================================================
//  TABS
// =====================================================================
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".panel").forEach((p) => p.classList.add("hidden"));
    $("#tab-" + t.dataset.tab).classList.remove("hidden");
    state.activeTab = t.dataset.tab;
    renderActiveTab();
  })
);
function renderActiveTab() {
  const tab = state.activeTab || "groups";
  if (tab === "groups") renderGroups();
  else if (tab === "knockouts") renderKnockouts();
  else if (tab === "bonus") renderBonus();
  else if (tab === "picks") renderPicks();
  else if (tab === "info") renderInfo();
  else if (tab === "board") renderBoard();
}

// =====================================================================
//  MATCH ROW (shared by group + knockout)
// =====================================================================
function matchRow(m, opts = {}) {
  const locked = isLocked(m);
  const finished = m.status === "FINISHED" && m.home_score != null;
  const live = ["IN_PLAY", "PAUSED"].includes(m.status);
  const mine = state.myPreds.get(m.id);
  const hv = mine ? mine.home_score : "";
  const av = mine ? mine.away_score : "";

  let statusPill = `<span class="pill open">Open</span>`;
  if (live) statusPill = `<span class="pill live">● Live</span>`;
  else if (finished) statusPill = `<span class="pill points">+${pointsFor(mine, m)} pts</span>`;
  else if (locked) statusPill = `<span class="pill locked">Locked</span>`;

  const crest = (url) => (url ? `<img class="crest" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'"/>` : `<span class="crest"></span>`);
  const home = m.home_team || "TBD";
  const away = m.away_team || "TBD";
  const disabled = locked ? "disabled" : "";

  let actual = "";
  if (finished) actual = `<span class="actual">Final: <b>${m.home_score}–${m.away_score}</b></span>`;
  else if (live && m.home_score != null) actual = `<span class="actual">Live: <b>${m.home_score}–${m.away_score}</b></span>`;

  // others' picks (only present after kickoff via RLS)
  let others = "";
  const list = state.othersPreds.get(m.id);
  if (locked && list?.length) {
    const chips = list
      .map((p) => `<span class="chip"><b>${esc(state.names.get(p.user_id) || "?")}</b> ${p.home_score}–${p.away_score}</span>`)
      .join("");
    others = `<div class="others">Picks: ${chips}</div>`;
  }

  // "who advances" picker (knockouts only, both teams known)
  let adv = "";
  if (opts.advance && m.home_team && m.away_team) {
    const mineAdv = state.bracketPreds.get(m.id);
    const actualAdv = finished
      ? (m.winner === "HOME_TEAM" ? m.home_team : m.winner === "AWAY_TEAM" ? m.away_team : null)
      : null;
    const advBtn = (team) => {
      const sel = mineAdv === team ? " sel" : "";
      const correct = actualAdv && actualAdv === team ? " correct" : "";
      return `<button class="adv-btn${sel}${correct}" data-team="${esc(team)}" ${locked ? "disabled" : ""}>${esc(team)}</button>`;
    };
    adv = `<div class="advrow"><span class="advlbl">Advances:</span>${advBtn(m.home_team)}${advBtn(m.away_team)}</div>`;
  }

  return `
  <div class="match" data-id="${m.id}">
    <div class="side home">${crest(m.home_crest)}<span class="tname">${esc(home)}</span></div>
    <div class="score-in">
      <input type="number" min="0" max="30" value="${hv}" data-side="home" ${disabled} inputmode="numeric"/>
      <span class="vs">:</span>
      <input type="number" min="0" max="30" value="${av}" data-side="away" ${disabled} inputmode="numeric"/>
    </div>
    <div class="side away"><span class="tname">${esc(away)}</span>${crest(m.away_crest)}</div>
    <div class="meta">
      <span class="kick">${fmtKick(m.kickoff)}</span>
      <span style="display:flex;gap:8px;align-items:center">
        ${actual}<span class="saved-tag">Saved ✓</span>${statusPill}
      </span>
    </div>
    ${adv}
    ${others}
  </div>`;
}

// wire the knockout "who advances" buttons
function wireAdvance(root) {
  $$(".match", root).forEach((row) => {
    const id = Number(row.dataset.id);
    $$(".adv-btn", row).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const team = btn.dataset.team;
        const { error } = await sb
          .from("bracket_predictions")
          .upsert({ user_id: state.user.id, match_id: id, advance_team: team, updated_at: new Date().toISOString() },
                  { onConflict: "user_id,match_id" });
        if (error) { toast("Locked — kickoff has passed.", true); return; }
        state.bracketPreds.set(id, team);
        $$(".adv-btn", row).forEach((b) => b.classList.toggle("sel", b.dataset.team === team));
        toast("Advance pick saved ✓");
      })
    );
  });
}

// debounce-save a single match prediction
function wireMatchInputs(root) {
  $$(".match", root).forEach((row) => {
    const id = Number(row.dataset.id);
    const inputs = $$("input", row);
    const tag = $(".saved-tag", row);
    let timer;
    inputs.forEach((inp) =>
      inp.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const h = inputs[0].value, a = inputs[1].value;
          if (h === "" || a === "") return;
          const home_score = Math.max(0, Math.min(30, parseInt(h, 10)));
          const away_score = Math.max(0, Math.min(30, parseInt(a, 10)));
          const { error } = await sb
            .from("predictions")
            .upsert({ user_id: state.user.id, match_id: id, home_score, away_score, updated_at: new Date().toISOString() },
                    { onConflict: "user_id,match_id" });
          if (error) { toast("Locked — kickoff has passed.", true); return; }
          state.myPreds.set(id, { match_id: id, user_id: state.user.id, home_score, away_score });
          tag.classList.add("show"); setTimeout(() => tag.classList.remove("show"), 1200);
        }, 550);
      })
    );
  });
}

// =====================================================================
//  GROUP STAGE
// =====================================================================
function renderGroups() {
  const el = $("#tab-groups");
  const groupMatches = state.matches.filter((m) => m.stage === "GROUP_STAGE");
  if (!groupMatches.length) { el.innerHTML = emptyState(); return; }

  const byGroup = {};
  groupMatches.forEach((m) => { (byGroup[m.grp || "Group ?"] ??= []).push(m); });

  el.innerHTML =
    `<p class="note">Predict every group match. Each one locks at kickoff. Exact score = 2 pts, correct result = 1 pt.</p>` +
    Object.keys(byGroup).sort().map((g) => {
      const rows = byGroup[g].map(matchRow).join("");
      return `<div class="group">
        <div class="group-head"><h3>${esc(g)}</h3><span class="chev">▾</span></div>
        <div class="group-body">${rows}</div>
      </div>`;
    }).join("");

  $$(".group-head", el).forEach((h) =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"))
  );
  wireMatchInputs(el);
}

// =====================================================================
//  KNOCKOUTS
// =====================================================================
function renderKnockouts() {
  const el = $("#tab-knockouts");
  const ko = state.matches.filter(isKnockout);
  if (!ko.length) {
    el.innerHTML = `<div class="empty">The knockout bracket appears here automatically once the group stage finishes and the fixtures are set.</div>`;
    return;
  }
  const byStage = {};
  ko.forEach((m) => { (byStage[m.stage] ??= []).push(m); });
  // known stages first in bracket order, then any unexpected stages by kickoff
  const stages = [
    ...STAGE_ORDER.filter((s) => byStage[s]),
    ...Object.keys(byStage).filter((s) => !STAGE_ORDER.includes(s)),
  ];
  el.innerHTML =
    `<p class="note">Predict the score AND tap who you think <b>advances</b> each tie. Score: exact 2 / result 1. Correct advancement: ${state.config?.points_advance ?? 2} pts. Both lock at kickoff.</p>` +
    stages.map((s) => {
      const rows = byStage[s].map((m) => matchRow(m, { advance: true })).join("");
      return `<div class="group">
        <div class="group-head"><h3>${stageLabel(s)}</h3><span class="chev">▾</span></div>
        <div class="group-body">${rows}</div>
      </div>`;
    }).join("");
  $$(".group-head", el).forEach((h) =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"))
  );
  wireMatchInputs(el);
  wireAdvance(el);
}

// =====================================================================
//  BONUS PICKS
// =====================================================================
function teamList() {
  const set = new Set();
  state.matches.filter((m) => m.stage === "GROUP_STAGE").forEach((m) => {
    if (m.home_team) set.add(m.home_team);
    if (m.away_team) set.add(m.away_team);
  });
  return [...set].sort();
}
function selectFor(field, current, teams, disabled) {
  const opts = `<option value="">— pick —</option>` +
    teams.map((t) => `<option value="${esc(t)}" ${t === current ? "selected" : ""}>${esc(t)}</option>`).join("");
  return `<select class="pick" data-field="${field}" ${disabled}>${opts}</select>`;
}
function renderBonus() {
  const el = $("#tab-bonus");
  const teams = teamList();
  if (!teams.length) { el.innerHTML = emptyState(); return; }
  const locked = bonusLocked();
  const b = state.bonus || {};
  const r = state.results || {};
  const dis = locked ? "disabled" : "";
  const inArr = (t, arr) => t && Array.isArray(arr) && arr.includes(t);

  const lockNote = locked
    ? `<p class="note">Bonus picks are locked (the tournament has started).</p>`
    : `<p class="note">Lock in your tournament predictions before the first kickoff${state.config?.bonus_locks_at ? " (" + fmtKick(state.config.bonus_locks_at) + ")" : ""}. Champion = 5 pts, each finalist = 3, each semifinalist = 2.</p>`;

  el.innerHTML = lockNote + `<div class="bonus-grid">
    <div class="bonus-card">
      <h4>🏆 Champion <small style="color:var(--gold)">${r.champion ? "· actual: " + esc(r.champion) : ""}</small></h4>
      <p class="hint">Who lifts the trophy? Worth ${state.config.points_champion} pts.</p>
      ${selectFor("champion", b.champion, teams, dis)}
    </div>
    <div class="bonus-card">
      <h4>🥈 Finalists</h4>
      <p class="hint">The two teams in the final. ${state.config.points_finalist} pts each.</p>
      <div class="bonus-row">
        ${selectFor("finalist1", b.finalist1, teams, dis)}
        ${selectFor("finalist2", b.finalist2, teams, dis)}
      </div>
    </div>
    <div class="bonus-card">
      <h4>🥉 Semi-finalists</h4>
      <p class="hint">The four teams in the semis. ${state.config.points_semifinalist} pts each.</p>
      <div class="bonus-row">
        ${selectFor("semifinalist1", b.semifinalist1, teams, dis)}
        ${selectFor("semifinalist2", b.semifinalist2, teams, dis)}
        ${selectFor("semifinalist3", b.semifinalist3, teams, dis)}
        ${selectFor("semifinalist4", b.semifinalist4, teams, dis)}
      </div>
    </div>
  </div>`;

  if (!locked) {
    $$("select.pick", el).forEach((sel) =>
      sel.addEventListener("change", async () => {
        const payload = { user_id: state.user.id, updated_at: new Date().toISOString() };
        $$("select.pick", el).forEach((s) => (payload[s.dataset.field] = s.value || null));
        const { error } = await sb.from("bonus_predictions").upsert(payload, { onConflict: "user_id" });
        if (error) { toast("Could not save (maybe locked).", true); return; }
        state.bonus = payload;
        toast("Bonus pick saved ✓");
      })
    );
  }
}

// =====================================================================
//  GROUP-ORDER & BEST-THIRDS PREDICTIONS
// =====================================================================
function teamsInGroup(g) {
  const s = new Set();
  state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp === g).forEach((m) => {
    if (m.home_team) s.add(m.home_team);
    if (m.away_team) s.add(m.away_team);
  });
  return [...s].sort();
}

function renderPicks() {
  const el = $("#tab-picks");
  const groupNames = [...new Set(
    state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp).map((m) => m.grp)
  )].sort();
  if (!groupNames.length) { el.innerHTML = emptyState(); return; }

  const locked = bonusLocked();
  const dis = locked ? "disabled" : "";
  const C = state.config;

  // ---- group order cards (4 ordered dropdowns each) ----
  const orderCards = groupNames.map((g) => {
    const teams = teamsInGroup(g);
    const pred = state.groupPreds.get(g) || {};
    const sel = (pos, cur) => {
      const opts = `<option value="">—</option>` +
        teams.map((t) => `<option value="${esc(t)}" ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
      return `<select class="gpick" data-grp="${esc(g)}" data-pos="${pos}" ${dis}>${opts}</select>`;
    };
    return `<div class="bonus-card">
      <h4>${esc(g)}</h4>
      <div class="order-rows">
        <label><span class="ord">1</span>${sel("pos1", pred.pos1)}</label>
        <label><span class="ord">2</span>${sel("pos2", pred.pos2)}</label>
        <label><span class="ord">3</span>${sel("pos3", pred.pos3)}</label>
        <label><span class="ord">4</span>${sel("pos4", pred.pos4)}</label>
      </div>
    </div>`;
  }).join("");

  // ---- best thirds (8 dropdowns of all teams) ----
  const allTeams = teamList();
  const myThirds = Array.isArray(state.thirdPred?.teams) ? state.thirdPred.teams : [];
  const thirdSel = (i) => {
    const cur = myThirds[i] || "";
    const opts = `<option value="">—</option>` +
      allTeams.map((t) => `<option value="${esc(t)}" ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
    return `<select class="tpick" data-i="${i}" ${dis}>${opts}</select>`;
  };
  const thirdsCard = `<div class="bonus-card">
    <h4>🥉 Best third-placed teams</h4>
    <p class="hint">8 of the 12 third-place teams reach the Round of 32. ${C.points_third} pts each correct.</p>
    <div class="thirds-grid">${[0,1,2,3,4,5,6,7].map(thirdSel).join("")}</div>
  </div>`;

  const note = locked
    ? `<p class="note">These picks are locked (the tournament has started).</p>`
    : `<p class="note">Predict each group's final 1–4 order and the 8 best third-place teams. Locks at the first kickoff${C?.bonus_locks_at ? " (" + fmtKick(C.bonus_locks_at) + ")" : ""}. Correct position = ${C.points_group_pos} pt · perfect group = +${C.points_group_perfect} · each correct third = ${C.points_third}.</p>`;

  el.innerHTML = note +
    `<h3 class="sec">📊 Group final standings</h3><div class="bonus-grid picks-grid">${orderCards}</div>` +
    `<h3 class="sec">🥉 Best third-placed teams</h3><div class="bonus-grid">${thirdsCard}</div>`;

  if (locked) return;

  $$("select.gpick", el).forEach((s) =>
    s.addEventListener("change", async () => {
      const g = s.dataset.grp;
      const row = { user_id: state.user.id, grp: g, updated_at: new Date().toISOString() };
      $$("select.gpick", el).filter((x) => x.dataset.grp === g).forEach((x) => (row[x.dataset.pos] = x.value || null));
      const { error } = await sb.from("group_predictions").upsert(row, { onConflict: "user_id,grp" });
      if (error) { toast("Could not save (locked?).", true); return; }
      state.groupPreds.set(g, row);
      toast(esc(g) + " order saved ✓");
    })
  );

  $$("select.tpick", el).forEach((s) =>
    s.addEventListener("change", async () => {
      const arr = [];
      $$("select.tpick", el).forEach((x) => { if (x.value) arr.push(x.value); });
      const teams = [...new Set(arr)];
      const { error } = await sb.from("third_predictions")
        .upsert({ user_id: state.user.id, teams, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) { toast("Could not save (locked?).", true); return; }
      state.thirdPred = { teams };
      toast("Best thirds saved ✓");
    })
  );
}

// =====================================================================
//  GROUPS & SCHEDULE  (info only — who's in each group + Saudi-time fixtures)
// =====================================================================
function renderInfo() {
  const el = $("#tab-info");
  if (!state.matches.length) { el.innerHTML = emptyState(); return; }

  const crest = (url) =>
    url ? `<img class="crest sm" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'"/>` : `<span class="crest sm"></span>`;

  // ---- Group tables (live standings; before kickoff everything is 0) ----
  const groups = [...new Set(
    state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp).map((m) => m.grp)
  )].sort();

  const groupsHtml = groups.map((g) => {
    const { rows, crests } = groupStandings(g);
    const body = rows.map((r, i) => `
      <tr${i < 2 ? ' class="qual"' : ""}>
        <td class="pos">${i + 1}</td>
        <td class="tm">${crest(crests.get(r.team))}<span>${esc(r.team)}</span></td>
        <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td>
        <td class="pts">${r.pts}</td>
      </tr>`).join("");
    return `<div class="group">
      <div class="group-head"><h3>${esc(g)}</h3><span class="chev">▾</span></div>
      <div class="group-body">
        <table class="gtable">
          <thead><tr><th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  // ---- Full schedule, grouped by Saudi-time date ----
  const sorted = [...state.matches].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const byDay = {};
  sorted.forEach((m) => { (byDay[saDateKey(m.kickoff)] ??= []).push(m); });

  const schedHtml = Object.keys(byDay).sort().map((day) => {
    const items = byDay[day].map((m) => {
      const label = m.grp || stageLabel(m.stage);
      const finished = m.status === "FINISHED" && m.home_score != null;
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      const scoreOrVs = finished || (live && m.home_score != null)
        ? `<b class="sc">${m.home_score}–${m.away_score}</b>`
        : `<span class="vs">v</span>`;
      const flag = live ? `<span class="pill live">● Live</span>` : finished ? `<span class="pill points">FT</span>` : "";
      return `<div class="srow">
        <span class="stime">${fmtSATime(m.kickoff)}</span>
        <span class="steams">
          <span class="sh">${crest(m.home_crest)}${esc(m.home_team || "TBD")}</span>
          ${scoreOrVs}
          <span class="sa">${esc(m.away_team || "TBD")}${crest(m.away_crest)}</span>
        </span>
        <span class="stag">${esc(label)} ${flag}</span>
      </div>`;
    }).join("");
    return `<div class="sday"><div class="sday-head">${fmtSADate(byDay[day][0].kickoff)}</div>${items}</div>`;
  }).join("");

  el.innerHTML =
    `<p class="note">Group tables update live as results come in (top 2 qualify, shaded). All kickoff times shown in <b>Saudi Arabia time (UTC+3)</b>.</p>` +
    `<div class="seg info-seg">
       <button class="seg-btn active" data-view="tables">Group tables</button>
       <button class="seg-btn" data-view="schedule">Full schedule</button>
     </div>
     <div id="info-tables">${groupsHtml}</div>
     <div id="info-schedule" class="hidden">${schedHtml}</div>`;

  $$(".info-seg .seg-btn", el).forEach((b) =>
    b.addEventListener("click", () => {
      $$(".info-seg .seg-btn", el).forEach((x) => x.classList.toggle("active", x === b));
      $("#info-tables", el).classList.toggle("hidden", b.dataset.view !== "tables");
      $("#info-schedule", el).classList.toggle("hidden", b.dataset.view !== "schedule");
    })
  );
  $$(".group-head", el).forEach((h) =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"))
  );
}

// =====================================================================
//  LEADERBOARD
// =====================================================================
async function renderBoard() {
  const el = $("#tab-board");
  el.innerHTML = `<div class="empty">Crunching the numbers…</div>`;
  const { data, error } = await sb.rpc("get_leaderboard");
  if (error) { el.innerHTML = `<div class="empty">Could not load leaderboard.</div>`; return; }
  if (!data?.length) { el.innerHTML = `<div class="empty">No players yet. Sign up the family!</div>`; return; }

  const rows = data.map((u, i) => {
    const me = u.user_id === state.user.id ? " me" : "";
    const parts = [
      `${u.exact_count} exact`,
      `${u.result_count} result`,
      `${u.bonus_points} bonus`,
    ];
    if (u.group_points) parts.push(`${u.group_points} groups`);
    if (u.third_points) parts.push(`${u.third_points} thirds`);
    if (u.bracket_points) parts.push(`${u.bracket_points} bracket`);
    return `<div class="row${me}">
      <div class="rank">${i + 1}</div>
      <div class="name">${esc(u.display_name)}${me ? " (you)" : ""}
        <small>${parts.join(" · ")}</small>
      </div>
      <div class="total">${u.total_points}<span> pts</span></div>
    </div>`;
  }).join("");
  el.innerHTML = `<p class="note">Updates automatically as results come in.</p><div class="board">${rows}</div>`;
}

function emptyState() {
  return `<div class="empty">Fixtures haven't loaded yet.<br/>They appear automatically the first time the results function runs (see the README setup step).</div>`;
}

// ---------- boot ----------
(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) showAuth();
})();
