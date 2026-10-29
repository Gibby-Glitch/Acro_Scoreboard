// Public, read-only scoreboard for the TV / cast screen and parents' phones.
// What it shows (which session, side-by-side or rotating) is chosen by the host
// on the scoring desk's "Cast & QR" tab and stored in meet_config.data.display.
import "./styles.css";
import QRCode from "qrcode";
import { configured, createStore, calcLevel, levelsOf, displaySettings, sessionLevels, esc, fmt, ord, sid, evLabel, displayUrl, toast } from "./core.js";

const app = document.getElementById("app");
const flashEl = document.getElementById("flash");
const phone = matchMedia("(max-width: 760px)");
const ui = { rotId: null, rotNext: 0, rotKey: "", showQr: true, qr: "", fresh: {}, queue: [], flashing: false };
try { ui.showQr = localStorage.getItem("sb-qr") !== "0"; } catch (_) {}

QRCode.toDataURL(displayUrl(), { margin: 1, width: 300, errorCorrectionLevel: "M" }).then(u => { ui.qr = u; render(); }).catch(() => {});

let st = null;
if (!configured) {
  app.innerHTML = `<div class="sb"><div class="sb-empty">This site isn't connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.</div></div>`;
} else {
  st = createStore({
    onChange: () => render(),
    onScore: (r, prev) => {
      ui.fresh[r.id] = Date.now();
      if (r.flashAt && r.flashAt !== prev?.flashAt) queueFlash(r.id);
    },
  });
  render();
  setInterval(tick, 1000);
  phone.addEventListener?.("change", () => render());
}

/* Which levels are on screen right now. */
function current() {
  const ds = displaySettings(st.config);
  const lv = sessionLevels(st.config, ds.session);
  const rotate = ds.mode === "rotate" && lv.length > 1 && !phone.matches;
  // Restart the rotation whenever the host changes session / mode / timing.
  const key = `${ds.session}|${ds.mode}|${ds.seconds}|${lv.map(l => l.id).join(",")}`;
  if (key !== ui.rotKey) { ui.rotKey = key; ui.rotId = lv[0]?.id || null; ui.rotNext = Date.now() + ds.seconds * 1000; }
  if (rotate && !lv.some(l => l.id === ui.rotId)) ui.rotId = lv[0].id;
  const shown = rotate ? lv.filter(l => l.id === ui.rotId) : lv;
  return { ds, lv, rotate, shown };
}

function tick() {
  const c = document.getElementById("sbclock");
  if (c) c.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!st?.loaded) return;
  const { ds, lv, rotate } = current();
  const left = Math.max(0, Math.ceil((ui.rotNext - Date.now()) / 1000));
  const cd = document.getElementById("sbnext"); if (cd && rotate) cd.textContent = `${left}s`;
  if (rotate && !ui.flashing && Date.now() >= ui.rotNext) {
    const i = lv.findIndex(l => l.id === ui.rotId);
    ui.rotId = lv[(i + 1) % lv.length].id;
    ui.rotNext = Date.now() + ds.seconds * 1000;
    render();
  }
}

function render() {
  if (!st) return;
  const all = levelsOf(st);
  const { ds, lv, rotate, shown } = current();
  const cols = Math.max(1, shown.length);
  const maxRows = Math.max(1, ...shown.map(L => calcLevel(L, st.scores).cats.length + 2));
  const fs = rotate ? `min(${(44 / maxRows).toFixed(2)}vh, 4vw)` : `min(${(62 / maxRows).toFixed(2)}vh, ${((3.4 / cols) * 1.6).toFixed(2)}vw)`;

  let body;
  if (st.status === "error") body = `<div class="sb-empty">Can't reach the scores right now.<br><small>${esc(st.error)}</small></div>`;
  else if (!st.loaded) body = `<div class="sb-empty">Connecting to the scoring desk…</div>`;
  else if (!all.length) body = `<div class="sb-empty">No levels set up yet.</div>`;
  else body = shown.map(sbCard).join("");
  const plain = !st.loaded || !all.length || st.status === "error";

  // Session label + rotation dots
  const sessLabel = ds.session === "all" ? "" : `Session ${esc(ds.session)}`;
  const dots = rotate ? `<span class="sb-dots">${lv.map(l => `<span class="${l.id === ui.rotId ? "on" : ""}">${esc(l.name)}</span>`).join("")}<em id="sbnext"></em></span>` : "";

  const ids = new Set(lv.map(l => l.id));
  const recent = Object.values(st.scores).filter(s => s.updatedAt && ids.has(s.level)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(s => {
    const L = all.find(l => l.id === s.level); const t = L?.teams.find(x => x.id === s.team); const ev = L?.events.find(x => x.id === s.event);
    if (!t || !ev) return "";
    return `<span><b>${esc(t.name)}</b> ${lv.length > 1 ? esc(L.name) + " " : ""}${esc(evLabel(ev))}${s.athlete ? ` (${esc(s.athlete)})` : ""} <em>${fmt(s.score)}</em></span>`;
  }).join("");

  const live = st.status === "live" ? "Live scores" : st.status === "reconnecting" ? "Reconnecting…" : "Connecting…";
  app.innerHTML = `<div class="sb">
    <div class="sb-head"><div class="sb-title">${esc(st.config?.name || "Live scores")}</div>${sessLabel ? `<div class="sb-sess">${sessLabel}</div>` : ""}<div class="sb-live"><i></i>${live}</div>
      <div class="sb-ctl"><button data-act="qr">${ui.showQr ? "Hide QR" : "Show QR"}</button><button data-act="fs">Full screen</button></div>
      <div class="sb-clock" id="sbclock"></div>
      ${ui.showQr && ui.qr ? `<div class="sb-qr"><span>Scores on<br>your phone</span><img src="${ui.qr}" alt="QR code for live scores"></div>` : ""}</div>
    <div class="sb-body" style="--cols:${plain ? 1 : cols};--fs:${fs}">${body}</div>
    <div class="sb-ticker">${dots}<span class="lab">Latest</span>${recent || "<span>Scores appear here as judges enter them.</span>"}</div>
  </div>`;
  tick();
}

function sbCard(L) {
  const C = calcLevel(L, st.scores);
  const now = Date.now();
  const soleLead = t => t.place === 1 && C.teams.filter(x => x.place === 1).length === 1;
  let cells = `<div></div>` + C.teams.map(t => `<div class="sb-th ${soleLead(t) ? "lead" : ""}">${esc(t.name)}<span class="rk">${t.place ? ord(t.place) : "&nbsp;"}</span></div>`).join("");
  for (const c of C.cats) {
    const sums = C.teams.map(t => t.cats[c.name].sum).filter(v => v != null);
    const best = sums.length > 1 ? Math.max(...sums) : null;
    cells += `<div class="sb-ev">${esc(c.name)}</div>`;
    cells += C.teams.map(t => {
      const cc = t.cats[c.name]; const got = cc.parts.filter(p => p.s);
      const fresh = cc.parts.some(p => { const f = ui.fresh[sid(L.id, t.id, p.ev.id)]; return p.s && f && now - f < 2500; });
      const sub = c.individual && got.length ? `<small>${got.map(p => esc(p.s.athlete || fmt(p.s.score))).join(", ")}</small>`
        : cc.parts.length > 1 && got.length ? `<small>${got.map(p => fmt(p.s.score)).join(" + ")}</small>` : "";
      return `<div class="sb-sc ${cc.sum == null ? "none" : ""} ${best != null && cc.sum === best && !c.individual ? "best" : ""} ${fresh ? "fresh" : ""}">${cc.sum == null ? "–" : fmt(cc.sum)}${sub}</div>`;
    }).join("");
  }
  cells += `<div class="sb-ev sb-tot">Total</div>` + C.teams.map(t => `<div class="sb-sc sb-tot ${soleLead(t) ? "best" : ""}">${t.count ? fmt(t.total) : "–"}</div>`).join("");
  return `<section class="sb-card"><div class="sb-card-h"><h2>${esc(L.name)}</h2><span>${C.entered}/${C.expected} scored</span></div>
    <div class="sb-tbl" style="--teams:${L.teams.length};grid-template-rows:auto repeat(${C.cats.length + 1},1fr)">${cells}</div></section>`;
}

/* ---------- full-screen flash ---------- */
function queueFlash(id) { ui.queue.push(id); if (!ui.flashing) nextFlash(); }
function nextFlash() {
  const id = ui.queue.shift(); if (!id) { ui.flashing = false; return; }
  const s = st.scores[id]; const L = s && levelsOf(st).find(l => l.id === s.level);
  const t = L?.teams.find(x => x.id === s.team); const ev = L?.events.find(x => x.id === s.event);
  if (!s || !t || !ev) return nextFlash();
  ui.flashing = true;
  // When rotating, land on the level that just scored and give it a full turn on screen.
  const { ds, lv } = current();
  if (lv.some(l => l.id === L.id)) { ui.rotId = L.id; ui.rotNext = Date.now() + 6950 + ds.seconds * 1000; }
  const tr = calcLevel(L, st.scores).teams.find(x => x.id === t.id);
  const HOLD = 6500;
  flashEl.innerHTML = `<div class="fl-in"><div class="fl-lvl">${esc(L.name)}</div><div class="fl-team">${esc(t.name)}</div>${s.athlete ? `<div class="fl-ath">${esc(s.athlete)}</div>` : ""}<div class="fl-ev">${esc(evLabel(ev))}</div><div class="fl-score" id="flscore">${fmt(s.score)}</div><div class="fl-sub">Team total <b>${fmt(tr.total)}</b>${tr.place ? ` · <b>${ord(tr.place)}</b> in ${esc(L.name)}` : ""}</div><div class="fl-bar"><i style="animation-duration:${HOLD}ms"></i></div></div>`;
  flashEl.classList.remove("out"); flashEl.hidden = false;
  countUp(document.getElementById("flscore"), s.score);
  setTimeout(() => {
    flashEl.classList.add("out");
    setTimeout(() => { flashEl.hidden = true; render(); setTimeout(nextFlash, 500); }, 450);
  }, HOLD);
}
function countUp(el, target) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(target); return; }
  const dur = 900, t0 = performance.now();
  const step = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target); };
  requestAnimationFrame(step);
}

/* ---------- controls ---------- */
app.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "qr") {
    ui.showQr = !ui.showQr; try { localStorage.setItem("sb-qr", ui.showQr ? "1" : "0"); } catch (_) {}
    render();
  } else if (a === "fs") {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (_) { toast("Use your browser's full-screen option instead."); }
  }
});

/* keep the TV screen awake */
async function wake() { try { await navigator.wakeLock?.request("screen"); } catch (_) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
wake();
