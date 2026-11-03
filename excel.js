'use strict';
/* Lecture des plannings Excel, avec les mêmes règles que l'ancienne appli PC (calendrier_elo.py) :
   - planning ASV original : feuilles « ASV … » (sauf OLD), seul le bloc EH est lu,
     case bleue = vacances, case rose = férié (ignoré) ;
   - Excel simplifié : Date | Début 1 | Fin 1 | Début 2 | Fin 2 | Statut (facultatif).
   Résultat : [{day: 'AAAA-MM-JJ', status, slots: [['08:00','12:00'], …], source}]. */

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const ASV_START = '2026-10-26';  // Début du suivi : ne jamais importer les anciens plannings ASV.
const VACATION_RGB = ['00B0F0', '00BFFF', '00AEEF', '00B4E6', '00FFFF'];
const HOLIDAY_RGB = ['FF99CC', 'FF66CC', 'FF99FF', 'FFC0CB', 'FF80C0'];

/** '8:30', '8h30', '08:30:00' -> '08:30' ; null si invalide. */
function normHour(text) {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})(?::\d{2})?$/.exec(String(text).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossible de charger le lecteur Excel. Vérifie la connexion Internet.'));
    document.head.append(s);
  });
}

function plainValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result;                      // formule
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;                          // lien
  }
  return v;
}

function serialToIso(n, date1904) {
  return new Date(Date.UTC(1899, 11, 30) + (n + (date1904 ? 1462 : 0)) * 86400000).toISOString().slice(0, 10);
}

/** Heure Excel -> 'HH:MM' ; null si la case est vide. */
function hourOf(raw) {
  const v = plainValue(raw);
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  let minutes = null;
  if (v instanceof Date) minutes = Math.round(((v.getTime() / 60000) % 1440 + 1440) % 1440) % 1440;
  else if (typeof v === 'number' && v >= 0 && v < 1) { minutes = Math.round(v * 1440); if (minutes >= 1440) minutes = null; }
  else if (typeof v === 'string' && normHour(v)) return normHour(v);
  if (minutes === null) throw new Error(`Heure non reconnue : ${v}`);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function solidRgb(cell) {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return null;
  const argb = fill.fgColor && fill.fgColor.argb;
  return typeof argb === 'string' ? argb.slice(-6).toUpperCase() : null;
}
function colorStatus(cell) {
  const rgb = solidRgb(cell);
  if (VACATION_RGB.includes(rgb)) return 'Vacances';
  if (HOLIDAY_RGB.includes(rgb)) return 'Férié';
  return null;
}

function readAsv(wb) {
  const date1904 = !!(wb.properties && wb.properties.date1904);
  const result = new Map();
  const conflicts = [];
  let sheets = 0;
  for (const ws of wb.worksheets) {
    const title = ws.name.toUpperCase();
    if (!title.startsWith('ASV ') || title.includes('OLD')) continue;
    let header = null;
    for (let r = 1; r <= Math.min(ws.rowCount, 4) && !header; r++) {
      ws.getRow(r).eachCell((cell) => {
        const v = plainValue(cell.value);
        if (!header && typeof v === 'string' && /^EH\s*\(/i.test(v.trim())) header = { row: r, col: cell.col };
      });
    }
    if (!header) continue;
    sheets++;
    for (let line = header.row + 1; line <= ws.rowCount; line++) {
      const raw = plainValue(ws.getCell(line, 2).value);
      let day = null;
      if (raw instanceof Date) day = raw.toISOString().slice(0, 10);
      else if (typeof raw === 'number' && raw > 30000 && raw < 90000) day = serialToIso(raw, date1904);
      if (!day || day < ASV_START) continue;
      // Une journée peut apparaître dans deux feuilles mensuelles adjacentes.
      const cells = [0, 1, 2, 3].map((i) => ws.getCell(line, header.col + i));
      const status = cells.map(colorStatus).find(Boolean) || null;
      if (status) {
        if (status === 'Vacances') {
          const previous = result.get(day);
          if (!previous || previous.status !== 'Vacances') result.set(day, { day, status: 'Vacances', slots: [], source: ws.name });
        }
        continue;
      }
      if (result.has(day) && result.get(day).status === 'Vacances') continue;
      let times;
      try { times = cells.map((c) => hourOf(c.value)); } catch (e) { throw new Error(`${ws.name}, ligne ${line}, ${day} : ${e.message}`); }
      const filled = times.filter(Boolean);
      if (!filled.length) continue;
      let slots;
      if (filled.length === 2) slots = [filled];
      else if (filled.length === 4) slots = [filled.slice(0, 2), filled.slice(2)];
      else throw new Error(`${ws.name}, ligne ${line}, ${day} : ${filled.length} horaires au lieu de 2 ou 4. Vérification nécessaire.`);
      if (slots.some(([a, b]) => a >= b) || (slots.length === 2 && slots[0][1] > slots[1][0])) {
        throw new Error(`${ws.name}, ligne ${line}, ${day} : horaires incohérents ${slots.map((s) => s.join('-')).join(' / ')}`);
      }
      const previous = result.get(day);
      if (previous && JSON.stringify(previous.slots) !== JSON.stringify(slots)) conflicts.push(`${day} : ${previous.source} / ${ws.name}`);
      else if (!previous) result.set(day, { day, status: 'Travail', slots, source: ws.name });
    }
  }
  if (!sheets) throw new Error('Aucune feuille ASV avec en-tête EH détectée.');
  if (conflicts.length) throw new Error('Horaires contradictoires entre feuilles :\n' + conflicts.slice(0, 12).join('\n'));
  if (!result.size) throw new Error('Aucun horaire EH trouvé dans les feuilles ASV.');
  return [...result.values()];
}

function readSimple(wb, fileName) {
  const date1904 = !!(wb.properties && wb.properties.date1904);
  const ws = wb.worksheets[0];
  if (!ws || !ws.rowCount) throw new Error('Le fichier Excel est vide.');
  const norm = (v) => String(plainValue(v) ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const header = [1, 2, 3, 4, 5].map((c) => norm(ws.getCell(1, c).value));
  if (header.join('|') !== 'date|debut 1|fin 1|debut 2|fin 2') {
    throw new Error('Colonnes attendues en première ligne : Date | Début 1 | Fin 1 | Début 2 | Fin 2 | Statut (facultatif).');
  }
  const statuses = { travail: 'Travail', repos: 'Repos', vacances: 'Vacances', ferie: 'Férié' };
  const rows = [];
  const seen = new Set();
  for (let line = 2; line <= ws.rowCount; line++) {
    const values = [1, 2, 3, 4, 5, 6].map((c) => plainValue(ws.getCell(line, c).value));
    if (!values.some((v) => v !== null && v !== undefined && String(v).trim())) continue;
    try {
      const raw = values[0];
      let day = null;
      if (raw instanceof Date) day = raw.toISOString().slice(0, 10);
      else if (typeof raw === 'number' && raw > 30000 && raw < 90000) day = serialToIso(raw, date1904);
      else if (typeof raw === 'string') {
        const t = raw.trim();
        let m;
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) day = t;
        else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) day = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (day && Number.isNaN(Date.parse(day + 'T00:00:00Z'))) day = null;
      }
      if (!day) throw new Error('Date invalide');
      if (seen.has(day)) throw new Error('Date en double dans le fichier');
      seen.add(day);
      const vals = [1, 2, 3, 4].map((i) => {
        try { return hourOf(values[i]); } catch (e) { throw new Error(`Heure invalide : ${values[i]}`); }
      });
      const rawStatus = norm(values[5]);
      if (rawStatus && !statuses[rawStatus]) throw new Error(`Statut inconnu : ${rawStatus}`);
      const status = statuses[rawStatus] || (vals.some(Boolean) ? 'Travail' : 'Repos');
      const slots = [];
      for (const i of [0, 2]) {
        if (vals[i] || vals[i + 1]) {
          if (!(vals[i] && vals[i + 1])) throw new Error('Début/fin incomplet');
          if (vals[i] >= vals[i + 1]) throw new Error('Fin antérieure au début');
          slots.push([vals[i], vals[i + 1]]);
        }
      }
      if (slots.length === 2 && slots[0][1] > slots[1][0]) throw new Error('Périodes qui se chevauchent');
      if (status === 'Travail' && !slots.length) throw new Error('Travail sans horaires');
      rows.push({ day, status, slots, source: fileName });
    } catch (e) {
      throw new Error(`Ligne Excel ${line} : ${e.message}`);
    }
  }
  if (!rows.length) throw new Error('Aucune journée trouvée.');
  return rows;
}

async function readPlanning(file) {
  await loadExcelJs();
  const wb = new window.ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch (e) { throw new Error('Fichier illisible : choisis un fichier Excel .xlsx.'); }
  const isAsv = wb.worksheets.some((ws) => ws.name.toUpperCase().startsWith('ASV '));
  const rows = isAsv ? readAsv(wb) : readSimple(wb, file.name);
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}
