let bot;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (process.env.TELEGRAM_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
    console.log('[Telegram] Bot listo. Chat ID:', CHAT_ID || 'NO CONFIGURADO');
  } catch (e) {
    console.warn('[Telegram] Error al iniciar:', e.message);
  }
} else {
  console.warn('[Telegram] TELEGRAM_TOKEN no configurado');
}

async function notificar(texto) {
  if (!bot) { console.warn('[Telegram] Bot no iniciado'); return false; }
  if (!CHAT_ID) { console.warn('[Telegram] TELEGRAM_CHAT_ID no configurado'); return false; }
  try {
    await bot.sendMessage(CHAT_ID, texto, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    console.error('[Telegram] Error enviando mensaje:', err.message);
    return false;
  }
}

module.exports = { notificar };
