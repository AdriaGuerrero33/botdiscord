require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('FATAL: Falta BOT_TOKEN en .env');
  process.exit(1);
}

const client = require('./bot');
const app    = require('./server');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Dashboard: http://localhost:${PORT}`));

client.login(process.env.BOT_TOKEN);

process.on('unhandledRejection', err => console.error('[Unhandled]', err.message));
