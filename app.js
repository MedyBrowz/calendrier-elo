'use strict';
/* Notre Calendrier : planning d'Élodie, sorties à deux et photos.
   La même appli sert sur PC (import du planning Excel) et sur téléphone (installée depuis le navigateur). */

const POLL_MS = 15000;
const QUOTA_BYTES = 1024 ** 3;    // 1 Go de stockage gratuit chez Supabase
const PHOTO_MAX_SIDE = 1600;      // px : net sur un écran, ~300 Ko par photo
const PHOTO_QUALITY = 0.82;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                'septembre', 'octobre', 'novembre', 'décembre'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const COLORS = { violet: '#a78bfa', rose: '#f472b6', orange: '#fb923c', jaune: '#facc15', bleu: '#60a5fa' };
const STATUSES = ['Travail', 'Repos', 'Vacances', 'Férié'];

const DEMO = new URLSearchParams(location.search).has('demo');
const CONFIGURED = !!(window.APP_CONFIG && APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseKey);
const api = DEMO ? createDemoApi() : CONFIGURED ? createSupabaseApi(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey) : null;
const CACHE_KEY = 'notre-calendrier-cache';

const state = {
  me: null,
  data: null,          // {members, work: Map(jour -> ligne), events, photos}
  version: null,
  tab: 'calendar',
  view: 'week',        // 'week' | 'month'
  week: mondayOf(todayIso()),  // lundi de la semaine affichée
  month: todayIso().slice(0, 7),
  importRows: null,
  importName: '',
  loading: null,       // chargement en cours (promesse)
  urls: new Map(),     // chemin photo -> {url, expires}
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ------------------------------------------------------------------ outils
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function utc(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function addDays(iso, days) { const d = utc(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function mondayOf(iso) { return addDays(iso, -((utc(iso).getUTCDay() + 6) % 7)); }
/** Affiche la semaine et le mois qui contiennent ce jour. */
function goTo(iso) { state.week = mondayOf(iso); state.month = iso.slice(0, 7); }
function monthShift(ym, offset) {
  const total = +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1 + offset;
  return `${Math.floor(total / 12)}-${pad(total % 12 + 1)}`;
}
function monthLabel(ym) { const m = MONTHS[+ym.slice(5, 7) - 1]; return m[0].toUpperCase() + m.slice(1) + ' ' + ym.slice(0, 4); }
function dayLabel(iso, withYear = false) {
  const d = utc(iso);
  const text = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`;
  return text[0].toUpperCase() + text.slice(1);
}
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function shortDate(iso) { const d = utc(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`; }
function hourText(hhmm) { const [h, m] = hhmm.split(':'); return `${+h}h${m === '00' ? '' : m}`; }
function slotsText(slots) { return slots.map(([a, b]) => `${hourText(a)} – ${hourText(b)}`).join('  ·  '); }
function bytesText(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
  return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0).replace('.', ',')} Mo`;
}
function colorOf(ev) { return COLORS[ev.color] || COLORS.violet; }
function eventWhen(ev) {
  const days = ev.start_date === ev.end_date ? dayLabel(ev.start_date, true) : `Du ${shortDate(ev.start_date)} au ${shortDate(ev.end_date)} ${ev.end_date.slice(0, 4)}`;
  const time = ev.start_time ? (ev.end_time ? ` · ${hourText(ev.start_time)} – ${hourText(ev.end_time)}` : ` · ${hourText(ev.start_time)}`) : '';
  return days + time;
}

// ----------------------------------------------------------------- données
function normalize(raw) {
  return { ...raw, work: new Map(raw.work.map((w) => [w.day, w])) };
}
function eventsOn(day) {
  return state.data.events
    .filter((e) => e.start_date <= day && e.end_date >= day)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '') || a.title.localeCompare(b.title));
}
function photosOf(eventId) {
  return state.data.photos.filter((p) => p.event_id === eventId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
function usedBytes() { return state.data.photos.reduce((s, p) => s + p.size_bytes, 0); }

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: state.me.id, version: state.version,
      data: { ...state.data, work: [...state.data.work.values()] } }));
  } catch (e) { /* stockage plein ou bloqué : pas grave */ }
}
function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cache && cache.user === state.me.id) { state.data = normalize(cache.data); state.version = cache.version; }
  } catch (e) { /* cache illisible : on recharge */ }
}

/** Recharge si les données ont changé ailleurs (force : toujours). Attend un chargement déjà en cours. */
async function refresh(force = false) {
  if (!state.me) return;
  if (state.loading) {
    await state.loading;
    if (!force) return;
  }
  state.loading = load(force);
  try { await state.loading; } finally { state.loading = null; }
}
async function load(force) {
  if (!state.data) setSync('Chargement…');
  try {
    const version = await api.version();
    if (force || !state.data || version !== state.version) {
      state.data = normalize(await api.loadAll());
      state.version = version;
      if (!api.demo) saveCache();
      render();
    }
    setSync('');
  } catch (e) {
    setSync(navigator.onLine ? 'Erreur' : 'Hors ligne', true);
    if (!state.data) view.innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
}
function setSync(text, error = false) {
  const el = $('#sync');
  el.textContent = text;
  el.classList.toggle('error', error);
}

/** Liens d'affichage des photos privées, gardés 50 min. */
async function photoUrls(paths) {
  const now = Date.now();
  const missing = paths.filter((p) => !(state.urls.get(p) && state.urls.get(p).expires > now));
  if (missing.length) {
    const fresh = await api.photoUrls(missing);
    for (const [p, url] of Object.entries(fresh)) state.urls.set(p, { url, expires: now + 50 * 60000 });
  }
  return Object.fromEntries(paths.filter((p) => state.urls.has(p)).map((p) => [p, state.urls.get(p).url]));
}
async function hydratePhotos(root) {
  const nodes = [...root.querySelectorAll('[data-src]')];
  if (!nodes.length) return;
  try {
    const urls = await photoUrls([...new Set(nodes.map((n) => n.dataset.src))]);
    for (const n of nodes) if (urls[n.dataset.src]) n.style.backgroundImage = `url("${urls[n.dataset.src]}")`;
  } catch (e) { toast('Photos indisponibles pour le moment.'); }
}

// ------------------------------------------------------------------ rendu
/** Toute la petite famille, côte à côte. */
function family(size = 62) {
  return `<div class="family">${['noir', 'roux', 'cheval', 'blanc', 'angora']
    .map((n) => animal(n, n === 'cheval' ? Math.round(size * 1.55) : size)).join('')}</div>`;
}
/** Un compagnon différent chaque mois / chaque jour. */
function buddyOf(n) { return ANIMAL_NAMES[((n % 5) + 5) % 5]; }
function emptyState(name, text) { return `<div class="empty">${animal(name, name === 'cheval' ? 120 : 84)}<span>${text}</span></div>`; }

function render() {
  if (!state.data) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#fab').hidden = state.tab !== 'calendar';
  if (state.tab === 'calendar') renderCalendar();
  else if (state.tab === 'memories') renderMemories();
  else if (state.tab === 'import') renderImport();
  else renderSettings();
}

function workTag(w) {
  if (!w) return '';
  if (w.status === 'Travail' && w.slots.length) {
    return `<span class="tag work">${hourText(w.slots[0][0])}<br>${hourText(w.slots[w.slots.length - 1][1])}</span>`;
  }
  return `<span class="tag ${esc(w.status)}">${w.status === 'Vacances' ? 'Vac.' : esc(w.status)}</span>`;
}

function renderCalendar() {
  if (state.view === 'week') renderWeek(); else renderMonth();
}

const viewSwitch = () => `<div class="switch" role="tablist">
  <button type="button" data-view="week" class="${state.view === 'week' ? 'on' : ''}">Semaine</button>
  <button type="button" data-view="month" class="${state.view === 'month' ? 'on' : ''}">Mois</button></div>`;

function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const a = utc(monday), b = utc(sunday);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  return `${a.getUTCDate()} ${MONTHS_SHORT[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS_SHORT[b.getUTCMonth()]}`;
}

function renderWeek() {
  const monday = state.week;
  const today = todayIso();
  const buddy = buddyOf(Math.round(utc(monday).getTime() / (7 * 86400000)));
  const names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const cards = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const day = addDays(monday, i);
    const w = state.data.work.get(day);
    const evs = eventsOn(day);
    let work = '';
    if (w && w.status === 'Travail' && w.slots.length) work = `<span class="wwork">${esc(slotsText(w.slots))}</span>`;
    else if (w) work = `<span class="wstatus ${esc(w.status)}">${esc(w.status)}</span>`;
    const events = evs.map((e) => {
      const time = e.start_time && (e.start_date === day) ? `<b>${hourText(e.start_time)}</b>` : '';
      return `<span class="wev" style="--c:${colorOf(e)}">${time}${esc(e.title)}${photosOf(e.id).length ? ' <small>📷</small>' : ''}</span>`;
    }).join('');
    const cls = ['wday', day === today && 'today', i >= 5 && 'weekend', w && w.status === 'Vacances' && 'vacation'].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-day="${day}">
      <span class="wdate"><span class="wname">${names[i]}</span><span class="wnum">${utc(day).getUTCDate()}</span></span>
      <span class="wbody">${work}${events}${!work && !events ? '<span class="wfree">Rien de prévu</span>' : ''}</span>
    </button>`;
  });
  view.innerHTML = `
    ${viewSwitch()}
    <div class="monthbar">
      <button class="icon-btn" type="button" data-week="-1" aria-label="Semaine précédente">‹</button>
      <span class="label">${weekLabel(monday)}<small>${utc(addDays(monday, 6)).getUTCFullYear()}</small></span>
      <button class="icon-btn" type="button" data-week="1" aria-label="Semaine suivante">›</button>
    </div>
    ${monday !== mondayOf(today) ? '<div style="text-align:center;margin:-4px 0 10px"><button class="chip" type="button" id="today">Revenir à cette semaine</button></div>' : ''}
    <div class="cal week" id="swipe">
      ${animal(buddy, 80, buddy === 'cheval' ? 'buddy wide' : 'buddy')}
      ${cards.join('')}
    </div>
    <div class="legend"><span><i style="background:var(--work)"></i>Travail Élodie</span>
      <span><i style="background:var(--vacation)"></i>Vacances</span><span><i style="background:${COLORS.rose}"></i>Nos événements</span></div>`;
}

function renderMonth() {
  const ym = state.month;
  const first = `${ym}-01`;
  const lead = (utc(first).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const today = todayIso();
  const buddy = buddyOf(+ym.slice(0, 4) * 12 + +ym.slice(5, 7));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="day out"></div>');
  for (let d = 1; d <= count; d++) {
    const day = `${ym}-${pad(d)}`;
    const w = state.data.work.get(day);
    const evs = eventsOn(day);
    const wd = (lead + d - 1) % 7;
    const cls = ['day', day === today && 'today', wd >= 5 && 'weekend', w && w.status === 'Vacances' && 'vacation'].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-day="${day}">
      <span class="num">${d}</span>${workTag(w)}
      ${evs.slice(0, 2).map((e) => `<span class="tag ev" style="--c:${colorOf(e)}">${esc(e.title)}</span>`).join('')}
      ${evs.length > 2 ? `<span class="tag more">+${evs.length - 2}</span>` : ''}
    </button>`);
  }
  const last = `${ym}-${pad(count)}`;
  const monthEvents = state.data.events
    .filter((e) => e.start_date <= last && e.end_date >= first)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.start_time || '').localeCompare(b.start_time || ''));
  view.innerHTML = `
    ${viewSwitch()}
    <div class="monthbar">
      <button class="icon-btn" type="button" data-month="-1" aria-label="Mois précédent">‹</button>
      <span class="label">${monthLabel(ym)}</span>
      <button class="icon-btn" type="button" data-month="1" aria-label="Mois suivant">›</button>
    </div>
    ${ym !== today.slice(0, 7) ? '<div style="text-align:center;margin:-4px 0 10px"><button class="chip" type="button" id="today">Revenir à aujourd’hui</button></div>' : ''}
    <div class="cal" id="swipe">
      ${animal(buddy, 80, buddy === 'cheval' ? 'buddy wide' : 'buddy')}
      <div class="weekdays">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="grid">${cells.join('')}</div>
    </div>
    <div class="legend"><span><i style="background:var(--work)"></i>Travail Élodie</span>
      <span><i style="background:var(--vacation)"></i>Vacances</span><span><i style="background:${COLORS.rose}"></i>Nos événements</span></div>
    <h2>Ce mois-ci</h2>
    <div class="list">${monthEvents.length ? monthEvents.map(eventRow).join('')
      : emptyState(buddyOf(+ym.slice(5, 7) + 2), 'Rien de prévu pour l’instant.<br>Touche + pour ajouter une sortie.')}</div>`;
}

function eventRow(e) {
  const n = photosOf(e.id).length;
  return `<button type="button" class="row" data-event="${e.id}" style="--c:${colorOf(e)}">
    <span class="bar"></span>
    <span class="main"><strong>${esc(e.title)}</strong><span class="sub">${esc(eventWhen(e))}${e.location ? ' · ' + esc(e.location) : ''}</span></span>
    ${n ? `<span class="side">📷 ${n}</span>` : ''}
  </button>`;
}

function renderMemories() {
  const withPhotos = state.data.events
    .map((e) => ({ e, photos: photosOf(e.id) }))
    .filter((x) => x.photos.length)
    .sort((a, b) => b.e.start_date.localeCompare(a.e.start_date));
  view.innerHTML = `<h2>Souvenirs</h2>
    ${withPhotos.length ? `<div class="memories">${withPhotos.map(({ e, photos }) => `
      <button type="button" class="memory" data-event="${e.id}">
        <div class="cover" data-src="${esc(photos[0].path)}"></div>
        <div class="info"><strong>${esc(e.title)}</strong><span>${shortDate(e.start_date)} ${e.start_date.slice(0, 4)} · ${photos.length} photo${photos.length > 1 ? 's' : ''}</span></div>
      </button>`).join('')}</div>`
    : emptyState('angora', 'Ajoute des photos sur vos événements :<br>elles apparaîtront ici.')}`;
  hydratePhotos(view);
}

function renderSettings() {
  const used = usedBytes();
  const ratio = Math.min(1, used / QUOTA_BYTES);
  view.innerHTML = `
    <h2>Réglages</h2>
    ${api.demo ? '<div class="card"><strong>Mode démo</strong><p class="muted">Données fictives, rien n’est enregistré. Recharge la page pour repartir de zéro.</p></div>' : ''}
    <div class="card">
      <strong>Planning d’Élodie</strong>
      <p class="muted">Importe le planning ASV (Excel). Plus pratique depuis le PC.</p>
      <div class="actions"><button class="primary" type="button" id="go-import">Importer un planning Excel</button></div>
    </div>
    <div class="card">
      <strong>Espace photos</strong>
      <div class="gauge ${ratio > .9 ? 'full' : ''}"><div style="width:${(ratio * 100).toFixed(1)}%"></div></div>
      <small class="muted">${bytesText(used)} utilisés sur 1 Go · ${state.data.photos.length} photo${state.data.photos.length > 1 ? 's' : ''}</small>
    </div>
    <div class="card">
      <strong>Compte</strong>
      <p class="muted">${esc(state.me.email)}<br>Membres : ${state.data.members.map((m) => esc(m.name)).join(' et ') || '—'}</p>
      <div class="actions">
        <button class="secondary" type="button" id="password">Changer le mot de passe</button>
        <button class="secondary" type="button" id="logout">Se déconnecter</button>
      </div>
    </div>
    <div class="card family-card"><strong>La petite famille</strong>${family(54)}</div>
    <p class="muted" style="font-size:12px">Sur téléphone : menu du navigateur › « Ajouter à l’écran d’accueil » pour l’installer comme une appli.</p>`;
}

function renderLogin(message = '') {
  $('#tabs').hidden = true;
  $('#fab').hidden = true;
  setSync('');
  view.innerHTML = `
    <form class="login" id="login" novalidate>
      ${family(58)}
      <h1>Coucou vous deux</h1>
      <p class="muted">Connecte-toi avec ton compte.</p>
      <label class="field" for="email">E-mail</label>
      <input class="input" id="email" type="email" autocomplete="username" required>
      <label class="field" for="password-input">Mot de passe</label>
      <input class="input" id="password-input" type="password" autocomplete="current-password" required>
      <p class="error-text" id="login-error">${esc(message)}</p>
      <div class="actions"><button class="primary" type="submit">Se connecter</button></div>
    </form>`;
}

function renderSetup() {
  view.innerHTML = `<div class="login">
    ${family(58)}
    <h1>Presque prêt</h1>
    <p class="muted">L’appli n’est pas encore reliée à Supabase : renseigne l’adresse et la clé dans <code>config.js</code>
    (voir MISE_EN_ROUTE.txt).</p>
    <div class="actions"><a class="primary" style="text-align:center;text-decoration:none" href="?demo">Essayer en mode démo</a></div></div>`;
}

// ------------------------------------------------------------------ import
function importStatus(row) {
  const old = state.data.work.get(row.day);
  if (!old) return 'new';
  return old.status === row.status && JSON.stringify(old.slots) === JSON.stringify(row.slots) ? 'same' : 'changed';
}

function renderImport() {
  const rows = state.importRows;
  let body = '';
  if (rows) {
    const counts = { new: 0, changed: 0, same: 0 };
    rows.forEach((r) => counts[importStatus(r)]++);
    const work = rows.filter((r) => r.status === 'Travail').length;
    body = `
      <div class="card">
        <strong>${esc(state.importName)}</strong>
        <p class="muted">${rows.length} jour${rows.length > 1 ? 's' : ''} lus (${work} travaillés, ${rows.length - work} autres) ·
          du ${shortDate(rows[0].day)} au ${shortDate(rows[rows.length - 1].day)} ${rows[rows.length - 1].day.slice(0, 4)}<br>
          <span class="badge new">${counts.new} nouveaux</span> <span class="badge changed">${counts.changed} différents</span>
          <span class="badge">${counts.same} identiques</span></p>
        <label class="radio"><input type="radio" name="mode" value="add" checked>
          <span>Ajouter uniquement<small>Les jours déjà dans l’appli (même modifiés à la main) ne bougent pas.</small></span></label>
        <label class="radio"><input type="radio" name="mode" value="replace">
          <span>Remplacer par l’Excel<small>Les ${counts.changed} jour${counts.changed > 1 ? 's' : ''} différent${counts.changed > 1 ? 's' : ''} prennent les horaires du fichier.</small></span></label>
        <p class="error-text" id="import-error"></p>
        <div class="actions"><button class="primary" type="button" id="import-save">Enregistrer</button>
          <button class="secondary" type="button" id="import-cancel">Annuler</button></div>
      </div>
      <table class="preview"><thead><tr><th>Date</th><th>Statut</th><th>Horaires</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const s = importStatus(r);
        return `<tr><td>${esc(dayLabel(r.day))}</td><td>${esc(r.status)}</td><td>${esc(slotsText(r.slots))}</td>
          <td>${s === 'same' ? '' : `<span class="badge ${s}">${s === 'new' ? 'nouveau' : 'différent'}</span>`}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  view.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:10px">${animal('roux', 64)}<h2>Importer le planning d’Élodie</h2></div>
    <p class="muted">Planning ASV original : seul le bloc EH est lu, les cases bleues deviennent des vacances, les roses (fériés) sont ignorées.
      Ou un Excel simplifié : Date | Début 1 | Fin 1 | Début 2 | Fin 2 | Statut.</p>
    <div class="actions">
      <label class="primary file-btn">${rows ? 'Choisir un autre fichier' : 'Choisir le fichier Excel'}<input type="file" id="import-file" accept=".xlsx" hidden></label>
      <button class="secondary" type="button" data-tab="settings">Retour</button>
    </div>
    <p class="error-text" id="file-error"></p>
    ${body}`;
}

async function onImportFile(file) {
  const error = $('#file-error');
  error.textContent = 'Lecture du fichier…';
  try {
    state.importRows = await readPlanning(file);
    state.importName = file.name;
    renderImport();
  } catch (e) {
    error.textContent = e.message;
  }
}

async function saveImport() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const rows = state.importRows.filter((r) => importStatus(r) === 'new' || (mode === 'replace' && importStatus(r) === 'changed'));
  const button = $('#import-save');
  if (!rows.length) { toast('Rien à enregistrer : tout est déjà à jour.'); return; }
  button.disabled = true;
  try {
    await api.saveWorkDays(rows.map(({ day, status, slots, source }) => ({ day, status, slots, source })), mode === 'add');
    toast(`${rows.length} jour${rows.length > 1 ? 's' : ''} enregistré${rows.length > 1 ? 's' : ''}.`);
    state.importRows = null;
    state.tab = 'calendar';
    goTo(rows[0].day);
    await refresh(true);
    render();
  } catch (e) {
    $('#import-error').textContent = e.message;
    button.disabled = false;
  }
}

// --------------------------------------------------------- fenêtres (feuilles)
function openSheet(html, onSubmit = null) {
  const form = $('#sheet-form');
  form.innerHTML = html;
  $('#sheet').hidden = false;
  form.scrollTop = 0;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    const error = form.querySelector('.error-text');
    const submit = form.querySelector('.primary');
    error.textContent = '';
    submit.disabled = true;
    try {
      const after = await onSubmit(form);
      closeSheet();
      await refresh(true);
      if (typeof after === 'function') after();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
}
function closeSheet() {
  const form = $('#sheet-form');
  $('#sheet').hidden = true;
  form.innerHTML = '';
  delete form.dataset.eventId;
}
const sheetHead = (title, sub = '', buddy = '') => `<div class="head"><div><h3>${title}</h3>${sub ? `<p class="info-line">${sub}</p>` : ''}</div>
  ${buddy ? animal(buddy, buddy === 'cheval' ? 70 : 52) : ''}
  <button type="button" class="close" data-close aria-label="Fermer">✕</button></div>`;

function daySheet(day) {
  const w = state.data.work.get(day);
  const evs = eventsOn(day);
  openSheet(`${sheetHead(esc(dayLabel(day, true)), '', buddyOf(+day.slice(8, 10)))}
    <div class="section-title">Planning d’Élodie</div>
    <button type="button" class="row" data-action="edit-work" data-date="${day}" style="--c:var(--work)">
      <span class="bar"></span>
      <span class="main"><strong>${w ? esc(w.status) : 'Rien de saisi'}</strong>
        <span class="sub">${w && w.slots.length ? esc(slotsText(w.slots)) : w ? '' : 'Toucher pour ajouter des horaires'}</span></span>
      <span class="side">Modifier</span>
    </button>
    <div class="section-title">Nos événements</div>
    <div class="list">${evs.length ? evs.map(eventRow).join('') : '<p class="empty">Aucun événement ce jour-là.</p>'}</div>
    <div class="actions"><button class="primary" type="button" data-action="new-event" data-date="${day}">+ Ajouter un événement</button></div>`);
}

function workSheet(day) {
  const w = state.data.work.get(day);
  let status = w ? w.status : 'Travail';
  const t = w ? w.slots.flat() : [];
  const time = (id, label, value) => `<div><label class="field" for="${id}">${label}</label><input class="input" type="time" id="${id}" value="${value || ''}"></div>`;
  openSheet(`${sheetHead('Planning d’Élodie', esc(dayLabel(day, true)))}
    <label class="field">Statut</label>
    <div class="statuses" id="statuses">${[...STATUSES, 'Rien'].map((s) => `<button type="button" data-status="${s}" class="${s === status ? 'on' : ''}">${s}</button>`).join('')}</div>
    <div id="times">
      <div class="two">${time('t0', 'Début', t[0])}${time('t1', 'Fin', t[1])}</div>
      <div class="two">${time('t2', 'Reprise (facultatif)', t[2])}${time('t3', 'Fin', t[3])}</div>
    </div>
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Enregistrer</button></div>`, async (form) => {
    status = form.querySelector('#statuses .on').dataset.status;
    if (status === 'Rien') { if (w) await api.deleteWorkDay(day); return () => daySheet(day); }
    const vals = ['t0', 't1', 't2', 't3'].map((id) => form.querySelector('#' + id).value);
    const slots = [];
    if (status === 'Travail') {
      for (const i of [0, 2]) {
        if (!vals[i] && !vals[i + 1]) continue;
        if (!vals[i] || !vals[i + 1]) throw new Error('Renseigne le début et la fin de chaque période.');
        if (vals[i] >= vals[i + 1]) throw new Error('L’heure de fin doit être après le début.');
        slots.push([vals[i], vals[i + 1]]);
      }
      if (!slots.length) throw new Error('Indique au moins une période de travail.');
      if (slots.length === 2 && slots[0][1] > slots[1][0]) throw new Error('Les deux périodes se chevauchent.');
    }
    await api.saveWorkDays([{ day, status, slots, source: 'Manuel' }]);
    return () => daySheet(day);
  });
  const sync = () => { $('#times').hidden = $('#statuses .on').dataset.status !== 'Travail'; };
  sync();
  $('#statuses').onclick = (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    document.querySelectorAll('#statuses button').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  };
}

function eventSheet(id) {
  const ev = state.data.events.find((e) => e.id === id);
  if (!ev) { closeSheet(); return; }
  const photos = photosOf(id);
  openSheet(`${sheetHead(esc(ev.title), esc(eventWhen(ev)))}
    ${ev.location ? `<p class="info-line">📍 ${esc(ev.location)}</p>` : ''}
    ${ev.note ? `<p style="white-space:pre-line">${esc(ev.note)}</p>` : ''}
    <div class="section-title">Photos${photos.length ? ` (${photos.length})` : ''}</div>
    ${photos.length ? `<div class="photos">${photos.map((p, i) => `<button type="button" data-photo="${i}" data-src="${esc(p.path)}" aria-label="Photo ${i + 1}"></button>`).join('')}</div>`
      : emptyState('blanc', 'Pas encore de photos.')}
    <div class="actions">
      <button class="primary" type="button" data-action="add-photos" data-event-id="${id}">+ Ajouter des photos</button>
      <button class="secondary" type="button" data-action="edit-event" data-event-id="${id}">Modifier</button>
    </div>
    <div class="actions"><button class="danger" type="button" data-action="delete-event" data-event-id="${id}">Supprimer l’événement</button></div>`);
  $('#sheet-form').dataset.eventId = id;
  hydratePhotos($('#sheet-form'));
}

function eventForm(ev, date) {
  const e = ev || { title: '', start_date: date || todayIso(), end_date: date || todayIso(), start_time: null, end_time: null, location: '', note: '', color: 'rose' };
  openSheet(`${sheetHead(ev ? 'Modifier l’événement' : 'Nouvel événement')}
    <label class="field" for="ev-title">Quoi ?</label>
    <input class="input" id="ev-title" maxlength="120" value="${esc(e.title)}" placeholder="Resto, ciné, week-end…" required>
    <div class="two">
      <div><label class="field" for="ev-start">Du</label><input class="input" type="date" id="ev-start" value="${e.start_date}"></div>
      <div><label class="field" for="ev-end">Au</label><input class="input" type="date" id="ev-end" value="${e.end_date}"></div>
    </div>
    <label class="check"><input type="checkbox" id="ev-allday" ${e.start_time ? '' : 'checked'}> Toute la journée</label>
    <div class="two" id="ev-times">
      <div><label class="field" for="ev-t1">Heure</label><input class="input" type="time" id="ev-t1" value="${e.start_time || ''}"></div>
      <div><label class="field" for="ev-t2">Fin (facultatif)</label><input class="input" type="time" id="ev-t2" value="${e.end_time || ''}"></div>
    </div>
    <label class="field" for="ev-loc">Où ? (facultatif)</label>
    <input class="input" id="ev-loc" maxlength="200" value="${esc(e.location || '')}">
    <label class="field" for="ev-note">Note (facultatif)</label>
    <textarea class="input" id="ev-note" maxlength="2000">${esc(e.note || '')}</textarea>
    <label class="field">Couleur</label>
    <div class="colors" id="ev-colors">${Object.entries(COLORS).map(([k, c]) => `<button type="button" data-color="${k}" class="${k === e.color ? 'on' : ''}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div>
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Enregistrer</button></div>`, async (form) => {
    const v = (sel) => form.querySelector(sel).value.trim();
    const allDay = form.querySelector('#ev-allday').checked;
    const fields = {
      title: v('#ev-title'), start_date: v('#ev-start'), end_date: v('#ev-end') || v('#ev-start'),
      start_time: allDay ? null : v('#ev-t1') || null, end_time: allDay ? null : v('#ev-t2') || null,
      location: v('#ev-loc') || null, note: v('#ev-note') || null,
      color: (form.querySelector('#ev-colors .on') || {}).dataset?.color || 'rose',
    };
    if (!fields.title) throw new Error('Donne un nom à l’événement.');
    if (!fields.start_date) throw new Error('Choisis une date.');
    if (fields.end_date < fields.start_date) throw new Error('La date de fin est avant la date de début.');
    if (!allDay && !fields.start_time) throw new Error('Indique l’heure, ou coche « Toute la journée ».');
    if (fields.start_time && fields.end_time && fields.start_date === fields.end_date && fields.end_time <= fields.start_time) {
      throw new Error('L’heure de fin doit être après le début.');
    }
    const savedId = await api.saveEvent(fields, ev && ev.id);
    goTo(fields.start_date);
    return () => { render(); eventSheet(savedId); };
  });
  const sync = () => { $('#ev-times').hidden = $('#ev-allday').checked; };
  sync();
  $('#ev-allday').onchange = sync;
  $('#ev-start').onchange = () => { if ($('#ev-end').value < $('#ev-start').value) $('#ev-end').value = $('#ev-start').value; };
  $('#ev-colors').onclick = (x) => {
    const b = x.target.closest('[data-color]');
    if (b) document.querySelectorAll('#ev-colors button').forEach((y) => y.classList.toggle('on', y === b));
  };
  if (!ev) $('#ev-title').focus();
}

function passwordSheet() {
  openSheet(`${sheetHead('Changer le mot de passe')}
    <label class="field" for="pw1">Nouveau mot de passe</label>
    <input class="input" type="password" id="pw1" autocomplete="new-password">
    <label class="field" for="pw2">Confirmer</label>
    <input class="input" type="password" id="pw2" autocomplete="new-password">
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Changer</button></div>`, async (form) => {
    const a = form.querySelector('#pw1').value, b = form.querySelector('#pw2').value;
    if (a.length < 8) throw new Error('8 caractères minimum.');
    if (a !== b) throw new Error('Les deux mots de passe sont différents.');
    await api.changePassword(a);
    return () => toast('Mot de passe changé.');
  });
}

// ------------------------------------------------------------------ photos
/** Réduit une photo (≤ 1600 px, JPEG) : ~300 Ko au lieu de 3 à 6 Mo. */
async function compressImage(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Format non pris en charge : ${file.name}`));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = source.width || source.naturalWidth, h0 = source.height || source.naturalHeight;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w0, h0));
  const width = Math.round(w0 * scale), height = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  if (source.close) source.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
  if (!blob) throw new Error(`Impossible de préparer ${file.name}`);
  return { blob, width, height };
}

async function addPhotos(eventId, files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!list.length) return;
  let done = 0;
  const failed = [];
  for (const file of list) {
    if (usedBytes() > QUOTA_BYTES * 0.98) { failed.push('Espace photos plein (1 Go).'); break; }
    toast(`Envoi de la photo ${done + failed.length + 1} sur ${list.length}…`, 0);
    try {
      await api.uploadPhoto(eventId, await compressImage(file));
      done++;
    } catch (e) {
      failed.push(e.message);
    }
  }
  await refresh(true);
  toast(failed.length ? `${done} photo(s) ajoutée(s), ${failed.length} échec(s) : ${failed[0]}` : `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''}.`);
  if (!$('#sheet').hidden && $('#sheet-form').dataset.eventId === eventId) eventSheet(eventId);
}

const lightbox = { eventId: null, index: 0 };
async function showPhoto(eventId, index) {
  const photos = photosOf(eventId);
  if (!photos.length) { $('#lightbox').hidden = true; return; }
  lightbox.eventId = eventId;
  lightbox.index = (index + photos.length) % photos.length;
  const photo = photos[lightbox.index];
  const box = $('#lightbox');
  box.hidden = false;
  box.innerHTML = `<div class="stage"><img alt="">
      ${photos.length > 1 ? '<button type="button" class="nav prev" data-lb="prev" aria-label="Précédente">‹</button><button type="button" class="nav next" data-lb="next" aria-label="Suivante">›</button>' : ''}</div>
    <div class="bar"><button type="button" data-lb="close">Fermer</button>
      <span class="muted">${lightbox.index + 1} / ${photos.length}</span>
      <span><a target="_blank" rel="noopener" id="lb-open">Ouvrir</a> <button type="button" data-lb="delete">Supprimer</button></span></div>`;
  try {
    const url = (await photoUrls([photo.path]))[photo.path];
    if (url) { box.querySelector('img').src = url; $('#lb-open').href = url; }
  } catch (e) { toast('Photo indisponible pour le moment.'); }
}

// --------------------------------------------------------------- mode nuit
const MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
function savedTheme() { try { return localStorage.getItem('theme'); } catch (e) { return null; } }
function applyTheme(theme, save = false) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1f1a20' : '#fff5ee';
  const button = $('#theme');
  button.innerHTML = theme === 'dark' ? SUN : MOON;
  button.setAttribute('aria-label', theme === 'dark' ? 'Passer en mode jour' : 'Passer en mode nuit');
  if (save) { try { localStorage.setItem('theme', theme); } catch (e) { /* stockage bloqué : choix non retenu */ } }
}
applyTheme(document.documentElement.dataset.theme || 'light');
// Sans choix enregistré, on suit le téléphone s'il change de thème (ex. passage automatique le soir).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light');
});

// ------------------------------------------------------------- événements
let toastTimer = null;
function toast(text, duration = 3200) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

document.addEventListener('click', async (event) => {
  const t = event.target;
  const lb = t.closest('[data-lb]');
  if (lb) {
    const action = lb.dataset.lb;
    if (action === 'close') $('#lightbox').hidden = true;
    else if (action === 'prev') showPhoto(lightbox.eventId, lightbox.index - 1);
    else if (action === 'next') showPhoto(lightbox.eventId, lightbox.index + 1);
    else if (action === 'delete' && confirm('Supprimer cette photo pour vous deux ?')) {
      try {
        await api.deletePhoto(photosOf(lightbox.eventId)[lightbox.index]);
        await refresh(true);
        showPhoto(lightbox.eventId, lightbox.index);
        eventSheet(lightbox.eventId);
      } catch (e) { toast(e.message); }
    }
    return;
  }
  if (t.closest('[data-close]')) { closeSheet(); return; }
  const tab = t.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; window.scrollTo(0, 0); render(); return; }
  if (t.closest('#fab')) {
    const today = todayIso();
    if (state.view === 'week') eventForm(null, state.week === mondayOf(today) ? today : state.week);
    else eventForm(null, state.month === today.slice(0, 7) ? today : `${state.month}-01`);
    return;
  }
  const switchTo = t.closest('[data-view]');
  if (switchTo) {
    // On garde la même période : semaine du 1er du mois affiché, ou mois de la semaine affichée.
    if (switchTo.dataset.view === 'week' && state.view !== 'week') {
      state.week = state.month === todayIso().slice(0, 7) ? mondayOf(todayIso()) : mondayOf(`${state.month}-01`);
    } else if (switchTo.dataset.view === 'month') state.month = addDays(state.week, 3).slice(0, 7);
    state.view = switchTo.dataset.view;
    render();
    return;
  }
  const week = t.closest('[data-week]');
  if (week) { shiftPeriod(+week.dataset.week); return; }
  if (t.closest('#sync')) { refresh(true); return; }
  if (t.closest('#theme')) { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true); return; }
  if (t.closest('#today')) { goTo(todayIso()); render(); return; }
  if (t.closest('#go-import')) { state.tab = 'import'; render(); return; }
  if (t.closest('#import-cancel')) { state.importRows = null; render(); return; }
  if (t.closest('#import-save')) { saveImport(); return; }
  if (t.closest('#password')) { passwordSheet(); return; }
  if (t.closest('#logout')) {
    if (!confirm('Se déconnecter sur cet appareil ?')) return;
    await api.signOut();
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* rien */ }
    state.data = null;
    state.me = null;
    renderLogin();
    return;
  }
  const month = t.closest('[data-month]');
  if (month) { shiftPeriod(+month.dataset.month); return; }
  const photo = t.closest('[data-photo]');
  if (photo) { showPhoto($('#sheet-form').dataset.eventId, +photo.dataset.photo); return; }
  const action = t.closest('[data-action]');
  if (action) {
    const { date, eventId } = action.dataset;
    const a = action.dataset.action;
    if (a === 'edit-work') workSheet(date);
    else if (a === 'new-event') eventForm(null, date);
    else if (a === 'edit-event') eventForm(state.data.events.find((e) => e.id === eventId));
    else if (a === 'add-photos') { const input = $('#photo-input'); input.dataset.eventId = eventId; input.value = ''; input.click(); }
    else if (a === 'delete-event') {
      const n = photosOf(eventId).length;
      if (!confirm(`Supprimer cet événement${n ? ` et ses ${n} photo${n > 1 ? 's' : ''}` : ''} pour vous deux ?`)) return;
      try {
        await api.deleteEvent(eventId, photosOf(eventId).map((p) => p.path));
        closeSheet();
        await refresh(true);
        toast('Événement supprimé.');
      } catch (e) { toast(e.message); }
    }
    return;
  }
  const ev = t.closest('[data-event]');
  if (ev) { eventSheet(ev.dataset.event); return; }
  const day = t.closest('[data-day]');
  if (day) daySheet(day.dataset.day);
});

/** Semaine ou mois suivant (+1) / précédent (-1), selon la vue. */
function shiftPeriod(offset) {
  if (state.view === 'week') state.week = addDays(state.week, 7 * offset);
  else state.month = monthShift(state.month, offset);
  render();
}

// Glisser le doigt sur le calendrier : gauche = suivant, droite = précédent.
let touchStart = null;
document.addEventListener('touchstart', (event) => {
  touchStart = event.target.closest('#swipe') && event.touches.length === 1
    ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (event) => {
  if (!touchStart) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    // Le doigt qui glisse ne doit pas ouvrir le jour touché ; le navigateur n'envoie pas toujours
    // ce clic, d'où la limite de temps (sinon le prochain vrai toucher serait avalé).
    clickSwallow = true;
    setTimeout(() => { clickSwallow = false; }, 350);
    shiftPeriod(dx < 0 ? 1 : -1);
  }
}, { passive: true });
let clickSwallow = false;
document.addEventListener('click', (event) => {
  if (clickSwallow) { clickSwallow = false; event.stopImmediatePropagation(); event.preventDefault(); }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.id === 'photo-input') addPhotos(event.target.dataset.eventId, event.target.files);
  else if (event.target.id === 'import-file' && event.target.files[0]) onImportFile(event.target.files[0]);
});

document.addEventListener('keydown', (event) => {
  if ($('#lightbox').hidden) { if (event.key === 'Escape' && !$('#sheet').hidden) closeSheet(); return; }
  if (event.key === 'Escape') $('#lightbox').hidden = true;
  else if (event.key === 'ArrowLeft') showPhoto(lightbox.eventId, lightbox.index - 1);
  else if (event.key === 'ArrowRight') showPhoto(lightbox.eventId, lightbox.index + 1);
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'login') return;
  event.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password-input').value;
  const error = $('#login-error');
  if (!email || !password) { error.textContent = 'Saisis ton e-mail et ton mot de passe.'; return; }
  error.textContent = '';
  try { startApp(await api.signIn(email, password)); } catch (e) { error.textContent = e.message; }
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

function startApp(me) {
  state.me = me;
  $('#tabs').hidden = false;
  if (!state.data && !api.demo) loadCache();
  if (!state.data) view.innerHTML = `<div class="loading">${animal('noir', 90)}<span>Chargement…</span></div>`;
  render();
  refresh(state.data === null);
}

async function boot() {
  if ('serviceWorker' in navigator && !DEMO && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!api) { renderSetup(); return; }
  const me = await api.session();
  if (!me) { renderLogin(); return; }
  startApp(me);
}

setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
boot();
