'use strict';
/* Accès aux données. Deux versions avec les mêmes fonctions :
   - createSupabaseApi : les vraies données, partagées entre vos appareils ;
   - createDemoApi     : données fictives en mémoire (adresse terminée par ?demo), pour essayer. */

const PAGE = 1000;
/** Tables de la partie 2 (listes, questions…) : [table, colonnes, tri]. */
const EXTRA_TABLES = {
  lists: ['lists', 'id,name,icon,position', 'position'],
  items: ['list_items', 'id,list_id,text,done,created_by,created_at', 'created_at'],
  questions: ['questions', 'id,text,kind,options,from_user,to_user,answer,answered_at,created_at', 'created_at'],
  reminders: ['reminders', 'id,title,note,next_at,local_time,repeat,private,owner,active,last_sent_at', 'next_at'],
  ideas: ['vacation_ideas', 'id,title,note,done,created_by,created_at', 'created_at'],
  votes: ['vacation_votes', 'idea_id,user_id', 'idea_id'],
  messages: ['question_messages', 'id,question_id,from_user,text,created_at', 'created_at'],
};

function createSupabaseApi(url, key) {
  const sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  const bucket = () => sb.storage.from('photos');

  async function check(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }
  async function fetchAll(table, cols, order) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const batch = await check(sb.from(table).select(cols).order(order).range(from, from + PAGE - 1));
      rows.push(...batch);
      if (batch.length < PAGE) return rows;
    }
  }
  const user = (u) => ({ id: u.id, email: u.email });

  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? user(data.session.user) : null;
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : error.message);
      return user(data.user);
    },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(password) { await check(sb.auth.updateUser({ password })); },
    async version() {
      const rows = await check(sb.from('sync_state').select('version').eq('id', 1));
      if (!rows.length) throw new Error('Compte non autorisé : ajoute-le dans la table members (voir MISE_EN_ROUTE.txt).');
      return rows[0].version;
    },
    async loadAll() {
      const [members, work, events, photos] = await Promise.all([
        fetchAll('members', 'user_id,name', 'name'),
        fetchAll('work_days', 'day,status,slots,source', 'day'),
        fetchAll('events', 'id,title,start_date,end_date,start_time,end_time,location,note,color,created_by', 'start_date'),
        fetchAll('photos', 'id,event_id,path,width,height,size_bytes,created_at', 'created_at'),
      ]);
      // Parties 2 et 3 : une table pas encore installée n'empêche pas le reste de l'appli de marcher.
      const extra = {};
      const missing = [];
      await Promise.all(Object.entries(EXTRA_TABLES).map(async ([name, [table, cols, order]]) => {
        try { extra[name] = await fetchAll(table, cols, order); } catch (e) { extra[name] = []; missing.push(name); }
      }));
      return { members, work, events, photos, ...extra,
        extraMissing: missing.some((n) => n !== 'messages'), messagesMissing: missing.includes('messages') };
    },
    /** onlyNew : ne touche pas aux jours déjà présents. */
    async saveWorkDays(rows, onlyNew = false) {
      for (let i = 0; i < rows.length; i += 500) {
        await check(sb.from('work_days').upsert(rows.slice(i, i + 500), { onConflict: 'day', ignoreDuplicates: onlyNew }));
      }
    },
    async deleteWorkDay(day) { await check(sb.from('work_days').delete().eq('day', day)); },
    async saveEvent(fields, id) {
      if (id) { await check(sb.from('events').update(fields).eq('id', id)); return id; }
      return (await check(sb.from('events').insert(fields).select('id').single())).id;
    },
    async deleteEvent(id, paths) {
      for (let i = 0; i < paths.length; i += 100) await check(bucket().remove(paths.slice(i, i + 100)));
      await check(sb.from('events').delete().eq('id', id));
    },
    async uploadPhoto(eventId, image) {
      const path = `${eventId}/${crypto.randomUUID()}.jpg`;
      await check(bucket().upload(path, image.blob, { contentType: 'image/jpeg', upsert: false }));
      try {
        await check(sb.from('photos').insert({ event_id: eventId, path, width: image.width, height: image.height, size_bytes: image.blob.size }));
      } catch (e) {
        await bucket().remove([path]);
        throw e;
      }
    },
    async deletePhoto(photo) {
      await check(bucket().remove([photo.path]));
      await check(sb.from('photos').delete().eq('id', photo.id));
    },
    /** Liens temporaires (1 h) pour afficher des photos privées. Renvoie {chemin: url}. */
    async photoUrls(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 100) {
        const rows = await check(bucket().createSignedUrls(paths.slice(i, i + 100), 3600));
        for (const r of rows) if (r.signedUrl) out[r.path] = r.signedUrl;
      }
      return out;
    },
    // --- partie 2 : écritures simples sur les tables (listes, questions, rappels, vacances)
    async add(table, row) { return check(sb.from(table).insert(row).select().single()); },
    async patch(table, id, fields) { await check(sb.from(table).update(fields).eq('id', id)); },
    async del(table, match) { await check(sb.from(table).delete().match(match)); },
    // --- notifications
    async savePush(subscription) {
      const j = subscription.toJSON();
      await check(sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    },
    async removePush(endpoint) { await check(sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
    /** Demande au serveur d'envoyer la notification (question posée, réponse, test). */
    async notify(type, id) {
      const { data } = await sb.auth.getSession();
      const res = await fetch(`${url}/functions/v1/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ type, id }),
      });
      if (!res.ok) throw new Error(`Notification non envoyée (${res.status}).`);
      return res.json();
    },
  };
}

function createDemoApi() {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const me = { id: 'demo-moi', email: 'demo@exemple.fr' };
  const uid = () => crypto.randomUUID();
  const db = {
    members: [{ user_id: 'demo-moi', name: 'Moi' }, { user_id: 'demo-elo', name: 'Élodie' }],
    work: [], events: [], photos: [],
  };
  for (let d = 1; d <= dim; d++) {
    const wd = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    const day = `${ym}-${pad(d)}`;
    if (d >= 20 && d <= 24) db.work.push({ day, status: 'Vacances', slots: [], source: 'Démo' });
    else if (wd >= 1 && wd <= 5) {
      db.work.push({ day, status: 'Travail', source: 'Démo',
        slots: wd === 3 ? [['08:00', '12:30']] : [['08:30', '12:00'], ['13:30', '17:00']] });
    }
  }
  db.events.push(
    { id: uid(), title: 'Resto italien', start_date: `${ym}-07`, end_date: `${ym}-07`, start_time: '20:00', end_time: null, location: 'Chez Luigi', note: '', color: 'rose', created_by: 'demo-moi' },
    { id: uid(), title: 'Week-end à la mer', start_date: `${ym}-21`, end_date: `${ym}-23`, start_time: null, end_time: null, location: 'Étretat', note: 'Penser aux chaussures de rando', color: 'bleu', created_by: 'demo-elo' },
  );
  // Partie 2
  const lists = [['Courses', '🛒'], ['Pharmacie', '💊'], ['Animaux', '🐾'], ['Maison', '🏠']].map(([name, icon], position) => ({ id: uid(), name, icon, position }));
  const stamp = (m) => new Date(Date.now() - m * 60000).toISOString();
  Object.assign(db, {
    lists,
    items: [
      { id: uid(), list_id: lists[0].id, text: 'Lait', done: false, created_by: 'demo-elo', created_at: stamp(50) },
      { id: uid(), list_id: lists[0].id, text: 'Pâtes', done: true, created_by: 'demo-moi', created_at: stamp(40) },
      { id: uid(), list_id: lists[2].id, text: 'Croquettes chats', done: false, created_by: 'demo-moi', created_at: stamp(30) },
    ],
    questions: [
      { id: uid(), text: 'On mange quoi ce soir ?', kind: 'choice', options: ['Pâtes carbo', 'Sushis'], from_user: 'demo-elo', to_user: 'demo-moi', answer: null, answered_at: null, created_at: stamp(5) },
      { id: uid(), text: 'Tu rentres à quelle heure ?', kind: 'open', options: [], from_user: 'demo-moi', to_user: 'demo-elo', answer: 'Vers 18h30', answered_at: stamp(60), created_at: stamp(90) },
    ],
    reminders: [
      { id: uid(), title: 'Vermifuge des chats', note: '', next_at: new Date(Date.now() + 3 * 86400000).toISOString(), local_time: '09:00', repeat: 'monthly', private: false, owner: 'demo-moi', active: true, last_sent_at: null },
    ],
    ideas: [{ id: uid(), title: 'Rome', note: 'Printemps ?', done: false, created_by: 'demo-elo', created_at: stamp(500) },
            { id: uid(), title: 'Montagne en été', note: '', done: false, created_by: 'demo-moi', created_at: stamp(400) }],
    votes: [],
    messages: [],
  });
  db.votes.push({ idea_id: db.ideas[0].id, user_id: 'demo-elo' });
  db.messages.push(
    { id: uid(), question_id: db.questions[1].id, from_user: 'demo-moi', text: 'Ok, je fais à manger alors 🍝', created_at: stamp(55) },
    { id: uid(), question_id: db.questions[1].id, from_user: 'demo-elo', text: 'Trop bien merci ❤️', created_at: stamp(3) },
  );
  const TABLE = { lists: 'lists', list_items: 'items', questions: 'questions', reminders: 'reminders', vacation_ideas: 'ideas', vacation_votes: 'votes', question_messages: 'messages' };
  const DEFAULTS = {
    question_messages: { from_user: me.id },
    list_items: { done: false, created_by: me.id }, questions: { options: [], from_user: me.id, answer: null, answered_at: null },
    reminders: { repeat: 'none', private: false, owner: me.id, active: true, last_sent_at: null },
    vacation_ideas: { done: false, created_by: me.id }, vacation_votes: { user_id: me.id }, lists: { icon: '📝', position: 99 },
  };
  let version = 1;
  const blobs = new Map();
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const wait = () => new Promise((r) => setTimeout(r, 120));
  const matches = (row, match) => Object.entries(match).every(([k, v]) => row[k] === v);

  return {
    demo: true,
    async session() { return me; },
    async signIn() { return me; },
    async signOut() {},
    async changePassword() {},
    async version() { return version; },
    async loadAll() { await wait(); return { ...copy(db), extraMissing: false, messagesMissing: false }; },
    async saveWorkDays(rows, onlyNew = false) {
      for (const r of rows) {
        const i = db.work.findIndex((w) => w.day === r.day);
        if (i < 0) db.work.push(copy(r)); else if (!onlyNew) db.work[i] = copy(r);
      }
      version++;
    },
    async deleteWorkDay(day) { db.work = db.work.filter((w) => w.day !== day); version++; },
    async saveEvent(fields, id) {
      if (id) Object.assign(db.events.find((e) => e.id === id), copy(fields));
      else { id = uid(); db.events.push({ id, created_by: me.id, ...copy(fields) }); }
      version++;
      return id;
    },
    async deleteEvent(id) {
      db.events = db.events.filter((e) => e.id !== id);
      db.photos = db.photos.filter((p) => p.event_id !== id);
      version++;
    },
    async uploadPhoto(eventId, image) {
      await wait();
      const path = `${eventId}/${uid()}.jpg`;
      blobs.set(path, URL.createObjectURL(image.blob));
      db.photos.push({ id: uid(), event_id: eventId, path, width: image.width, height: image.height,
        size_bytes: image.blob.size, created_at: new Date().toISOString() });
      version++;
    },
    async deletePhoto(photo) { db.photos = db.photos.filter((p) => p.id !== photo.id); version++; },
    async photoUrls(paths) { return Object.fromEntries(paths.filter((p) => blobs.has(p)).map((p) => [p, blobs.get(p)])); },
    async add(table, row) {
      const full = { ...(table === 'vacation_votes' ? {} : { id: uid() }), created_at: new Date().toISOString(), ...DEFAULTS[table], ...copy(row) };
      db[TABLE[table]].push(full);
      version++;
      return copy(full);
    },
    async patch(table, id, fields) { Object.assign(db[TABLE[table]].find((r) => r.id === id), copy(fields)); version++; },
    async del(table, match) {
      const key = TABLE[table];
      db[key] = db[key].filter((r) => !matches(r, match));
      if (table === 'lists') db.items = db.items.filter((i) => i.list_id !== match.id);
      if (table === 'vacation_ideas') db.votes = db.votes.filter((v) => v.idea_id !== match.id);
      if (table === 'questions') db.messages = db.messages.filter((m) => m.question_id !== match.id);
      version++;
    },
    async savePush() {},
    async removePush() {},
    async notify() { return { sent: 0 }; },
  };
}
