const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const { negocios: db, asignaciones: asignDb } = require('./database');
const { notificar, notificarAudio, iniciarReporteDiario } = require('./telegram');
const { analizar } = require('./gemini');
const { verificar, extraerLinks } = require('./reviews');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PATRON_TICKET    = /^ticket-\d+$/;
const CHANNEL_ANUNCIOS = process.env.CHANNEL_ANUNCIOS;
const CHANNEL_GENERAL  = process.env.CHANNEL_GENERAL;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── MENSAJES PROGRAMADOS ──────────────────────────────────────────────────────

const MENSAJE_JUEVES = `# Leer esto es muy importante.

Entregar todas las reseñas Mañana Viernes despues de este mensaje para que lo podamos contar bien antes de las 22:00 para que podamos hacer todo correctamente, sin confusiones.

Pasa todos los enlaces de lo que hayas hecho desde el sabado hasta hoy DESPUES de esté mensaje. SOBRETODO NO LO ENTREGEIS TARDE

@everyone`;

const MENSAJE_DIARIO = `# @everyone PEDIR MAS RESEÑAS en vuestro ticket`;

async function enviarJueves() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.channels.fetch();

  for (const id of [CHANNEL_ANUNCIOS, CHANNEL_GENERAL].filter(Boolean)) {
    try { const ch = guild.channels.cache.get(id); if (ch?.isTextBased()) await ch.send(MENSAJE_JUEVES); }
    catch (e) { console.error(`[Jueves] ${id}:`, e.message); }
    await sleep(1000);
  }

  const tickets = guild.channels.cache.filter(ch => ch.isTextBased() && PATRON_TICKET.test(ch.name));
  let n = 0;
  for (const [, ch] of tickets) {
    try { await ch.send(MENSAJE_JUEVES); n++; }
    catch (e) { console.error(`[Jueves] ${ch.name}:`, e.message); }
    await sleep(1000);
  }
  console.log(`[Jueves] Enviado a ${n} tickets + canales fijos`);
  await notificar(`📅 *Mensaje del jueves enviado*\nTickets: ${n}`);
}

async function enviarDiario() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.channels.fetch();
  for (const id of [CHANNEL_ANUNCIOS, CHANNEL_GENERAL].filter(Boolean)) {
    try { const ch = guild.channels.cache.get(id); if (ch?.isTextBased()) await ch.send(MENSAJE_DIARIO); }
    catch (e) { console.error(`[Diario] ${id}:`, e.message); }
    await sleep(1000);
  }
}

// ── SLASH COMMANDS ────────────────────────────────────────────────────────────

async function registrarComandos() {
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const GUILD_ID  = process.env.DISCORD_GUILD_ID;
  if (!CLIENT_ID || !GUILD_ID) {
    console.warn('[Slash] Faltan DISCORD_CLIENT_ID / DISCORD_GUILD_ID');
    return;
  }
  const commands = [
    new SlashCommandBuilder()
      .setName('pedir')
      .setDescription('Recibe reseñas para hacer (1-5)')
      .addIntegerOption(opt =>
        opt.setName('cantidad')
          .setDescription('Cuántas reseñas quieres hacer (1-5)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(5))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('reporte')
      .setDescription('Ver estado y reporte IA de las reseñas')
      .toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[Slash] Comandos registrados');
  } catch (e) {
    console.error('[Slash] Error registrando:', e.message);
  }
}

// ── HANDLERS ─────────────────────────────────────────────────────────────────

function construirMensajePedir(negocio, cantidad) {
  return [
    negocio.enlace,
    '',
    `**CANTIDAD:** ${cantidad}/${negocio.total}`,
    '',
    '**INDICACIONES PARA LOS TEXTOS:**',
    negocio.descripcion?.trim() || '_Sin indicaciones específicas._',
    '',
    '# NO USAR BAJO NINGÚN CONCEPTO IA',
    '## SI SE USA IA SERÁ PENALIZADO',
    '### También puedes revisar el perfil de la empresa y lo que tienen para hacer un buen texto. (Simplemente tiene que verse realista).',
  ].join('\n');
}

async function handlePedir(interaction) {
  const pedida     = interaction.options.getInteger('cantidad');
  const pendientes = db.getActive();

  if (!pedida) {
    return interaction.reply({ content: '❌ Indica cuántas reseñas quieres hacer. Ejemplo: `/pedir 3`', ephemeral: true });
  }
  if (!pendientes.length) {
    return interaction.reply({ content: '⚠️ No hay reseñas disponibles ahora. El administrador añadirá negocios pronto.' });
  }

  const negocio  = pendientes[0];
  const cantidad = Math.min(pedida, negocio.total - negocio.hechas);

  await interaction.reply({ content: construirMensajePedir(negocio, cantidad) });
  asignDb.add({ negocio_id: negocio.id, user_id: interaction.user.id, user_tag: interaction.user.tag, canal_id: interaction.channelId, cantidad });
  await notificar(`📋 *Nueva asignación /pedir*\n👤 ${interaction.user.tag}\n🏪 ${negocio.nombre}\n📝 ${cantidad} reseñas`);
}

async function handleReporte(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const todos = db.getAll();
  const stats = db.stats();
  const pct   = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;

  let texto = `📊 **Reporte de reseñas**\n🏪 Negocios: **${stats.negocios}** | ✅ **${stats.hechas}/${stats.necesarias}** (${pct}%)\n\n`;
  todos.slice(0, 8).forEach(n => {
    const p    = n.total > 0 ? Math.round((n.hechas / n.total) * 100) : 0;
    const icon = !n.activo ? '⏸️' : p >= 100 ? '✅' : p >= 50 ? '🟡' : '🔴';
    texto += `${icon} **${n.nombre}** — ${n.hechas}/${n.total} (${p}%)\n`;
  });

  const ia = await analizar(todos, stats);
  if (ia) texto += `\n🤖 **Análisis IA:**\n${ia}`;

  await interaction.editReply({ content: texto });
  await notificar(`📊 *Reporte visto por* ${interaction.user.tag}\n${pct}% (${stats.hechas}/${stats.necesarias})`);
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'pedir')   await handlePedir(interaction);
    if (interaction.commandName === 'reporte') await handleReporte(interaction);
  } catch (err) {
    console.error('[Slash]', err.message);
    const payload = { content: '❌ Error procesando el comando.', ephemeral: true };
    interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content) return; // MessageContent intent no habilitado

  const texto = message.content.trim();

  // ── /pedir N ─────────────────────────────────────────────
  if (texto.startsWith('/pedir')) {
    const partes   = texto.split(/\s+/);
    const cantidad = parseInt(partes[1], 10);

    if (isNaN(cantidad) || cantidad < 1 || cantidad > 5) {
      return message.reply('❌ Indica cuántas reseñas quieres hacer. Ejemplo: `/pedir 3` (máximo 5)');
    }

    const pendientes = db.getActive();
    if (!pendientes.length) {
      return message.reply('⚠️ No hay reseñas disponibles ahora. El administrador añadirá negocios pronto.');
    }

    const negocio  = pendientes[0];
    const asignadas = Math.min(cantidad, negocio.total - negocio.hechas);

    await message.reply(construirMensajePedir(negocio, asignadas));
    asignDb.add({ negocio_id: negocio.id, user_id: message.author.id, user_tag: message.author.tag, canal_id: message.channel.id, cantidad: asignadas });
    await notificar(`📋 *Nueva asignación /pedir*\n👤 ${message.author.tag}\n🏪 ${negocio.nombre}\n📝 ${asignadas} reseñas`);
    return;
  }

  // ── /reporte ──────────────────────────────────────────────
  if (texto === '/reporte') {
    const todos = db.getAll();
    const stats = db.stats();
    const pct   = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;
    let rep = `📊 **Reporte** — ${stats.hechas}/${stats.necesarias} (${pct}%)\n`;
    todos.slice(0, 8).forEach(n => {
      const p    = n.total > 0 ? Math.round((n.hechas / n.total) * 100) : 0;
      const icon = !n.activo ? '⏸️' : p >= 100 ? '✅' : p >= 50 ? '🟡' : '🔴';
      rep += `${icon} **${n.nombre}** — ${n.hechas}/${n.total}\n`;
    });
    return message.reply(rep);
  }

  // ── /telegram_test ────────────────────────────────────────
  if (texto === '/telegram_test') {
    const ok = await notificar('✅ *Prueba de Telegram* — Bot conectado correctamente.');
    return message.reply(ok ? '✅ Mensaje enviado a Telegram.' : '❌ Falla Telegram. Revisa TELEGRAM_TOKEN y TELEGRAM_CHAT_ID en Railway.');
  }

  // ── /audio_test ───────────────────────────────────────────
  if (texto === '/audio_test') {
    await message.reply('🎙️ Generando audio de prueba en Telegram...');
    const ok = await notificarAudio('Hola. Esta es una prueba de audio del bot RSMoney. Si escuchas esto, el sistema de reportes de audio funciona correctamente.');
    return message.reply(ok ? '✅ Audio enviado a Telegram.' : '❌ Error enviando audio.');
  }

  // ── Detección de enlaces Google Maps en tickets ───────────
  if (!PATRON_TICKET.test(message.channel.name)) return;

  const links = extraerLinks(message.content);
  for (const link of links) {
    const res = await verificar(link, message.author.id, message.author.tag, message.channel.id);
    await message.reply(res.msg);
    if (res.estado !== 'valida') {
      await notificar(`${res.estado === 'duplicada' ? '⚠️' : '❌'} *Reseña ${res.estado}*\n👤 ${message.author.tag}\n📍 #${message.channel.name}\n🔗 ${link}`);
    }
  }
});

client.on('error', err => console.error('[Discord]', err.message));

client.once('ready', async () => {
  console.log(`✅ Bot conectado: ${client.user.tag}`);
  await registrarComandos();

  cron.schedule('0 15 * * 4',         enviarJueves, { timezone: 'Europe/Madrid' });
  cron.schedule('0 15 * * 0,1,2,3,5,6', enviarDiario, { timezone: 'Europe/Madrid' });

  // Reporte de audio diario a las 9:00 por Telegram
  iniciarReporteDiario(() => ({
    negocios: db.getAll(),
    stats:    db.stats(),
  }));

  console.log('⏰ Schedulers activos: 15:00 diario + 15:00 jueves + 09:00 audio Telegram');
  await notificar(`🟢 *Bot online*\n🤖 ${client.user.tag}`);
});

module.exports = client;
