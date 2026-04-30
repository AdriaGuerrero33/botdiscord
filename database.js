const fs   = require('fs');
const path = require('path');

const DIR  = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const FILE = process.env.DB_PATH || path.join(DIR, 'data.json');

const EMPTY = { negocios: [], asignaciones: [], reseñas: [], bloqueos: [] };

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return structuredClone(EMPTY); }
}

function save(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function nextId(arr) {
  return arr.length > 0 ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

function now() { return new Date().toISOString(); }

// ── NEGOCIOS ──────────────────────────────────────────────────────────────────
const negocios = {
  getAll() {
    const d = load();
    return d.negocios.sort((a, b) => b.prioridad - a.prioridad || (b.total - b.hechas) - (a.total - a.hechas));
  },
  getActive() {
    return this.getAll().filter(n => n.activo && n.hechas < n.total);
  },
  get(id) {
    return load().negocios.find(n => n.id === Number(id));
  },
  add({ nombre, enlace, total, prioridad, descripcion }) {
    const d = load();
    const id = nextId(d.negocios);
    d.negocios.push({ id, nombre, enlace, total: Number(total)||10, hechas: 0, prioridad: Number(prioridad)||3, descripcion: descripcion||'', activo: 1, creado: now() });
    save(d);
    return { lastInsertRowid: id };
  },
  update(id, { nombre, enlace, total, prioridad, descripcion, activo, hechas }) {
    const d = load();
    const i = d.negocios.findIndex(n => n.id === Number(id));
    if (i === -1) return;
    d.negocios[i] = { ...d.negocios[i], nombre, enlace, total: Number(total), prioridad: Number(prioridad), descripcion: descripcion||'', activo: activo ? 1 : 0 };
    if (hechas !== undefined) d.negocios[i].hechas = Math.min(Number(total), Number(hechas));
    save(d);
  },
  delete(id) {
    const d = load();
    d.negocios = d.negocios.filter(n => n.id !== Number(id));
    save(d);
  },
  deleteAll() {
    const d = load();
    d.negocios = [];
    save(d);
  },
  addHechas(id, n) {
    const d = load();
    const i = d.negocios.findIndex(x => x.id === Number(id));
    if (i !== -1) {
      d.negocios[i].hechas = Math.min(d.negocios[i].total, d.negocios[i].hechas + n);
      save(d);
    }
  },
  stats() {
    const d = load();
    const activos = d.negocios.filter(n => n.activo);
    return {
      negocios:   activos.length,
      hechas:     d.negocios.reduce((s, n) => s + n.hechas, 0),
      necesarias: activos.reduce((s, n) => s + n.total, 0),
    };
  },
};

// ── ASIGNACIONES ──────────────────────────────────────────────────────────────
const asignaciones = {
  add({ negocio_id, user_id, user_tag, canal_id, canal_nombre, cantidad }) {
    const d = load();
    d.asignaciones.push({ id: nextId(d.asignaciones), negocio_id, user_id, user_tag, canal_id, canal_nombre: canal_nombre || '', cantidad, fecha: now() });
    save(d);
  },
  getByNegocio(negocio_id) {
    const d = load();
    return d.asignaciones
      .filter(a => a.negocio_id === negocio_id)
      .map(a => ({
        user_tag:     a.user_tag,
        canal_nombre: a.canal_nombre || a.canal_id,
        cantidad:     a.cantidad,
        fecha:        a.fecha,
      }));
  },
  getRecent(limit = 30) {
    const d = load();
    return d.asignaciones
      .slice(-limit).reverse()
      .map(a => ({ ...a, nombre: d.negocios.find(n => n.id === a.negocio_id)?.nombre || '—' }));
  },
  getLastNegocioId(user_id) {
    const d = load();
    const last = d.asignaciones.filter(a => a.user_id === user_id).at(-1);
    return last?.negocio_id ?? null;
  },
  getLastAsignacion(user_id) {
    const d = load();
    return d.asignaciones.filter(a => a.user_id === user_id).at(-1) ?? null;
  },
  getRequestsToday(user_id) {
    const hoy = new Date().toISOString().split('T')[0];
    const d = load();
    return d.asignaciones.filter(a => a.user_id === user_id && a.fecha?.startsWith(hoy)).length;
  },
  getCountPerNegocio(user_id) {
    const d = load();
    const counts = {};
    d.asignaciones.filter(a => a.user_id === user_id).forEach(a => {
      counts[a.negocio_id] = (counts[a.negocio_id] || 0) + a.cantidad;
    });
    return counts;
  },
  getPendingCount(user_id) {
    const d = load();
    const asignadas = d.asignaciones.filter(a => a.user_id === user_id).reduce((s, a) => s + a.cantidad, 0);
    const enviadas  = d.reseñas.filter(r => r.user_id === user_id).length;
    return Math.max(0, asignadas - enviadas);
  },
  getDailyStats(fecha) {
    const hoy = fecha || new Date().toISOString().split('T')[0];
    const d   = load();
    const asigns  = d.asignaciones.filter(a => a.fecha?.startsWith(hoy));
    const resenas = d.reseñas.filter(r => r.fecha?.startsWith(hoy));
    return {
      pedidas:  asigns.reduce((s, a) => s + a.cantidad, 0),
      enviadas: resenas.length,
      validas:  resenas.filter(r => r.valida === 1).length,
      usuarios: [...new Set(asigns.map(a => a.user_tag).filter(Boolean))],
    };
  },
};

// ── RESEÑAS ───────────────────────────────────────────────────────────────────
const reseñas = {
  get(enlace) {
    return load().reseñas.find(r => r.enlace === enlace);
  },
  add({ enlace, user_id, user_tag, negocio_id, canal_id }) {
    const d = load();
    if (d.reseñas.find(r => r.enlace === enlace)) return;
    d.reseñas.push({ id: nextId(d.reseñas), enlace, user_id, user_tag, negocio_id, canal_id, valida: null, fecha: now() });
    save(d);
  },
  setValida(enlace, v) {
    const d = load();
    const i = d.reseñas.findIndex(r => r.enlace === enlace);
    if (i !== -1) { d.reseñas[i].valida = v ? 1 : 0; save(d); }
  },
  getByCanal(canal_id, desde, hasta) {
    const d = load();
    return d.reseñas.filter(r =>
      r.canal_id === canal_id &&
      r.fecha >= desde &&
      r.fecha <= hasta
    ).sort((a, b) => a.fecha.localeCompare(b.fecha));
  },
};

// ── BLOQUEOS ──────────────────────────────────────────────────────────────────
const bloqueos = {
  bloquear(ticket, horas) {
    const d = load();
    if (!d.bloqueos) d.bloqueos = [];
    d.bloqueos = d.bloqueos.filter(b => b.ticket !== ticket); // reemplaza si ya existe
    const hasta = new Date(Date.now() + horas * 60 * 60 * 1000).toISOString();
    d.bloqueos.push({ ticket, hasta, creado: now() });
    save(d);
  },
  desbloquear(ticket) {
    const d = load();
    if (!d.bloqueos) return;
    d.bloqueos = d.bloqueos.filter(b => b.ticket !== ticket);
    save(d);
  },
  estaBloqueado(ticket) {
    const d = load();
    if (!d.bloqueos) return false;
    const b = d.bloqueos.find(b => b.ticket === ticket);
    if (!b) return false;
    if (new Date(b.hasta) <= new Date()) {
      // expirado, limpiar
      d.bloqueos = d.bloqueos.filter(x => x.ticket !== ticket);
      save(d);
      return false;
    }
    return b.hasta;
  },
  getAll() {
    const d = load();
    return (d.bloqueos || []).filter(b => new Date(b.hasta) > new Date());
  },
};

console.log('[DB] Base de datos JSON lista en', FILE);
module.exports = { negocios, asignaciones, reseñas, bloqueos };
