let genAI;

if (process.env.GEMINI_API_KEY) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('[Gemini] Listo');
  } catch (e) {
    console.warn('[Gemini] Error:', e.message);
  }
}

async function analizar(negocios, stats) {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(`Eres un asistente de negocio que analiza reseñas de Google Maps.
Genera un reporte conciso en español (máx 200 palabras) con:
- Progreso general
- Negocios más urgentes (alta prioridad + pocas hechas)
- Recomendaciones

Stats: ${JSON.stringify(stats)}
Negocios: ${JSON.stringify(negocios.map(n => ({ nombre: n.nombre, hechas: n.hechas, total: n.total, prioridad: n.prioridad, activo: n.activo })))}`);
    return result.response.text();
  } catch (err) {
    console.error('[Gemini]', err.message);
    return null;
  }
}

async function analizarMensaje(texto, contexto) {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(`Contexto del servidor de reseñas de Google Maps: ${contexto}\n\nMensaje a analizar: ${texto}\n\n¿Hay algo importante o urgente aquí? Responde en máximo 2 frases en español.`);
    return result.response.text();
  } catch (err) {
    return null;
  }
}

module.exports = { analizar, analizarMensaje };
