const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

let bot;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (process.env.TELEGRAM_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    // polling: true para recibir mensajes del usuario
    bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    console.log('[Telegram] Bot listo con polling. Chat ID:', CHAT_ID || 'NO CONFIGURADO');
    iniciarChat();
  } catch (e) {
    console.warn('[Telegram] Error al iniciar:', e.message);
  }
} else {
  console.warn('[Telegram] TELEGRAM_TOKEN no configurado');
}

// ── CHAT CON GEMINI ───────────────────────────────────────────────────────────
function iniciarChat() {
  if (!bot) return;

  bot.onText(/(.+)/, async (msg, match) => {
    // Solo responder al owner (CHAT_ID)
    if (String(msg.chat.id) !== String(CHAT_ID)) return;

    const texto = match[1].trim();

    // Comandos rápidos
    if (texto === '/start' || texto === '/help') {
      return bot.sendMessage(CHAT_ID,
        '👋 *Bot RSMoney activo*\n\n' +
        'Puedo responderte cualquier pregunta sobre las reseñas y el estado del negocio.\n\n' +
        '*Comandos:*\n' +
        '`/reporte` — Reporte actual en texto\n' +
        '`/audio` — Reporte en audio\n' +
        '`/start` — Este mensaje\n\n' +
        'O simplemente escríbeme lo que necesitas 🤖',
        { parse_mode: 'Markdown' }
      );
    }

    if (texto === '/reporte') {
      return enviarReporteTexto();
    }

    if (texto === '/audio') {
      return enviarReporteAudioCompleto();
    }

    // Cualquier otro mensaje → Gemini responde
    await bot.sendChatAction(CHAT_ID, 'typing');
    const respuesta = await preguntarGemini(texto);
    bot.sendMessage(CHAT_ID, respuesta, { parse_mode: 'Markdown' });
  });

  bot.on('polling_error', err => console.error('[Telegram polling]', err.message));
}

async function preguntarGemini(pregunta) {
  if (!process.env.GEMINI_API_KEY) {
    return '⚠️ GEMINI_API_KEY no configurada. Añádela en Railway Variables.';
  }
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Cargar datos actuales para dar contexto a Gemini
    let contexto = '';
    try {
      const { negocios } = require('./database');
      const todos  = negocios.getAll();
      const stats  = negocios.stats();
      const pct    = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;
      contexto = `Eres el asistente de RSMoney, un sistema de gestión de reseñas de Google Maps.
Datos actuales:
- Negocios activos: ${stats.negocios}
- Reseñas hechas: ${stats.hechas} de ${stats.necesarias} (${pct}%)
- Negocios: ${JSON.stringify(todos.map(n => ({ nombre: n.nombre, hechas: n.hechas, total: n.total, prioridad: n.prioridad, activo: n.activo })))}

Responde en español de forma concisa y útil. Si te preguntan algo que no tiene que ver con el negocio, responde igualmente con sentido común.`;
    } catch {}

    const result = await model.generateContent(`${contexto}\n\nPregunta del admin: ${pregunta}`);
    return result.response.text();
  } catch (err) {
    console.error('[Gemini]', err.message);
    return `❌ Error con Gemini: ${err.message}`;
  }
}

async function enviarReporteTexto() {
  try {
    const { negocios } = require('./database');
    const todos  = negocios.getAll();
    const stats  = negocios.stats();
    const pct    = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;

    let msg = `📊 *Reporte RSMoney*\n`;
    msg += `🏪 Negocios: *${stats.negocios}* | ✅ *${stats.hechas}/${stats.necesarias}* (${pct}%)\n\n`;
    todos.slice(0, 10).forEach(n => {
      const p    = n.total > 0 ? Math.round((n.hechas / n.total) * 100) : 0;
      const icon = !n.activo ? '⏸' : p >= 100 ? '✅' : p >= 50 ? '🟡' : '🔴';
      msg += `${icon} *${n.nombre}* — ${n.hechas}/${n.total}\n`;
    });

    await notificar(msg);
  } catch (err) {
    await notificar('❌ Error generando reporte: ' + err.message);
  }
}

async function enviarReporteAudioCompleto() {
  try {
    const { negocios } = require('./database');
    const stats  = negocios.stats();
    const todos  = negocios.getAll();
    const pct    = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;
    const urgentes = todos.filter(n => n.activo && n.hechas < n.total)
      .slice(0, 3).map(n => `${n.nombre}: ${n.hechas} de ${n.total}`).join('. ');

    const textoAudio = `Reporte RSMoney. Progreso: ${pct} por ciento. ${stats.hechas} de ${stats.necesarias} reseñas completadas. Negocios activos: ${stats.negocios}. ${urgentes ? `Pendientes: ${urgentes}.` : 'Todo al día.'}`;
    await notificarAudio(textoAudio);
  } catch (err) {
    await notificar('❌ Error generando audio: ' + err.message);
  }
}

// ── ENVIAR TEXTO ──────────────────────────────────────────────────────────────
async function notificar(texto) {
  if (!bot)    { console.warn('[Telegram] Bot no iniciado');    return false; }
  if (!CHAT_ID){ console.warn('[Telegram] CHAT_ID no configurado'); return false; }
  try {
    await bot.sendMessage(CHAT_ID, texto, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    console.error('[Telegram] Error enviando texto:', err.message);
    return false;
  }
}

// ── ENVIAR AUDIO TTS ──────────────────────────────────────────────────────────
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
      caption:   '📊 Reporte RSMoney',
      title:     'Reporte RSMoney',
      performer: 'Bot RSMoney',
    });
    fs.unlink(tmpFile, () => {});
    return true;
  } catch (err) {
    console.error('[Telegram] Error enviando audio:', err.message);
    return notificar(texto);
  }
}

// ── REPORTE NOCTURNO 21:00 ────────────────────────────────────────────────────
async function enviarReporteNoche() {
  try {
    const { negocios, asignaciones } = require('./database');
    const stats   = negocios.stats();
    const daily   = asignaciones.getDailyStats();
    const todos   = negocios.getAll();
    const pct     = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;
    const usuarios = daily.usuarios.length > 0 ? daily.usuarios.join(', ') : 'ninguno';

    // Texto para notificar en Telegram (con Markdown)
    const textoMsg =
      `🌙 *Resumen del día — RSMoney*\n\n` +
      `📋 Reseñas pedidas hoy: *${daily.pedidas}*\n` +
      `📤 Reseñas enviadas hoy: *${daily.enviadas}*\n` +
      `✅ Reseñas válidas: *${daily.validas}*\n` +
      `👥 Usuarios activos: ${usuarios}\n\n` +
      `📊 *Progreso total:* ${stats.hechas}/${stats.necesarias} (${pct}%)`;

    await notificar(textoMsg);

    // Audio con el resumen
    const textoAudio =
      `Resumen nocturno de RSMoney. ` +
      `Hoy se han pedido ${daily.pedidas} reseñas y se han enviado ${daily.enviadas}. ` +
      `${daily.validas} han sido validadas correctamente. ` +
      `Usuarios activos: ${daily.usuarios.length}. ` +
      `Progreso total: ${pct} por ciento.`;

    await notificarAudio(textoAudio);
    console.log('[Telegram] Reporte nocturno enviado');
  } catch (err) {
    console.error('[Telegram] Error reporte noche:', err.message);
  }
}

// ── REPORTES PROGRAMADOS ──────────────────────────────────────────────────────
function iniciarReporteDiario() {
  cron.schedule('0 9 * * *',  enviarReporteAudioCompleto, { timezone: 'Europe/Madrid' });
  cron.schedule('0 21 * * *', enviarReporteNoche,         { timezone: 'Europe/Madrid' });
  console.log('[Telegram] Reportes: 09:00 mañana + 21:00 noche (Madrid)');
}

module.exports = { notificar, notificarAudio, iniciarReporteDiario };
