require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const CHANNELS = [
  process.env.CHANNEL_ANUNCIOS,
  process.env.CHANNEL_GENERAL,
];

const MENSAJE = `# Leer esto es muy importante.

Entregar todas las reseñas Mañana Viernes despues de este mensaje para que lo podamos contar bien antes de las 22:00 para que podamos hacer todo correctamente, sin confusiones.

Pasa todos los enlaces de lo que hayas hecho desde el sabado hasta hoy DESPUES de esté mensaje. SOBRETODO NO LO ENTREGEIS TARDE

@everyone`;

async function enviarMensaje() {
  for (const channelId of CHANNELS) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await channel.send(MENSAJE);
        console.log(`[${new Date().toISOString()}] Mensaje enviado a canal ${channelId}`);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error enviando a canal ${channelId}:`, err.message);
    }
  }
}

client.once('ready', () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  // Cada jueves a las 15:00 hora de Madrid
  cron.schedule('0 15 * * 4', enviarMensaje, {
    timezone: 'Europe/Madrid',
  });

  console.log('Scheduler activo: mensajes cada jueves a las 15:00 (Madrid)');
});

client.login(process.env.BOT_TOKEN);
