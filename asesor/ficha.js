// Ficha completa de un corte: galería (principal + ángulos), clip corto, datos técnicos, mantenimiento y variantes.
// Fuentes de fotos/clips, en este orden:
//   1. Fotos y videos subidos desde el gestor (corte.imagenes con `vista`/`tipo`), solo si están marcados publicables.
//   2. assets/cortes/media.json: recursos locales con registro de origen y `publicable: true`.
//   3. privado/media.json: SOLO en modo de prueba privada (?privado). Esa carpeta no entra en la demo ni en producción.
import { PREGUNTAS, esRecomendable } from "./engine.js";
import { esc, fuentes } from "./vista.js";

export const VISTAS = { frente: "Frente", perfil: "Perfil", tres_cuartos: "¾ posterior", nuca: "Nuca" };
const RUTA = /^(assets|privado)\/cortes\/[\w-]+\/[\w.-]+\.(webp|jpg|jpeg|png|mp4|webm)$/;
const privado = new URLSearchParams(location.search).has("privado");
let media = null;

function validar(v, esPrivado) {
  if (!v?.derechos || !v.registro || !RUTA.test(v.principal?.src || "")) return null;
  if (!esPrivado && v.registro.publicable !== true) return null;           // sin derechos de publicación: no sale
  const clip = v.clip && RUTA.test(v.clip.src || "") && (!v.clip.mp4 || RUTA.test(v.clip.mp4)) && (!v.clip.poster || RUTA.test(v.clip.poster)) ? v.clip : null;
  return { ...v, privado: esPrivado, clip, vistas: (v.vistas || []).filter(x => VISTAS[x.id] && RUTA.test(x.src || "")) };
}
export async function cargarMedia() {
  if (media) return media;
  const leer = async (url, esPrivado) => { try { const m = await (await fetch(url)).json();
    return Object.entries(m).map(([k, v]) => [k, validar(v, esPrivado)]).filter(([, v]) => v); } catch { return []; } };
  media = Object.fromEntries([...await leer("assets/cortes/media.json", false), ...(privado ? await leer("privado/media.json", true) : [])]);
  return media;
}
/** Cortes que solo existen como referencia visual privada (no están en el catálogo). */
export const referenciasPrivadas = cortes => Object.values(media || {}).filter(m => m.privado && m.corte && !cortes.some(c => c.slug === m.corte.slug)).map(m => ({ ...m.corte, imagenes: [], variantes: [], fuentes: [] }));

// Fotos/videos cargados desde el gestor (API): ya vienen filtrados como publicables por el servidor.
function mediaDeAPI(c) {
  const xs = (c.imagenes || []).filter(i => i.vista || i.tipo === "video");
  if (!xs.length) return null;
  const fotos = xs.filter(i => i.tipo !== "video"), v = xs.find(i => i.tipo === "video");
  const principal = fotos.find(i => i.vista === "principal") || fotos[0];
  if (!principal) return null;
  return { principal: { src: principal.url, alt: principal.alt }, derechos: principal.derechos || "", registro: principal.registro || {},
    vistas: fotos.filter(i => i !== principal && VISTAS[i.vista]).map(i => ({ id: i.vista, src: i.url, alt: i.alt })),
    clip: v ? { src: v.url, tipo: v.mime, poster: principal.url } : null };
}
export const mediaDe = c => mediaDeAPI(c) || media?.[c.slug] || null;

function datosTecnicos(c) {
  const T = { poco: "Menos de 5 minutos", medio: "Entre 5 y 15 minutos", mucho: "Más de 15 minutos" };
  const filas = PREGUNTAS.filter(p => p.campo !== "tiempo_peinado" && Array.isArray(c[p.campo]) && c[p.campo].length).map(p =>
    `<div><dt>${esc(p.titulo.replace(/^¿|\?$/g, ""))}</dt><dd>${esc(c[p.campo].map(v => p.opciones.find(o => o.v === v)?.t || v).join(" · "))}</dd></div>`);
  if (c.tiempo_peinado) filas.push(`<div><dt>Tiempo de peinado</dt><dd>${esc(T[c.tiempo_peinado] || c.tiempo_peinado)}</dd></div>`);
  return filas.length ? `<dl class="tec">${filas.join("")}</dl>` : `<p class="muted">Pendiente: la ficha técnica todavía no fue cargada ni verificada.</p>`;
}

const tipoDe = s => (s.endsWith(".webm") ? "video/webm" : "video/mp4");
function galeria(c, m) {
  if (!m) return `<div class="fg-col fg-vacia" role="img" aria-label="Sin fotos todavía"><span>Fotos y clip en preparación</span></div>`;
  const items = [{ id: "principal", t: VISTAS[m.principal.id] || "Principal", ...m.principal }, ...m.vistas.map(v => ({ ...v, t: VISTAS[v.id] }))];
  const reg = m.registro || {};
  const nota = reg.origen === "generado_ia"
    ? `Referencia visual generada con IA${reg.herramienta ? ` (${esc(reg.herramienta)})` : ""}. No es una foto real ni evidencia técnica: tu barbero adapta el corte a tu cabello.`
    : esc(m.derechos);
  return `<div class="fg-col"><figure class="fg"><div class="fg-marco">
      ${items.map((x, i) => `<img src="${esc(x.src)}" alt="${esc(x.alt || `${c.nombre}, vista ${x.t.toLowerCase()}`)}" data-id="${x.id}" width="${+x.w || 640}" height="${+x.h || 800}" ${i ? `loading="lazy" hidden` : `fetchpriority="high"`} decoding="async">`).join("")}
      ${m.clip ? `<video hidden playsinline muted loop preload="none" ${m.clip.poster ? `poster="${esc(m.clip.poster)}"` : ""} aria-label="Clip del corte ${esc(c.nombre)} en movimiento, sin sonido">
          <source src="${esc(m.clip.src)}" type="${esc(m.clip.tipo || tipoDe(m.clip.src))}">${m.clip.mp4 ? `<source src="${esc(m.clip.mp4)}" type="video/mp4">` : ""}</video>
        <button class="fg-play" id="play" hidden aria-label="Pausar">❚❚</button>` : ""}
      ${m.privado ? `<span class="etq-priv">PRUEBA PRIVADA</span>` : ""}
    </div>
    ${items.length > 1 ? `<div class="fg-tabs" role="tablist" aria-label="Ángulos">${items.map((x, i) => `<button role="tab" data-id="${x.id}" aria-selected="${!i}" tabindex="${i ? -1 : 0}">${esc(x.t)}</button>`).join("")}</div>` : ""}
    <figcaption class="muted small">${nota}${m.vistas.some(v => v.id === "frente") ? "" : " Sin vista frontal disponible."}</figcaption>
  </figure>
  <div class="fg-acciones">
    ${m.vistas.length ? `<button class="ghost" id="angulos">Ver desde otros ángulos</button>` : ""}
    ${m.clip ? `<button class="ghost" id="mov" aria-pressed="false">▶ Ver corte en movimiento${m.clip.duracion ? ` <span class="muted">· ${+m.clip.duracion} s</span>` : ""}</button>` : ""}
  </div></div>`;
}

/** Monta la ficha. `x` es el resultado del motor (o { corte } desde el catálogo). */
export async function abrirFicha({ x, montar, app, volver, demo, textoVolver = "Volver" }) {
  await cargarMedia();
  const c = x.corte, m = mediaDe(c), verificada = esRecomendable(c);
  montar(`<div class="cabecera"><button class="atras" id="atras" aria-label="${esc(textoVolver)}">←</button><small class="muted">Ficha del corte</small></div>
    <article class="ficha${demo ? " es-demo" : ""}">
      ${demo ? `<div class="demo-tag">DEMO · contenido de prueba, no aprobado por profesionales</div>` : ""}
      <h2>${esc(c.nombre)}</h2>
      ${verificada ? "" : `<div class="aviso">Ficha en preparación: todavía no fue verificada por profesionales y no se usa para recomendar.</div>`}
      ${galeria(c, m)}
      ${c.descripcion ? `<p class="lead-f">${esc(c.descripcion)}</p>` : ""}
      ${x.razones?.length ? `<p class="resumen">Coincide con ${x.razones.filter(r => r.ok).length} de ${x.razones.length} cosas que elegiste</p>` : ""}
      <section aria-labelledby="h-tec"><h3 id="h-tec">Datos técnicos</h3>${datosTecnicos(c)}</section>
      <section aria-labelledby="h-man"><h3 id="h-man">Mantenimiento</h3>${c.mantenimiento ? `<p>${esc(c.mantenimiento)}</p>` : `<p class="muted">Pendiente.</p>`}</section>
      <section aria-labelledby="h-var"><h3 id="h-var">Variantes</h3>${(c.variantes || []).length ? `<ul class="simple">${c.variantes.map(v => `<li><b>${esc(v.nombre)}</b>${x.variante?.nombre === v.nombre ? ` <span class="badge verificado">la más cercana a lo que elegiste</span>` : ""}${v.descripcion ? "<br>" + esc(v.descripcion) : ""}</li>`).join("")}</ul>` : `<p class="muted">Pendiente.</p>`}</section>
      ${fuentes(x.respaldo || c.fuentes)}
    </article>
    <button class="ghost block" id="volver2">${esc(textoVolver)}</button>`, "h2");
  const salir = () => { app.querySelector(".fg-marco video")?.pause(); volver(); };
  app.querySelector("#atras").onclick = app.querySelector("#volver2").onclick = salir;
  if (m) controlarGaleria(app);
}

function controlarGaleria(app) {
  const imgs = [...app.querySelectorAll(".fg-marco img")], video = app.querySelector(".fg-marco video"), tabs = [...app.querySelectorAll(".fg-tabs [role=tab]")];
  const btnMov = app.querySelector("#mov"), play = app.querySelector("#play"), marco = app.querySelector(".fg-marco");
  const textoMov = btnMov?.innerHTML;
  const actual = () => tabs.find(t => t.getAttribute("aria-selected") === "true")?.dataset.id || "principal";
  const enVideo = () => video && !video.hidden;
  const mostrar = id => {
    imgs.forEach(i => (i.hidden = i.dataset.id !== id));
    tabs.forEach(t => { const on = t.dataset.id === id; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    if (video) { video.pause(); video.hidden = true; play.hidden = true; btnMov.setAttribute("aria-pressed", "false"); btnMov.innerHTML = textoMov; }
  };
  const siguiente = d => { const i = tabs.findIndex(t => t.dataset.id === actual()); return tabs[(i + d + tabs.length) % tabs.length]; };
  tabs.forEach(t => {
    t.onclick = () => mostrar(t.dataset.id);
    t.onkeydown = e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); const n = siguiente(d); mostrar(n.dataset.id); n.focus(); } };
  });
  app.querySelector("#angulos")?.addEventListener("click", () => { const n = enVideo() ? tabs[0] : siguiente(1); mostrar(n.dataset.id); });
  let x0 = null;   // deslizar sobre la foto cambia de ángulo (celular)
  marco.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  marco.addEventListener("touchend", e => { if (x0 === null || !tabs.length || enVideo()) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) mostrar(siguiente(dx < 0 ? 1 : -1).dataset.id); });
  if (!video) return;
  const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const estado = () => { const p = video.paused; play.textContent = p ? "▶" : "❚❚"; play.setAttribute("aria-label", p ? "Reproducir" : "Pausar"); };
  video.addEventListener("play", estado); video.addEventListener("pause", estado);
  play.onclick = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  video.onclick = () => play.click();
  btnMov.onclick = () => {
    if (enVideo()) return mostrar(actual());
    imgs.forEach(i => (i.hidden = true)); video.hidden = false; play.hidden = false;
    btnMov.setAttribute("aria-pressed", "true"); btnMov.textContent = "■ Volver a las fotos";
    video.muted = true;                                   // nunca con sonido (las versiones optimizadas no tienen audio)
    if (sinMovimiento) estado(); else video.play().catch(estado);
  };
}
