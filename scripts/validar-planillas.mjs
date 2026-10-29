// Valida datos/planillas/{Cortes,Variantes,Fuentes}.csv. Solo LEE: no toca el motor ni las preguntas.
// Uso: node scripts/validar-planillas.mjs [carpeta] [--exigir-publicable]
// Dos niveles: (1) ESTRUCTURA correcta del CSV (errores) y (2) ficha con información SUFICIENTE para pasar a revisión de
// publicación (listo). Una ficha puede tener estructura válida y aun así no estar lista. "Lista" no equivale a verificada ni publicada.
import { readFileSync } from "node:fs";
import { PREGUNTAS } from "../asesor/engine.js";

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const exigir = process.argv.includes("--exigir-publicable");
const dir = args[0] || new URL("../datos/planillas/", import.meta.url).pathname;
const errores = [], avisos = [];
const err = (m) => errores.push(m), avi = (m) => avisos.push(m);

function csv(nombre) {
  const t = readFileSync(dir + "/" + nombre, "utf8").replace(/^﻿/, "");
  const filas = []; let f = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { f.push(c); c = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; f.push(c); c = ""; if (f.some(x => x !== "")) filas.push(f); f = []; }
    else c += ch;
  }
  if (c !== "" || f.length) { f.push(c); filas.push(f); }
  const [cab, ...resto] = filas;
  return { cab, filas: resto.map((r, i) => ({ n: i + 2, ...Object.fromEntries(cab.map((k, j) => [k, (r[j] ?? "").trim()])) })) };
}

// Valores permitidos: salen de las preguntas del asesor (así nunca se desfasan)
const permitidos = {};
for (const p of PREGUNTAS) permitidos[p.campo] = p.opciones.map(o => o.v).filter(v => v !== "no_se");
const LISTAS = ["pelos", "largos", "estilos", "entradas", "densidades", "volumenes", "laterales", "alturas", "transiciones"];
const DATOS = [...LISTAS, "tiempo_peinado", "mantenimiento", "descripcion", "caracteristicas"];
const MARCAS = new Set(["?", "n/a", "todos"]);
const f = (c, x) => `${c}${x.slug ? " [" + x.slug + "]" : ""} fila ${x.n}`;

const C = csv("Cortes.csv"), V = csv("Variantes.csv"), F = csv("Fuentes.csv");
const falta = (cab, req, arch) => req.filter(k => !cab.includes(k)).forEach(k => err(`${arch}: falta la columna "${k}"`));
falta(C.cab, ["slug", "nombre", ...DATOS, "estado", "publicado", "notas_internas", "campos_deducidos", "observaciones_del_barbero"], "Cortes.csv");
falta(V.cab, ["slug", "nombre", "descripcion", "laterales", "altura", "transicion"], "Variantes.csv");
falta(F.cab, ["slug", "autor", "titulo", "url", "afirmacion", "campo", "fragmento", "consultada_en", "comprobada_abierta"], "Fuentes.csv");
if (errores.length) { salir(); }

const slugs = new Map();
const respaldado = new Set(F.filas.map(x => x.slug + "|" + x.campo));

for (const c of C.filas) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) err(`${f("slug inválido", c)}`);
  if (slugs.has(c.slug)) err(`${f("slug repetido", c)}`); slugs.set(c.slug, c);
  if (!c.nombre) err(`${f("sin nombre", c)}`);
  if (c.estado !== "borrador") err(`${f("estado debe ser 'borrador' (verificar se hace en el gestor)", c)}`);
  if (c.publicado !== "0") err(`${f("publicado debe ser 0", c)}`);
  for (const k of LISTAS) {
    const v = c[k]; if (v === "") { avi(`${f(k + " vacío: escribí ? o n/a", c)}`); continue; }
    const partes = v.split("|").map(s => s.trim());
    const marcas = partes.filter(p => MARCAS.has(p));
    if (marcas.length && partes.length > 1) err(`${f(k + ": '" + marcas[0] + "' no se mezcla con otros valores", c)}`);
    for (const p of partes) if (!MARCAS.has(p) && !permitidos[k].includes(p)) err(`${f(k + ": valor no permitido '" + p + "'", c)}`);
    if (new Set(partes).size !== partes.length) err(`${f(k + ": valor repetido", c)}`);
    if (v === "todos" && !respaldado.has(c.slug + "|" + k) && !c.observaciones_del_barbero) err(`${f(k + ": 'todos' sin justificar (fuente u observación del barbero)", c)}`);
  }
  const tp = c.tiempo_peinado;
  if (tp === "") avi(`${f("tiempo_peinado vacío: escribí ? o n/a", c)}`);
  else if (!MARCAS.has(tp) && !permitidos.tiempo_peinado.includes(tp)) err(`${f("tiempo_peinado no permitido '" + tp + "'", c)}`);
  const lat = c.laterales.split("|");
  if (lat.length === 1 && lat[0] === "tijera") for (const k of ["alturas", "transiciones"]) if (c[k] && !["n/a", "?"].includes(c[k])) err(`${f(k + " contradice laterales=tijera (usar n/a)", c)}`);
  const ded = c.campos_deducidos ? c.campos_deducidos.split("|") : [];
  for (const k of ded) {
    if (!DATOS.includes(k)) err(`${f("campos_deducidos: columna desconocida '" + k + "'", c)}`);
    else if (!c[k] || MARCAS.has(c[k])) avi(`${f("campos_deducidos incluye '" + k + "' pero está sin valor", c)}`);
    if (respaldado.has(c.slug + "|" + k)) avi(`${f("'" + k + "' figura como deducido pero ya tiene fuente", c)}`);
  }
  for (const k of DATOS) {
    const lleno = c[k] && !MARCAS.has(c[k]);
    if (lleno && !respaldado.has(c.slug + "|" + k) && !ded.includes(k)) err(`${f("'" + k + "' tiene valor pero ni fuente ni está en campos_deducidos", c)}`);
  }
}

const vistos = new Set(), nombres = new Set();
for (const v of V.filas) {
  const c = slugs.get(v.slug);
  if (!c) { err(`${f("variante con slug inexistente", v)}`); continue; }
  if (!v.nombre) err(`${f("variante sin nombre", v)}`);
  const kn = v.slug + "|" + v.nombre.toLowerCase(); if (nombres.has(kn)) err(`${f("nombre de variante repetido", v)}`); nombres.add(kn);
  const lim = (x) => (MARCAS.has(x) || x === "" ? "" : x);
  const L = lim(v.laterales), A = lim(v.altura), T = lim(v.transicion);
  if (L && !permitidos.laterales.includes(L)) err(`${f("laterales no permitido '" + L + "'", v)}`);
  if (A && !permitidos.alturas.includes(A)) err(`${f("altura no permitida '" + A + "'", v)}`);
  if (T && !permitidos.transiciones.includes(T)) err(`${f("transición no permitida '" + T + "'", v)}`);
  if (L === "tijera" && (A || T)) err(`${f("contradicción: tijera no lleva altura ni transición", v)}`);
  if ((A || T) && !L) err(`${f("altura/transición sin laterales (degradado)", v)}`);
  const kc = [v.slug, L, A, T].join("|"); if (vistos.has(kc)) err(`${f("combinación duplicada", v)}`); vistos.add(kc);
  const cmp = (campo, val, nom) => { const l = c[campo].split("|"); if (val && !MARCAS.has(c[campo]) && c[campo] !== "" && !l.includes(val)) err(`${f(nom + " '" + val + "' no figura en " + campo + " del corte", v)}`); };
  cmp("laterales", L, "laterales"); cmp("alturas", A, "altura"); cmp("transiciones", T, "transición");
}

for (const s of F.filas) {
  if (!slugs.has(s.slug)) err(`${f("fuente con slug inexistente", s)}`);
  if (!s.autor) err(`${f("fuente sin autor", s)}`);
  if (!/^https:\/\/\S+$/.test(s.url)) err(`${f("url debe empezar con https://", s)}`);
  if (!s.afirmacion) err(`${f("fuente sin afirmación", s)}`);
  if (!DATOS.includes(s.campo)) err(`${f("campo desconocido '" + s.campo + "'", s)}`);
  if (!s.fragmento) err(`${f("sin fragmento que respalde el dato", s)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.consultada_en)) err(`${f("consultada_en debe ser AAAA-MM-DD", s)}`);
  if (s.comprobada_abierta !== "si") err(`${f("comprobada_abierta debe ser 'si' (enlace abierto y leído)", s)}`);
  if (/catalog|shop|product|\/store/i.test(s.url)) avi(`${f("¿catálogo o tienda? no vale como evidencia técnica", s)}`);
}

// Campos sin los cuales no se debe publicar (vacío NO significa compatible)
const CRITICOS = ["pelos", "largos", "estilos", "entradas", "laterales", "tiempo_peinado", "mantenimiento", "descripcion"];
function motivosNoListo(c) {
  const m = [], vacio = k => !c[k] || c[k] === "?";
  const conFuente = k => F.filas.some(s => s.slug === c.slug && s.campo === k && s.comprobada_abierta === "si");
  for (const k of CRITICOS) if (vacio(k)) m.push(`${k} pendiente`);
  if (c.laterales.split("|").includes("degradado")) for (const k of ["alturas", "transiciones"]) if (vacio(k)) m.push(`${k} pendiente (hay degradado)`);
  for (const k of DATOS) if (c[k] && !MARCAS.has(c[k]) && !conFuente(k)) m.push(`${k} sin fuente comprobada (${(c.campos_deducidos || "").split("|").includes(k) ? "deducido" : "sin respaldo"})`);
  if (!F.filas.some(s => s.slug === c.slug && s.comprobada_abierta === "si")) m.push("ninguna fuente comprobada");
  return m;
}

function salir() {
  console.log(`\nCortes: ${C.filas.length} · Variantes: ${V.filas.length} · Fuentes: ${F.filas.length}`);
  if (avisos.length) console.log("\nAVISOS (" + avisos.length + ")\n" + avisos.map(x => " · " + x).join("\n"));
  if (errores.length) console.log("\nERRORES (" + errores.length + ")\n" + errores.map(x => " ✗ " + x).join("\n"));
  else console.log("\n✓ Formato válido: sin errores.");
  console.log("\nPARA EL BARBERO, POR CORTE");
  for (const c of (C?.filas || [])) {
    const ded = c.campos_deducidos ? c.campos_deducidos.split("|") : [];
    const pend = [...LISTAS, "tiempo_peinado", "mantenimiento", "descripcion", "caracteristicas"].filter(k => !c[k] || c[k] === "?");
    const resp = DATOS.filter(k => c[k] && !MARCAS.has(c[k]) && respaldado.has(c.slug + "|" + k));
    console.log(` ${c.nombre} [${c.estado}, publicado=${c.publicado}]\n   con fuente: ${resp.join(", ") || "(ninguno)"}\n   deducido, hay que aprobar: ${ded.join(", ") || "(ninguno)"}\n   pendiente (?): ${pend.join(", ") || "(ninguno)"}`);
  }
  console.log("\nNIVEL 2 · ¿INFORMACIÓN SUFICIENTE PARA REVISIÓN DE PUBLICACIÓN? (no verifica ni publica nada)");
  let noListas = 0;
  for (const c of (C?.filas || [])) {
    const m = errores.length ? ["corregir primero los errores"] : motivosNoListo(c);
    if (m.length) noListas++;
    console.log(` ${m.length ? "✗ PENDIENTE" : "✓ lista para revisión"} · ${c.nombre}${m.length ? "\n     " + m.join("\n     ") : ""}`);
  }
  process.exit(errores.length || (exigir && noListas) ? 1 : 0);
}
salir();
