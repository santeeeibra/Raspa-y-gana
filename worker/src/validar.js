import { PREGUNTAS, CAMPOS_LISTA } from "../../asesor/engine.js";

// Valores permitidos para cada lista, tomados del cuestionario (sin "no_se")
const PERMITIDOS = Object.fromEntries(PREGUNTAS.filter(p => CAMPOS_LISTA.includes(p.campo))
  .map(p => [p.campo, new Set(p.opciones.map(o => o.v).filter(v => v !== "no_se"))]));
PERMITIDOS.entradas = new Set(["cuidar", "volumen"]);
const TIEMPOS = new Set(["poco", "medio", "mucho"]);
const SOLO = { laterales: new Set(["degradado", "tijera"]), altura: new Set(["bajo", "medio", "alto"]), transicion: new Set(["comprimida", "equilibrada", "estirada"]) };

export class ErrorValidacion extends Error {}
const falla = m => { throw new ErrorValidacion(m); };
const texto = (v, max, nombre, req = false) => {
  const s = v == null ? "" : String(v).trim();
  if (req && !s) falla(`${nombre} es obligatorio`);
  if (s.length > max) falla(`${nombre} supera ${max} caracteres`);
  return s;
};
export const slugDe = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Devuelve solo los campos presentes en `b`, ya validados (sirve para crear y para editar). */
export function validarCorte(b, { crear = false } = {}) {
  const o = {};
  if (crear || "nombre" in b) o.nombre = texto(b.nombre, 80, "El nombre", true);
  for (const [k, max] of [["descripcion", 1000], ["caracteristicas", 1500], ["mantenimiento", 800], ["notas_internas", 2000]])
    if (k in b) o[k] = texto(b[k], max, k);
  if ("tiempo_peinado" in b) {
    if (b.tiempo_peinado && !TIEMPOS.has(b.tiempo_peinado)) falla("tiempo_peinado inválido");
    o.tiempo_peinado = b.tiempo_peinado || null;
  }
  for (const campo of CAMPOS_LISTA) if (campo in b) {
    if (!Array.isArray(b[campo])) falla(`${campo} debe ser una lista`);
    const bad = b[campo].find(v => !PERMITIDOS[campo].has(v));
    if (bad !== undefined) falla(`Valor no permitido en ${campo}: ${bad}`);
    o[campo] = JSON.stringify([...new Set(b[campo])]);
  }
  if ("publicado" in b) o.publicado = b.publicado ? 1 : 0;
  return o;
}
export function validarVariante(b) {
  const o = { nombre: texto(b.nombre, 80, "El nombre", true), descripcion: texto(b.descripcion, 500, "La descripción") };
  for (const k of ["laterales", "altura", "transicion"]) {
    if (b[k] && !SOLO[k].has(b[k])) falla(`${k} inválido`);
    o[k] = b[k] || null;
  }
  return o;
}
export function validarFuente(b) {
  const url = texto(b.url, 500, "El enlace", true);
  let u; try { u = new URL(url); } catch { falla("El enlace no es una URL válida"); }
  if (u.protocol !== "https:") falla("El enlace debe empezar con https://");
  const fecha = texto(b.consultada_en, 10, "La fecha");
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) falla("La fecha debe ser AAAA-MM-DD");
  return { autor: texto(b.autor, 120, "El autor", true), titulo: texto(b.titulo, 200, "El título"), url: u.href,
    afirmacion: texto(b.afirmacion, 500, "La afirmación respaldada"), consultada_en: fecha || null };
}
