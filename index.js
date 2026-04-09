require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const BOT_TOKEN        = process.env.BOT_TOKEN;
const CHANNEL_ANUNCIOS = process.env.CHANNEL_ANUNCIOS;
const CHANNEL_GENERAL  = process.env.CHANNEL_GENERAL;

const PATRON_TICKET = /^ticket-\d+$/;

const MENSAJE = `# Leer esto es muy importante.

Entregar todas las reseñas Mañana Viernes despues de este mensaje para que lo podamos contar bien antes de las 22:00 para que podamos hacer todo correctamente, sin confusiones.

Pasa todos los enlaces de lo que hayas hecho desde el sabado hasta hoy DESPUES de esté mensaje. SOBRETODO NO LO ENTREGEIS TARDE

@everyone`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function enviarMensaje() {
  console.log(`\n[${new Date().toISOString()}] Iniciando envio de mensajes...`);

  const guild = client.guilds.cache.first();
  if (!guild) {
    console.error('No se encontro ningun servidor.');
    return;
  }

  // Aseguramos que todos los canales estan cargados
  await guild.channels.fetch();

  // --- Canales fijos: anuncios y general ---
  for (const channelId of [CHANNEL_ANUNCIOS, CHANNEL_GENERAL]) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (channel && channel.isTextBased()) {
        await channel.send(MENSAJE);
        console.log(`[OK] Enviado a #${channel.name}`);
      } else {
        console.warn(`[WARN] Canal ${channelId} no encontrado o no es de texto`);
      }
    } catch (err) {
      console.error(`[ERROR] Canal ${channelId}: ${err.message}`);
    }
    await sleep(500);
  }

  // --- Todos los canales ticket-<numero> ---
  const tickets = guild.channels.cache.filter(
    ch => ch.isTextBased() && PATRON_TICKET.test(ch.name)
  );

  console.log(`Encontrados ${tickets.size} canales de tickets. Enviando...`);

  let enviados = 0;
  let errores  = 0;

  for (const [, channel] of tickets) {
    try {
      await channel.send(MENSAJE);
      enviados++;
      if (enviados % 10 === 0) {
        console.log(`  ${enviados}/${tickets.size} tickets completados...`);
      }
    } catch (err) {
      errores++;
      console.error(`[ERROR] ${channel.name}: ${err.message}`);
    }
    await sleep(500); // Respeta rate limits de Discord
  }

  console.log(`\nRESUMEN: ${enviados} tickets OK | ${errores} errores | Total: ${enviados + 2} canales`);
}

client.once('ready', async () => {
  console.log(`Bot conectado como: ${client.user.tag}`);
  console.log(`Servidor: ${client.guilds.cache.first()?.name}`);

  // Envio inmediato al arrancar (prueba)
  await enviarMensaje();

  // Scheduler: cada jueves a las 15:00 hora de Madrid
  cron.schedule('0 15 * * 4', enviarMensaje, {
    timezone: 'Europe/Madrid',
  });

  console.log('\nScheduler activo: proxima ejecucion automatica el jueves a las 15:00 (Madrid)');
});

client.on('error', err => console.error('Error del cliente Discord:', err.message));

client.login(process.env.BOT_TOKEN);
