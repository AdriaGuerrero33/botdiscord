const express = require('express');
const path    = require('path');
const { negocios, asignaciones } = require('./database');
const { analizar } = require('./gemini');

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Basic auth opcional
const PASS = process.env.DASHBOARD_PASSWORD;
if (PASS) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const b64  = auth.replace('Basic ', '');
    const cred = Buffer.from(b64, 'base64').toString();
    if (cred === `admin:${PASS}`) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel RSMoney"');
    res.status(401).send('Acceso no autorizado');
  });
}

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

app.get('/api/reporte', async (_, res) => {
  const todos = negocios.getAll();
  const stats = negocios.stats();
  const ia    = await analizar(todos, stats);
  res.json({ stats, negocios: todos, ia });
});

module.exports = app;
