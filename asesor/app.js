import { PREGUNTAS, preguntasVisibles, recomendar, esRecomendable } from "./engine.js";
import { esc, esquema, tarjeta, fuentes } from "./vista.js";

const app = document.getElementById("app");
const config = await fetch("config.json").then(r => (r.ok ? r.json() : {})).catch(() => ({}));
const demo = new URLSearchParams(location.search).has("demo") || config.demo === true;
let cortes = [], respuestas = {}, paso = 0, editando = false, manifiesto = {}, resultados = [], comparar = new Set();

// ---- datos ----
async function cargar() {
  if (demo) { document.getElementById("demo").hidden = false; cortes = (await (await fetch("demo.json")).json()).cortes; return; }
  try { const r = await fetch("/api/cortes"); if (!r.ok) throw 0; cortes = await r.json(); }
  catch { cortes = (await (await fetch("catalogo.json")).json()).cortes; }
}
// Fotos de las opciones (solo si existen Y declaran de quién son / permiso). Si no, se usan esquemas o texto.
async function cargarManifiesto() {
  try { const m = await (await fetch("assets/opciones/manifest.json")).json();
    manifiesto = Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.src && v.alt && v.derechos && /^[\w./-]+$/.test(v.src))); } catch { manifiesto = {}; }
}
// ---- guardados (solo en este dispositivo) ----
const leerG = () => { try { return JSON.parse(localStorage.getItem("lv-guardados") || "[]"); } catch { return []; } };
const escribirG = l => { try { localStorage.setItem("lv-guardados", JSON.stringify(l)); } catch { /* sin almacenamiento: no pasa nada */ } };
const hayVerificadas = () => cortes.some(esRecomendable);
const montar = (html, titulo = "h2") => { app.innerHTML = `<div class="paso">${html}</div>`; const h = app.querySelector(titulo); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } window.scrollTo({ top: 0 }); };

// ---- inicio ----
function inicio() {
  respuestas = {}; paso = 0; editando = false; comparar.clear();
  const g = leerG();
  montar(`<section class="hero"><div class="hero-img" id="heroImg"><img src="assets/logo.jpg" alt="Logo de Las Vegas Barbería"></div>
    <p class="kicker">Las Vegas Haircuts</p><h1 id="t">Descubrí tu próximo corte</h1>
    <p class="lead">Respondé unas preguntas sobre tu cabello y tu estilo, y te mostramos opciones respaldadas por información profesional.</p>
    ${hayVerificadas() ? "" : `<div class="aviso">Estamos revisando con profesionales la información de cada corte. Todavía no hay recomendaciones disponibles, pero podés hacer el cuestionario y explorar el catálogo.</div>`}
    <button class="cta" id="ir">Descubrir mi corte</button>
    <button class="ghost block" id="cat">Explorar el catálogo</button>
    <ul class="puntos"><li>Menos de 2 minutos</li><li>Sin registro</li><li>No guardamos tus respuestas</li></ul>
    ${g.length ? `<div class="guardados"><h4>Tus cortes guardados (en este dispositivo)</h4><ul>${g.map(x => `<li class="chip">${esc(x.nombre)}</li>`).join("")}</ul></div>` : ""}</section>`, "h1");
  app.querySelector("#ir").onclick = () => pregunta(); app.querySelector("#cat").onclick = catalogo;
  // Imagen protagonista: solo si el local sube assets/hero.jpg (foto propia o con permiso). Si no existe, queda el logo.
  const im = new Image(); im.onload = () => { const h = document.getElementById("heroImg"); if (h) { h.innerHTML = ""; h.append(Object.assign(im, { alt: "Interior de Las Vegas Barbería" })); } }; im.src = "assets/hero.jpg";
}

// ---- cuestionario ----
const siguientePendiente = () => preguntasVisibles(respuestas).findIndex(p => !respuestas[p.id]);
function pregunta() {
  const vis = preguntasVisibles(respuestas);
  if (paso >= vis.length) return resumen();
  const p = vis[paso], actual = respuestas[p.id];
  const dosCol = p.opciones.length >= 4 && !p.visual && p.opciones.every(o => o.t.length < 22 && !o.d);
  const media = o => {
    const f = manifiesto[p.id + ":" + o.v];
    if (f) return `<img class="foto-op" src="${esc(f.src)}" alt="${esc(f.alt)}" width="${+f.w || 480}" height="${+f.h || 291}" decoding="async">`;
    return p.visual && o.v !== "no_se" ? esquema(p.visual, o.v) : "";
  };
  const hayEsq = p.visual && p.opciones.some(o => o.v !== "no_se");
  const conFotos = p.opciones.every(o => manifiesto[p.id + ":" + o.v]);
  // Variantes de referencia (opcionales, no son respuestas): solo para la pregunta de tipo de cabello.
  const variantes = p.id === "pelo" && conFotos ? `<details class="variantes"><summary>Ver más ejemplos de cada tipo</summary>
      <p class="nota-esq">Imágenes ilustrativas generadas con IA, solo de referencia. Elegí arriba el tipo que más se parezca.</p>
      ${p.opciones.map((o, i) => `<div class="var-fila"><b>${esc(o.t)}</b><div class="var-fotos">${"abcd".split("").map(l => `<img src="assets/opciones/pelo/${i + 1}${l}.webp" alt="" loading="lazy" decoding="async" width="480" height="291">`).join("")}</div></div>`).join("")}</details>` : "";
  montar(`<div class="cabecera"><button class="atras" id="atras" aria-label="${paso || editando ? "Volver" : "Volver al inicio"}">←</button>
      <div class="prog"><small id="pp" aria-live="polite">Pregunta <b>${paso + 1}</b> de ${vis.length}</small><div class="bar" role="progressbar" aria-label="Progreso" aria-valuemin="1" aria-valuemax="${vis.length}" aria-valuenow="${paso + 1}"><i style="width:${Math.round(100 * (paso + 1) / vis.length)}%"></i></div></div></div>
    <div class="pregunta"><h2 id="q">${esc(p.titulo)}</h2>${p.ayuda ? `<p class="ayuda">${esc(p.ayuda)}</p>` : ""}
    <div class="opts${conFotos ? " con-fotos" : dosCol ? " dos" : ""}" role="group" aria-labelledby="q">${p.opciones.map(o => `<button class="opt${o.v === "no_se" ? " ns" : ""}" data-v="${esc(o.v)}" aria-pressed="${actual === o.v}">${media(o)}<span class="tx"><b>${esc(o.t)}</b>${o.d ? `<span class="d">${esc(o.d)}</span>` : ""}</span></button>`).join("")}</div>${variantes}
    ${hayEsq && !Object.keys(manifiesto).some(k => k.startsWith(p.id + ":")) ? `<p class="nota-esq">Los dibujos son esquemas ilustrativos, no fotografías.</p>` : ""}</div>`);
  app.querySelectorAll(".opt").forEach(b => b.onclick = () => responder(p, b));
  app.querySelector("#atras").onclick = () => { if (editando) return resumen(); if (paso) { paso--; pregunta(); } else inicio(); };
}
function responder(p, boton) {
  respuestas[p.id] = boton.dataset.v;
  if (p.id === "laterales" && respuestas.laterales === "tijera") { delete respuestas.altura; delete respuestas.transicion; }
  app.querySelectorAll(".opt").forEach(b => b.setAttribute("aria-pressed", String(b === boton)));
  const ir = () => {
    if (editando) { const i = siguientePendiente(); if (i >= 0) { paso = i; return pregunta(); } return resumen(); }
    paso++; pregunta();
  };
  matchMedia("(prefers-reduced-motion: reduce)").matches ? ir() : setTimeout(ir, 170);
}

// ---- resumen (permite cambiar cualquier respuesta) ----
function resumen() {
  editando = false;
  const vis = preguntasVisibles(respuestas), pend = vis.some(p => !respuestas[p.id]);
  montar(`<div class="cabecera"><button class="atras" id="atras" aria-label="Volver a la última pregunta">←</button><div class="prog"><small>Último paso</small><div class="bar"><i style="width:100%"></i></div></div></div>
    <div class="pregunta"><h2>Revisá tus respuestas</h2><p class="ayuda">Podés cambiar cualquiera antes de ver tus cortes.</p>
    <div class="resumen-lista">${vis.map((p, i) => { const o = p.opciones.find(o => o.v === respuestas[p.id]);
      return `<div class="fila${o ? "" : " falta"}"><div><small>${esc(p.titulo.replace(/[¿?]/g, ""))}</small><b>${o ? esc(o.t) : "Sin responder"}</b></div><button data-i="${i}" aria-label="Cambiar: ${esc(p.titulo)}">Cambiar</button></div>`; }).join("")}</div>
    <button class="cta" id="ver" ${pend ? "disabled" : ""}>Ver mis cortes</button></div>`);
  app.querySelector("#atras").onclick = () => { paso = Math.max(0, vis.length - 1); pregunta(); };
  app.querySelectorAll(".fila button").forEach(b => b.onclick = () => { editando = true; paso = +b.dataset.i; pregunta(); });
  app.querySelector("#ver").onclick = resultado;
}

// ---- resultados ----
function resultado() {
  const r = recomendar(respuestas, cortes); resultados = r.recomendaciones; comparar.clear();
  if (r.estado !== "ok") {
    return montar(`<h2>${r.estado === "sin_verificadas" ? "Todavía no hay recomendaciones" : "Sin coincidencias"}</h2><div class="aviso">${esc(r.mensaje)}</div>
      <button class="cta" id="cat">Explorar el catálogo</button><button class="ghost block" id="rep">Volver a empezar</button>`)
      || (app.querySelector("#cat").onclick = catalogo, app.querySelector("#rep").onclick = inicio);
  }
  const g = leerG().map(x => x.slug);
  montar(`<h2>${resultados.length === 1 ? "Tu opción" : `Tus ${resultados.length} opciones`}</h2>
    <p class="ayuda">Ordenadas de la que más se ajusta a la que menos. Es una orientación: tu barbero te confirma el resultado.</p>
    ${resultados.map((x, i) => tarjeta(x, { demo, indice: i + 1, controles: `<div class="acciones"><button class="ghost guardar" data-s="${esc(x.corte.slug)}" aria-pressed="${g.includes(x.corte.slug)}">${g.includes(x.corte.slug) ? "♥ Guardado" : "♡ Guardar"}</button>
      ${resultados.length > 1 ? `<label><input type="checkbox" class="cmp" data-s="${esc(x.corte.slug)}"> Comparar</label>` : ""}</div>` })).join("")}
    ${resultados.length > 1 ? `<button class="cta comparar" id="cmp" hidden>Comparar seleccionados</button>` : ""}
    <p class="footer-nota">Guardar solo marca el corte en este dispositivo. No enviamos nada a ningún servidor.</p>
    <button class="ghost block" id="mod">Cambiar mis respuestas</button><button class="ghost block" id="cat">Explorar el catálogo</button><button class="ghost block" id="rep">Volver a empezar</button>`);
  app.querySelectorAll(".guardar").forEach(b => b.onclick = () => {
    const x = resultados.find(r => r.corte.slug === b.dataset.s); let l = leerG();
    l = l.some(y => y.slug === x.corte.slug) ? l.filter(y => y.slug !== x.corte.slug) : [...l, { slug: x.corte.slug, nombre: x.corte.nombre }];
    escribirG(l); const on = l.some(y => y.slug === x.corte.slug); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "♥ Guardado" : "♡ Guardar";
  });
  const bc = app.querySelector("#cmp");
  app.querySelectorAll(".cmp").forEach(c => c.onchange = () => { c.checked ? comparar.add(c.dataset.s) : comparar.delete(c.dataset.s); bc.hidden = comparar.size < 2; bc.textContent = `Comparar ${comparar.size} cortes`; });
  if (bc) bc.onclick = tablaComparar;
  app.querySelector("#mod").onclick = resumen; app.querySelector("#cat").onclick = catalogo; app.querySelector("#rep").onclick = inicio;
}
function tablaComparar() {
  const xs = resultados.filter(x => comparar.has(x.corte.slug)), T = { poco: "Menos de 5 min", medio: "5 a 15 min", mucho: "Más de 15 min" };
  const fila = (t, f) => `<tr><th scope="row">${t}</th>${xs.map(x => `<td>${f(x) || "—"}</td>`).join("")}</tr>`;
  const d = document.createElement("dialog"); d.setAttribute("aria-label", "Comparación de cortes");
  d.innerHTML = `<h3>Comparar</h3><div class="tabla"><table><thead><tr><th></th>${xs.map(x => `<th scope="col">${esc(x.corte.nombre)}</th>`).join("")}</tr></thead><tbody>
    ${fila("Coincide con", x => `${x.razones.filter(r => r.ok).length} de ${x.razones.length} cosas`)}${fila("Mantenimiento", x => esc(x.corte.mantenimiento))}
    ${fila("Tiempo de peinado", x => T[x.corte.tiempo_peinado] || "")}${fila("Variante cercana", x => esc(x.variante?.nombre))}${fila("Fuentes", x => String(x.respaldo.length))}</tbody></table></div>
    <button class="ghost block" autofocus>Cerrar</button>`;
  d.querySelector("button").onclick = () => d.close(); d.onclose = () => d.remove(); document.body.append(d); d.showModal();
}

// ---- catálogo ----
function catalogo() {
  const etq = { verificado: "Verificada", pendiente: "En revisión", borrador: "En preparación" };
  montar(`<div class="cabecera"><button class="atras" id="atras" aria-label="Volver al inicio">←</button><h2 style="margin-left:6px">Catálogo</h2></div>
    ${hayVerificadas() ? "" : `<div class="aviso">Las fichas están en revisión: por ahora mostramos solo los nombres.</div>`}
    <div class="lista-cat">${cortes.map(c => `<div class="card"><div class="row"><b>${esc(c.nombre)}</b><span class="badge ${esc(c.estado)}">${etq[c.estado] || ""}</span></div>
      ${esRecomendable(c) ? `<details><summary>Ver ficha</summary>${c.descripcion ? `<p>${esc(c.descripcion)}</p>` : ""}${c.caracteristicas ? `<p class="small">${esc(c.caracteristicas)}</p>` : ""}${fuentes(c.fuentes)}</details>` : ""}</div>`).join("")}</div>`);
  app.querySelector("#atras").onclick = inicio;
}

await Promise.all([cargar(), cargarManifiesto()]);
inicio();
