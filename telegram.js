let bot;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (process.env.TELEGRAM_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
    console.log('[Telegram] Bot listo');
  } catch (e) {
    console.warn('[Telegram] Error al iniciar:', e.message);
  }
}

async function notificar(texto) {
  if (!bot || !CHAT_ID) return;
  try {
    await bot.sendMessage(CHAT_ID, texto, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Telegram]', err.message);
  }
}

module.exports = { notificar };
