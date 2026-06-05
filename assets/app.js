// =====================================================================
//  كأس العالم العائلية 2026 — منطق الواجهة الأمامية (عربي / RTL)
//  يتصل المتصفح مباشرة بـ Supabase. أمان الصفوف (RLS) في قاعدة البيانات
//  هو ما يحمي البيانات فعليًا، ومفتاح anon هنا عامٌّ عن قصد.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.APP_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  alert("افتح assets/config.js وأضف رابط Supabase ومفتاح anon أولًا.");
}
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// أسماء الأدوار بالعربية
const STAGE_LABEL = {
  LAST_32: "دور الـ32", LAST_16: "دور الـ16", QUARTER_FINALS: "ربع النهائي",
  SEMI_FINALS: "نصف النهائي", THIRD_PLACE: "تحديد المركز الثالث", FINAL: "النهائي",
};
const STAGE_ORDER = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
const isKnockout = (m) => m.stage && m.stage !== "GROUP_STAGE";
const stageLabel = (s) => STAGE_LABEL[s] || String(s).replace(/_/g, " ");
const grpName = (g) => (g ? String(g).replace(/Group/i, "المجموعة") : g);

// أسماء المنتخبات بالعربية (يُستخدم الاسم الأصلي إن لم يوجد)
const AR_TEAM = {
  "Argentina":"الأرجنتين","Brazil":"البرازيل","France":"فرنسا","England":"إنجلترا","Spain":"إسبانيا",
  "Germany":"ألمانيا","Portugal":"البرتغال","Netherlands":"هولندا","Belgium":"بلجيكا","Italy":"إيطاليا",
  "Croatia":"كرواتيا","Uruguay":"الأوروغواي","Mexico":"المكسيك","United States":"الولايات المتحدة",
  "USA":"الولايات المتحدة","Canada":"كندا","Japan":"اليابان","South Korea":"كوريا الجنوبية",
  "Korea Republic":"كوريا الجنوبية","Australia":"أستراليا","Morocco":"المغرب","Senegal":"السنغال",
  "Ghana":"غانا","Nigeria":"نيجيريا","Cameroon":"الكاميرون","Egypt":"مصر","Tunisia":"تونس",
  "Algeria":"الجزائر","Saudi Arabia":"السعودية","Qatar":"قطر","Iran":"إيران","IR Iran":"إيران",
  "Iraq":"العراق","United Arab Emirates":"الإمارات","Jordan":"الأردن","Oman":"عُمان","Kuwait":"الكويت",
  "Bahrain":"البحرين","Palestine":"فلسطين","Lebanon":"لبنان","Syria":"سوريا","Switzerland":"سويسرا",
  "Denmark":"الدنمارك","Sweden":"السويد","Norway":"النرويج","Poland":"بولندا","Serbia":"صربيا",
  "Czechia":"التشيك","Czech Republic":"التشيك","Austria":"النمسا","Wales":"ويلز","Scotland":"اسكتلندا",
  "Republic of Ireland":"أيرلندا","Ireland":"أيرلندا","Ukraine":"أوكرانيا","Turkey":"تركيا",
  "Türkiye":"تركيا","Greece":"اليونان","Colombia":"كولومبيا","Chile":"تشيلي","Peru":"بيرو",
  "Ecuador":"الإكوادور","Paraguay":"باراغواي","Venezuela":"فنزويلا","Bolivia":"بوليفيا",
  "Costa Rica":"كوستاريكا","Panama":"بنما","Jamaica":"جامايكا","Honduras":"هندوراس","Haiti":"هايتي",
  "South Africa":"جنوب أفريقيا","Ivory Coast":"ساحل العاج","Côte d'Ivoire":"ساحل العاج",
  "Cote d'Ivoire":"ساحل العاج","Mali":"مالي","Cape Verde":"الرأس الأخضر","DR Congo":"الكونغو الديمقراطية",
  "New Zealand":"نيوزيلندا","Uzbekistan":"أوزبكستان","Curaçao":"كوراساو","Curacao":"كوراساو",
  "Slovakia":"سلوفاكيا","Slovenia":"سلوفينيا","Hungary":"المجر","Romania":"رومانيا","Russia":"روسيا",
  "Finland":"فنلندا","Iceland":"آيسلندا","Albania":"ألبانيا","Bosnia and Herzegovina":"البوسنة والهرسك",
  "North Macedonia":"مقدونيا الشمالية","Montenegro":"الجبل الأسود","Georgia":"جورجيا","Israel":"إسرائيل",
  "Indonesia":"إندونيسيا","Thailand":"تايلاند","China PR":"الصين","China":"الصين","India":"الهند",
};
const teamName = (t) => (t ? (AR_TEAM[t] || t) : "غير محدد");
const tn = (t) => esc(teamName(t));

const state = {
  user: null, profile: null,
  config: null, results: null,
  matches: [], myPreds: new Map(), othersPreds: new Map(),
  bonus: null, names: new Map(), authMode: "login",
  groupPreds: new Map(), thirdPred: { teams: [] },
  bracketPreds: new Map(), bracketOthers: new Map(),
  crests: new Map(), groupToggle: new Map(),
};

// ---------- أدوات صغيرة ----------
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

// ---- وقت السعودية (Asia/Riyadh = UTC+3) + تاريخ بالعربية ----
const SA_TZ = "Asia/Riyadh";
const AR = "ar";
const saDateKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SA_TZ }); // YYYY-MM-DD
const fmtSADate = (iso) =>
  new Date(iso).toLocaleDateString(AR, { timeZone: SA_TZ, calendar: "gregory", numberingSystem: "latn", weekday: "long", day: "numeric", month: "long" });
const fmtSATime = (iso) =>
  new Date(iso).toLocaleTimeString(AR, { timeZone: SA_TZ, calendar: "gregory", numberingSystem: "latn", hour: "2-digit", minute: "2-digit" });
function fmtKick(iso) {
  return new Date(iso).toLocaleString(AR, {
    timeZone: SA_TZ, calendar: "gregory", numberingSystem: "latn",
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// جدول المجموعة محسوبًا من المباريات المنتهية
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
//  تسجيل الدخول
// =====================================================================
function showAuth() { $("#auth-view").classList.remove("hidden"); $("#app-view").classList.add("hidden"); }
function showApp() { $("#auth-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); }

$$(".seg-btn").forEach((b) =>
  b.addEventListener("click", () => {
    if (!b.dataset.mode) return;
    state.authMode = b.dataset.mode;
    $$(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    $("#name-field").style.display = state.authMode === "signup" ? "block" : "none";
    $("#auth-submit").textContent = state.authMode === "signup" ? "إنشاء حساب" : "تسجيل الدخول";
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
  if (!email || !password) { msg.className = "msg error"; msg.textContent = "البريد وكلمة المرور مطلوبان."; return; }

  $("#auth-submit").disabled = true;
  try {
    if (state.authMode === "signup") {
      if (!name) { throw new Error("الرجاء إدخال اسمك."); }
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      state._pendingName = name;
      if (!data.session) {
        msg.textContent = "تم إنشاء الحساب. تحقّق من بريدك للتأكيد ثم سجّل الدخول.";
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) {
    msg.className = "msg error"; msg.textContent = e.message || "حدث خطأ ما.";
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
//  تحميل البيانات
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

  // خريطة شعارات/أعلام لكل منتخب
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

// توقعات الترتيب/الثوالث/الإقصائيات. يتعامل بهدوء إن لم تُطبّق predictions.sql بعد.
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
//  التبويبات
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
//  صف المباراة (مشترك بين المجموعات والإقصائيات)
// =====================================================================
function matchRow(m, opts = {}) {
  const locked = isLocked(m);
  const finished = m.status === "FINISHED" && m.home_score != null;
  const live = ["IN_PLAY", "PAUSED"].includes(m.status);
  const mine = state.myPreds.get(m.id);
  const hv = mine ? mine.home_score : "";
  const av = mine ? mine.away_score : "";

  let statusPill = `<span class="pill open">مفتوحة</span>`;
  if (live) statusPill = `<span class="pill live">● مباشر</span>`;
  else if (finished) statusPill = `<span class="pill points">+${pointsFor(mine, m)} نقطة</span>`;
  else if (locked) statusPill = `<span class="pill locked">مقفلة</span>`;

  const disabled = locked ? "disabled" : "";

  let actual = "";
  if (finished) actual = `<span class="actual">النتيجة: <b>${m.home_score}–${m.away_score}</b></span>`;
  else if (live && m.home_score != null) actual = `<span class="actual">مباشر: <b>${m.home_score}–${m.away_score}</b></span>`;

  // توقعات الآخرين (تظهر بعد انطلاق المباراة فقط عبر RLS)
  let others = "";
  const list = state.othersPreds.get(m.id);
  if (locked && list?.length) {
    const chips = list
      .map((p) => `<span class="chip"><b>${esc(state.names.get(p.user_id) || "؟")}</b> ${p.home_score}–${p.away_score}</span>`)
      .join("");
    others = `<div class="others">التوقعات: ${chips}</div>`;
  }

  // مَن يتأهل (للإقصائيات فقط، إذا عُرف الفريقان)
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
    adv = `<div class="advrow"><span class="advlbl">يتأهل:</span>${advBtn(m.home_team)}${advBtn(m.away_team)}</div>`;
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
        ${actual}<span class="saved-tag">حُفظ ✓</span>${statusPill}
      </span>
    </div>
    ${adv}
    ${others}
  </div>`;
}

// أزرار "مَن يتأهل" في الإقصائيات
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
        if (error) { toast("مقفلة — انطلقت المباراة.", true); return; }
        state.bracketPreds.set(id, team);
        $$(".adv-btn", row).forEach((b) => b.classList.toggle("sel", b.dataset.team === team));
        toast("تم حفظ المتأهل ✓");
      })
    );
  });
}

// حفظ توقّع نتيجة مباراة (مع تأخير بسيط)
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
          if (error) { toast("مقفلة — انطلقت المباراة.", true); return; }
          state.myPreds.set(id, { match_id: id, user_id: state.user.id, home_score, away_score });
          tag.classList.add("show"); setTimeout(() => tag.classList.remove("show"), 1200);
          maybeRevealNext(id);
        }, 550);
      })
    );
  });
}

// عند إكمال توقعات مجموعة، افتح المجموعة التالية تلقائيًا
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
//  دور المجموعات
// =====================================================================
function groupComplete(matches) {
  return matches.length > 0 && matches.every((m) => state.myPreds.has(m.id));
}
function renderGroups() {
  const el = $("#tab-groups");
  const groupMatches = state.matches.filter((m) => m.stage === "GROUP_STAGE");
  if (!groupMatches.length) { el.innerHTML = emptyState(); return; }

  const byGroup = {};
  groupMatches.forEach((m) => { (byGroup[m.grp || "؟"] ??= []).push(m); });
  const names = Object.keys(byGroup).sort();

  el.innerHTML =
    `<p class="note">توقّع نتيجة كل مباراة. تُقفل المباراة عند انطلاقها. النتيجة الصحيحة بالضبط = ٢ نقطة، توقّع الفائز = ١. تُفتح المجموعة التالية تلقائيًا بعد إكمال توقعات المجموعة التي قبلها.</p>` +
    names.map((g, idx) => {
      const rows = byGroup[g].map((m) => matchRow(m)).join("");
      const prevComplete = idx === 0 || groupComplete(byGroup[names[idx - 1]]);
      const manual = state.groupToggle.get(g); // true=مفتوحة، false=مغلقة، undefined=تلقائي
      const open = manual !== undefined ? manual : (idx === 0 || prevComplete);
      const done = groupComplete(byGroup[g]) ? `<span class="group-done">✓ مكتملة</span>` : "";
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
//  الأدوار الإقصائية
// =====================================================================
function renderKnockouts() {
  const el = $("#tab-knockouts");
  const ko = state.matches.filter(isKnockout);
  if (!ko.length) {
    el.innerHTML = `<div class="empty">تظهر الأدوار الإقصائية تلقائيًا بعد انتهاء دور المجموعات وتحديد المباريات.</div>`;
    return;
  }
  const byStage = {};
  ko.forEach((m) => { (byStage[m.stage] ??= []).push(m); });
  const stages = [
    ...STAGE_ORDER.filter((s) => byStage[s]),
    ...Object.keys(byStage).filter((s) => !STAGE_ORDER.includes(s)),
  ];
  el.innerHTML =
    `<p class="note">توقّع النتيجة، واضغط على المنتخب الذي تظنه <b>سيتأهل</b> من كل مواجهة. النقاط: صحيحة بالضبط ٢ / الفائز ١. التأهل الصحيح: ${state.config?.points_advance ?? 2} نقطة. الكل يُقفل عند انطلاق المباراة.</p>` +
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
//  التوقعات الإضافية (البطل/النهائي/نصف النهائي)
// =====================================================================
function teamList() {
  const set = new Set();
  state.matches.filter((m) => m.stage === "GROUP_STAGE").forEach((m) => {
    if (m.home_team) set.add(m.home_team);
    if (m.away_team) set.add(m.away_team);
  });
  return [...set].sort((a, b) => teamName(a).localeCompare(teamName(b), "ar"));
}
function selectFor(field, current, teams, disabled) {
  const opts = `<option value="">— اختر —</option>` +
    teams.map((t) => `<option value="${esc(t)}" ${t === current ? "selected" : ""}>${tn(t)}</option>`).join("");
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

  const lockNote = locked
    ? `<p class="note">التوقعات الإضافية مقفلة (انطلقت البطولة).</p>`
    : `<p class="note">ثبّت توقعاتك قبل أول مباراة${state.config?.bonus_locks_at ? " (" + fmtKick(state.config.bonus_locks_at) + ")" : ""}. البطل = ${state.config.points_champion} نقطة، كل صاحب نهائي = ${state.config.points_finalist}، كل صاحب نصف نهائي = ${state.config.points_semifinalist}.</p>`;

  el.innerHTML = lockNote + `<div class="bonus-grid">
    <div class="bonus-card">
      <h4>🏆 البطل <small style="color:var(--gold)">${r.champion ? "· الفعلي: " + tn(r.champion) : ""}</small></h4>
      <p class="hint">مَن يرفع الكأس؟ بـ ${state.config.points_champion} نقطة.</p>
      ${selectFor("champion", b.champion, teams, dis)}
    </div>
    <div class="bonus-card">
      <h4>🥈 صاحبا النهائي</h4>
      <p class="hint">المنتخبان في النهائي. ${state.config.points_finalist} نقطة لكل منهما.</p>
      <div class="bonus-row">
        ${selectFor("finalist1", b.finalist1, teams, dis)}
        ${selectFor("finalist2", b.finalist2, teams, dis)}
      </div>
    </div>
    <div class="bonus-card">
      <h4>🥉 أصحاب نصف النهائي</h4>
      <p class="hint">المنتخبات الأربعة في نصف النهائي. ${state.config.points_semifinalist} نقطة لكل منها.</p>
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
        if (error) { toast("تعذّر الحفظ (ربما مقفل).", true); return; }
        state.bonus = payload;
        toast("تم حفظ التوقع ✓");
      })
    );
  }
}

// =====================================================================
//  ترتيب المجموعات (سحب وإفلات) + أفضل أصحاب المركز الثالث
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
    const lockBadge = locked ? `<span class="group-locked">🔒 مقفلة</span>` : "";
    return `<div class="bonus-card">
      <h4>${esc(grpName(g))} ${lockBadge}</h4>
      <ul class="dnd${locked ? " locked" : ""}" data-grp="${esc(g)}">${lis}</ul>
    </div>`;
  }).join("");

  const note = locked
    ? `<p class="note">توقعات الترتيب مقفلة (انطلقت البطولة).</p>`
    : `<p class="note">رتّب فرق كل مجموعة بالسحب والإفلات من الأول إلى الرابع. تُقفل عند أول مباراة${C?.bonus_locks_at ? " (" + fmtKick(C.bonus_locks_at) + ")" : ""}. المركز الصحيح = ${C.points_group_pos} نقطة · المجموعة كاملة = +${C.points_group_perfect} · كل ثالث صحيح = ${C.points_third}.</p>`;

  el.innerHTML = note +
    `<h3 class="sec">📊 ترتيب المجموعات النهائي</h3><div class="bonus-grid picks-grid">${orderCards}</div>` +
    `<h3 class="sec">🥉 أفضل أصحاب المركز الثالث</h3><div id="thirds-wrap"></div>`;

  if (!locked && window.Sortable) {
    $$(".dnd", el).forEach((ul) =>
      Sortable.create(ul, {
        animation: 150, handle: ".handle",
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
  if (error) { toast("تعذّر الحفظ (مقفل؟).", true); return; }
  state.groupPreds.set(g, row);
  toast(grpName(g) + " — تم الحفظ ✓");
}

// الفرق التي وضعها المستخدم في المركز الثالث في كل مجموعة
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
    wrap.innerHTML = `<p class="thirds-count">رتّب مجموعاتك أولًا — ستظهر هنا الفرق التي وضعتها في المركز الثالث لتختار منها ٨.</p>`;
    return;
  }

  const chips = opts.map((t) => {
    const on = chosen.includes(t) ? " sel" : "";
    return `<button class="tchip${on}" data-team="${esc(t)}" ${locked ? "disabled" : ""}>${flagImg(t, "crest")}${tn(t)}</button>`;
  }).join("");

  wrap.innerHTML = `<div class="bonus-card">
    <p class="hint">يتأهل ٨ من أصحاب المراكز الثالثة إلى دور الـ32. اختر ٨ من الفرق التي وضعتها في المركز الثالث. ${C.points_third} نقطة لكل فريق صحيح.</p>
    <p class="thirds-count">المختار: <b id="tcount">${chosen.length}</b> / 8</p>
    <div class="thirds-chips">${chips}</div>
  </div>`;

  if (locked) return;
  $$(".tchip", wrap).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const t = btn.dataset.team;
      const cur = new Set((state.thirdPred?.teams || []).filter((x) => opts.includes(x)));
      if (cur.has(t)) cur.delete(t);
      else { if (cur.size >= 8) { toast("الحد الأقصى ٨ فرق.", true); return; } cur.add(t); }
      const teams = [...cur];
      const { error } = await sb.from("third_predictions")
        .upsert({ user_id: state.user.id, teams, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) { toast("تعذّر الحفظ (مقفل؟).", true); return; }
      state.thirdPred = { teams };
      btn.classList.toggle("sel");
      const c = $("#tcount"); if (c) c.textContent = cur.size;
    })
  );
}

// =====================================================================
//  المجموعات والجدول (معلومات فقط)
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
          <thead><tr><th></th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>الفارق</th><th>نقاط</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  const sorted = [...state.matches].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const byDay = {};
  sorted.forEach((m) => { (byDay[saDateKey(m.kickoff)] ??= []).push(m); });

  const schedHtml = Object.keys(byDay).sort().map((day) => {
    const items = byDay[day].map((m) => {
      const label = m.grp ? grpName(m.grp) : stageLabel(m.stage);
      const finished = m.status === "FINISHED" && m.home_score != null;
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      const scoreOrVs = finished || (live && m.home_score != null)
        ? `<b class="sc">${m.home_score}–${m.away_score}</b>`
        : `<span class="vs">×</span>`;
      const flag = live ? `<span class="pill live">● مباشر</span>` : finished ? `<span class="pill points">انتهت</span>` : "";
      return `<div class="srow">
        <span class="stime">${fmtSATime(m.kickoff)}</span>
        <span class="steams">
          <span class="sh">${flagImg(m.home_team)}${tn(m.home_team)}</span>
          ${scoreOrVs}
          <span class="sa">${tn(m.away_team)}${flagImg(m.away_team)}</span>
        </span>
        <span class="stag">${esc(label)} ${flag}</span>
      </div>`;
    }).join("");
    return `<div class="sday"><div class="sday-head">${fmtSADate(byDay[day][0].kickoff)}</div>${items}</div>`;
  }).join("");

  el.innerHTML =
    `<p class="note">تتحدّث جداول المجموعات تلقائيًا مع ورود النتائج (المتأهلان الأولان مظلّلان). كل المواعيد بتوقيت <b>السعودية (UTC+3)</b>.</p>` +
    `<div class="seg info-seg">
       <button class="seg-btn active" data-view="tables">جداول المجموعات</button>
       <button class="seg-btn" data-view="schedule">الجدول الكامل</button>
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
//  الترتيب العام
// =====================================================================
async function renderBoard() {
  const el = $("#tab-board");
  el.innerHTML = `<div class="empty">يتم حساب النقاط…</div>`;
  const { data, error } = await sb.rpc("get_leaderboard");
  if (error) { el.innerHTML = `<div class="empty">تعذّر تحميل الترتيب.</div>`; return; }
  if (!data?.length) { el.innerHTML = `<div class="empty">لا يوجد لاعبون بعد. سجّلوا العائلة!</div>`; return; }

  const rows = data.map((u, i) => {
    const me = u.user_id === state.user.id ? " me" : "";
    const parts = [
      `${u.exact_count} تامة`,
      `${u.result_count} نتيجة`,
      `${u.bonus_points} إضافية`,
    ];
    if (u.group_points) parts.push(`${u.group_points} مجموعات`);
    if (u.third_points) parts.push(`${u.third_points} ثوالث`);
    if (u.bracket_points) parts.push(`${u.bracket_points} إقصائي`);
    return `<div class="row${me}">
      <div class="rank">${i + 1}</div>
      <div class="name">${esc(u.display_name)}${me ? " (أنت)" : ""}
        <small>${parts.join(" · ")}</small>
      </div>
      <div class="total">${u.total_points}<span> نقطة</span></div>
    </div>`;
  }).join("");
  el.innerHTML = `<p class="note">يتحدّث تلقائيًا مع ورود النتائج.</p><div class="board">${rows}</div>`;
}

function emptyState() {
  return `<div class="empty">لم تُحمّل المباريات بعد.<br/>تظهر تلقائيًا عند أول تشغيل لوظيفة النتائج.</div>`;
}

// ---------- إقلاع ----------
(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) showAuth();
})();
