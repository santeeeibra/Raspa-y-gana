// Motor de recomendaciones de LAS VEGAS: puntaje explicable, sin IA generativa.
// Se usa igual en el navegador y en el Worker (módulo ES sin dependencias).

export const CAMPOS_LISTA = ["pelos", "largos", "estilos", "entradas", "densidades", "volumenes", "laterales", "alturas", "transiciones"];
const NS = "no_se";

export const PREGUNTAS = [
  { id: "pelo", titulo: "¿Cómo es tu cabello?", campo: "pelos", ayuda: "Elegí el tipo que más se parece a tu pelo natural, sin peinar.", opciones: [
    { v: "lacio", t: "Lacio" }, { v: "ondulado", t: "Ondulado" }, { v: "rizado", t: "Rizado" }, { v: "muy_rizado", t: "Muy rizado / afro" }] },
  { id: "largo", titulo: "¿Qué largo tenés actualmente?", campo: "largos", ayuda: "Elegí la imagen que más se parece al largo de tu pelo hoy. Las medidas son orientativas.", opciones: [
    { v: "muy_corto", t: "Muy corto", d: "aprox. 0 a 2 cm" }, { v: "corto", t: "Corto", d: "aprox. 2 a 5 cm" }, { v: "medio", t: "Medio", d: "aprox. 5 a 12 cm" }, { v: "largo", t: "Largo", d: "más de 12 cm" }] },
  { id: "estilo", titulo: "¿Qué estilo buscás?", campo: "estilos", ayuda: "Pensá en cómo querés verte todos los días.", opciones: [
    { v: "clasico", t: "Clásico y prolijo" }, { v: "moderno", t: "Moderno" }, { v: "natural", t: "Natural, sin esfuerzo" }, { v: "atrevido", t: "Distinto, que se note" }] },
  { id: "entradas", titulo: "¿Qué hacemos con las entradas?", campo: "entradas", ayuda: "Las entradas son los huecos a los costados de la frente. Contanos qué es más importante para vos.", opciones: [
    { v: "cuidar", t: "Quiero cuidarlas / disimularlas", d: "Que el corte las tenga en cuenta" }, { v: "volumen", t: "Prefiero conservar el volumen", d: "Mantener cuerpo arriba y adelante" }, { v: "indiferente", t: "No me preocupan", d: "Que decida el estilo" }] },
  { id: "densidad", titulo: "¿Qué tan espeso es tu cabello?", campo: "densidades", tecnica: true, ayuda: "Cuánto pelo tenés por zona: se nota al mirar el cuero cabelludo.", opciones: [
    { v: "rala", t: "Poco denso" }, { v: "normal", t: "Normal" }, { v: "espesa", t: "Muy denso" }] },
  { id: "volumen", titulo: "¿Cuánto volumen querés arriba?", campo: "volumenes", tecnica: true, ayuda: "El volumen es la altura y el cuerpo del pelo en la parte de arriba.", opciones: [
    { v: "bajo", t: "Poco" }, { v: "medio", t: "Medio" }, { v: "alto", t: "Mucho" }] },
  { id: "laterales", titulo: "¿Cómo querés los laterales?", campo: "laterales", tecnica: true, visual: "laterales", ayuda: "Degradado: la máquina deja el pelo cada vez más corto hacia abajo. Tijera: el largo cambia de forma pareja, sin ese efecto.", opciones: [
    { v: "degradado", t: "Degradado", d: "con máquina" }, { v: "tijera", t: "Con tijera", d: "sin degradado" }] },
  { id: "altura", titulo: "¿A qué altura va el degradado?", campo: "alturas", tecnica: true, visual: "altura", ayuda: "Es el punto donde el pelo empieza a acortarse a los costados.", cuando: r => r.laterales !== "tijera", opciones: [
    { v: "bajo", t: "Bajo", d: "cerca de la oreja" }, { v: "medio", t: "Medio" }, { v: "alto", t: "Alto", d: "casi en la sien" }] },
  { id: "transicion", titulo: "¿Cómo querés la transición del degradado?", campo: "transiciones", tecnica: true, visual: "transicion", ayuda: "Es qué tan rápido o gradual pasa del pelo largo al corto.", cuando: r => r.laterales !== "tijera", opciones: [
    { v: "comprimida", t: "Comprimida", d: "cambio rápido y marcado" }, { v: "equilibrada", t: "Equilibrada" }, { v: "estirada", t: "Estirada", d: "cambio suave y gradual" }] },
  { id: "tiempo", titulo: "¿Cuánto tiempo tenés para peinarte?", campo: "tiempo_peinado", opciones: [
    { v: "poco", t: "Menos de 5 minutos" }, { v: "medio", t: "Entre 5 y 15 minutos" }, { v: "mucho", t: "Más de 15 minutos" }] },
];
for (const p of PREGUNTAS) if (p.tecnica) p.opciones.push({ v: NS, t: "No sé, recomendame" });

// Peso de cada criterio y frase para explicarlo
const CRITERIOS = {
  pelo:       { peso: 3,   ok: "es compatible con cabello {r}",              no: "no está indicado para cabello {r}" },
  largo:      { peso: 3,   ok: "se puede hacer con tu largo actual ({r})",   no: "necesita otro largo del que tenés hoy ({r})" },
  estilo:     { peso: 2,   ok: "va con el estilo que buscás ({r})",          no: "no está asociado al estilo que buscás ({r})" },
  entradas:   { peso: 2,   ok: "responde a lo que querés con las entradas",  no: "no está pensado para lo que querés con las entradas" },
  densidad:   { peso: 1,   ok: "funciona con densidad {r}",                  no: "no figura como adecuado para densidad {r}" },
  volumen:    { peso: 1,   ok: "permite el volumen que buscás ({r})",        no: "no coincide con el volumen que buscás ({r})" },
  laterales:  { peso: 2,   ok: "se hace con laterales en {r}",               no: "no se hace con laterales en {r}" },
  altura:     { peso: 1.5, ok: "admite degradado {r}",                       no: "no figura con degradado {r}" },
  transicion: { peso: 1,   ok: "admite transición {r}",                      no: "no figura con transición {r}" },
  tiempo:     { peso: 2,   ok: "se peina en el tiempo que tenés ({r})",      no: "pide más tiempo de peinado del que tenés ({r})" },
};
const ETIQ = Object.fromEntries(PREGUNTAS.flatMap(p => p.opciones.map(o => [p.id + ":" + o.v, o.t.toLowerCase()])));
const etiqueta = (id, v) => ETIQ[id + ":" + v] || v;
const CAMPO_DE = Object.fromEntries(PREGUNTAS.map(p => [p.id, p.campo]));
// "entradas" se responde con cuidar/volumen/indiferente, igual que la lista de la ficha
const HARD = new Set(["pelo", "largo"]); // si el dato de la ficha existe y no coincide, el corte se descarta

export const preguntasVisibles = r => PREGUNTAS.filter(p => !p.cuando || p.cuando(r));

/** Una ficha solo se recomienda si está verificada, publicada y tiene fuentes con enlace https. */
export function esRecomendable(c) {
  return c.estado === "verificado" && !!c.publicado &&
    Array.isArray(c.fuentes) && c.fuentes.length > 0 &&
    c.fuentes.every(f => f.autor && /^https:\/\//.test(f.url || ""));
}

function evaluar(corte, r) {
  const razones = []; let ganado = 0, posible = 0, descartado = null, sinDato = 0;
  for (const p of preguntasVisibles(r)) {
    const resp = r[p.id];
    if (!resp || resp === NS || (p.id === "entradas" && resp === "indiferente")) continue; // sin preferencia: no suma ni resta
    if (p.id === "altura" || p.id === "transicion") if (!(corte.laterales || []).includes("degradado") && (corte.laterales || []).length) continue;
    const valores = p.id === "tiempo" ? null : corte[CAMPO_DE[p.id]];
    let coincide;
    if (p.id === "tiempo") {
      if (!corte.tiempo_peinado) { sinDato++; continue; }
      const orden = ["poco", "medio", "mucho"]; // el corte pide <= tiempo disponible
      coincide = orden.indexOf(corte.tiempo_peinado) <= orden.indexOf(resp);
    } else {
      let lista = valores || [];
      if ((p.id === "altura" || p.id === "transicion") && corte.variantes?.length) {
        const k = p.id; lista = [...new Set([...lista, ...corte.variantes.map(v => v[k]).filter(Boolean)])];
      }
      if (!lista.length) { sinDato++; continue; }       // la ficha no dice nada: no se inventa
      coincide = lista.includes(resp);
    }
    const c = CRITERIOS[p.id]; posible += c.peso;
    if (coincide) ganado += c.peso;
    else if (HARD.has(p.id)) descartado = c.no.replace("{r}", etiqueta(p.id, resp));
    razones.push({ criterio: p.id, ok: coincide, texto: (coincide ? c.ok : c.no).replace("{r}", etiqueta(p.id, resp)) });
  }
  return { razones, ganado, posible, descartado, sinDato };
}

function mejorVariante(corte, r) {
  let mejor = null, mejorPts = 0;
  for (const v of corte.variantes || []) {
    let pts = 0;
    if (r.laterales && r.laterales !== NS && v.laterales === r.laterales) pts++;
    if (r.altura && r.altura !== NS && v.altura === r.altura) pts++;
    if (r.transicion && r.transicion !== NS && v.transicion === r.transicion) pts++;
    if (pts > mejorPts) { mejor = v; mejorPts = pts; }
  }
  return mejor;
}

/**
 * @param {object} respuestas  {pelo, largo, estilo, entradas, densidad, volumen, laterales, altura, transicion, tiempo}
 * @param {object[]} cortes    fichas completas (con variantes y fuentes)
 * @returns {{estado:string, mensaje:string, recomendaciones:object[], descartados:object[]}}
 */
export function recomendar(respuestas, cortes, { max = 3, minimo = 50 } = {}) {
  const verificados = cortes.filter(esRecomendable);
  if (!verificados.length) return { estado: "sin_verificadas", recomendaciones: [], descartados: [],
    mensaje: "Todavía no hay fichas verificadas por nuestro equipo, así que no te vamos a mostrar recomendaciones. Mientras tanto podés explorar el catálogo." };
  const out = [], descartados = [];
  for (const corte of verificados) {
    const e = evaluar(corte, respuestas);
    if (e.descartado) { descartados.push({ slug: corte.slug, nombre: corte.nombre, motivo: e.descartado }); continue; }
    if (!e.posible) continue; // no hay ningún dato para comparar
    const puntaje = Math.round(100 * e.ganado / e.posible);
    if (puntaje < minimo) { descartados.push({ slug: corte.slug, nombre: corte.nombre, motivo: `coincide solo en ${puntaje}% de lo que pediste` }); continue; }
    out.push({ corte, puntaje, razones: e.razones, criteriosEvaluados: e.razones.length, datosFaltantes: e.sinDato,
      variante: mejorVariante(corte, respuestas), respaldo: corte.fuentes });
  }
  out.sort((a, b) => b.puntaje - a.puntaje || b.criteriosEvaluados - a.criteriosEvaluados || a.corte.nombre.localeCompare(b.corte.nombre));
  const recomendaciones = out.slice(0, max);
  return recomendaciones.length
    ? { estado: "ok", mensaje: "", recomendaciones, descartados }
    : { estado: "sin_coincidencias", recomendaciones: [], descartados,
        mensaje: "Ninguna de nuestras fichas verificadas coincide bien con lo que elegiste. Probá cambiar alguna respuesta o consultanos en el local." };
}
