// Shared pieces: Supabase client, live data store, scoring math, formatting.
import { createClient } from "@supabase/supabase-js";

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!(URL_ && KEY_);
export const sb = configured ? createClient(URL_, KEY_, { auth: { persistSession: true } }) : null;

// The login box takes a plain username ("judges"); Supabase needs an email.
export const LOGIN_DOMAIN = "stackitup.local";
export const toEmail = u => (u.includes("@") ? u.trim() : `${u.trim().toLowerCase()}@${LOGIN_DOMAIN}`);

/* ---------- helpers ---------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const r3 = n => Math.round(n * 1000) / 1000;
export function fmt(n) {
  if (n == null || isNaN(n)) return "–";
  let s = r3(n).toFixed(3).replace(/0+$/, "");
  if (s.endsWith(".")) s += "00";
  else if (s.split(".")[1].length < 2) s += "0";
  return s;
}
export const ord = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const sid = (l, t, e) => `${l}--${t}--${e}`;
export const mkId = name => (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x") + "-" + Math.random().toString(36).slice(2, 6);
export const evLabel = ev => (ev.round ? ev.round + " " : "") + ev.name;
export const catKey = ev => (ev.award || ev.name || "").trim();

export function toast(msg) {
  const t = document.getElementById("toast"); if (!t) return;
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2800);
}
export function confirmBox(msg, ok = "Confirm", danger = true) {
  return new Promise(res => {
    const bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal panel" role="dialog" aria-modal="true"><div>${msg}</div><div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-a="yes">${esc(ok)}</button></div></div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { const a = e.target.closest("[data-a]"); if (!a && e.target !== bg) return; bg.remove(); res(a?.dataset.a === "yes"); });
    bg.querySelector('[data-a="yes"]').focus();
  });
}

/* ---------- scoring math ---------- */
function denseRank(items, val) {
  const vals = [...new Set(items.map(val).filter(v => v != null))].sort((a, b) => b - a);
  const m = new Map(); items.forEach(it => { const v = val(it); m.set(it, v == null ? null : vals.indexOf(v) + 1); }); return m;
}
// Everything the display, judges' grid and results need for one level.
export function calcLevel(L, scores) {
  const cats = [];
  for (const ev of L.events) {
    const k = catKey(ev); let c = cats.find(c => c.name === k);
    if (!c) { c = { name: k, individual: false, events: [] }; cats.push(c); }
    c.events.push(ev); if (ev.individual) c.individual = true;
  }
  let entered = 0;
  const teams = L.teams.map(t => {
    const row = { id: t.id, name: t.name, total: 0, count: 0, cats: {} };
    for (const c of cats) {
      const parts = c.events.map(ev => { const s = scores[sid(L.id, t.id, ev.id)]; return { ev, s: s && typeof s.score === "number" && !isNaN(s.score) ? s : null }; });
      const got = parts.filter(p => p.s);
      const sum = got.length ? r3(got.reduce((a, p) => a + p.s.score, 0)) : null;
      row.cats[c.name] = { parts, sum };
      if (sum != null) { row.total = r3(row.total + sum); row.count += got.length; }
    }
    entered += row.count; return row;
  });
  const overall = denseRank(teams, t => (t.count ? t.total : null));
  teams.forEach(t => (t.place = overall.get(t)));
  const awards = cats.map(c => {
    let entries;
    if (c.individual) {
      entries = [];
      teams.forEach(t => t.cats[c.name].parts.forEach(p => { if (p.s) entries.push({ name: (p.s.athlete || "").trim() || `${t.name} (${p.ev.name})`, team: t.name, score: p.s.score }); }));
    } else entries = teams.filter(t => t.cats[c.name].sum != null).map(t => ({ name: t.name, score: t.cats[c.name].sum }));
    const rk = denseRank(entries, e => e.score); entries.forEach(e => (e.place = rk.get(e)));
    entries.sort((a, b) => a.place - b.place || a.name.localeCompare(b.name));
    return { name: c.name, individual: c.individual, entries };
  });
  const ovEntries = teams.filter(t => t.count).map(t => ({ name: t.name, score: t.total, place: t.place })).sort((a, b) => a.place - b.place);
  return { cats, teams, awards, overall: ovEntries, entered, expected: L.teams.length * L.events.length };
}

/* ---------- live data store ---------- */
const norm = r => ({
  id: r.id, level: r.level, team: r.team, event: r.event,
  score: Number(r.score), athlete: r.athlete || "",
  flashAt: Number(r.flash_at || 0), updatedAt: Number(r.updated_at || 0),
});

// Loads config + scores, then keeps them live through Supabase Realtime.
// onScore(row, previousRow) fires for every insert/update that arrives live.
export function createStore({ onChange, onScore } = {}) {
  const st = { config: null, scores: {}, loaded: false, status: "connecting", error: "" };
  if (!sb) { st.status = "error"; st.error = "Supabase isn't configured."; return st; }

  async function loadAll() {
    const [c, s] = await Promise.all([
      sb.from("meet_config").select("data").eq("id", 1).maybeSingle(),
      sb.from("scores").select("*"),
    ]);
    if (c.error || s.error) {
      st.error = (c.error || s.error).message; if (!st.loaded) st.status = "error";
      onChange?.(); return;
    }
    st.config = c.data?.data || null;
    st.scores = Object.fromEntries(s.data.map(r => [r.id, norm(r)]));
    st.loaded = true; st.error = "";
    onChange?.();
  }
  st.reload = loadAll;

  sb.channel("meet-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, p => {
      if (p.eventType === "DELETE") { delete st.scores[p.old.id]; }
      else { const r = norm(p.new); const prev = st.scores[r.id]; st.scores[r.id] = r; onScore?.(r, prev); }
      onChange?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "meet_config" }, p => {
      if (p.new?.data) { st.config = p.new.data; onChange?.(); }
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") { st.status = "live"; loadAll(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { st.status = "reconnecting"; onChange?.(); }
    });

  loadAll();
  // Safety net: re-sync every 30 s in case the connection dropped a message.
  setInterval(() => { if (document.visibilityState === "visible") loadAll(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadAll(); });
  return st;
}

export const levelsOf = st => st.config?.levels || [];

/* ---------- sessions + what the TV shows ---------- */
export const sessionOf = L => String(L.session || "1").trim() || "1";
export function sessionsOf(config) {
  const out = [];
  (config?.levels || []).forEach(L => { const s = sessionOf(L); if (!out.includes(s)) out.push(s); });
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
// Host-chosen display settings, with sensible defaults.
export function displaySettings(config) {
  const d = config?.display || {};
  const sessions = sessionsOf(config);
  const session = d.session === "all" || sessions.includes(d.session) ? d.session : (sessions.length > 1 ? sessions[0] : "all");
  return { session, mode: d.mode === "rotate" ? "rotate" : "side", seconds: Math.min(600, Math.max(5, Number(d.seconds) || 45)) };
}
export function sessionLevels(config, session) {
  const lv = config?.levels || [];
  if (session === "all") return lv;
  const pick = lv.filter(L => sessionOf(L) === session);
  return pick.length ? pick : lv;
}
export const displayUrl = () => new URL("/display", location.origin).href;
