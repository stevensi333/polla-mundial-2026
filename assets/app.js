// =====================================================================
// =====================================================================
//  Polla Mundial 2026 — lógica de interfaz del usuario (Español / LTR)
//  El navegador se conecta directamente con Supabase. La seguridad real
//  de los datos depende de las políticas RLS configuradas en la base.
//  La clave anon es pública por diseño.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.APP_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  alert("Abre assets/config.js y agrega primero la URL de Supabase y la clave anon.");
}
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// Nombres de las fases
const STAGE_LABEL = {
  LAST_32: "Dieciseisavos", LAST_16: "Octavos de final", QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinales", THIRD_PLACE: "Tercer puesto", FINAL: "Final",
};
const STAGE_ORDER = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
const isKnockout = (m) => m.stage && m.stage !== "GROUP_STAGE";
const stageLabel = (s) => STAGE_LABEL[s] || String(s).replace(/_/g, " ");
const grpName = (g) => (g ? String(g).replace(/Group/i, "Grupo") : g);

// Nombres de selecciones en español; si no existe traducción, se usa el nombre original.
const ES_TEAM = {
  "Argentina": "Argentina", "Brazil": "Brasil", "France": "Francia", "England": "Inglaterra", "Spain": "España",
  "Germany": "Alemania", "Portugal": "Portugal", "Netherlands": "Países Bajos", "Belgium": "Bélgica", "Italy": "Italia",
  "Croatia": "Croacia", "Uruguay": "Uruguay", "Mexico": "México", "United States": "Estados Unidos",
  "USA": "Estados Unidos", "Canada": "Canadá", "Japan": "Japón", "South Korea": "Corea del Sur",
  "Korea Republic": "Corea del Sur", "Australia": "Australia", "Morocco": "Marruecos", "Senegal": "Senegal",
  "Ghana": "Ghana", "Nigeria": "Nigeria", "Cameroon": "Camerún", "Egypt": "Egipto", "Tunisia": "Túnez",
  "Algeria": "Argelia", "Saudi Arabia": "Arabia Saudita", "Qatar": "Catar", "Iran": "Irán", "IR Iran": "Irán",
  "Iraq": "Irak", "United Arab Emirates": "Emiratos Árabes Unidos", "Jordan": "Jordania", "Oman": "Omán", "Kuwait": "Kuwait",
  "Bahrain": "Baréin", "Palestine": "Palestina", "Lebanon": "Líbano", "Syria": "Siria", "Switzerland": "Suiza",
  "Denmark": "Dinamarca", "Sweden": "Suecia", "Norway": "Noruega", "Poland": "Polonia", "Serbia": "Serbia",
  "Czechia": "Chequia", "Czech Republic": "República Checa", "Austria": "Austria", "Wales": "Gales", "Scotland": "Escocia",
  "Republic of Ireland": "Irlanda", "Ireland": "Irlanda", "Ukraine": "Ucrania", "Turkey": "Turquía",
  "Türkiye": "Turquía", "Greece": "Grecia", "Colombia": "Colombia", "Chile": "Chile", "Peru": "Perú",
  "Ecuador": "Ecuador", "Paraguay": "Paraguay", "Venezuela": "Venezuela", "Bolivia": "Bolivia",
  "Costa Rica": "Costa Rica", "Panama": "Panamá", "Jamaica": "Jamaica", "Honduras": "Honduras", "Haiti": "Haití",
  "South Africa": "Sudáfrica", "Ivory Coast": "Costa de Marfil", "Côte d'Ivoire": "Costa de Marfil",
  "Cote d'Ivoire": "Costa de Marfil", "Mali": "Malí", "Cape Verde": "Cabo Verde", "DR Congo": "República Democrática del Congo",
  "New Zealand": "Nueva Zelanda", "Uzbekistan": "Uzbekistán", "Curaçao": "Curazao", "Curacao": "Curazao",
  "Slovakia": "Eslovaquia", "Slovenia": "Eslovenia", "Hungary": "Hungría", "Romania": "Rumania", "Russia": "Rusia",
  "Finland": "Finlandia", "Iceland": "Islandia", "Albania": "Albania", "Bosnia and Herzegovina": "Bosnia y Herzegovina",
  "North Macedonia": "Macedonia del Norte", "Montenegro": "Montenegro", "Georgia": "Georgia", "Israel": "Israel",
  "Indonesia": "Indonesia", "Thailand": "Tailandia", "China PR": "China", "China": "China", "India": "India",
};
const teamName = (t) => (t ? (ES_TEAM[t] || t) : "Por definir");
const tn = (t) => esc(teamName(t));

const state = {
  user: null, profile: null,
  config: null, results: null,
  matches: [], myPreds: new Map(), othersPreds: new Map(),
  bonus: null, names: new Map(), authMode: "login",
  groupPreds: new Map(), thirdPred: { teams: [] },
  bracketPreds: new Map(), bracketOthers: new Map(),
  crests: new Map(), groupToggle: new Map(),
  bracketBuild: {},
};

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isLocked = (m) => new Date(m.kickoff).getTime() <= Date.now();
const bonusLocked = () => state.config?.bonus_locks_at && new Date(state.config.bonus_locks_at).getTime() <= Date.now();
const crestFor = (t) => state.crests.get(t) || null;
const flagImg = (t, cls = "crest") => {
  const u = crestFor(t);
  return u ? `<img class="${cls}" src="${esc(u)}" alt="" onerror="this.style.visibility='hidden'"/>` : `<span class="${cls}"></span>`;
};

// ---- Hora de Colombia (America/Bogota) + fecha en español ----
const APP_TZ = "America/Bogota";
const APP_LOCALE = "es-CO";
const appDateKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: APP_TZ }); // YYYY-MM-DD
const fmtAppDate = (iso) =>
  new Date(iso).toLocaleDateString(APP_LOCALE, { timeZone: APP_TZ, calendar: "gregory", numberingSystem: "latn", weekday: "long", day: "numeric", month: "long" });
const fmtAppTime = (iso) =>
  new Date(iso).toLocaleTimeString(APP_LOCALE, { timeZone: APP_TZ, calendar: "gregory", numberingSystem: "latn", hour: "2-digit", minute: "2-digit" });
function fmtKick(iso) {
  return new Date(iso).toLocaleString(APP_LOCALE, {
    timeZone: APP_TZ, calendar: "gregory", numberingSystem: "latn",
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Tabla de grupo calculada con los partidos finalizados
function groupStandings(groupName) {
  const ms = state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp === groupName);
  const table = new Map();
  const ensure = (t) => {
    if (!table.has(t)) table.set(t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    return table.get(t);
  };
  ms.forEach((m) => {
    if (m.home_team) ensure(m.home_team);
    if (m.away_team) ensure(m.away_team);
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
  return [...table.values()].sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team)
  );
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
//  Inicio de sesión
// =====================================================================
function showAuth() { $("#auth-view").classList.remove("hidden"); $("#app-view").classList.add("hidden"); }
function showApp() { $("#auth-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); }

$$(".seg-btn").forEach((b) =>
  b.addEventListener("click", () => {
    if (!b.dataset.mode) return;
    state.authMode = b.dataset.mode;
    $$(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    $("#name-field").style.display = state.authMode === "signup" ? "block" : "none";
    $("#auth-submit").textContent = state.authMode === "signup" ? "Crear cuenta" : "Iniciar sesión";
    $("#password").autocomplete = state.authMode === "signup" ? "new-password" : "current-password";
    $("#auth-msg").textContent = "";
  })
);


function translateAuthError(message) {
  const msg = String(message || "");
  const map = [
    ["Email not confirmed", "El correo no está confirmado."],
    ["Invalid login credentials", "Correo o contraseña incorrectos."],
    ["User already registered", "Este correo ya está registrado."],
    ["Password should be at least", "La contraseña no cumple la longitud mínima."],
    ["Signup requires a valid password", "La contraseña no es válida."],
    ["Unable to validate email address", "El correo no es válido."],
    ["Email rate limit exceeded", "Se alcanzó el límite temporal de correos. Intenta más tarde."],
  ];
  const found = map.find(([key]) => msg.toLowerCase().includes(key.toLowerCase()));
  return found ? found[1] : msg;
}

$("#auth-submit").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const name = $("#display-name").value.trim();
  const msg = $("#auth-msg");
  msg.className = "msg"; msg.textContent = "";
  if (!email || !password) { msg.className = "msg error"; msg.textContent = "El correo y la contraseña son obligatorios."; return; }

  $("#auth-submit").disabled = true;
  try {
    if (state.authMode === "signup") {
      if (!name) { throw new Error("Por favor ingresa tu nombre."); }
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      state._pendingName = name;
      if (!data.session) {
        msg.textContent = "Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.";
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) {
    msg.className = "msg error"; msg.textContent = translateAuthError(e.message) || "Ocurrió un error.";
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#logout").addEventListener("click", () => sb.auth.signOut());

let entering = false;
// Show the app shell FIRST, then load data — so a slow/aborted request on
// reload can never leave the page blank. Guarded so it runs once.
async function enterApp(user) {
  showApp();
  state.user = user;
  try { await ensureProfile(); } catch (e) { console.warn("profile:", e?.message); }
  try { await loadAll(); } catch (e) { console.warn("loadAll:", e?.message); }
}
sb.auth.onAuthStateChange((_evt, session) => {
  if (session?.user) {
    if (!entering) { entering = true; enterApp(session.user); }
  } else {
    entering = false;
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
//  Carga de datos
// =====================================================================
async function loadAll() {
  $("#who").textContent = state.profile?.display_name || "";
  const [{ data: conf }, { data: res }, { data: matches }, { data: profiles }] = await Promise.all([
    sb.from("app_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("tournament_results").select("*").eq("id", 1).maybeSingle(),
    sb.from("matches").select("*").order("kickoff", { ascending: true }),
    sb.from("profiles").select("id,display_name"),
  ]);
  state.config = conf || { points_result: 1, points_exact: 2, points_champion: 5, points_finalist: 3, points_semifinalist: 2, points_group_pos: 1, points_group_perfect: 3, points_third: 2, points_advance: 2 };
  state.results = res || {};
  state.matches = matches || [];
  state.names = new Map((profiles || []).map((p) => [p.id, p.display_name]));

  // Mapa de escudos/banderas por selección
  state.crests = new Map();
  state.matches.forEach((m) => {
    if (m.home_team && m.home_crest) state.crests.set(m.home_team, m.home_crest);
    if (m.away_team && m.away_crest) state.crests.set(m.away_team, m.away_crest);
  });

  await loadPredictions();
  await loadBonus();
  await loadExtraPreds();
  renderActiveTab();
}

// Predicciones de grupos/terceros/llaves. Falla sin romper si aún no se aplicó predictions.sql.
async function loadExtraPreds() {
  const [gp, tp, bk, kb] = await Promise.all([
    sb.from("group_predictions").select("user_id,grp,pos1,pos2,pos3,pos4").eq("user_id", state.user.id),
    sb.from("third_predictions").select("teams").eq("user_id", state.user.id).maybeSingle(),
    sb.from("bracket_predictions").select("match_id,user_id,advance_team"),
    sb.from("knockout_brackets").select("picks").eq("user_id", state.user.id).maybeSingle(),
  ]);
  state.groupPreds = new Map();
  (gp.data || []).forEach((r) => state.groupPreds.set(r.grp, r));
  state.thirdPred = tp.data || { teams: [] };
  state.bracketBuild = (kb.data && kb.data.picks) || {};
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

async function fetchAllPredictions() {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await sb
      .from("predictions")
      .select("match_id,user_id,home_score,away_score")
      .order("match_id", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("predictions load error:", error);
      throw error;
    }

    const rows = data || [];
    all = all.concat(rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return all;
}

async function loadPredictions() {
  const data = await fetchAllPredictions();

  state.myPreds = new Map();
  state.othersPreds = new Map();

  data.forEach((p) => {
    if (p.user_id === state.user.id) {
      state.myPreds.set(p.match_id, p);
    } else {
      if (!state.othersPreds.has(p.match_id)) {
        state.othersPreds.set(p.match_id, []);
      }
      state.othersPreds.get(p.match_id).push(p);
    }
  });
}

async function loadBonus() {
  const { data } = await sb.from("bonus_predictions").select("*").eq("user_id", state.user.id).maybeSingle();
  state.bonus = data || {};
}

// =====================================================================
//  Pestañas
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
  else if (tab === "bracket") renderBracket();
  else if (tab === "info") renderInfo();
  else if (tab === "board") renderBoard();
}

// =====================================================================
//  Fila de partido (compartida entre grupos y eliminatorias)
// =====================================================================
function matchRow(m, opts = {}) {
  const locked = isLocked(m);
  const finished = m.status === "FINISHED" && m.home_score != null;
  const live = ["IN_PLAY", "PAUSED"].includes(m.status);
  const mine = state.myPreds.get(m.id);
  const hv = mine ? mine.home_score : "";
  const av = mine ? mine.away_score : "";

  let statusPill = `<span class="pill open">Abierta</span>`;
  if (live) statusPill = `<span class="pill live">● En vivo</span>`;
  else if (finished) statusPill = `<span class="pill points">+${pointsFor(mine, m)} puntos</span>`;
  else if (locked) statusPill = `<span class="pill locked">Cerrada</span>`;

  const disabled = locked ? "disabled" : "";

  let actual = "";
  if (finished) actual = `<span class="actual">Resultado: <b>${m.home_score}–${m.away_score}</b></span>`;
  else if (live && m.home_score != null) actual = `<span class="actual">En vivo: <b>${m.home_score}–${m.away_score}</b></span>`;

  // Predicciones de otros usuarios (solo visibles después del inicio por RLS)
  let others = "";
  const list = state.othersPreds.get(m.id);
  if (locked && list?.length) {
    const chips = list
      .map((p) => `<span class="chip"><b>${esc(state.names.get(p.user_id) || "?")}</b> ${p.home_score}–${p.away_score}</span>`)
      .join("");
    others = `<div class="others">Predicciones: ${chips}</div>`;
  }

  // Equipo que avanza (solo en eliminatorias, si ambos equipos ya existen)
  let adv = "";
  if (opts.advance && m.home_team && m.away_team) {
    const mineAdv = state.bracketPreds.get(m.id);
    const actualAdv = finished
      ? (m.winner === "HOME_TEAM" ? m.home_team : m.winner === "AWAY_TEAM" ? m.away_team : null)
      : null;
    const advBtn = (team) => {
      const sel = mineAdv === team ? " sel" : "";
      const correct = actualAdv && actualAdv === team ? " correct" : "";
      return `<button class="adv-btn${sel}${correct}" data-team="${esc(team)}" ${locked ? "disabled" : ""}>${tn(team)}</button>`;
    };
    adv = `<div class="advrow"><span class="advlbl">Avanza:</span>${advBtn(m.home_team)}${advBtn(m.away_team)}</div>`;
  }

  return `
  <div class="match" data-id="${m.id}">
    <div class="side home">${flagImg(m.home_team)}<span class="tname">${tn(m.home_team)}</span></div>
    <div class="score-in">
      <input type="number" min="0" max="30" value="${hv}" data-side="home" ${disabled} inputmode="numeric"/>
      <span class="vs">:</span>
      <input type="number" min="0" max="30" value="${av}" data-side="away" ${disabled} inputmode="numeric"/>
    </div>
    <div class="side away"><span class="tname">${tn(m.away_team)}</span>${flagImg(m.away_team)}</div>
    <div class="meta">
      <span class="kick">${fmtKick(m.kickoff)}</span>
      <span style="display:flex;gap:8px;align-items:center">
        ${actual}<span class="saved-tag">Guardado ✓</span>${statusPill}
      </span>
    </div>
    ${adv}
    ${others}
  </div>`;
}

// Botones de equipo que avanza en eliminatorias
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
        if (error) { toast("Cerrado: el partido ya inició.", true); return; }
        state.bracketPreds.set(id, team);
        $$(".adv-btn", row).forEach((b) => b.classList.toggle("sel", b.dataset.team === team));
        toast("Clasificado guardado ✓");
      })
    );
  });
}

// Guarda la predicción del marcador con una pequeña espera
function wireMatchInputs(root) {
  $$(".match", root).forEach((row) => {
    const id = Number(row.dataset.id);
    const inputs = $$("input", row);
    const tag = $(".saved-tag", row);
    let timer;

    async function savePrediction() {
      const h = inputs[0].value;
      const a = inputs[1].value;

      if (h === "" || a === "") return;

      const home_score = Math.max(0, Math.min(30, parseInt(h, 10)));
      const away_score = Math.max(0, Math.min(30, parseInt(a, 10)));

      const { error } = await sb
        .from("predictions")
        .upsert(
          {
            user_id: state.user.id,
            match_id: id,
            home_score,
            away_score,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,match_id" }
        );

      if (error) {
        console.error("prediction save error:", error);
        toast("No se pudo guardar. El partido puede estar cerrado.", true);
        return;
      }

      state.myPreds.set(id, {
        match_id: id,
        user_id: state.user.id,
        home_score,
        away_score,
      });

      if (tag) {
        tag.classList.add("show");
        setTimeout(() => tag.classList.remove("show"), 1200);
      }

      maybeRevealNext(id);
    }

    inputs.forEach((inp) => {
      inp.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(savePrediction, 350);
      });

      inp.addEventListener("change", () => {
        clearTimeout(timer);
        savePrediction();
      });

      inp.addEventListener("blur", () => {
        clearTimeout(timer);
        savePrediction();
      });
    });
  });
}

// Al completar las predicciones de un grupo, abre automáticamente el siguiente grupo
function maybeRevealNext(matchId) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m || m.stage !== "GROUP_STAGE") return;
  const names = [...new Set(state.matches.filter((x) => x.stage === "GROUP_STAGE" && x.grp).map((x) => x.grp))].sort();
  const idx = names.indexOf(m.grp);
  if (idx < 0 || idx + 1 >= names.length) return;
  const cur = names[idx];
  const curMatches = state.matches.filter((x) => x.stage === "GROUP_STAGE" && x.grp === cur);
  if (curMatches.every((x) => state.myPreds.has(x.id))) {
    const next = names[idx + 1];
    const wrap = $(`.group[data-grp="${cssAttr(next)}"]`);
    if (wrap && !state.groupToggle.has(next)) wrap.classList.remove("collapsed");
  }
}
const cssAttr = (s) => String(s).replace(/"/g, '\\"');

// =====================================================================
//  Fase de grupos
// =====================================================================
function groupComplete(matches) {
  return matches.length > 0 && matches.every((m) => state.myPreds.has(m.id));
}
function renderGroups() {
  const el = $("#tab-groups");
  const groupMatches = state.matches.filter((m) => m.stage === "GROUP_STAGE");
  if (!groupMatches.length) { el.innerHTML = emptyState(); return; }

  const byGroup = {};
  groupMatches.forEach((m) => { (byGroup[m.grp || "?"] ??= []).push(m); });
  const names = Object.keys(byGroup).sort();

  el.innerHTML =
    `<p class="note">Predice el marcador de cada partido. Cada partido se bloquea cuando inicia. Marcador exacto = 2 puntos; acertar el ganador = 1 punto. El siguiente grupo se abre automáticamente cuando completes el grupo anterior.</p>` +
    names.map((g, idx) => {
      const rows = byGroup[g].map((m) => matchRow(m)).join("");
      const prevComplete = idx === 0 || groupComplete(byGroup[names[idx - 1]]);
      const manual = state.groupToggle.get(g); // true=abierta, false=cerrada, undefined=automático
      const open = manual !== undefined ? manual : (idx === 0 || prevComplete);
      const done = groupComplete(byGroup[g]) ? `<span class="group-done">✓ Completo</span>` : "";
      return `<div class="group${open ? "" : " collapsed"}" data-grp="${esc(g)}">
        <div class="group-head"><h3>${esc(grpName(g))} ${done}</h3><span class="chev">▾</span></div>
        <div class="group-body">${rows}</div>
      </div>`;
    }).join("");

  $$(".group-head", el).forEach((h) =>
    h.addEventListener("click", () => {
      const wrap = h.parentElement;
      wrap.classList.toggle("collapsed");
      state.groupToggle.set(wrap.dataset.grp, !wrap.classList.contains("collapsed"));
    })
  );
  wireMatchInputs(el);
}

// =====================================================================
//  Eliminatorias
// =====================================================================
function renderKnockouts() {
  const el = $("#tab-knockouts");
  const ko = state.matches.filter(isKnockout);
  if (!ko.length) {
    el.innerHTML = `<div class="empty">Las eliminatorias aparecerán automáticamente cuando termine la fase de grupos y se definan los partidos.</div>`;
    return;
  }
  const byStage = {};
  ko.forEach((m) => { (byStage[m.stage] ??= []).push(m); });
  const stages = [
    ...STAGE_ORDER.filter((s) => byStage[s]),
    ...Object.keys(byStage).filter((s) => !STAGE_ORDER.includes(s)),
  ];
  el.innerHTML =
    `<p class="note">Predice el marcador de cada partido. Marcador exacto = 2 puntos; acertar ganador o empate = 1 punto. Cada partido se bloquea cuando inicia.</p>` +
    stages.map((s) => {
      const rows = byStage[s].map((m) => matchRow(m)).join("");
      return `<div class="group">
      <div class="group-head"><h3>${stageLabel(s)}</h3><span class="chev">▾</span></div>
      <div class="group-body">${rows}</div>
    </div>`;
    }).join("");
  $$(".group-head", el).forEach((h) =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"))
  );
  wireMatchInputs(el);

}

// =====================================================================
//  Predicciones extra (campeón/finalistas/semifinalistas)
// =====================================================================
function teamList() {
  const set = new Set();
  state.matches.filter((m) => m.stage === "GROUP_STAGE").forEach((m) => {
    if (m.home_team) set.add(m.home_team);
    if (m.away_team) set.add(m.away_team);
  });
  return [...set].sort((a, b) => teamName(a).localeCompare(teamName(b), "es"));
}
// Solo lectura: campeón/finalistas/semifinalistas se toman automáticamente de "Mi cuadro".
// Fuente única: no se ingresan dos veces fuera de las eliminatorias.
function renderBonus() {
  const el = $("#tab-bonus");
  if (!state.matches.length) { el.innerHTML = emptyState(); return; }
  const C = state.config;
  const b = state.bonus || {};
  const r = state.results || {};
  const fin = Array.isArray(r.finalists) ? r.finalists : [];
  const semi = Array.isArray(r.semifinalists) ? r.semifinalists : [];

  const line = (team, correct) => team
    ? `<span class="champ-t${correct ? " ok" : ""}">${flagImg(team, "crest")}${tn(team)}${correct ? " ✓" : ""}</span>`
    : `<span class="b-empty">— Aún no definido —</span>`;
  const champCorrect = b.champion && r.champion && b.champion === r.champion;

  el.innerHTML =
    `<p class="note">El campeón, los finalistas y los semifinalistas se toman automáticamente de <b>Mi cuadro</b>. Esa es la fuente principal; no tienes que ingresarlos dos veces. Para cambiarlos, modifica tu cuadro.</p>` +
    `<button id="go-bracket" class="btn-ghost" style="margin:0 4px 16px">🏆 Abrir mi cuadro</button>` +
    `<div class="bonus-grid">
      <div class="bonus-card">
        <h4>🏆 Campeón <small style="color:var(--gold)">${r.champion ? "· real: " + tn(r.champion) : ""}</small></h4>
        <p class="hint">${C.points_champion} puntos.</p>
        ${line(b.champion, champCorrect)}
      </div>
      <div class="bonus-card">
        <h4>🥈 Finalistas</h4>
        <p class="hint">${C.points_finalist} puntos por cada uno.</p>
        <div class="bonus-row">${line(b.finalist1, b.finalist1 && fin.includes(b.finalist1))}${line(b.finalist2, b.finalist2 && fin.includes(b.finalist2))}</div>
      </div>
      <div class="bonus-card">
        <h4>🥉 Semifinalistas</h4>
        <p class="hint">${C.points_semifinalist} puntos por cada uno.</p>
        <div class="bonus-row">
          ${line(b.semifinalist1, b.semifinalist1 && semi.includes(b.semifinalist1))}
          ${line(b.semifinalist2, b.semifinalist2 && semi.includes(b.semifinalist2))}
          ${line(b.semifinalist3, b.semifinalist3 && semi.includes(b.semifinalist3))}
          ${line(b.semifinalist4, b.semifinalist4 && semi.includes(b.semifinalist4))}
        </div>
      </div>
    </div>`;

  const go = $("#go-bracket", el);
  if (go) go.addEventListener("click", () => { const t = $(`.tab[data-tab="bracket"]`); if (t) t.click(); });
}

// =====================================================================
//  Clasificación de grupos (arrastrar y soltar) + mejores terceros
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
  const C = state.config;

  const orderCards = groupNames.map((g) => {
    const teams = teamsInGroup(g);
    const pred = state.groupPreds.get(g) || {};
    const saved = [pred.pos1, pred.pos2, pred.pos3, pred.pos4].filter(Boolean).filter((t) => teams.includes(t));
    const ordered = [...saved, ...teams.filter((t) => !saved.includes(t))];
    const lis = ordered.map((t, i) =>
      `<li data-team="${esc(t)}"><span class="ord">${i + 1}</span>${flagImg(t)}<span class="tname">${tn(t)}</span>${locked ? "" : '<span class="handle">⠿</span>'}</li>`
    ).join("");
    const lockBadge = locked ? `<span class="group-locked">🔒 Cerrado</span>` : "";
    return `<div class="bonus-card">
      <h4>${esc(grpName(g))} ${lockBadge}</h4>
      <ul class="dnd${locked ? " locked" : ""}" data-grp="${esc(g)}">${lis}</ul>
    </div>`;
  }).join("");

  const note = locked
    ? `<p class="note">Las predicciones de clasificación están cerradas porque la competencia ya inició.</p>`
    : `<p class="note">Ordena los equipos de cada grupo arrastrando del primero al cuarto. Se bloquea al iniciar el primer partido${C?.bonus_locks_at ? " (" + fmtKick(C.bonus_locks_at) + ")" : ""}. Posición correcta = ${C.points_group_pos} punto(s) · grupo perfecto = +${C.points_group_perfect} · cada tercero correcto = ${C.points_third}.</p>`;

  el.innerHTML = note +
    `<h3 class="sec">📊 Clasificación final de grupos</h3><div class="bonus-grid picks-grid">${orderCards}</div>` +
    `<h3 class="sec">🥉 Mejores terceros</h3><div id="thirds-wrap"></div>`;

  if (!locked && window.Sortable) {
    $$(".dnd", el).forEach((ul) =>
      Sortable.create(ul, {
        animation: 150, handle: ".handle",
        forceFallback: true, fallbackTolerance: 3, // consistent on touch + mouse
        onEnd: async () => { renumber(ul); await saveGroupOrder(ul); renderThirds(); },
      })
    );
  }
  renderThirds();
}

function renumber(ul) { $$("li", ul).forEach((li, i) => ($(".ord", li).textContent = i + 1)); }

async function saveGroupOrder(ul) {
  const g = ul.dataset.grp;
  const order = $$("li", ul).map((li) => li.dataset.team);
  const row = {
    user_id: state.user.id, grp: g,
    pos1: order[0] || null, pos2: order[1] || null, pos3: order[2] || null, pos4: order[3] || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("group_predictions").upsert(row, { onConflict: "user_id,grp" });
  if (error) { toast("No se pudo guardar. Puede estar bloqueado.", true); return; }
  state.groupPreds.set(g, row);
  toast(grpName(g) + " — guardado ✓");
}

// Equipos que el usuario ubicó en tercer lugar en cada grupo
function predictedThirds() {
  const arr = [];
  [...state.groupPreds.values()].forEach((p) => { if (p.pos3) arr.push(p.pos3); });
  return [...new Set(arr)];
}

function renderThirds() {
  const wrap = $("#thirds-wrap");
  if (!wrap) return;
  const locked = bonusLocked();
  const C = state.config;
  const opts = predictedThirds();
  let chosen = (state.thirdPred?.teams || []).filter((t) => opts.includes(t));

  if (!opts.length) {
    wrap.innerHTML = `<p class="thirds-count">Primero ordena tus grupos. Aquí aparecerán los equipos que pusiste en tercer lugar para escoger 8.</p>`;
    return;
  }

  const chips = opts.map((t) => {
    const on = chosen.includes(t) ? " sel" : "";
    return `<button class="tchip${on}" data-team="${esc(t)}" ${locked ? "disabled" : ""}>${flagImg(t, "crest")}${tn(t)}</button>`;
  }).join("");

  wrap.innerHTML = `<div class="bonus-card">
    <p class="hint">Avanzan 8 de los mejores terceros a dieciseisavos. Escoge 8 de los equipos que pusiste en tercer lugar. ${C.points_third} puntos por cada equipo correcto.</p>
    <p class="thirds-count">Seleccionados: <b id="tcount">${chosen.length}</b> / 8</p>
    <div class="thirds-chips">${chips}</div>
  </div>`;

  if (locked) return;
  $$(".tchip", wrap).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const t = btn.dataset.team;
      const cur = new Set((state.thirdPred?.teams || []).filter((x) => opts.includes(x)));
      if (cur.has(t)) cur.delete(t);
      else { if (cur.size >= 8) { toast("Máximo 8 equipos.", true); return; } cur.add(t); }
      const teams = [...cur];
      const { error } = await sb.from("third_predictions")
        .upsert({ user_id: state.user.id, teams, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) { toast("No se pudo guardar. Puede estar bloqueado.", true); return; }
      state.thirdPred = { teams };
      btn.classList.toggle("sel");
      const c = $("#tcount"); if (c) c.textContent = cur.size;
    })
  );
}

// =====================================================================
//  Mi cuadro (dieciseisavos → campeón) construido con las predicciones del usuario
// =====================================================================
// 32 selecciones = 12 primeras de grupo + 8 terceros escogidos + 12 segundas de grupo
// =====================================================================
//  Mi cuadro: Ronda de 32 oficial 2026
//  Usa la clasificación de grupos del usuario + sus 8 mejores terceros.
// =====================================================================

const GROUP_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

function groupNameByLetter(letter) {
  const groupNames = [...new Set(
    state.matches
      .filter((m) => m.stage === "GROUP_STAGE" && m.grp)
      .map((m) => m.grp)
  )];

  return groupNames.find((g) => {
    const s = String(g).toUpperCase().trim();
    return s === letter || s.endsWith(" " + letter) || s.endsWith(letter);
  });
}

function teamByCode(code) {
  const m = String(code).match(/^([123])([A-L])$/);
  if (!m) return null;

  const pos = Number(m[1]);
  const letter = m[2];
  const grp = groupNameByLetter(letter);
  if (!grp) return null;

  const pred = state.groupPreds.get(grp);
  if (!pred) return null;

  if (pos === 1) return pred.pos1 || null;
  if (pos === 2) return pred.pos2 || null;
  if (pos === 3) return pred.pos3 || null;

  return null;
}

const R32_TEMPLATE = [
  { id: 73, home: { code: "2A" }, away: { code: "2B" } },
  { id: 74, home: { code: "1E" }, away: { thirdSlot: 74, allowed: ["A", "B", "C", "D", "F"] } },
  { id: 75, home: { code: "1F" }, away: { code: "2C" } },
  { id: 76, home: { code: "1C" }, away: { code: "2F" } },
  { id: 77, home: { code: "1I" }, away: { thirdSlot: 77, allowed: ["C", "D", "F", "G", "H"] } },
  { id: 78, home: { code: "2E" }, away: { code: "2I" } },
  { id: 79, home: { code: "1A" }, away: { thirdSlot: 79, allowed: ["C", "E", "F", "H", "I"] } },
  { id: 80, home: { code: "1L" }, away: { thirdSlot: 80, allowed: ["E", "H", "I", "J", "K"] } },
  { id: 81, home: { code: "1D" }, away: { thirdSlot: 81, allowed: ["B", "E", "F", "I", "J"] } },
  { id: 82, home: { code: "1G" }, away: { thirdSlot: 82, allowed: ["A", "E", "H", "I", "J"] } },
  { id: 83, home: { code: "2K" }, away: { code: "2L" } },
  { id: 84, home: { code: "1H" }, away: { code: "2J" } },
  { id: 85, home: { code: "1B" }, away: { thirdSlot: 85, allowed: ["E", "F", "G", "I", "J"] } },
  { id: 86, home: { code: "1J" }, away: { code: "2H" } },
  { id: 87, home: { code: "1K" }, away: { thirdSlot: 87, allowed: ["D", "E", "I", "J", "L"] } },
  { id: 88, home: { code: "2D" }, away: { code: "2G" } },
];

const NEXT_ROUNDS_TEMPLATE = {
  r16: [
    { id: 89, homeWin: 74, awayWin: 77 },
    { id: 90, homeWin: 73, awayWin: 75 },
    { id: 91, homeWin: 76, awayWin: 78 },
    { id: 92, homeWin: 79, awayWin: 80 },
    { id: 93, homeWin: 83, awayWin: 84 },
    { id: 94, homeWin: 81, awayWin: 82 },
    { id: 95, homeWin: 86, awayWin: 88 },
    { id: 96, homeWin: 85, awayWin: 87 },
  ],
  qf: [
    { id: 97, homeWin: 89, awayWin: 90 },
    { id: 98, homeWin: 93, awayWin: 94 },
    { id: 99, homeWin: 91, awayWin: 92 },
    { id: 100, homeWin: 95, awayWin: 96 },
  ],
  sf: [
    { id: 101, homeWin: 97, awayWin: 98 },
    { id: 102, homeWin: 99, awayWin: 100 },
  ],
  final: [
    { id: 104, homeWin: 101, awayWin: 102 },
  ],
};

function bracketKey(matchId) {
  return "m" + matchId;
}

function selectedThirdTeamsByGroup() {
  const selected = new Set(state.thirdPred?.teams || []);
  const arr = [];

  GROUP_LETTERS.forEach((letter) => {
    const team = teamByCode("3" + letter);
    if (team && selected.has(team)) {
      arr.push({ letter, team });
    }
  });

  return arr;
}

function assignThirdsToOfficialSlots() {
  const thirds = selectedThirdTeamsByGroup();
  const slots = R32_TEMPLATE
    .filter((m) => m.away?.thirdSlot)
    .map((m) => ({
      matchId: m.id,
      allowed: m.away.allowed,
    }));

  if (thirds.length !== 8) {
    return {
      ok: false,
      reason: `Debes escoger exactamente 8 mejores terceros. Ahora tienes ${thirds.length}.`,
      assignments: new Map(),
    };
  }

  // Backtracking para asignar cada mejor tercero a un partido permitido.
  // Evita errores como poner un tercero del Grupo A en un cruce donde A no está permitido.
  const slotOrder = [...slots].sort((a, b) => {
    const ca = thirds.filter((t) => a.allowed.includes(t.letter)).length;
    const cb = thirds.filter((t) => b.allowed.includes(t.letter)).length;
    return ca - cb;
  });

  const usedTeams = new Set();
  const assignments = new Map();

  function backtrack(i) {
    if (i >= slotOrder.length) return true;

    const slot = slotOrder[i];
    const candidates = thirds.filter(
      (t) => slot.allowed.includes(t.letter) && !usedTeams.has(t.team)
    );

    for (const c of candidates) {
      usedTeams.add(c.team);
      assignments.set(slot.matchId, c.team);

      if (backtrack(i + 1)) return true;

      assignments.delete(slot.matchId);
      usedTeams.delete(c.team);
    }

    return false;
  }

  const ok = backtrack(0);

  if (!ok) {
    return {
      ok: false,
      reason: "Los 8 terceros seleccionados no se pueden ubicar respetando los grupos permitidos del cuadro oficial.",
      assignments: new Map(),
    };
  }

  return { ok: true, assignments };
}

function hasCompleteGroupPredictions() {
  const groupNames = [...new Set(
    state.matches
      .filter((m) => m.stage === "GROUP_STAGE" && m.grp)
      .map((m) => m.grp)
  )].sort();

  if (groupNames.length < 12) return false;

  return groupNames.every((g) => {
    const p = state.groupPreds.get(g);
    return p?.pos1 && p?.pos2 && p?.pos3 && p?.pos4;
  });
}

function resolveBracketEntry(entry, thirdAssignments) {
  if (!entry) return null;

  if (entry.code) {
    return teamByCode(entry.code);
  }

  if (entry.thirdSlot) {
    return thirdAssignments.get(entry.thirdSlot) || null;
  }

  return null;
}

function officialR32Matches(thirdAssignments) {
  return R32_TEMPLATE.map((m) => ({
    id: m.id,
    teams: [
      resolveBracketEntry(m.home, thirdAssignments),
      resolveBracketEntry(m.away, thirdAssignments),
    ],
  }));
}

function officialNextRoundMatches(template, picks) {
  return template.map((m) => ({
    id: m.id,
    teams: [
      picks[bracketKey(m.homeWin)] || null,
      picks[bracketKey(m.awayWin)] || null,
    ],
  }));
}

function computeOfficialRounds(thirdAssignments, picks) {
  const r32 = officialR32Matches(thirdAssignments);
  const r16 = officialNextRoundMatches(NEXT_ROUNDS_TEMPLATE.r16, picks);
  const qf = officialNextRoundMatches(NEXT_ROUNDS_TEMPLATE.qf, picks);
  const sf = officialNextRoundMatches(NEXT_ROUNDS_TEMPLATE.sf, picks);
  const final = officialNextRoundMatches(NEXT_ROUNDS_TEMPLATE.final, picks);

  return [r32, r16, qf, sf, final];
}

function pruneBracketOfficial(thirdAssignments) {
  let changed = true;

  while (changed) {
    changed = false;
    const rounds = computeOfficialRounds(thirdAssignments, state.bracketBuild);

    rounds.flat().forEach((m) => {
      const key = bracketKey(m.id);
      const pick = state.bracketBuild[key];

      if (pick && !m.teams.includes(pick)) {
        delete state.bracketBuild[key];
        changed = true;
      }
    });
  }
}

async function saveBracketOfficial(thirdAssignments) {
  const { error } = await sb.from("knockout_brackets")
    .upsert(
      {
        user_id: state.user.id,
        picks: state.bracketBuild,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    toast("No se pudo guardar. Puede estar bloqueado.", true);
    return;
  }

  await syncBonusFromBracketOfficial(thirdAssignments);
  toast("Cuadro guardado ✓");
}

async function syncBonusFromBracketOfficial(thirdAssignments) {
  const rounds = computeOfficialRounds(thirdAssignments, state.bracketBuild);
  const sf = rounds[3];

  const semifinalists = [
    sf?.[0]?.teams?.[0],
    sf?.[0]?.teams?.[1],
    sf?.[1]?.teams?.[0],
    sf?.[1]?.teams?.[1],
  ];

  const payload = {
    user_id: state.user.id,
    updated_at: new Date().toISOString(),
    champion: state.bracketBuild[bracketKey(104)] || null,
    finalist1: state.bracketBuild[bracketKey(101)] || null,
    finalist2: state.bracketBuild[bracketKey(102)] || null,
    semifinalist1: semifinalists[0] || null,
    semifinalist2: semifinalists[1] || null,
    semifinalist3: semifinalists[2] || null,
    semifinalist4: semifinalists[3] || null,
  };

  const { error } = await sb.from("bonus_predictions")
    .upsert(payload, { onConflict: "user_id" });

  if (!error) {
    state.bonus = { ...(state.bonus || {}), ...payload };
  }
}

function renderBracket() {
  const el = $("#tab-bracket");

  const groupNames = [...new Set(
    state.matches
      .filter((m) => m.stage === "GROUP_STAGE" && m.grp)
      .map((m) => m.grp)
  )].sort();

  if (!groupNames.length) {
    el.innerHTML = emptyState();
    return;
  }

  const completeGroups = hasCompleteGroupPredictions();
  const thirdCheck = assignThirdsToOfficialSlots();

  if (!completeGroups || !thirdCheck.ok) {
    const completed = groupNames.filter((g) => {
      const p = state.groupPreds.get(g);
      return p?.pos1 && p?.pos2 && p?.pos3 && p?.pos4;
    }).length;

    const need = [];

    if (!completeGroups) {
      need.push(`Ordena todos los grupos en “Clasificación grupos” (${completed} de ${groupNames.length} completos).`);
    }

    if (!thirdCheck.ok) {
      need.push(thirdCheck.reason);
    }

    el.innerHTML =
      `<p class="note">Para armar tu cuadro debes ordenar los grupos y elegir los 8 mejores terceros.</p>` +
      `<div class="empty">Para empezar:<br/>• ${need.join("<br/>• ")}</div>`;

    return;
  }

  const locked = bonusLocked();
  const thirdAssignments = thirdCheck.assignments;

  pruneBracketOfficial(thirdAssignments);

  const rounds = computeOfficialRounds(thirdAssignments, state.bracketBuild);
  const champion = state.bracketBuild[bracketKey(104)] || null;

  const titles = [
    "Ronda de 32",
    "Octavos de final",
    "Cuartos de final",
    "Semifinales",
    "Final",
  ];

  const teamBtn = (team, matchId) => {
    if (!team) return `<span class="bteam empty">—</span>`;

    const chosen = state.bracketBuild[bracketKey(matchId)] === team;

    return `
      <button class="bteam${chosen ? " sel" : ""}" data-match="${matchId}" data-team="${esc(team)}" ${locked ? "disabled" : ""}>
        ${flagImg(team, "crest sm")}
        <span>${tn(team)}</span>
      </button>
    `;
  };

  const matchHtml = (m) => `
    <div class="bmatch" data-match="${m.id}">
      <div class="bmatch-no">Partido ${m.id}</div>
      ${teamBtn(m.teams[0], m.id)}
      <span class="bvs">×</span>
      ${teamBtn(m.teams[1], m.id)}
    </div>
  `;

  const roundsHtml = rounds.map((matches, idx) => {
    const ms = matches.map(matchHtml).join("");

    return `
      <div class="bround">
        <h4 class="bround-h">${titles[idx]}</h4>
        ${ms}
      </div>
    `;
  }).join("");

  const champHtml = champion
    ? `<div class="champ"><span class="champ-l">🏆 Campeón pronosticado</span><span class="champ-t">${flagImg(champion, "crest")}${tn(champion)}</span></div>`
    : `<div class="champ muted">🏆 Elige los ganadores hasta llegar al campeón</div>`;

  const note = locked
    ? `<p class="note">Mi cuadro está bloqueado.</p>`
    : `<p class="note">Este cuadro respeta los cruces oficiales de los partidos 73 a 104. Los mejores terceros se ubican solo en los cruces donde su grupo está permitido.</p>`;

  el.innerHTML = note + champHtml + `<div class="bracket">${roundsHtml}</div>`;

  if (locked) return;

  $$(".bteam", el).forEach((btn) => {
    if (btn.disabled || btn.classList.contains("empty")) return;

    btn.addEventListener("click", async () => {
      const matchId = Number(btn.dataset.match);
      state.bracketBuild[bracketKey(matchId)] = btn.dataset.team;

      pruneBracketOfficial(thirdAssignments);
      await saveBracketOfficial(thirdAssignments);
      renderBracket();
    });
  });
}

// =====================================================================
//  Grupos y calendario (solo información)
// =====================================================================
function renderInfo() {
  const el = $("#tab-info");
  if (!state.matches.length) { el.innerHTML = emptyState(); return; }

  const groups = [...new Set(
    state.matches.filter((m) => m.stage === "GROUP_STAGE" && m.grp).map((m) => m.grp)
  )].sort();

  const groupsHtml = groups.map((g) => {
    const rows = groupStandings(g);
    const body = rows.map((r, i) => `
      <tr${i < 2 ? ' class="qual"' : ""}>
        <td class="pos">${i + 1}</td>
        <td class="tm">${flagImg(r.team, "crest sm")}<span>${tn(r.team)}</span></td>
        <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td>
        <td class="pts">${r.pts}</td>
      </tr>`).join("");
    return `<div class="group">
      <div class="group-head"><h3>${esc(grpName(g))}</h3><span class="chev">▾</span></div>
      <div class="group-body">
        <table class="gtable">
          <thead><tr><th></th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  const sorted = [...state.matches].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const byDay = {};
  sorted.forEach((m) => { (byDay[appDateKey(m.kickoff)] ??= []).push(m); });

  const schedHtml = Object.keys(byDay).sort().map((day) => {
    const items = byDay[day].map((m) => {
      const label = m.grp ? grpName(m.grp) : stageLabel(m.stage);
      const finished = m.status === "FINISHED" && m.home_score != null;
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      const scoreOrVs = finished || (live && m.home_score != null)
        ? `<b class="sc">${m.home_score}–${m.away_score}</b>`
        : `<span class="vs">×</span>`;
      const flag = live ? `<span class="pill live">● En vivo</span>` : finished ? `<span class="pill points">Finalizado</span>` : "";
      return `<div class="srow">
        <span class="stime">${fmtAppTime(m.kickoff)}</span>
        <span class="steams">
          <span class="sh">${flagImg(m.home_team)}${tn(m.home_team)}</span>
          ${scoreOrVs}
          <span class="sa">${tn(m.away_team)}${flagImg(m.away_team)}</span>
        </span>
        <span class="stag">${esc(label)} ${flag}</span>
      </div>`;
    }).join("");
    return `<div class="sday"><div class="sday-head">${fmtAppDate(byDay[day][0].kickoff)}</div>${items}</div>`;
  }).join("");

  el.innerHTML =
    `<p class="note">Las tablas de grupos se actualizan automáticamente cuando llegan los resultados. Los dos primeros aparecen resaltados. Todos los horarios están en hora de <b>Colombia</b>.</p>` +
    `<div class="seg info-seg">
       <button class="seg-btn active" data-view="tables">Tablas de grupos</button>
       <button class="seg-btn" data-view="schedule">Calendario completo</button>
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
//  Tabla general
// =====================================================================
async function renderBoard() {
  const el = $("#tab-board");
  el.innerHTML = `<div class="empty">Calculando puntos…</div>`;
  const { data, error } = await sb.rpc("get_leaderboard");
  if (error) { el.innerHTML = `<div class="empty">🏆 La tabla aparecerá cuando inicie el Mundial y empiecen a llegar resultados.</div>`; return; }
  if (!data?.length) { el.innerHTML = `<div class="empty">🏆 La tabla aparecerá cuando inicie el Mundial. Regístrense y empiecen a pronosticar.</div>`; return; }

  const rows = data.map((u, i) => {
    const me = u.user_id === state.user.id ? " me" : "";
    const parts = [
      `${u.exact_count} exactos`,
      `${u.result_count} resultados`,
      `${u.bonus_points} extra`,
    ];
    if (u.group_points) parts.push(`${u.group_points} grupos`);
    if (u.third_points) parts.push(`${u.third_points} terceros`);
    if (u.bracket_points) parts.push(`${u.bracket_points} eliminatorias`);
    return `<div class="row${me}">
      <div class="rank">${i + 1}</div>
      <div class="name">${esc(u.display_name)}${me ? " (tú)" : ""}
        <small>${parts.join(" · ")}</small>
      </div>
      <div class="total">${u.total_points}<span> puntos</span></div>
    </div>`;
  }).join("");
  el.innerHTML = `<p class="note">Se actualiza automáticamente con los resultados.</p><div class="board">${rows}</div>`;
}

function emptyState() {
  return `<div class="empty">Aún no se han cargado los partidos.<br/>Aparecerán automáticamente cuando se ejecute por primera vez la función de resultados.</div>`;
}

// ---------- Arranque ----------
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) {
    if (!entering) { entering = true; enterApp(data.session.user); }
  } else {
    showAuth();
  }
})();
