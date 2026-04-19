require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Express arranca primero siempre
let app;
try {
  app = require('./server');
} catch (err) {
  console.error('[Server] Error cargando server.js:', err.message);
  const express = require('express');
  app = express();
  app.get('/health', (_, res) => res.json({ ok: true, error: err.message }));
}

app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));

// Discord bot arranca después, sin bloquear Express
if (!process.env.BOT_TOKEN) {
  console.error('[Discord] Falta BOT_TOKEN');
} else {
  try {
    const client = require('./bot');
    client.login(process.env.BOT_TOKEN).catch(err => {
      console.error('[Discord] Login fallido:', err.message);
    });
  } catch (err) {
    console.error('[Discord] Error iniciando bot:', err.message);
  }
}

process.on('unhandledRejection', err => console.error('[Unhandled]', err?.message));
process.on('uncaughtException',  err => console.error('[Uncaught]',  err?.message));
