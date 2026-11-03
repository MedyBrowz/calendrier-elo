'use strict';
/* Accès aux données. Deux versions avec les mêmes fonctions :
   - createSupabaseApi : les vraies données, partagées entre vos appareils ;
   - createDemoApi     : données fictives en mémoire (adresse terminée par ?demo), pour essayer. */

const PAGE = 1000;

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
      return { members, work, events, photos };
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
  };
}

function createDemoApi() {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const me = { id: 'demo-moi', email: 'demo@exemple.fr' };
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
    { id: crypto.randomUUID(), title: 'Resto italien', start_date: `${ym}-07`, end_date: `${ym}-07`, start_time: '20:00', end_time: null, location: 'Chez Luigi', note: '', color: 'rose', created_by: 'demo-moi' },
    { id: crypto.randomUUID(), title: 'Week-end à la mer', start_date: `${ym}-21`, end_date: `${ym}-23`, start_time: null, end_time: null, location: 'Étretat', note: 'Penser aux chaussures de rando', color: 'bleu', created_by: 'demo-elo' },
  );
  let version = 1;
  const blobs = new Map();
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const wait = () => new Promise((r) => setTimeout(r, 120));

  return {
    demo: true,
    async session() { return me; },
    async signIn() { return me; },
    async signOut() {},
    async changePassword() {},
    async version() { return version; },
    async loadAll() { await wait(); return copy(db); },
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
      else { id = crypto.randomUUID(); db.events.push({ id, created_by: me.id, ...copy(fields) }); }
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
      const path = `${eventId}/${crypto.randomUUID()}.jpg`;
      blobs.set(path, URL.createObjectURL(image.blob));
      db.photos.push({ id: crypto.randomUUID(), event_id: eventId, path, width: image.width, height: image.height,
        size_bytes: image.blob.size, created_at: new Date().toISOString() });
      version++;
    },
    async deletePhoto(photo) { db.photos = db.photos.filter((p) => p.id !== photo.id); version++; },
    async photoUrls(paths) { return Object.fromEntries(paths.filter((p) => blobs.has(p)).map((p) => [p, blobs.get(p)])); },
  };
}
