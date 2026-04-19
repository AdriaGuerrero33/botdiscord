const axios = require('axios');
const { reseñas } = require('./database');

const MAPS_REGEX = /https?:\/\/(maps\.google\.[a-z.]+|www\.google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\S*/gi;

function extraerLinks(texto) {
  return [...(texto.matchAll(MAPS_REGEX) || [])].map(m => m[0]);
}

function esMaps(url) {
  return MAPS_REGEX.test(url);
}

async function verificar(enlace, userId, userTag, canalId) {
  // Comprobar duplicado
  const existente = reseñas.get(enlace);
  if (existente) {
    const fecha = new Date(existente.fecha).toLocaleDateString('es-ES');
    return {
      estado: 'duplicada',
      msg: `⚠️ **Reseña duplicada** — Este enlace ya fue enviado por <@${existente.user_id}> el ${fecha}.`,
    };
  }

  // Guardar en BD
  reseñas.add({ enlace, user_id: userId, user_tag: userTag, negocio_id: null, canal_id: canalId });

  // Verificar accesibilidad
  try {
    const res = await axios.get(enlace, {
      timeout: 8000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: () => true,
    });
    const valida = res.status < 400;
    reseñas.setValida(enlace, valida);
    if (valida) {
      return { estado: 'valida', msg: '✅ **Reseña registrada** — Enlace verificado correctamente.' };
    }
    return { estado: 'eliminada', msg: '❌ **Reseña no accesible** — Puede estar eliminada o ser inválida.' };
  } catch {
    reseñas.setValida(enlace, false);
    return { estado: 'eliminada', msg: '❌ **Reseña no accesible** — No se pudo verificar el enlace.' };
  }
}

module.exports = { verificar, extraerLinks, esMaps };
