// Scoring desk: login, judges' entry, results, setup, and share/cast (QR).
import "./styles.css";
import QRCode from "qrcode";
import { sb, configured, toEmail, createStore, calcLevel, levelsOf, esc, fmt, r3, ord, sid, mkId, evLabel, catKey, toast, confirmBox, displayUrl } from "./core.js";

const app = document.getElementById("app");
const S = { session: null, st: null, sel: null, entry: "", athlete: "", err: "", saving: false, judgeLevel: null, draft: null, draftDirty: false, loginErr: "", qr: "" };
const view = () => (location.hash || "#judge").slice(1) || "judge";
const levels = () => (S.st ? levelsOf(S.st) : []);
const findLevel = id => levels().find(l => l.id === id);

/* ---------- boot ---------- */
if (!configured) {
  app.innerHTML = `<div class="wrap"><div class="panel" style="padding:20px"><h1 class="h-sec">Almost there</h1><p>This site isn't connected to Supabase yet. In Vercel, add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> under Settings → Environment Variables, then redeploy. See the README for the full steps.</p></div></div>`;
} else {
  sb.auth.getSession().then(({ data }) => { S.session = data.session; start(); });
  sb.auth.onAuthStateChange((_e, session) => { const was = !!S.session; S.session = session; if (was !== !!session) start(); });
  window.addEventListener("hashchange", () => { S.err = ""; render(); });
  QRCode.toDataURL(displayUrl(), { margin: 1, width: 640, errorCorrectionLevel: "M" }).then(u => { S.qr = u; if (view() === "share") render(); });
}
function start() {
  if (S.session && !S.st) S.st = createStore({ onChange: () => { if (!S.draftDirty) S.draft = null; render(); } });
  render();
}

/* ---------- shell ---------- */
function topBar(active) {
  const st = S.st;
  const conn = !st ? "" : st.status === "live" ? `<span class="dot live"></span>Live` : st.status === "error" ? `<span class="dot bad"></span>Not connected` : `<span class="dot"></span>Connecting`;
  const tab = (h, l) => `<a href="#${h}" ${active === h ? 'aria-current="page"' : ""}>${l}</a>`;
  return `<div class="bar"><div class="brand">${esc(st?.config?.name || "Meet scoring")}<small>Scoring desk</small></div>
    <span class="status">${conn}</span>
    <nav class="tabs">${tab("judge", "Judges")}${tab("results", "Results")}${tab("setup", "Setup")}${tab("share", "Cast &amp; QR")}</nav>
    <button class="btn sm signout" data-act="signout">Sign out</button></div>`;
}
function notReady() {
  const st = S.st;
  if (st.status === "error") return `<div class="panel" style="padding:18px"><b>Can't load the meet.</b><p class="note">${esc(st.error)}. Check that you ran <code>supabase/schema.sql</code> in Supabase.</p></div>`;
  if (!st.loaded) return `<p class="note">Loading meet…</p>`;
  return "";
}

function render() {
  if (!configured) return;
  if (!S.session) return renderLogin();
  const v = view();
  const keepScroll = window.scrollY;
  const ae = document.activeElement; const focusId = ae && ae.id && app.contains(ae) ? ae.id : null;
  let selS = null, selE = null; try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (_) {}
  let html;
  if (v === "results") html = renderResults();
  else if (v === "setup") html = renderSetup();
  else if (v === "share") html = renderShare();
  else html = renderJudge();
  app.innerHTML = `<div class="wrap">${html}</div>`;
  window.scrollTo(0, keepScroll);
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus({ preventScroll: true }); try { if (selS != null) el.setSelectionRange(selS, selE); } catch (_) {} } }
}

/* ---------- login ---------- */
function renderLogin() {
  app.innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <div><p class="eyebrow">Judges &amp; meet host</p><h1 class="meet-title">Scoring desk</h1></div>
    <div class="field"><label class="eyebrow" for="lu">Username</label><input id="lu" name="u" autocomplete="username" autocapitalize="none" autocorrect="off" required></div>
    <div class="field"><label class="eyebrow" for="lp">Password</label><input id="lp" name="p" type="password" autocomplete="current-password" required></div>
    <div class="err">${esc(S.loginErr)}</div>
    <button class="btn primary" type="submit">Sign in</button>
    <p class="note" style="margin:0">Parents and the TV don't need to sign in. Open <a href="/display">the live display</a> instead.</p>
  </form></div>`;
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector("button"); btn.disabled = true; S.loginErr = "";
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(f.u.value), password: f.p.value });
    if (error) { S.loginErr = "That username and password didn't match. Check with the meet host."; btn.disabled = false; renderLogin(); document.getElementById("lu").value = f.u.value; }
  });
}

/* ---------- judges ---------- */
function renderJudge() {
  const nr = notReady(); if (nr) return topBar("judge") + nr;
  if (!levels().length) return topBar("judge") + `<div class="panel" style="padding:18px">No levels yet. <a href="#setup">Set up the meet</a> first.</div>`;
  if (!S.judgeLevel || !findLevel(S.judgeLevel)) S.judgeLevel = levels()[0].id;
  const L = findLevel(S.judgeLevel); const C = calcLevel(L, S.st.scores);
  const lt = levels().map(l => `<button data-act="lvl" data-l="${esc(l.id)}" aria-pressed="${l.id === L.id}">${esc(l.name)}</button>`).join("");
  const head = L.teams.map(t => `<th class="team">${esc(t.name)}</th>`).join("");
  const rows = L.events.map(ev => `<tr><th>${esc(ev.name)}${ev.round || ev.individual ? `<span class="rd">${esc([ev.round, ev.individual ? "individual" : ""].filter(Boolean).join(" · "))}</span>` : ""}</th>${L.teams.map(t => {
    const s = S.st.scores[sid(L.id, t.id, ev.id)];
    const sel = S.sel && S.sel.l === L.id && S.sel.t === t.id && S.sel.e === ev.id;
    return `<td><button class="cellbtn ${s ? "" : "empty"} ${sel ? "sel" : ""}" data-act="cell" data-l="${esc(L.id)}" data-t="${esc(t.id)}" data-e="${esc(ev.id)}" aria-label="${esc(t.name + " " + evLabel(ev))}">${s ? fmt(s.score) : "—"}${s && s.athlete ? `<span class="ath">${esc(s.athlete)}</span>` : ""}</button></td>`;
  }).join("")}</tr>`).join("");
  const foot = `<tr><th>Total</th>${C.teams.map(t => `<td class="num">${t.count ? fmt(t.total) : "—"}</td>`).join("")}</tr><tr><th>Place</th>${C.teams.map(t => `<td>${t.place ? ord(t.place) : "—"}</td>`).join("")}</tr>`;
  return `${topBar("judge")}
  <div class="judge">
    <div>
      <div class="lvl-tabs">${lt}</div>
      <div class="panel scroll-x"><table class="mx"><thead><tr><th>Event</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
      <p class="note" style="margin-top:8px">${C.entered} of ${C.expected} scores entered for ${esc(L.name)}.</p>
    </div>
    ${entryPanel()}
  </div>`;
}
function entryPanel() {
  if (!S.sel) return `<aside class="panel entry"><div class="what"><span class="eyebrow">Score entry</span><b>Pick a box</b><span class="note">Tap a team's box for an event to enter or fix its score.</span></div><div class="readout ph">0.00</div></aside>`;
  const L = findLevel(S.sel.l), t = L?.teams.find(x => x.id === S.sel.t), ev = L?.events.find(x => x.id === S.sel.e);
  if (!L || !t || !ev) { S.sel = null; return entryPanel(); }
  const existing = S.st.scores[sid(L.id, t.id, ev.id)];
  const max = ev.max || 10;
  const dis = S.saving ? "disabled" : "";
  return `<aside class="panel entry">
    <div class="what"><span class="eyebrow">${esc(L.name)} · ${esc(evLabel(ev))}</span><b>${esc(t.name)}</b><span class="note">${existing ? `Current score ${fmt(existing.score)}. Saving replaces it.` : `No score yet. Out of ${fmt(max)}.`}</span></div>
    ${ev.individual ? `<div class="field"><label class="eyebrow" for="ath">Athlete name</label><input id="ath" type="text" autocomplete="off" value="${esc(S.athlete)}" placeholder="Who tumbled?" ${dis}></div>` : ""}
    <div class="readout ${S.entry ? "" : "ph"}" id="readout">${S.entry ? esc(S.entry) : "0.00"}<span class="max">/ ${fmt(max)}</span></div>
    <div class="keys">${["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map(k => `<button data-act="key" data-k="${k}" ${dis} aria-label="${k === "⌫" ? "Delete" : k}">${k}</button>`).join("")}</div>
    <div class="err" id="err">${esc(S.err)}</div>
    <div class="save-row">
      <button class="btn primary" data-act="save" data-show="1" ${dis}>Save &amp; show on screen</button>
      <button class="btn" data-act="save" data-show="0" ${dis}>Save without flashing</button>
      ${existing ? `<div class="row" style="justify-content:space-between"><button class="btn sm" data-act="reflash" ${dis}>Flash again</button><button class="btn sm danger" data-act="del" ${dis}>Remove score</button></div>` : ""}
    </div>
  </aside>`;
}
function updateReadout() {
  const r = document.getElementById("readout"); if (!r || !S.sel) return;
  const ev = findLevel(S.sel.l).events.find(x => x.id === S.sel.e);
  r.className = "readout " + (S.entry ? "" : "ph");
  r.innerHTML = `${S.entry ? esc(S.entry) : "0.00"}<span class="max">/ ${fmt(ev.max || 10)}</span>`;
  const e = document.getElementById("err"); if (e) e.textContent = S.err;
}
function selectCell(l, t, e) {
  S.sel = { l, t, e }; const s = S.st.scores[sid(l, t, e)];
  S.entry = s ? String(r3(s.score)) : ""; S.athlete = s?.athlete || ""; S.err = "";
  render();
  if (window.innerWidth <= 900) document.querySelector(".entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function pressKey(k) {
  if (!S.sel) return;
  if (k === "⌫" || k === "Backspace") S.entry = S.entry.slice(0, -1);
  else if (k === ".") { if (!S.entry.includes(".")) S.entry = (S.entry || "0") + "."; }
  else if (/^\d$/.test(k)) { const dec = S.entry.split(".")[1]; if (dec && dec.length >= 3) return; if (S.entry.length >= 6) return; S.entry = (S.entry === "0" ? "" : S.entry) + k; }
  S.err = ""; updateReadout();
}
function rowFor(L, t, ev, score, flashAt, athlete) {
  return { id: sid(L.id, t.id, ev.id), level: L.id, team: t.id, event: ev.id, score, athlete: ev.individual ? athlete : null, flash_at: flashAt, updated_at: Date.now() };
}
function applyLocal(row) { S.st.scores[row.id] = { id: row.id, level: row.level, team: row.team, event: row.event, score: Number(row.score), athlete: row.athlete || "", flashAt: Number(row.flash_at), updatedAt: Number(row.updated_at) }; }
async function saveScore(show) {
  if (!S.sel || S.saving) return;
  const L = findLevel(S.sel.l), t = L.teams.find(x => x.id === S.sel.t), ev = L.events.find(x => x.id === S.sel.e);
  const max = ev.max || 10; const v = parseFloat(S.entry);
  if (S.entry === "" || isNaN(v)) { S.err = "Key in a score first."; return updateReadout(); }
  if (v < 0 || v > max) { S.err = `Score must be between 0 and ${fmt(max)} for this event.`; return updateReadout(); }
  if (ev.individual && !S.athlete.trim()) { S.err = "Add the athlete's name for this individual event."; return updateReadout(); }
  const prev = S.st.scores[sid(L.id, t.id, ev.id)];
  const row = rowFor(L, t, ev, r3(v), show ? Date.now() : prev?.flashAt || 0, S.athlete.trim());
  S.saving = true; render();
  const { error } = await sb.from("scores").upsert(row);
  if (error) S.err = /row-level security|permission/i.test(error.message) ? "This login isn't allowed to enter scores. Add its email to the staff table in Supabase." : `Couldn't save: ${error.message}`;
  else { applyLocal(row); S.err = ""; toast(show ? `Saved ${fmt(v)} for ${t.name} · showing on the big screen` : `Saved ${fmt(v)} for ${t.name}`); }
  S.saving = false; render();
}
async function reflash() {
  const id = sid(S.sel.l, S.sel.t, S.sel.e); const prev = S.st.scores[id]; if (!prev) return;
  S.saving = true; render();
  const flashAt = Date.now();
  const { error } = await sb.from("scores").update({ flash_at: flashAt, updated_at: flashAt }).eq("id", id);
  if (error) toast("Couldn't reach the display"); else { prev.flashAt = flashAt; toast("Sent to the big screen again"); }
  S.saving = false; render();
}
async function delScore() {
  const id = sid(S.sel.l, S.sel.t, S.sel.e);
  if (!(await confirmBox("Remove this score? The team's total will drop by this amount.", "Remove score"))) return;
  const { error } = await sb.from("scores").delete().eq("id", id);
  if (error) toast("Couldn't remove the score"); else { delete S.st.scores[id]; S.entry = ""; toast("Score removed"); }
  render();
}

/* ---------- results ---------- */
function renderResults() {
  const nr = notReady(); if (nr) return topBar("results") + nr;
  if (!levels().length) return topBar("results") + `<p class="note">No levels set up yet.</p>`;
  const blocks = levels().map(L => {
    const C = calcLevel(L, S.st.scores); const final = C.expected > 0 && C.entered === C.expected;
    const placeCell = (entries, p) => { const e = entries.filter(x => x.place === p); return e.length ? e.map(x => `<span class="pl"><span class="medal m${p}"></span>${esc(x.name)}${x.team ? ` <span class="note">(${esc(x.team)})</span>` : ""}<span class="sc">${fmt(x.score)}</span></span>`).join("") : `<span class="note">—</span>`; };
    const awardRows = C.awards.map(a => `<tr><th>${esc(a.name)}${a.individual ? ` <span class="pill">individual</span>` : ""}</th><td>${placeCell(a.entries, 1)}</td><td>${placeCell(a.entries, 2)}</td><td>${placeCell(a.entries, 3)}</td></tr>`).join("");
    const ovRow = `<tr class="overall"><th>Overall</th><td>${placeCell(C.overall, 1)}</td><td>${placeCell(C.overall, 2)}</td><td>${placeCell(C.overall, 3)}</td></tr>`;
    const detHead = L.teams.map(t => `<th class="num" style="text-align:right">${esc(t.name)}</th>`).join("");
    const detRows = L.events.map(ev => `<tr><th>${esc(evLabel(ev))}</th>${L.teams.map(t => { const s = S.st.scores[sid(L.id, t.id, ev.id)]; return `<td class="num" style="text-align:right">${s ? fmt(s.score) : "—"}${s?.athlete ? `<br><span class="note">${esc(s.athlete)}</span>` : ""}</td>`; }).join("")}</tr>`).join("")
      + `<tr class="overall"><th>Total</th>${C.teams.map(t => `<td class="num" style="text-align:right">${t.count ? fmt(t.total) : "—"}</td>`).join("")}</tr>`;
    return `<section class="lvl-block"><div class="lvl-head"><h2>${esc(L.name)}</h2><span class="pill ${final ? "final" : ""}">${final ? "Final" : `In progress · ${C.entered}/${C.expected} scores`}</span></div>
      <div class="panel scroll-x"><table class="aw"><thead><tr><th>Award</th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead><tbody>${awardRows}${ovRow}</tbody></table></div>
      <details class="panel" style="padding:4px 0"><summary style="padding:10px 12px;cursor:pointer;font-weight:600">Every score for ${esc(L.name)}</summary><div class="scroll-x"><table class="aw"><thead><tr><th>Event</th>${detHead}</tr></thead><tbody>${detRows}</tbody></table></div></details>
    </section>`;
  }).join("");
  return `${topBar("results")}
    <div class="toolbar" style="margin-bottom:16px"><h1 class="h-sec">Results</h1><span class="note">Ties share a place. Awards update as scores come in.</span><span style="margin-left:auto"></span><button class="btn" data-act="copy">Copy awards</button><button class="btn primary" data-act="csv">Download CSV</button></div>
    ${blocks}`;
}
function csvText() {
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [["Section", "Level", "Award / Event", "Place", "Name", "Team", "Score"].join(",")];
  levels().forEach(L => {
    const C = calcLevel(L, S.st.scores);
    C.awards.forEach(a => a.entries.forEach(e => out.push(["Award", L.name, a.name, ord(e.place), e.name, e.team || e.name, fmt(e.score)].map(q).join(","))));
    C.overall.forEach(e => out.push(["Award", L.name, "Overall", ord(e.place), e.name, e.name, fmt(e.score)].map(q).join(",")));
  });
  out.push("", ["Section", "Level", "Event", "Round", "Award group", "Team", "Athlete", "Score"].join(","));
  levels().forEach(L => L.events.forEach(ev => L.teams.forEach(t => { const s = S.st.scores[sid(L.id, t.id, ev.id)]; out.push(["Score", L.name, ev.name, ev.round || "", catKey(ev), t.name, s?.athlete || "", s ? fmt(s.score) : ""].map(q).join(",")); })));
  return out.join("\n");
}
function awardsText() {
  return levels().map(L => {
    const C = calcLevel(L, S.st.scores);
    const line = (n, en) => `${n}: ` + [1, 2, 3].map(p => { const e = en.filter(x => x.place === p); return e.length ? `${ord(p)} ${e.map(x => `${x.name} ${fmt(x.score)}`).join(", ")}` : null; }).filter(Boolean).join(" | ");
    return [L.name.toUpperCase(), ...C.awards.map(a => line(a.name, a.entries)), line("Overall", C.overall)].join("\n");
  }).join("\n\n");
}

/* ---------- setup ---------- */
function blankLevel() { return { id: mkId("level"), name: "New level", teams: [{ id: mkId("team"), name: "Team A" }, { id: mkId("team"), name: "Team B" }], events: [{ id: mkId("acro"), name: "Acro", round: "", award: "Acro", max: 10, individual: false }] }; }
function renderSetup() {
  const nr = notReady(); if (nr) return topBar("setup") + nr;
  if (!S.draft) { S.draft = S.st.config ? JSON.parse(JSON.stringify(S.st.config)) : { name: "Stack It Up", levels: [blankLevel()] }; S.draftDirty = false; }
  const D = S.draft;
  const lv = D.levels.map((L, li) => `<section class="panel setup-lvl">
    <div class="row"><div class="field"><label class="eyebrow" for="ln-${li}">Level name</label><input id="ln-${li}" type="text" data-bind="level" data-li="${li}" data-k="name" value="${esc(L.name)}"></div>
      <button class="btn sm" data-act="lvup" data-li="${li}" ${li === 0 ? "disabled" : ""}>Move up</button><button class="btn sm danger" data-act="lvdel" data-li="${li}">Delete level</button></div>
    <div><div class="eyebrow" style="margin-bottom:6px">Teams</div><div class="team-list">${L.teams.map((t, ti) => `<span class="team-item"><input type="text" id="tn-${li}-${ti}" data-bind="team" data-li="${li}" data-ti="${ti}" value="${esc(t.name)}" aria-label="Team name"><button class="iconbtn" data-act="tdel" data-li="${li}" data-ti="${ti}" aria-label="Remove ${esc(t.name)}">×</button></span>`).join("")}<button class="btn sm" data-act="tadd" data-li="${li}">+ Team</button></div></div>
    <div><div class="eyebrow" style="margin-bottom:6px">Events, in running order</div>
    <div class="scroll-x"><table class="ev"><thead><tr><th>Event</th><th>Round</th><th>Award group</th><th>Max</th><th>Individual</th><th></th></tr></thead><tbody>
    ${L.events.map((ev, ei) => `<tr>
      <td><input type="text" id="en-${li}-${ei}" data-bind="ev" data-li="${li}" data-ei="${ei}" data-k="name" value="${esc(ev.name)}"></td>
      <td><select id="er-${li}-${ei}" data-bind="ev" data-li="${li}" data-ei="${ei}" data-k="round">${["", "Compulsory", "Optional"].map(r => `<option value="${r}" ${ev.round === r ? "selected" : ""}>${r || "—"}</option>`).join("")}</select></td>
      <td><input type="text" id="ea-${li}-${ei}" data-bind="ev" data-li="${li}" data-ei="${ei}" data-k="award" value="${esc(ev.award || "")}" placeholder="${esc(ev.name)}"></td>
      <td><input type="number" id="em-${li}-${ei}" step="0.5" min="1" data-bind="ev" data-li="${li}" data-ei="${ei}" data-k="max" value="${esc(ev.max || 10)}"></td>
      <td><input type="checkbox" id="ei-${li}-${ei}" data-bind="ev" data-li="${li}" data-ei="${ei}" data-k="individual" ${ev.individual ? "checked" : ""} aria-label="Individual event"></td>
      <td class="act"><button class="iconbtn" data-act="evup" data-li="${li}" data-ei="${ei}" aria-label="Move up" ${ei === 0 ? "disabled" : ""}>↑</button> <button class="iconbtn" data-act="evdel" data-li="${li}" data-ei="${ei}" aria-label="Remove event">×</button></td></tr>`).join("")}
    </tbody></table></div>
    <button class="btn sm" data-act="evadd" data-li="${li}" style="margin-top:8px">+ Event</button></div>
  </section>`).join("");
  return `${topBar("setup")}
  <div class="toolbar" style="margin-bottom:14px"><h1 class="h-sec">Meet setup</h1><span class="note" id="dirtyNote">${S.draftDirty ? "Unsaved changes" : "Saved"}</span><span style="margin-left:auto"></span><button class="btn primary" data-act="setsave" ${S.draftDirty ? "" : "disabled"}>Save setup</button></div>
  <div class="panel" style="padding:16px;margin-bottom:16px"><div class="field"><label class="eyebrow" for="mname">Meet name (shown on the big screen)</label><input id="mname" type="text" data-bind="meet" value="${esc(D.name)}"></div>
  <p class="note" style="margin:10px 0 0">Events that share an <b>award group</b> are added together, so Compulsory Acro and Optional Acro become one Acro award. Mark solo tumbles as <b>individual</b> so judges enter the athlete's name and the award ranks athletes instead of teams. Renaming a team or event keeps its scores; deleting one hides them.</p></div>
  ${lv}
  <div class="toolbar"><button class="btn" data-act="lvadd">+ Level</button><span style="margin-left:auto"></span><button class="btn danger" data-act="wipe">Clear all scores…</button></div>`;
}
function dirty() { S.draftDirty = true; const b = document.querySelector('[data-act="setsave"]'); if (b) b.disabled = false; const n = document.getElementById("dirtyNote"); if (n) n.textContent = "Unsaved changes"; }

/* ---------- share / cast ---------- */
function renderShare() {
  const url = displayUrl();
  return `${topBar("share")}
  <div class="share">
    <section class="panel">
      <h1 class="h-sec">Live display</h1>
      <p class="note" style="margin:0">Read-only. No sign-in needed. Scan this to open it on the TV device, an iPad, or parents' phones.</p>
      <div class="qr">${S.qr ? `<img src="${S.qr}" alt="QR code for the live display">` : ""}</div>
      <div class="linkbox">${esc(url)}</div>
      <div class="toolbar"><button class="btn" data-act="copylink">Copy link</button><a class="btn primary" href="/display" target="_blank" rel="noopener">Open display</a><button class="btn" data-act="qrdl">Save QR image</button></div>
    </section>
    <section class="panel">
      <h2 class="h-sec">Putting it on the TV</h2>
      <ol>
        <li><b>From a computer (Chrome):</b> open the display, click ⋮ → <i>Cast…</i> → pick the TV. Then press <b>Full screen</b> on the display.</li>
        <li><b>From an iPad or Mac to an Apple TV / AirPlay TV:</b> open the display in Safari, then Control Center → <i>Screen Mirroring</i> → pick the TV.</li>
        <li><b>Smart TV or Fire Stick browser:</b> type the link above, or scan the QR with a phone and cast from the phone.</li>
        <li><b>HDMI cable:</b> plug the laptop in and drag the display window to the TV.</li>
      </ol>
      <p class="note" style="margin:0">Use a different device for the display than the judges' iPad, so the judges can keep entering scores while the TV shows the board. When a judge presses <b>Save &amp; show on screen</b>, every open display shows the team and score full-screen for about 6 seconds, then goes back to the scoreboard.</p>
      <p class="note" style="margin:0">Print the QR (Save QR image) and tape it by the bleachers so parents can follow along on their phones.</p>
    </section>
  </div>`;
}

/* ---------- events ---------- */
app.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const a = b.dataset.act, li = +b.dataset.li, D = S.draft;
  switch (a) {
    case "signout": await sb.auth.signOut(); break;
    case "lvl": S.judgeLevel = b.dataset.l; S.sel = null; render(); break;
    case "cell": selectCell(b.dataset.l, b.dataset.t, b.dataset.e); break;
    case "key": pressKey(b.dataset.k); break;
    case "save": saveScore(b.dataset.show === "1"); break;
    case "reflash": reflash(); break;
    case "del": delScore(); break;
    case "csv": {
      const blob = new Blob([csvText()], { type: "text/csv" });
      const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob);
      a2.download = (S.st.config?.name || "meet").replace(/[^\w]+/g, "_") + "_results.csv";
      document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
      break; }
    case "copy": { const t = awardsText(); try { await navigator.clipboard.writeText(t); toast("Awards copied"); } catch (_) { await confirmBox(`<pre style="white-space:pre-wrap;max-height:50vh;overflow:auto;user-select:all">${esc(t)}</pre>`, "Done", false); } break; }
    case "copylink": try { await navigator.clipboard.writeText(displayUrl()); toast("Link copied"); } catch (_) { toast("Select the link and copy it"); } break;
    case "qrdl": { if (!S.qr) break; const a2 = document.createElement("a"); a2.href = S.qr; a2.download = "live-scores-qr.png"; document.body.appendChild(a2); a2.click(); a2.remove(); break; }
    case "tadd": D.levels[li].teams.push({ id: mkId("team"), name: "New team" }); dirty(); render(); break;
    case "tdel": D.levels[li].teams.splice(+b.dataset.ti, 1); dirty(); render(); break;
    case "evadd": D.levels[li].events.push({ id: mkId("event"), name: "New event", round: "", award: "", max: 10, individual: false }); dirty(); render(); break;
    case "evdel": D.levels[li].events.splice(+b.dataset.ei, 1); dirty(); render(); break;
    case "evup": { const ev = D.levels[li].events, i = +b.dataset.ei; [ev[i - 1], ev[i]] = [ev[i], ev[i - 1]]; dirty(); render(); break; }
    case "lvadd": D.levels.push(blankLevel()); dirty(); render(); break;
    case "lvdel": if (await confirmBox(`Delete <b>${esc(D.levels[li].name)}</b> from the meet? Its scores stay stored but won't show.`, "Delete level")) { D.levels.splice(li, 1); dirty(); render(); } break;
    case "lvup": [D.levels[li - 1], D.levels[li]] = [D.levels[li], D.levels[li - 1]]; dirty(); render(); break;
    case "setsave": {
      const clean = { name: D.name.trim() || "Meet", levels: D.levels.map(L => ({ id: L.id, name: L.name.trim() || "Level", teams: L.teams.map(t => ({ id: t.id, name: t.name.trim() || "Team" })), events: L.events.map(ev => ({ id: ev.id, name: ev.name.trim() || "Event", round: ev.round || "", award: (ev.award || "").trim(), max: Number(ev.max) > 0 ? Number(ev.max) : 10, individual: !!ev.individual })) })) };
      b.disabled = true;
      const { error } = await sb.from("meet_config").upsert({ id: 1, data: clean, updated_at: new Date().toISOString() });
      if (error) { toast(`Couldn't save setup: ${error.message}`); b.disabled = false; }
      else { S.st.config = clean; S.draft = null; S.draftDirty = false; toast("Setup saved"); render(); }
      break; }
    case "wipe": {
      if (!(await confirmBox("Clear <b>every score</b> for every level? This can't be undone. Use it to reset after a practice run.", "Clear all scores"))) break;
      const { error } = await sb.from("scores").delete().neq("id", "");
      if (error) toast(`Couldn't clear: ${error.message}`); else { S.st.scores = {}; toast("All scores cleared"); render(); }
      break; }
  }
});
app.addEventListener("input", e => {
  const el = e.target;
  if (el.id === "ath") { S.athlete = el.value; return; }
  const bind = el.dataset.bind; if (!bind || !S.draft) return;
  const D = S.draft, li = +el.dataset.li;
  if (bind === "meet") D.name = el.value;
  else if (bind === "level") D.levels[li][el.dataset.k] = el.value;
  else if (bind === "team") D.levels[li].teams[+el.dataset.ti].name = el.value;
  else if (bind === "ev") { const ev = D.levels[li].events[+el.dataset.ei]; const k = el.dataset.k; ev[k] = k === "individual" ? el.checked : el.value; }
  dirty();
});
document.addEventListener("keydown", e => {
  if (view() !== "judge" || !S.sel || e.target.tagName === "INPUT") return;
  if (/^[\d.]$/.test(e.key) || e.key === "Backspace") { e.preventDefault(); pressKey(e.key); }
  else if (e.key === "Enter") { e.preventDefault(); saveScore(true); }
});
