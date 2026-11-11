'use strict';
/* Partie 2 de Notre Calendrier : listes, questions, rappels, envies de vacances, notifications.
   Chargé avant app.js ; utilise ses outils (state, api, render, openSheet, toast…) au moment des clics. */

const QUESTION_TEMPLATES = [
  { text: 'On mange quoi ce soir ?', kind: 'choice' },
  { text: 'On fait quoi ce week-end ?', kind: 'choice' },
  { text: 'Tu rentres à quelle heure ?', kind: 'open' },
  { text: 'Tu peux passer acheter quelque chose ?', kind: 'open' },
];
const REPEATS = { none: 'Une fois', daily: 'Tous les jours', weekly: 'Chaque semaine', monthly: 'Chaque mois' };
const LIST_ICONS = ['🛒', '💊', '🐾', '🏠', '🎁', '👶', '🧴', '📝'];

const duo = {
  listId: null,          // liste affichée
  focusQuestion: null,   // question ouverte depuis une notification
};

// ------------------------------------------------------------------ outils
function memberName(id) {
  const m = state.data.members.find((x) => x.user_id === id);
  return m ? m.name : 'Quelqu’un';
}
function partnerId() {
  const other = state.data.members.find((m) => m.user_id !== state.me.id);
  return other ? other.user_id : null;
}
function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  const d = new Date(iso);
  return `le ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
function setupNeeded() {
  return state.data.extraMissing
    ? `<div class="card"><strong>Installation à terminer</strong>
        <p class="muted">Cette partie attend la mise à jour de la base de données (fichier 1_SQL_a_coller.sql).</p></div>` : '';
}
/** Action sur la base puis rechargement ; affiche l'erreur s'il y en a une. */
async function act(promise, done) {
  try {
    await promise;
    await refresh(true);
    if (done) done();
  } catch (e) {
    toast(e.message);
  }
}
function questionsForMe() {
  return (state.data.questions || []).filter((q) => q.to_user === state.me.id && !q.answer);
}
function updateQuestionBadge() {
  const button = document.querySelector('#tabs [data-tab="questions"]');
  if (!button || !state.data) return;
  const n = questionsForMe().length;
  let badge = button.querySelector('.badge-dot');
  if (!n) { if (badge) badge.remove(); return; }
  if (!badge) { badge = document.createElement('span'); badge.className = 'badge-dot'; button.append(badge); }
  badge.textContent = n;
}

// ------------------------------------------------------------------- listes
function renderLists() {
  const lists = [...(state.data.lists || [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  if (!lists.some((l) => l.id === duo.listId)) duo.listId = lists.length ? lists[0].id : null;
  const list = lists.find((l) => l.id === duo.listId);
  const items = (state.data.items || []).filter((i) => i.list_id === duo.listId);
  const todo = items.filter((i) => !i.done), done = items.filter((i) => i.done);
  const count = (l) => (state.data.items || []).filter((i) => i.list_id === l.id && !i.done).length;
  view.innerHTML = `
    <h2>Listes</h2>
    ${setupNeeded()}
    <div class="chips">
      ${lists.map((l) => `<button type="button" class="pill ${l.id === duo.listId ? 'on' : ''}" data-do="pick-list" data-id="${l.id}">
        ${esc(l.icon)} ${esc(l.name)}${count(l) ? ` <b>${count(l)}</b>` : ''}</button>`).join('')}
      <button type="button" class="pill add" data-do="new-list" aria-label="Nouvelle liste">+</button>
    </div>
    ${list ? `
    <form class="add-row" id="item-add" autocomplete="off">
      <input class="input" id="item-input" maxlength="120" placeholder="Ajouter à ${esc(list.name)}…">
      <button class="primary" type="submit" aria-label="Ajouter">+</button>
    </form>
    <div class="list">
      ${todo.map(itemRow).join('') || emptyState('roux', 'Rien à acheter pour l’instant.')}
    </div>
    ${done.length ? `
      <div class="section-title row-title"><span>Dans le panier (${done.length})</span>
        <button type="button" class="link" data-do="clear-done">Vider</button></div>
      <div class="list faded">${done.map(itemRow).join('')}</div>` : ''}
    <div class="actions"><button class="secondary" type="button" data-do="edit-list">Modifier la liste « ${esc(list.name)} »</button></div>`
    : ''}`;
}
function itemRow(i) {
  return `<div class="row item ${i.done ? 'done' : ''}">
    <button type="button" class="tick" data-do="toggle-item" data-id="${i.id}" aria-label="${i.done ? 'Décocher' : 'Cocher'}">${i.done ? '✓' : ''}</button>
    <span class="main"><strong>${esc(i.text)}</strong><span class="sub">${esc(memberName(i.created_by))} · ${ago(i.created_at)}</span></span>
    <button type="button" class="x" data-do="del-item" data-id="${i.id}" aria-label="Supprimer">✕</button>
  </div>`;
}

function listSheet(list) {
  let icon = list ? list.icon : '📝';
  openSheet(`${sheetHead(list ? 'Modifier la liste' : 'Nouvelle liste')}
    <label class="field" for="list-name">Nom</label>
    <input class="input" id="list-name" maxlength="40" value="${esc(list ? list.name : '')}" placeholder="Bricolage, cadeaux…">
    <label class="field">Icône</label>
    <div class="chips" id="list-icons">${LIST_ICONS.map((x) => `<button type="button" class="pill ${x === icon ? 'on' : ''}" data-icon="${x}">${x}</button>`).join('')}</div>
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Enregistrer</button></div>
    ${list ? '<div class="actions"><button class="danger" type="button" id="list-delete">Supprimer cette liste</button></div>' : ''}`, async (form) => {
    const name = form.querySelector('#list-name').value.trim();
    if (!name) throw new Error('Donne un nom à la liste.');
    if (list) await api.patch('lists', list.id, { name, icon });
    else duo.listId = (await api.add('lists', { name, icon, position: (state.data.lists || []).length })).id;
  });
  $('#list-icons').onclick = (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    icon = b.dataset.icon;
    document.querySelectorAll('#list-icons .pill').forEach((x) => x.classList.toggle('on', x === b));
  };
  if (list) $('#list-delete').onclick = () => {
    if (!confirm(`Supprimer la liste « ${list.name} » et tout son contenu ?`)) return;
    closeSheet();
    act(api.del('lists', { id: list.id }));
  };
}

// ---------------------------------------------------------------- questions
function renderQuestions() {
  const all = [...(state.data.questions || [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const forMe = all.filter((q) => q.to_user === state.me.id && !q.answer);
  const waiting = all.filter((q) => q.from_user === state.me.id && !q.answer);
  const answered = all.filter((q) => q.answer).slice(0, 30);
  const partner = partnerId();
  view.innerHTML = `
    <div class="title-row"><h2>Questions</h2>
      <button class="primary small" type="button" data-do="ask" ${partner ? '' : 'disabled'}>+ Poser une question</button></div>
    ${setupNeeded()}
    ${forMe.length ? `<div class="section-title">Pour toi</div>${forMe.map(questionToAnswer).join('')}` : ''}
    ${waiting.length ? `<div class="section-title">En attente de réponse</div>
      <div class="list">${waiting.map((q) => `<div class="row" id="q-${q.id}">
        <span class="main"><strong>${esc(q.text)}</strong>
        <span class="sub">${esc(memberName(q.to_user))} n’a pas encore répondu · ${ago(q.created_at)}</span></span>
        <button type="button" class="x" data-do="del-question" data-id="${q.id}" aria-label="Annuler la question">✕</button></div>`).join('')}</div>` : ''}
    ${answered.length ? `<div class="section-title">Réponses</div>
      <div class="list">${answered.map((q) => `<div class="row" id="q-${q.id}">
        <span class="main"><strong>${esc(q.text)}</strong>
        <span class="answer">${esc(memberName(q.to_user))} : ${esc(q.answer)}</span>
        <span class="sub">${ago(q.answered_at || q.created_at)}</span></span>
        <button type="button" class="x" data-do="del-question" data-id="${q.id}" aria-label="Supprimer">✕</button></div>`).join('')}</div>` : ''}
    ${!all.length ? emptyState('angora', 'Pose une question : elle arrive en notification sur le téléphone de l’autre.') : ''}`;
  if (duo.focusQuestion) {
    const el = document.getElementById(`q-${duo.focusQuestion}`);
    if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
    duo.focusQuestion = null;
  }
}
function questionToAnswer(q) {
  return `<div class="card question" id="q-${q.id}">
    <span class="sub">${esc(memberName(q.from_user))} · ${ago(q.created_at)}</span>
    <strong>${esc(q.text)}</strong>
    ${q.kind === 'choice' && q.options.length
      ? `<div class="choices">${q.options.map((o, i) => `<button type="button" class="choice" data-do="answer" data-id="${q.id}" data-option="${i}">${esc(o)}</button>`).join('')}</div>`
      : `<form class="add-row answer-form" data-id="${q.id}"><input class="input" maxlength="200" placeholder="Ta réponse…">
          <button class="primary" type="submit">Envoyer</button></form>`}
  </div>`;
}

function askSheet() {
  let kind = 'choice';
  openSheet(`${sheetHead('Poser une question', `à ${esc(memberName(partnerId()))}`)}
    <div class="chips" id="q-templates">${QUESTION_TEMPLATES.map((t, i) => `<button type="button" class="pill" data-t="${i}">${esc(t.text)}</button>`).join('')}</div>
    <label class="field" for="q-text">Question</label>
    <input class="input" id="q-text" maxlength="200" placeholder="On mange quoi ce soir ?">
    <label class="field">Réponse</label>
    <div class="switch" id="q-kind"><button type="button" data-kind="choice" class="on">Choix</button><button type="button" data-kind="open">Réponse libre</button></div>
    <div id="q-options">
      <label class="field">Propositions</label>
      <div id="q-option-list">${[0, 1].map(() => optionInput()).join('')}</div>
      <button type="button" class="link" id="q-add-option">+ Ajouter une proposition</button>
    </div>
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Envoyer la question</button></div>`, async (form) => {
    const text = form.querySelector('#q-text').value.trim();
    if (!text) throw new Error('Écris ta question.');
    const options = kind === 'choice' ? [...form.querySelectorAll('.q-option')].map((i) => i.value.trim()).filter(Boolean) : [];
    if (kind === 'choice' && options.length < 2) throw new Error('Donne au moins deux propositions.');
    const q = await api.add('questions', { text, kind, options, to_user: partnerId() });
    state.tab = 'questions';
    let warn = '';
    try { const r = await api.notify('question', q.id); if (!api.demo && !r.sent) warn = ' (pas de notification : l’autre ne les a pas encore activées)'; }
    catch (e) { warn = ' (notification non envoyée)'; }
    return () => toast(`Question envoyée${warn}.`);
  });
  const setKind = (k) => {
    kind = k;
    document.querySelectorAll('#q-kind button').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
    $('#q-options').hidden = k !== 'choice';
  };
  $('#q-kind').onclick = (e) => { const b = e.target.closest('[data-kind]'); if (b) setKind(b.dataset.kind); };
  $('#q-templates').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = QUESTION_TEMPLATES[+b.dataset.t];
    $('#q-text').value = t.text;
    setKind(t.kind);
    const first = document.querySelector(t.kind === 'choice' ? '.q-option' : '#q-text');
    first.focus();
  };
  $('#q-add-option').onclick = () => {
    const list = $('#q-option-list');
    if (list.children.length >= 6) return;
    list.insertAdjacentHTML('beforeend', optionInput());
    list.lastElementChild.focus();
  };
}
function optionInput() { return '<input class="input q-option" maxlength="80" placeholder="Proposition">'; }

async function answerQuestion(id, answer) {
  try {
    await api.patch('questions', id, { answer, answered_at: new Date().toISOString() });
    toast('Réponse envoyée.');
    api.notify('answer', id).catch(() => {});
    await refresh(true);
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------- plus : rappels, vacances
function renderMore() {
  const reminders = (state.data.reminders || []).filter((r) => r.active).sort((a, b) => a.next_at.localeCompare(b.next_at));
  const votes = state.data.votes || [];
  const ideas = (state.data.ideas || []).filter((i) => !i.done)
    .map((i) => ({ ...i, hearts: votes.filter((v) => v.idea_id === i.id) }))
    .sort((a, b) => b.hearts.length - a.hearts.length || a.created_at.localeCompare(b.created_at));
  view.innerHTML = `
    ${setupNeeded()}
    <div class="title-row"><h2>Rappels</h2><button class="primary small" type="button" data-do="new-reminder">+ Rappel</button></div>
    <div class="list">${reminders.map(reminderRow).join('') || '<p class="empty">Aucun rappel programmé.</p>'}</div>

    <h2>Envies de vacances</h2>
    <form class="add-row" id="idea-add" autocomplete="off">
      <input class="input" id="idea-input" maxlength="80" placeholder="Rome, la mer, la montagne…">
      <button class="primary" type="submit" aria-label="Ajouter">+</button>
    </form>
    <div class="list">${ideas.map((i) => {
      const mine = i.hearts.some((v) => v.user_id === state.me.id);
      return `<div class="row">
        <button type="button" class="heart ${mine ? 'on' : ''}" data-do="vote" data-id="${i.id}" aria-label="J’aime">♥<small>${i.hearts.length || ''}</small></button>
        <span class="main"><strong>${esc(i.title)}</strong>
          <span class="sub">${i.hearts.length ? `♥ ${i.hearts.map((v) => esc(memberName(v.user_id))).join(' et ')}` : `idée de ${esc(memberName(i.created_by))}`}</span></span>
        <button type="button" class="link" data-do="plan-idea" data-id="${i.id}">Planifier</button>
        <button type="button" class="x" data-do="del-idea" data-id="${i.id}" aria-label="Supprimer">✕</button>
      </div>`;
    }).join('') || emptyState('cheval', 'Notez vos envies : la plus aimée remonte en haut.')}</div>
    ${settingsHtml()}`;
  renderNotifCard();
}
function reminderRow(r) {
  const at = new Date(r.next_at);
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `<button type="button" class="row" data-do="edit-reminder" data-id="${r.id}">
    <span class="bell">⏰</span>
    <span class="main"><strong>${esc(r.title)}${r.private ? ' <small title="Visible seulement par toi">🔒</small>' : ''}</strong>
      <span class="sub">${esc(dayLabel(day))} à ${hourText(r.local_time)} · ${REPEATS[r.repeat]}</span></span>
  </button>`;
}

function reminderSheet(r) {
  const at = r ? new Date(r.next_at) : new Date(Date.now() + 3600000);
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  let repeat = r ? r.repeat : 'none';
  openSheet(`${sheetHead(r ? 'Modifier le rappel' : 'Nouveau rappel')}
    <label class="field" for="r-title">Rappel</label>
    <input class="input" id="r-title" maxlength="120" value="${esc(r ? r.title : '')}" placeholder="Vermifuge des chats, rendez-vous…">
    <div class="two">
      <div><label class="field" for="r-day">Jour</label><input class="input" type="date" id="r-day" value="${day}"></div>
      <div><label class="field" for="r-time">Heure</label><input class="input" type="time" id="r-time" value="${r ? r.local_time : `${pad(at.getHours())}:00`}"></div>
    </div>
    <label class="field">Répétition</label>
    <div class="chips" id="r-repeat">${Object.entries(REPEATS).map(([k, v]) => `<button type="button" class="pill ${k === repeat ? 'on' : ''}" data-r="${k}">${v}</button>`).join('')}</div>
    <label class="field" for="r-note">Note (facultatif)</label>
    <input class="input" id="r-note" maxlength="200" value="${esc(r && r.note ? r.note : '')}">
    <label class="check"><input type="checkbox" id="r-private" ${r && r.private ? 'checked' : ''}> Juste pour moi (l’autre ne le voit pas)</label>
    <p class="error-text"></p>
    <div class="actions"><button class="primary" type="submit">Enregistrer</button></div>
    ${r ? '<div class="actions"><button class="danger" type="button" id="r-delete">Supprimer le rappel</button></div>' : ''}`, async (form) => {
    const v = (s) => form.querySelector(s).value.trim();
    const title = v('#r-title'), dayValue = v('#r-day'), time = v('#r-time');
    if (!title) throw new Error('Écris le rappel.');
    if (!dayValue || !time) throw new Error('Choisis le jour et l’heure.');
    const nextAt = new Date(`${dayValue}T${time}`);
    if (repeat === 'none' && nextAt <= new Date()) throw new Error('Ce moment est déjà passé.');
    const fields = { title, note: v('#r-note') || null, next_at: nextAt.toISOString(), local_time: time, repeat,
      private: form.querySelector('#r-private').checked, active: true };
    if (r) await api.patch('reminders', r.id, fields); else await api.add('reminders', fields);
    return () => toast(notifPermission() === 'granted' ? 'Rappel enregistré.' : 'Rappel enregistré. Active les notifications dans Réglages pour le recevoir.');
  });
  $('#r-repeat').onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    repeat = b.dataset.r;
    document.querySelectorAll('#r-repeat .pill').forEach((x) => x.classList.toggle('on', x === b));
  };
  if (r) $('#r-delete').onclick = () => { closeSheet(); act(api.del('reminders', { id: r.id }), () => toast('Rappel supprimé.')); };
}

// ------------------------------------------------------------ notifications
function notifSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function notifPermission() { return 'Notification' in window ? Notification.permission : 'unsupported'; }
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function currentSubscription() {
  if (!notifSupported() || api.demo) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
/** Au démarrage : si cet appareil est abonné, on le (re)déclare pour le compte connecté. */
async function syncPushSubscription() {
  try {
    const sub = await currentSubscription();
    if (sub && notifPermission() === 'granted') await api.savePush(sub);
  } catch (e) { /* hors ligne : on réessaiera au prochain démarrage */ }
}
function vapidKey() {
  const b64 = APP_CONFIG.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enableNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('Notifications refusées : autorise-les dans les réglages du téléphone.'); renderNotifCard(); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
    await api.savePush(sub);
    toast('Notifications activées sur cet appareil.');
  } catch (e) {
    toast(`Activation impossible : ${e.message}`);
  }
  renderNotifCard();
}
async function disableNotifications() {
  const sub = await currentSubscription();
  if (sub) { await api.removePush(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  toast('Notifications désactivées sur cet appareil.');
  renderNotifCard();
}
async function renderNotifCard() {
  const card = $('#notif-card');
  if (!card) return;
  let text, buttons = '';
  if (api.demo) text = 'Disponibles dans la vraie appli (pas en mode démo).';
  else if (isIos() && !isInstalled()) text = 'Sur iPhone : ajoute d’abord l’appli à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvre-la depuis son icône.';
  else if (!notifSupported()) text = 'Ce navigateur ne gère pas les notifications.';
  else if (notifPermission() === 'denied') text = 'Bloquées pour cette appli : autorise-les dans les réglages du téléphone (Notifications).';
  else if (await currentSubscription() && notifPermission() === 'granted') {
    text = 'Activées sur cet appareil : questions, réponses et rappels arrivent ici.';
    buttons = `<button class="secondary" type="button" data-do="notif-test">Envoyer un test</button>
      <button class="secondary" type="button" data-do="notif-off">Désactiver</button>`;
  } else {
    text = 'Pour recevoir les questions, les réponses et les rappels sur cet appareil.';
    buttons = '<button class="primary" type="button" data-do="notif-on">Activer les notifications</button>';
  }
  if (!$('#notif-card')) return;
  card.innerHTML = `<div class="card"><strong>Notifications</strong><p class="muted">${text}</p>${buttons ? `<div class="actions">${buttons}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------- événements
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-do]');
  if (!el || !state.data) return;
  const id = el.dataset.id;
  const items = state.data.items || [];
  switch (el.dataset.do) {
    case 'pick-list': duo.listId = id; render(); break;
    case 'new-list': listSheet(null); break;
    case 'edit-list': listSheet((state.data.lists || []).find((l) => l.id === duo.listId)); break;
    case 'toggle-item': {
      const item = items.find((i) => i.id === id);
      if (!item) break;
      item.done = !item.done;          // affichage immédiat, puis enregistrement
      render();
      act(api.patch('list_items', id, { done: item.done }));
      break;
    }
    case 'del-item': act(api.del('list_items', { id })); break;
    case 'clear-done': {
      const done = items.filter((i) => i.list_id === duo.listId && i.done);
      act(Promise.all(done.map((i) => api.del('list_items', { id: i.id }))));
      break;
    }
    case 'ask': askSheet(); break;
    case 'answer': {
      const q = (state.data.questions || []).find((x) => x.id === id);
      if (q) answerQuestion(id, q.options[+el.dataset.option]);
      break;
    }
    case 'del-question': if (confirm('Supprimer cette question ?')) act(api.del('questions', { id })); break;
    case 'new-reminder': reminderSheet(null); break;
    case 'edit-reminder': reminderSheet((state.data.reminders || []).find((r) => r.id === id)); break;
    case 'vote': {
      const mine = (state.data.votes || []).some((v) => v.idea_id === id && v.user_id === state.me.id);
      act(mine ? api.del('vacation_votes', { idea_id: id, user_id: state.me.id }) : api.add('vacation_votes', { idea_id: id }));
      break;
    }
    case 'plan-idea': {
      const idea = (state.data.ideas || []).find((i) => i.id === id);
      if (!idea) break;
      state.tab = 'calendar';
      render();
      eventForm({ title: idea.title, start_date: todayIso(), end_date: todayIso(), start_time: null, end_time: null,
        location: '', note: idea.note || '', color: 'bleu' });
      break;
    }
    case 'del-idea': if (confirm('Supprimer cette idée ?')) act(api.del('vacation_ideas', { id })); break;
    case 'notif-on': enableNotifications(); break;
    case 'notif-off': disableNotifications(); break;
    case 'notif-test':
      try { const r = await api.notify('test'); toast(r.sent ? 'Test envoyé : la notification arrive.' : 'Aucun appareil trouvé : réactive les notifications.'); }
      catch (e) { toast(e.message); }
      break;
    default: break;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'item-add') {
    event.preventDefault();
    const input = $('#item-input');
    const text = input.value.trim();
    if (!text || !duo.listId) return;
    input.value = '';
    await act(api.add('list_items', { list_id: duo.listId, text }), () => { const i = $('#item-input'); if (i) i.focus(); });
  } else if (form.id === 'idea-add') {
    event.preventDefault();
    const input = $('#idea-input');
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    await act(api.add('vacation_ideas', { title }));
  } else if (form.classList.contains('answer-form')) {
    event.preventDefault();
    const text = form.querySelector('input').value.trim();
    if (text) answerQuestion(form.dataset.id, text);
  }
});
