const express = require('express');
const path    = require('path');
const { negocios, asignaciones, bloqueos } = require('./database');
const { analizar } = require('./gemini');

const PATRON_TICKET = /^ticket-\d+$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getClient() {
  try { return require('./bot'); } catch { return null; }
}

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use(express.static(path.join(__dirname, 'public')));

// API
app.get('/api/negocios', (_, res) => res.json(negocios.getAll()));
app.get('/api/stats',    (_, res) => res.json(negocios.stats()));
app.get('/api/asignaciones', (_, res) => res.json(asignaciones.getRecent(30)));

app.post('/api/negocios', (req, res) => {
  const { nombre, enlace, total, prioridad, descripcion } = req.body;
  if (!nombre || !enlace) return res.status(400).json({ error: 'nombre y enlace son requeridos' });
  const r = negocios.add({ nombre, enlace, total: Number(total)||10, prioridad: Number(prioridad)||3, descripcion: descripcion||'' });
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/negocios/:id', (req, res) => {
  const { nombre, enlace, total, prioridad, descripcion, activo, hechas } = req.body;
  negocios.update(req.params.id, {
    nombre, enlace,
    total:      Number(total),
    prioridad:  Number(prioridad),
    descripcion: descripcion || '',
    activo:     activo ? 1 : 0,
  });
  if (hechas !== undefined) {
    const n = negocios.get(req.params.id);
    if (n) {
      const diff = Number(hechas) - n.hechas;
      if (diff !== 0) negocios.addHechas(req.params.id, diff);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/negocios/all', (_, res) => {
  negocios.deleteAll();
  res.json({ ok: true });
});

app.delete('/api/negocios/:id', (req, res) => {
  negocios.delete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/difusion', async (req, res) => {
  const { mensaje, destino } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'mensaje requerido' });
  const client = getClient();
  if (!client?.guilds) return res.status(503).json({ error: 'Bot de Discord no conectado' });
  const guild = client.guilds.cache.first();
  if (!guild) return res.status(503).json({ error: 'Sin servidor Discord' });
  await guild.channels.fetch();

  const canales = [];
  if (destino === 'tickets' || destino === 'todos') {
    guild.channels.cache.filter(ch => ch.isTextBased() && PATRON_TICKET.test(ch.name)).forEach(ch => canales.push(ch));
  }
  if (destino === 'general' || destino === 'todos') {
    const ids = [process.env.CHANNEL_ANUNCIOS, process.env.CHANNEL_GENERAL].filter(Boolean);
    ids.forEach(id => { const ch = guild.channels.cache.get(id); if (ch?.isTextBased()) canales.push(ch); });
  }

  let enviados = 0;
  for (const ch of canales) {
    try { await ch.send(mensaje); enviados++; } catch {}
    await sleep(600);
  }
  res.json({ ok: true, enviados });
});

app.get('/api/bloqueos',        (_, res) => res.json(bloqueos.getAll()));
app.post('/api/bloqueos',       (req, res) => {
  const { ticket, horas } = req.body;
  if (!ticket || !horas) return res.status(400).json({ error: 'ticket y horas requeridos' });
  bloqueos.bloquear(ticket, Number(horas));
  res.json({ ok: true });
});
app.delete('/api/bloqueos/:ticket', (req, res) => {
  bloqueos.desbloquear(decodeURIComponent(req.params.ticket));
  res.json({ ok: true });
});

app.get('/api/reporte', async (_, res) => {
  const todos = negocios.getAll();
  const stats = negocios.stats();
  const ia    = await analizar(todos, stats);
  res.json({ stats, negocios: todos, ia });
});

module.exports = app;
