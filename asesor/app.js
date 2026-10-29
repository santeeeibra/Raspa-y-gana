import { PREGUNTAS, preguntasVisibles, recomendar, esRecomendable } from "./engine.js";

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const demo = new URLSearchParams(location.search).has("demo");
let cortes = [], respuestas = {}, paso = 0, fuenteDatos = "";

async function cargar() {
  if (demo) { document.getElementById("demo").hidden = false; cortes = (await (await fetch("demo.json")).json()).cortes; fuenteDatos = "demo"; return; }
  try { const r = await fetch("/api/cortes"); if (!r.ok) throw 0; cortes = await r.json(); fuenteDatos = "api"; }
  catch { cortes = (await (await fetch("catalogo.json")).json()).cortes; fuenteDatos = "estatico"; }
}
const hayVerificadas = () => cortes.some(esRecomendable);

function inicio() {
  respuestas = {}; paso = 0;
  app.innerHTML = `<div class="card"><h2>Encontrá tu corte</h2>
    <p>Respondé unas preguntas rápidas sobre tu pelo y lo que buscás. Te sugerimos hasta <b>3 cortes</b> y te explicamos por qué.</p>
    <p class="muted small" style="margin-top:10px">Sin registro. No guardamos tus respuestas ni fotos.</p>
    ${hayVerificadas() ? "" : `<div class="aviso" style="margin-top:14px">Estamos revisando con profesionales la información de cada corte. Todavía no hay recomendaciones disponibles, pero podés explorar el catálogo.</div>`}
    <button class="cta" id="ir">${hayVerificadas() ? "Empezar" : "Hacer el cuestionario igual"}</button>
    <button class="ghost" id="cat" style="width:100%">Explorar el catálogo</button></div>`;
  app.querySelector("#ir").onclick = pregunta; app.querySelector("#cat").onclick = catalogo;
}

function pregunta() {
  const vis = preguntasVisibles(respuestas);
  if (paso >= vis.length) return resultado();
  const p = vis[paso];
  app.innerHTML = `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${vis.length}" aria-valuenow="${paso}"><i style="width:${Math.round(100 * paso / vis.length)}%"></i></div>
    <h2>${esc(p.titulo)}</h2><div class="opts">${p.opciones.map(o => `<button class="opt${o.v === "no_se" ? " ns" : ""}" data-v="${esc(o.v)}"><b>${esc(o.t)}</b>${o.d ? `<span>${esc(o.d)}</span>` : ""}</button>`).join("")}</div>
    <button class="ghost" id="atras">${paso ? "← Volver" : "← Inicio"}</button>`;
  app.querySelectorAll(".opt").forEach(b => b.onclick = () => {
    respuestas[p.id] = b.dataset.v;
    if (p.id === "laterales" && b.dataset.v === "tijera") { delete respuestas.altura; delete respuestas.transicion; }
    paso++; pregunta();
  });
  app.querySelector("#atras").onclick = () => { if (paso) { paso--; pregunta(); } else inicio(); };
  app.querySelector(".opt").focus({ preventScroll: true });
}

const fotos = c => (c.imagenes || []).length ? `<div class="fotos">${c.imagenes.map(i => `<img src="${esc(i.url)}" alt="${esc(i.alt || c.nombre)}" loading="lazy">`).join("")}</div>` : "";
const fuentes = f => `<div class="fuentes"><b>Fuentes profesionales</b><ul>${f.map(x => `<li>${esc(x.autor)}${x.titulo ? " — " + esc(x.titulo) : ""}${x.afirmacion ? `<br><span class="muted">Respalda: ${esc(x.afirmacion)}</span>` : ""}<br><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a></li>`).join("")}</ul></div>`;

function resultado() {
  const r = recomendar(respuestas, cortes);
  if (r.estado !== "ok") {
    app.innerHTML = `<h2>${r.estado === "sin_verificadas" ? "Todavía no hay recomendaciones" : "Sin coincidencias"}</h2><div class="aviso">${esc(r.mensaje)}</div>
      <button class="cta" id="cat">Explorar el catálogo</button><button class="ghost" id="rep" style="width:100%">Volver a empezar</button>`;
    app.querySelector("#cat").onclick = catalogo; app.querySelector("#rep").onclick = inicio; return;
  }
  app.innerHTML = `<h2>${r.recomendaciones.length === 1 ? "Tu opción" : `Tus ${r.recomendaciones.length} opciones`}</h2>` + r.recomendaciones.map((x, i) => `<article class="card">
    <span class="badge verificado">Ficha verificada</span><h3 style="margin-top:8px">${i + 1}. ${esc(x.corte.nombre)}</h3>
    <div class="meter" title="Coincidencia"><i style="width:${x.puntaje}%"></i></div><p class="muted small">Coincide en ${x.puntaje}% de lo que elegiste (${x.criteriosEvaluados} criterios)</p>
    ${fotos(x.corte)}${x.corte.descripcion ? `<p>${esc(x.corte.descripcion)}</p>` : ""}
    <h3 style="font-size:20px;margin-top:10px">Por qué te lo sugerimos</h3><ul class="razones">${x.razones.map(z => `<li class="${z.ok ? "" : "no"}">${esc(z.texto)}</li>`).join("")}</ul>
    ${x.variante ? `<p><b>Variante que más se acerca:</b> ${esc(x.variante.nombre)}${x.variante.descripcion ? " — " + esc(x.variante.descripcion) : ""}</p>` : ""}
    ${x.corte.mantenimiento ? `<p><b>Mantenimiento:</b> ${esc(x.corte.mantenimiento)}</p>` : ""}
    ${x.datosFaltantes ? `<p class="muted small">En ${x.datosFaltantes} criterio(s) la ficha todavía no tiene información, por eso no los usamos.</p>` : ""}
    ${fuentes(x.respaldo)}</article>`).join("") +
    `<p class="muted small">Es una orientación. El barbero te confirma el resultado según tu cabello y tu cabeza.</p>
    <button class="cta" id="rep">Volver a empezar</button><button class="ghost" id="cat" style="width:100%">Explorar el catálogo</button>`;
  app.querySelector("#rep").onclick = inicio; app.querySelector("#cat").onclick = catalogo;
}

function catalogo() {
  app.innerHTML = `<h2>Catálogo de cortes</h2>${hayVerificadas() ? "" : `<div class="aviso">Las fichas están en revisión: por ahora solo mostramos los nombres.</div>`}
    <div class="lista">${cortes.map(c => `<div class="card" style="margin:0"><div class="row" style="align-items:center;justify-content:space-between"><b>${esc(c.nombre)}</b><span class="badge ${esc(c.estado)}" style="flex:0 0 auto">${c.estado === "verificado" ? "Verificado" : c.estado === "pendiente" ? "En revisión" : "En preparación"}</span></div>
      ${esCompleta(c) ? `<details><summary>Ver ficha</summary>${fotos(c)}<p>${esc(c.descripcion)}</p>${c.caracteristicas ? `<p class="small">${esc(c.caracteristicas)}</p>` : ""}${fuentes(c.fuentes)}</details>` : ""}</div>`).join("")}</div>
    <button class="ghost" id="volver" style="width:100%">← Volver</button>`;
  app.querySelector("#volver").onclick = inicio;
}
const esCompleta = c => esRecomendable(c);

await cargar();
inicio();
