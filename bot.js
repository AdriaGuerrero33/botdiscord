const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const { negocios: db, asignaciones: asignDb, reseñas: reseñasDb } = require('./database');
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

const RESPUESTAS_RANDOM = [
  'oye papi para eso usa `/avisar` que te atiendo yo personalmente 😘',
  'babe esto no es un chat, usa `/avisar` si necesitas algo 💋',
  'ey que soy un bot no tu puta asistente 😂 usa `/avisar` si necesitas ayuda de verdad',
  'para hablar conmigo usa `/avisar` que yo no muerdo 😉',
  'cariño esto no funciona así, usa `/avisar` para hablar con el admin 🥰',
];

// ── MENSAJES PROGRAMADOS ──────────────────────────────────────────────────────

const MENSAJE_JUEVES = `# Leer esto es muy importante.

Entregar todas las reseñas Mañana Viernes despues de este mensaje para que lo podamos contar bien antes de las 22:00 para que podamos hacer todo correctamente, sin confusiones.

Pasa todos los enlaces de lo que hayas hecho desde el sabado hasta hoy DESPUES de esté mensaje. SOBRETODO NO LO ENTREGEIS TARDE

@everyone`;

const MENSAJE_DIARIO = `# @everyone PEDIR MAS RESEÑAS en vuestro ticket`;

const MENSAJE_BIENVENIDA_BOT = `# 📢 Actualización importante — Nuevo sistema de reseñas

A partir de ahora usamos un bot para gestionar las reseñas de forma más ordenada. Lee esto con atención:

---

## ✅ Cómo funciona

**1. Pide reseñas con \`/pedir\`**
Escribe \`/pedir 3\` (o el número que quieras, máximo 5) y el bot te mandará el enlace del negocio con todas las indicaciones.

**2. Entrega los enlaces directamente en tu ticket**
Cuando hayas hecho las reseñas, **pega los enlaces de Google Maps aquí** en tu ticket. El bot los registrará automáticamente. ~~\`/revisar\` ya no existe~~, no lo uses.

**3. Otras plataformas**
Si haces reseñas en Trustpilot, TripAdvisor u otras webs, avísanos con:
- \`/trustpilot\`
- \`/tripadvisor\`
- \`/otros\`

**4. ¿Necesitas ayuda?**
Usa \`/avisar\` para que el admin te atienda personalmente.

---

## ⭐ IMPORTANTE — Hazte Local Guide en Google

Para que tus reseñas tengan más peso y no sean eliminadas por Google, **regístrate como Local Guide**:

1. Ve a: **maps.google.com**
2. Inicia sesión con tu cuenta de Google
3. Haz clic en el menú → **"Contribuir"**
4. Únete al programa **Local Guides**

Cuanto más nivel de Local Guide tengas, más valor tienen tus reseñas y menos probabilidad de que las eliminen. Es gratis y muy fácil.

---

> ⚠️ Todos los comandos funcionan **solo en tu ticket**. No los uses en otros canales.`;

async function enviarBienvenidaBot() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.channels.fetch();
  const tickets = guild.channels.cache.filter(ch => ch.isTextBased() && PATRON_TICKET.test(ch.name));
  let n = 0;
  for (const [, ch] of tickets) {
    try { await ch.send(MENSAJE_BIENVENIDA_BOT); n++; } catch (e) {}
    await sleep(1000);
  }
  await notificar(`📢 *Mensaje de bienvenida enviado*\nTickets: ${n}`);
  console.log(`[Bienvenida] Enviado a ${n} tickets`);
}

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
    try { await ch.send(MENSAJE_JUEVES); n++; } catch (e) {}
    await sleep(1000);
  }
  await notificar(`📅 *Mensaje del jueves enviado*\nTickets: ${n}`);
}

async function enviarDiario() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.channels.fetch();
  for (const id of [CHANNEL_ANUNCIOS, CHANNEL_GENERAL].filter(Boolean)) {
    try { const ch = guild.channels.cache.get(id); if (ch?.isTextBased()) await ch.send(MENSAJE_DIARIO); }
    catch (e) {}
    await sleep(1000);
  }
}

// ── SLASH COMMANDS ────────────────────────────────────────────────────────────

async function registrarComandos() {
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const GUILD_ID  = process.env.DISCORD_GUILD_ID;
  if (!CLIENT_ID || !GUILD_ID) return console.warn('[Slash] Faltan DISCORD_CLIENT_ID / DISCORD_GUILD_ID');
  const commands = [
    new SlashCommandBuilder()
      .setName('pedir').setDescription('Recibe reseñas (1-5)')
      .addIntegerOption(o => o.setName('cantidad').setDescription('Cuántas (1-5)').setRequired(false).setMinValue(1).setMaxValue(5))
      .toJSON(),
    new SlashCommandBuilder().setName('reporte').setDescription('Ver estado de reseñas').toJSON(),
    new SlashCommandBuilder()
      .setName('revisar').setDescription('[ADMIN] Ver enlaces de un ticket de sábado a viernes')
      .addIntegerOption(o => o.setName('ticket').setDescription('Número del ticket (ej: 83)').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder().setName('trustpilot').setDescription('Avisa al admin de que has hecho una reseña en Trustpilot').toJSON(),
    new SlashCommandBuilder().setName('tripadvisor').setDescription('Avisa al admin de que has hecho una reseña en TripAdvisor').toJSON(),
    new SlashCommandBuilder().setName('otros').setDescription('Avisa al admin de que has hecho una reseña en otra plataforma').toJSON(),
    new SlashCommandBuilder()
      .setName('avisar').setDescription('Avisa al admin de que necesitas algo importante')
      .addStringOption(o => o.setName('mensaje').setDescription('¿Qué necesitas?').setRequired(false))
      .toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[Slash] Comandos registrados');
  } catch (e) { console.error('[Slash]', e.message); }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function construirMensajePedir(negocio, cantidad) {
  return [
    negocio.enlace,
    '',
    `**CANTIDAD:** ${cantidad}`,
    '',
    '**INDICACIONES PARA LOS TEXTOS:**',
    negocio.descripcion?.trim() || '_Sin indicaciones específicas._',
    '',
    '# NO USAR BAJO NINGÚN CONCEPTO IA',
    '## SI SE USA IA SERÁ PENALIZADO',
    '### También puedes revisar el perfil de la empresa y lo que tienen para hacer un buen texto. (Simplemente tiene que verse realista).',
    '',
    `> ¿Quieres reseñas de otro negocio? Escribe \`/pedir ${cantidad}\` de nuevo.`,
  ].join('\n');
}

async function procesarPedir(userId, userTag, canalId, pedida, responder) {
  if (!pedida || isNaN(pedida) || pedida < 1 || pedida > 5) {
    return responder('❌ Indica cuántas reseñas quieres hacer. Ejemplo: `/pedir 3` (máximo 5)');
  }

  // Si pide demasiadas veces hoy, responder con personalidad
  const requestsHoy = asignDb.getRequestsToday(userId);
  if (requestsHoy >= 6) {
    return responder('papi relájate un poco 😂 hazlas primero y luego pides más que me causas jaleo bebé 💋 cuando las tengas listas sigue pidiendo');
  }

  // Solo negocios donde el usuario no ha agotado su cupo personal
  const conteo = asignDb.getCountPerNegocio(userId);
  const disponibles = db.getActive().filter(n => (conteo[n.id] || 0) < n.total);
  if (!disponibles.length) {
    return responder('⚠️ No hay reseñas disponibles ahora. El administrador añadirá negocios pronto.');
  }

  // Rotar: primero el negocio al que este usuario menos ha hecho
  const negocio = disponibles.slice().sort((a, b) => (conteo[a.id] || 0) - (conteo[b.id] || 0))[0];
  const restanteUsuario = negocio.total - (conteo[negocio.id] || 0);
  const restanteGlobal  = negocio.total - negocio.hechas;
  const cantidad = Math.min(pedida, restanteUsuario, restanteGlobal);

  await responder(construirMensajePedir(negocio, cantidad));
  asignDb.add({ negocio_id: negocio.id, user_id: userId, user_tag: userTag, canal_id: canalId, cantidad });
  await notificar(`📋 *Nueva asignación*\n👤 ${userTag}\n🏪 ${negocio.nombre}\n📝 ${cantidad} reseñas`);
}

function getSemanaActual() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0=Dom … 6=Sáb
  const diasDesdeSabado = dia === 6 ? 0 : dia + 1;
  const sabado = new Date(hoy);
  sabado.setDate(hoy.getDate() - diasDesdeSabado);
  sabado.setHours(0, 0, 0, 0);
  const viernes = new Date(sabado);
  viernes.setDate(sabado.getDate() + 6);
  viernes.setHours(23, 59, 59, 999);
  return { desde: sabado.toISOString(), hasta: viernes.toISOString() };
}

async function revisarTicket(numeroTicket, guild, responder) {
  await guild.channels.fetch();
  const canal = guild.channels.cache.find(ch => ch.name === `ticket-${numeroTicket}`);
  if (!canal) return responder(`❌ No encontré el canal \`ticket-${numeroTicket}\`.`);

  const { desde, hasta } = getSemanaActual();
  const enlaces = reseñasDb.getByCanal(canal.id, desde, hasta);

  const fDesde = new Date(desde).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'short' });
  const fHasta = new Date(hasta).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'short' });

  if (!enlaces.length) {
    return responder(`📭 **ticket-${numeroTicket}** no tiene reseñas registradas entre el ${fDesde} y el ${fHasta}.`);
  }

  let msg = `📋 **Reseñas de ticket-${numeroTicket}** (${fDesde} → ${fHasta})\n`;
  msg += `Total: **${enlaces.length}** enlace(s)\n\n`;

  for (const r of enlaces) {
    const icono = r.valida === 1 ? '✅' : r.valida === 0 ? '❌' : '⏳';
    const fecha = new Date(r.fecha).toLocaleDateString('es-ES');
    msg += `${icono} ${r.user_tag} · ${fecha}\n${r.enlace}\n\n`;
  }

  // Discord tiene límite de 2000 chars; dividir si hace falta
  const chunks = [];
  while (msg.length > 1900) {
    const corte = msg.lastIndexOf('\n\n', 1900);
    chunks.push(msg.slice(0, corte));
    msg = msg.slice(corte).trimStart();
  }
  chunks.push(msg);

  for (const chunk of chunks) await responder(chunk);
}

// ── INTERACTION HANDLERS ──────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const reply = (msg) => interaction.replied ? interaction.followUp({ content: msg }) : interaction.reply({ content: msg });

    if (['pedir', 'trustpilot', 'tripadvisor', 'otros', 'avisar'].includes(interaction.commandName)) {
      if (!PATRON_TICKET.test(interaction.channel?.name)) {
        return interaction.reply({ content: '❌ Este comando solo se puede usar en tu ticket personal (`ticket-XXXX`).', ephemeral: true });
      }
    }

    if (interaction.commandName === 'revisar') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Solo los administradores pueden usar este comando.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const num = interaction.options.getInteger('ticket');
      await revisarTicket(num, interaction.guild, (msg) => interaction.followUp({ content: msg, ephemeral: true }));
      return;
    }

    if (interaction.commandName === 'pedir') {
      const cantidad = interaction.options.getInteger('cantidad');
      await procesarPedir(interaction.user.id, interaction.user.tag, interaction.channelId, cantidad, reply);
    }

    if (interaction.commandName === 'reporte') {
      await interaction.deferReply({ ephemeral: true });
      const todos = db.getAll();
      const stats = db.stats();
      const pct   = stats.necesarias > 0 ? Math.round((stats.hechas / stats.necesarias) * 100) : 0;
      let texto = `📊 **Reporte** | 🏪 ${stats.negocios} negocios | ✅ ${stats.hechas}/${stats.necesarias} (${pct}%)\n\n`;
      todos.slice(0, 8).forEach(n => {
        const p    = n.total > 0 ? Math.round((n.hechas / n.total) * 100) : 0;
        const icon = !n.activo ? '⏸️' : p >= 100 ? '✅' : p >= 50 ? '🟡' : '🔴';
        texto += `${icon} **${n.nombre}** — ${n.hechas}/${n.total} (${p}%)\n`;
      });
      const ia = await analizar(todos, stats);
      if (ia) texto += `\n🤖 **IA:**\n${ia}`;
      await interaction.editReply({ content: texto });
    }

    const PLATAFORMAS = { trustpilot: 'Trustpilot', tripadvisor: 'TripAdvisor', otros: 'Otras plataformas' };
    if (PLATAFORMAS[interaction.commandName]) {
      const plataforma = PLATAFORMAS[interaction.commandName];
      await notificar(`📢 *Reseña en ${plataforma}*\n👤 ${interaction.user.tag}\n📌 Canal: ${interaction.channel?.name}`);
      await reply(`✅ Avisado al admin de tu reseña en **${plataforma}**. ¡Gracias!`);
    }

    if (interaction.commandName === 'avisar') {
      const extra = interaction.options.getString('mensaje') || '';
      await notificar(`🚨 *Aviso urgente*\n👤 ${interaction.user.tag}\n📌 Canal: ${interaction.channel?.name}${extra ? `\n💬 ${extra}` : ''}`);
      await reply('✅ Admin avisado. Te atenderá lo antes posible.');
    }
  } catch (err) {
    console.error('[Slash]', err.message);
    try { interaction.replied ? interaction.followUp({ content: '❌ Error.', ephemeral: true }) : interaction.reply({ content: '❌ Error.', ephemeral: true }); } catch {}
  }
});

// ── MENSAJE HANDLER ───────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const texto = message.content.trim();

  // /pedir N
  if (texto.startsWith('/pedir')) {
    if (!PATRON_TICKET.test(message.channel.name)) {
      return message.reply('❌ Este comando solo se puede usar en tu ticket personal (`ticket-XXXX`).');
    }
    const n = parseInt(texto.split(/\s+/)[1], 10);
    return procesarPedir(
      message.author.id, message.author.tag, message.channel.id, n,
      (msg) => message.reply(msg)
    );
  }

  // /revisar <número> (solo admins, cualquier canal)
  if (texto.startsWith('/revisar')) {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo los administradores pueden usar este comando.');
    }
    const num = parseInt(texto.split(/\s+/)[1], 10);
    if (isNaN(num)) return message.reply('❌ Indica el número del ticket. Ej: `/revisar 83`');
    return revisarTicket(num, message.guild, (msg) => message.channel.send(msg));
  }

  // /reporte
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

  // /trustpilot /tripadvisor /otros
  const PLATAFORMAS_TEXT = { '/trustpilot': 'Trustpilot', '/tripadvisor': 'TripAdvisor', '/otros': 'Otras plataformas' };
  if (PLATAFORMAS_TEXT[texto]) {
    if (!PATRON_TICKET.test(message.channel.name)) {
      return message.reply('❌ Este comando solo se puede usar en tu ticket personal (`ticket-XXXX`).');
    }
    const plataforma = PLATAFORMAS_TEXT[texto];
    await notificar(`📢 *Reseña en ${plataforma}*\n👤 ${message.author.tag}\n📌 Canal: ${message.channel.name}`);
    return message.reply(`✅ Avisado al admin de tu reseña en **${plataforma}**. ¡Gracias!`);
  }

  // /avisar [mensaje]
  if (texto.startsWith('/avisar')) {
    if (!PATRON_TICKET.test(message.channel.name)) {
      return message.reply('❌ Este comando solo se puede usar en tu ticket personal (`ticket-XXXX`).');
    }
    const extra = texto.replace('/avisar', '').trim();
    await notificar(`🚨 *Aviso urgente*\n👤 ${message.author.tag}\n📌 Canal: ${message.channel.name}${extra ? `\n💬 ${extra}` : ''}`);
    return message.reply('✅ Admin avisado. Te atenderá lo antes posible.');
  }

  // /enviar_bienvenida (solo admin)
  if (texto === '/enviar_bienvenida') {
    await message.reply('📢 Enviando mensaje de bienvenida a todos los tickets...');
    await enviarBienvenidaBot();
    return message.reply('✅ Mensaje enviado a todos los tickets.');
  }

  // /telegram_test
  if (texto === '/telegram_test') {
    const ok = await notificar('✅ *Prueba de Telegram* — Bot conectado.');
    return message.reply(ok ? '✅ Mensaje enviado a Telegram.' : '❌ Falla Telegram. Revisa variables en Railway.');
  }

  // /audio_test
  if (texto === '/audio_test') {
    await message.reply('🎙️ Generando audio...');
    const ok = await notificarAudio('Hola. Prueba de audio del bot RSMoney. Todo funciona correctamente.');
    return message.reply(ok ? '✅ Audio enviado.' : '❌ Error enviando audio.');
  }

  // Solo tickets a partir de aquí
  if (!PATRON_TICKET.test(message.channel.name)) return;

  // Links de Google Maps → validar automáticamente
  const links = extraerLinks(message.content);
  if (links.length) {
    for (const link of links) {
      const res = await verificar(link, message.author.id, message.author.tag, message.channel.id);
      await message.reply(res.msg);
      if (res.estado !== 'valida') {
        await notificar(`${res.estado === 'duplicada' ? '⚠️' : '❌'} *Reseña ${res.estado}*\n👤 ${message.author.tag}\n🔗 ${link}`);
      }
    }
    return;
  }

  // Mensaje de texto sin comando → personalidad + redirigir a /avisar
  if (!texto.startsWith('/')) {
    const resp = RESPUESTAS_RANDOM[Math.floor(Math.random() * RESPUESTAS_RANDOM.length)];
    return message.reply(resp);
  }
});

client.on('error', err => console.error('[Discord]', err.message));

client.once('ready', async () => {
  console.log(`✅ Bot conectado: ${client.user.tag}`);
  await registrarComandos();

  cron.schedule('0 15 * * 4',           enviarJueves, { timezone: 'Europe/Madrid' });
  cron.schedule('0 15 * * 0,1,2,3,5,6', enviarDiario, { timezone: 'Europe/Madrid' });
  iniciarReporteDiario();

  console.log('⏰ Schedulers activos');
  await notificar(`🟢 *Bot online*\n🤖 ${client.user.tag}`);

  // Enviar instrucciones a todos los tickets al arrancar
  await enviarBienvenidaBot();
});

module.exports = client;
