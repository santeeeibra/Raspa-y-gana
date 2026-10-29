// Gestor privado: la sesión vive en una cookie HttpOnly del servidor (no hay PIN ni claves en el navegador).
import { PREGUNTAS } from "./engine.js";

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LISTAS = [["pelos", "Tipos de cabello compatibles"], ["largos", "Largo necesario"], ["estilos", "Estilos / preferencias"], ["entradas", "Entradas"],
  ["densidades", "Densidad"], ["volumenes", "Volumen"], ["laterales", "Laterales"], ["alturas", "Altura del degradado"], ["transiciones", "Transición"]];
const OPC = Object.fromEntries(PREGUNTAS.map(p => [p.campo, p.opciones.filter(o => o.v !== "no_se")]));
OPC.entradas = [{ v: "cuidar", t: "Sirve para cuidar entradas" }, { v: "volumen", t: "Sirve para conservar volumen" }];
const ESTADOS = { borrador: "Borrador", pendiente: "Pendiente de revisión", verificado: "Verificado" };
let cortes = [], actual = null, r2 = false, msg = null;

async function api(metodo, ruta, cuerpo) {
  const init = { method: metodo, credentials: "same-origin", headers: {} };
  if (cuerpo instanceof FormData) init.body = cuerpo;
  else if (cuerpo !== undefined) { init.body = JSON.stringify(cuerpo); init.headers["Content-Type"] = "application/json"; }
  const res = await fetch("/api/admin" + ruta, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== "/login") { mostrarLogin(); throw new Error("Sesión vencida"); }
  if (!res.ok) { const e = new Error(data.error || "Error " + res.status); e.faltan = data.faltan; throw e; }
  return data;
}
const aviso = (t, mal) => { msg = { t, mal }; };
const guardarEn = c => { const i = cortes.findIndex(x => x.id === c.id); if (i >= 0) cortes[i] = c; else cortes.push(c); cortes.sort((a, b) => a.nombre.localeCompare(b.nombre)); actual = c.id; };
async function accion(fn, ok) {
  try { const c = await fn(); if (c && c.id) guardarEn(c); aviso(ok); } catch (e) { aviso(e.message + (e.faltan ? ": " + e.faltan.join("; ") : ""), true); }
  pintar();
}

function mostrarLogin(error = "") {
  app.innerHTML = `<form class="card" id="f" style="max-width:420px;margin:auto"><h2>Ingresar</h2><label for="p">Contraseña</label>
    <input id="p" type="password" autocomplete="current-password" required><div class="err" role="alert">${esc(error)}</div><button class="cta">Entrar</button></form>`;
  app.querySelector("#f").onsubmit = async e => {
    e.preventDefault(); const p = app.querySelector("#p").value;
    try { await api("POST", "/login", { password: p }); await iniciar(); } catch (x) { mostrarLogin(x.message); }
  };
}

function pintar() {
  const c = cortes.find(x => x.id === actual);
  app.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px"><div></div><button class="ghost" id="salir" style="flex:0 0 auto;margin:0">Salir</button></div>
    ${msg ? `<div class="${msg.mal ? "err" : "okmsg"}" role="status" style="margin-bottom:10px">${esc(msg.t)}</div>` : ""}
    <div class="cols"><aside><div class="lista">${cortes.map(x => `<button class="item" data-id="${x.id}" aria-current="${x.id === actual}"><span>${esc(x.nombre)}</span><span class="badge ${x.estado}">${ESTADOS[x.estado]}${x.publicado ? " · público" : ""}</span></button>`).join("")}</div>
      <form id="nuevo" class="card" style="margin-top:12px"><label for="nn">Crear corte nuevo</label><input id="nn" type="text" maxlength="80" required placeholder="Nombre"><button class="ghost" style="width:100%">+ Crear</button></form></aside>
    <section>${c ? editor(c) : `<div class="card muted">Elegí un corte de la lista o creá uno nuevo.</div>`}</section></div>`;
  msg = null;
  app.querySelector("#salir").onclick = async () => { await api("POST", "/logout", {}); mostrarLogin(); };
  app.querySelectorAll(".item").forEach(b => b.onclick = () => { actual = +b.dataset.id; pintar(); });
  app.querySelector("#nuevo").onsubmit = e => { e.preventDefault(); accion(() => api("POST", "/cortes", { nombre: app.querySelector("#nn").value }), "Corte creado como borrador"); };
  if (c) enlazar(c);
}

const chips = (campo, vals) => `<div class="chips">${OPC[campo].map(o => `<label><input type="checkbox" name="${campo}" value="${o.v}" ${vals.includes(o.v) ? "checked" : ""}><span>${esc(o.t)}</span></label>`).join("")}</div>`;
function editor(c) {
  const o = (v, t, sel) => `<option value="${v}" ${sel === v ? "selected" : ""}>${t}</option>`;
  return `<form id="ficha" class="card"><div class="row" style="align-items:center"><h2 style="margin:0">${esc(c.nombre)}</h2><span class="badge ${c.estado}" style="flex:0 0 auto">${ESTADOS[c.estado]}</span></div>
    ${c.verificado_en ? `<p class="muted small">Verificado por ${esc(c.verificado_por)} el ${esc(c.verificado_en.slice(0, 10))}</p>` : ""}
    <label>Nombre</label><input type="text" name="nombre" maxlength="80" value="${esc(c.nombre)}" required>
    <label>Descripción (se muestra al cliente; solo datos respaldados por una fuente)</label><textarea name="descripcion" maxlength="1000">${esc(c.descripcion)}</textarea>
    <label>Características técnicas</label><textarea name="caracteristicas" maxlength="1500">${esc(c.caracteristicas)}</textarea>
    <label>Mantenimiento</label><textarea name="mantenimiento" maxlength="800">${esc(c.mantenimiento)}</textarea>
    <label>Tiempo de peinado que requiere</label><select name="tiempo_peinado">${o("", "— sin dato —", c.tiempo_peinado || "")}${o("poco", "Menos de 5 min", c.tiempo_peinado)}${o("medio", "5 a 15 min", c.tiempo_peinado)}${o("mucho", "Más de 15 min", c.tiempo_peinado)}</select>
    ${LISTAS.map(([k, t]) => `<label>${t}</label>${chips(k, c[k])}`).join("")}
    <label>Notas internas (nunca se muestran al público)</label><textarea name="notas_internas" maxlength="2000">${esc(c.notas_internas)}</textarea>
    <button class="cta">Guardar cambios</button>${c.estado === "verificado" ? `<p class="muted small">Si guardás cambios, la ficha vuelve a «pendiente de revisión».</p>` : ""}</form>
    ${bloqueEstado(c)}${bloqueVariantes(c)}${bloqueFuentes(c)}${bloqueImagenes(c)}`;
}
function bloqueEstado(c) {
  return `<div class="card"><h3>Revisión y publicación</h3>
    <p class="small muted">Una ficha solo se usa en recomendaciones si está <b>verificada</b>, <b>publicada</b> y tiene fuentes. Hoy: ${c.publicado ? "visible en el catálogo" : "oculta"}.</p>
    <div class="row">
      ${c.estado === "borrador" ? `<button class="ghost" data-estado="pendiente">Enviar a revisión</button>` : ""}
      ${c.estado !== "borrador" ? `<button class="ghost" data-estado="borrador">Volver a borrador</button>` : ""}
      <button class="ghost" id="pub">${c.publicado ? "Retirar del catálogo" : "Publicar en el catálogo"}</button></div>
    ${c.estado === "pendiente" ? `<label style="text-transform:none;letter-spacing:0;font-size:17px;color:var(--white)"><input type="checkbox" id="confirmo"> Revisé que los datos de esta ficha coinciden con las fuentes cargadas</label>
      <button class="cta" id="verificar">Aprobar como verificada</button>` : ""}</div>`;
}
function bloqueVariantes(c) {
  const sel = (n, op, v) => `<select name="${n}"><option value="">—</option>${op.map(([a, b]) => `<option value="${a}" ${v === a ? "selected" : ""}>${b}</option>`).join("")}</select>`;
  const L = [["degradado", "Degradado"], ["tijera", "Tijera"]], A = [["bajo", "Bajo"], ["medio", "Medio"], ["alto", "Alto"]], T = [["comprimida", "Comprimida"], ["equilibrada", "Equilibrada"], ["estirada", "Estirada"]];
  const fila = v => `<form class="card var" data-id="${v?.id || ""}" style="background:var(--steel2)"><label>Nombre</label><input type="text" name="nombre" maxlength="80" value="${esc(v?.nombre)}" required>
    <label>Descripción</label><textarea name="descripcion" maxlength="500">${esc(v?.descripcion)}</textarea>
    <div class="row"><div><label>Laterales</label>${sel("laterales", L, v?.laterales)}</div><div><label>Altura</label>${sel("altura", A, v?.altura)}</div><div><label>Transición</label>${sel("transicion", T, v?.transicion)}</div></div>
    <div class="row"><button class="ghost">${v ? "Guardar variante" : "+ Agregar variante"}</button>${v ? `<button type="button" class="ghost danger" data-del="variantes/${v.id}">Borrar</button>` : ""}</div></form>`;
  return `<div class="card"><h3>Variantes</h3>${c.variantes.map(fila).join("")}${fila(null)}</div>`;
}
function bloqueFuentes(c) {
  const fila = f => `<form class="card fte" data-id="${f?.id || ""}" style="background:var(--steel2)"><label>Autor (persona u organización)</label><input type="text" name="autor" maxlength="120" value="${esc(f?.autor)}" required>
    <label>Título</label><input type="text" name="titulo" maxlength="200" value="${esc(f?.titulo)}">
    <label>Enlace (https://…)</label><input type="url" name="url" maxlength="500" value="${esc(f?.url)}" required placeholder="https://">
    <label>¿Qué dato de la ficha respalda?</label><textarea name="afirmacion" maxlength="500">${esc(f?.afirmacion)}</textarea>
    <label>Fecha en que la revisaste</label><input type="date" name="consultada_en" value="${esc(f?.consultada_en)}">
    <div class="row"><button class="ghost">${f ? "Guardar fuente" : "+ Agregar fuente"}</button>${f ? `<button type="button" class="ghost danger" data-del="fuentes/${f.id}">Borrar</button>` : ""}</div></form>`;
  return `<div class="card"><h3>Fuentes profesionales</h3><p class="small muted">Solo fuentes reales que hayas leído. No cargues datos generados por IA como si fueran una fuente.</p>${c.fuentes.map(fila).join("")}${fila(null)}</div>`;
}
function bloqueImagenes(c) {
  return `<div class="card"><h3>Fotografías</h3>${r2 ? "" : `<p class="aviso small">El almacenamiento de imágenes (R2) todavía no está activo en este entorno.</p>`}
    <div class="fotos">${c.imagenes.map(i => `<div><img src="/api/admin/imagenes/${i.id}" alt="${esc(i.alt)}" onerror="this.style.opacity=.3"><br><button class="ghost danger" data-delimg="${i.id}" style="margin:4px 0">Borrar</button><div class="small muted">${esc(i.derechos)}</div></div>`).join("") || `<p class="muted">Sin fotos.</p>`}</div>
    <form id="subir"><label>Archivo (JPG, PNG o WebP, hasta 2 MB)</label><input type="file" name="archivo" accept="image/jpeg,image/png,image/webp" required>
    <label>Descripción de la imagen</label><input type="text" name="alt" maxlength="200"><label>De quién es la foto / permiso de uso</label><input type="text" name="derechos" maxlength="300" required>
    <label style="text-transform:none;letter-spacing:0;font-size:17px;color:var(--white)"><input type="checkbox" name="confirmo_sin_clientes" value="1" required> Confirmo que NO es una foto de un cliente sin su consentimiento</label>
    <button class="ghost" ${r2 ? "" : "disabled"}>Subir foto</button></form></div>`;
}

function enlazar(c) {
  const f = app.querySelector("#ficha");
  f.onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f).entries());
    const cuerpo = { nombre: d.nombre, descripcion: d.descripcion, caracteristicas: d.caracteristicas, mantenimiento: d.mantenimiento, notas_internas: d.notas_internas, tiempo_peinado: d.tiempo_peinado || null };
    for (const [k] of LISTAS) cuerpo[k] = [...f.querySelectorAll(`input[name=${k}]:checked`)].map(i => i.value);
    accion(() => api("PUT", "/cortes/" + c.id, cuerpo), "Cambios guardados");
  };
  app.querySelectorAll("[data-estado]").forEach(b => b.onclick = () => accion(() => api("POST", `/cortes/${c.id}/estado`, { estado: b.dataset.estado }), "Estado actualizado"));
  app.querySelector("#pub").onclick = () => accion(() => api("PUT", "/cortes/" + c.id, { publicado: !c.publicado }), c.publicado ? "Retirado del catálogo" : "Publicado en el catálogo");
  const v = app.querySelector("#verificar");
  if (v) v.onclick = () => accion(() => api("POST", `/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: app.querySelector("#confirmo").checked }), "Ficha verificada");
  for (const [sel, tipo] of [[".var", "variantes"], [".fte", "fuentes"]]) app.querySelectorAll(sel).forEach(form => {
    form.onsubmit = e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(form).entries()), id = form.dataset.id;
      accion(() => id ? api("PUT", `/${tipo}/${id}`, d) : api("POST", `/cortes/${c.id}/${tipo}`, d), id ? "Guardado" : "Agregado");
    };
  });
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = () => confirm("¿Borrar?") && accion(() => api("DELETE", "/" + b.dataset.del), "Borrado"));
  app.querySelectorAll("[data-delimg]").forEach(b => b.onclick = () => confirm("¿Borrar esta foto?") && accion(() => api("DELETE", "/imagenes/" + b.dataset.delimg), "Foto borrada"));
  app.querySelector("#subir").onsubmit = e => { e.preventDefault(); accion(() => api("POST", `/cortes/${c.id}/imagenes`, new FormData(e.target)), "Foto subida"); };
}

async function iniciar() {
  try { r2 = (await api("GET", "/me")).r2; cortes = await api("GET", "/cortes"); actual = cortes[0]?.id ?? null; pintar(); }
  catch { mostrarLogin(); }
}
iniciar();
