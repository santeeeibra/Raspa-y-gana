// Piezas visuales compartidas entre el asesor público y la vista previa del gestor.
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Esquemas ilustrativos (dibujos, NO fotografías) para entender las preguntas técnicas. */
export function esquema(tipo, valor) {
  const duracion = { comprimida: 14, equilibrada: 30, estirada: 52 }, alturaY = { bajo: 66, medio: 50, alto: 34 };
  let cuerpo = "";
  if (tipo === "altura") {
    const y = alturaY[valor];
    cuerpo = `<ellipse class="piel" cx="60" cy="52" rx="34" ry="40"/><path class="pelo" d="M26 52 A34 40 0 0 1 94 52 L94 ${y} L26 ${y} Z"/><rect class="pelo" x="26" y="${y}" width="68" height="${Math.max(6, 96 - y - 30)}" opacity=".0"/>
      <path class="lado" d="M26 ${y} L26 70 Q28 84 40 90 L40 ${y + 8} Z"/><path class="lado" d="M94 ${y} L94 70 Q92 84 80 90 L80 ${y + 8} Z"/>
      <line class="guia" x1="14" y1="${y}" x2="106" y2="${y}"/>`;
  } else if (tipo === "transicion") {
    const d = duracion[valor], ini = 40;
    cuerpo = `<defs><linearGradient id="g-${valor}" x1="0" y1="0" x2="0" y2="1"><stop offset="${ini - 5}%" class="s-pelo"/><stop offset="${ini - 5 + d}%" class="s-piel"/></linearGradient></defs>
      <rect x="38" y="14" width="44" height="82" rx="6" fill="url(#g-${valor})"/><path class="guia" d="M30 ${14 + 82 * (ini - 5) / 100} h60 M30 ${14 + 82 * (ini - 5 + d) / 100} h60" stroke-dasharray="3 3"/>`;
  } else if (tipo === "laterales") {
    cuerpo = valor === "degradado"
      ? `<defs><linearGradient id="g-lat" x1="0" y1="0" x2="0" y2="1"><stop offset="15%" class="s-pelo"/><stop offset="85%" class="s-piel"/></linearGradient></defs><rect x="38" y="14" width="44" height="82" rx="6" fill="url(#g-lat)"/>`
      : `<rect class="pelo" x="38" y="14" width="44" height="70" rx="6"/><path class="pelo" d="M38 80 q6 10 12 4 q6 8 12 0 q6 8 12 2 q6 6 8 -4 V84 H38Z"/>`;
  } else return "";
  return `<svg class="esq" viewBox="0 0 120 100" role="img" aria-label="Esquema ilustrativo" focusable="false">${cuerpo}</svg>`;
}

export const fotos = (c, demo) => (c.imagenes || []).length
  ? `<div class="foto-principal"><img src="${esc(c.imagenes[0].url)}" alt="${esc(c.imagenes[0].alt || c.nombre)}" loading="lazy">${demo ? `<span class="cinta">DEMO</span>` : ""}</div>`
    + (c.imagenes.length > 1 ? `<div class="fotos">${c.imagenes.slice(1).map(i => `<img src="${esc(i.url)}" alt="${esc(i.alt || c.nombre)}" loading="lazy">`).join("")}</div>` : "")
  : `<div class="foto-principal vacia" role="img" aria-label="Fotografía pendiente"><span>Fotografía pendiente<br><small>Solo publicamos fotos con autorización</small></span>${demo ? `<span class="cinta">DEMO</span>` : ""}</div>`;

export const fuentes = f => !f?.length ? "" : `<details class="fuentes"><summary>Fuentes profesionales (${f.length})</summary><ul>${f.map(x =>
  `<li><b>${esc(x.autor)}</b>${x.titulo ? " — " + esc(x.titulo) : ""}${x.afirmacion ? `<br><span class="muted">Respalda: ${esc(x.afirmacion)}</span>` : ""}<br><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a></li>`).join("")}</ul></details>`;

const ETQ = { degradado: "Degradado", tijera: "Tijera" };
export function tarjeta(x, { demo = false, controles = "", indice = null } = {}) {
  const c = x.corte, ok = (x.razones || []).filter(r => r.ok).length, tot = (x.razones || []).length;
  const resumen = !tot ? "" : ok === tot ? "Coincide con todo lo que elegiste" : `Coincide con ${ok} de ${tot} cosas que elegiste`;
  return `<article class="res${demo ? " es-demo" : ""}">${demo ? `<div class="demo-tag">DEMO · contenido de prueba, no aprobado por profesionales</div>` : ""}
    ${fotos(c, demo)}
    <div class="cuerpo">${demo ? `<span class="badge pendiente">Ejemplo de prueba · no verificado</span>` : `<span class="badge verificado">Ficha verificada</span>`}
      <h3>${indice ? `<span class="n">${indice}</span>` : ""}${esc(c.nombre)}</h3>
      ${resumen ? `<p class="resumen">${esc(resumen)}</p>` : ""}
      ${c.descripcion ? `<p>${esc(c.descripcion)}</p>` : ""}
      ${tot ? `<h4>Por qué te lo sugerimos</h4><ul class="razones">${x.razones.map(z => `<li class="${z.ok ? "" : "no"}"><span class="sr">${z.ok ? "Coincide: " : "No coincide: "}</span>${esc(z.texto)}</li>`).join("")}</ul>` : ""}
      ${x.variante ? `<h4>Variante más cercana</h4><p><b>${esc(x.variante.nombre)}</b>${x.variante.descripcion ? " — " + esc(x.variante.descripcion) : ""}</p>` : ""}
      ${(c.variantes || []).length > (x.variante ? 1 : 0) ? `<details><summary>Todas las variantes (${c.variantes.length})</summary><ul class="simple">${c.variantes.map(v => `<li><b>${esc(v.nombre)}</b>${[v.laterales && ETQ[v.laterales], v.altura && "altura " + v.altura, v.transicion && "transición " + v.transicion].filter(Boolean).length ? ` <span class="muted">(${[v.laterales && ETQ[v.laterales], v.altura && "altura " + v.altura, v.transicion && "transición " + v.transicion].filter(Boolean).join(", ")})</span>` : ""}${v.descripcion ? "<br>" + esc(v.descripcion) : ""}</li>`).join("")}</ul></details>` : ""}
      ${c.mantenimiento ? `<h4>Mantenimiento</h4><p>${esc(c.mantenimiento)}</p>` : ""}
      ${x.datosFaltantes ? `<p class="muted small">En ${x.datosFaltantes} criterio(s) la ficha todavía no tiene información, por eso no los usamos.</p>` : ""}
      ${fuentes(x.respaldo || c.fuentes)}${controles}</div></article>`;
}
