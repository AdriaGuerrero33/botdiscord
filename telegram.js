const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

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
  console.warn('[Telegram] TELEGRAM_TOKEN no configurado en variables de entorno');
}

// Enviar mensaje de texto
async function notificar(texto) {
  if (!bot)    { console.warn('[Telegram] Bot no iniciado');               return false; }
  if (!CHAT_ID){ console.warn('[Telegram] TELEGRAM_CHAT_ID no configurado'); return false; }
  try {
    await bot.sendMessage(CHAT_ID, texto, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    console.error('[Telegram] Error enviando texto:', err.message);
    return false;
  }
}

// Enviar reporte de audio (TTS en español)
async function notificarAudio(texto) {
  if (!bot || !CHAT_ID) return false;
  try {
    const gtts    = require('node-gtts')('es');
    const tmpFile = path.join('/tmp', `reporte_${Date.now()}.mp3`);

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpFile);
      gtts.stream(texto).pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    await bot.sendAudio(CHAT_ID, tmpFile, {
      caption:  '📊 Reporte de reseñas RSMoney',
      title:    'Reporte RSMoney',
      performer: 'Bot RSMoney',
    });

    fs.unlink(tmpFile, () => {});
    return true;
  } catch (err) {
    console.error('[Telegram] Error enviando audio:', err.message);
    // Fallback a texto si falla el audio
    return notificar(texto);
  }
}

// Reporte diario de audio — 9:00 Madrid
function iniciarReporteDiario(obtenerDatos) {
  cron.schedule('0 9 * * *', async () => {
    const { negocios, stats } = obtenerDatos();
    const pct = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;

    const urgentes = negocios
      .filter(n => n.activo && n.hechas < n.total)
      .slice(0, 3)
      .map(n => `${n.nombre}: ${n.hechas} de ${n.total} reseñas.`)
      .join(' ');

    const textoAudio = `Buenos días. Reporte diario de RSMoney.
Progreso total: ${pct} por ciento.
Reseñas completadas: ${stats.hechas} de ${stats.necesarias}.
Negocios activos: ${stats.negocios}.
${urgentes ? `Pendientes: ${urgentes}` : 'Todos los negocios al día.'}`;

    console.log('[Telegram] Enviando reporte diario de audio...');
    await notificarAudio(textoAudio);
  }, { timezone: 'Europe/Madrid' });

  console.log('[Telegram] Reporte diario de audio programado a las 09:00 (Madrid)');
}

module.exports = { notificar, notificarAudio, iniciarReporteDiario };
