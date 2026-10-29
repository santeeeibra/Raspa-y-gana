// Gestor privado. La sesión vive en una cookie HttpOnly del servidor; el token CSRF solo se guarda en memoria.
import { PREGUNTAS } from "./engine.js";
import { esc, tarjeta } from "./vista.js";
import { crearInvestigacion } from "./investigacion.js";

const app = document.getElementById("app"), $msg = document.getElementById("msg");
const LISTAS = [
  ["pelos", "Tipos de cabello compatibles", "Marcá todos los tipos para los que tus fuentes dicen que el corte funciona."],
  ["largos", "Largo actual necesario", "Con qué largo de pelo se puede hacer el corte hoy."],
  ["estilos", "Estilos y preferencias", "Qué busca la persona que elige este corte."],
  ["entradas", "Entradas", "Si el corte sirve para cuidar las entradas o para conservar volumen."],
  ["densidades", "Densidad del cabello", "Dejalo vacío si las fuentes no lo dicen."],
  ["volumenes", "Volumen arriba", "Dejalo vacío si las fuentes no lo dicen."],
  ["laterales", "Laterales", "Degradado, tijera o ambos."],
  ["alturas", "Altura del degradado", "Solo si el corte lleva degradado."],
  ["transiciones", "Transición del degradado", "Solo si el corte lleva degradado."]];
const OPC = Object.fromEntries(PREGUNTAS.map(p => [p.campo, p.opciones.filter(o => o.v !== "no_se")]));
OPC.entradas = [{ v: "cuidar", t: "Sirve para cuidar las entradas" }, { v: "volumen", t: "Sirve para conservar volumen" }];
const ETQ = { borrador: "Borrador", pendiente: "Pendiente de revisión", verificado: "Verificado" };
const TABS = ["Información", "Compatibilidad", "Fotos y variantes", "Fuentes y publicación"];
let S = { seccion: "cortes", cortes: [], id: null, rol: "", csrf: "", r2: false, unico: false, filtro: "todos", q: "", tab: 0, sucio: false, vista: "lista" };

// ---------- utilidades ----------
let tMsg;
function aviso(t, mal = false) { $msg.textContent = t; $msg.className = "msg" + (mal ? " mal" : ""); $msg.hidden = false; clearTimeout(tMsg); tMsg = setTimeout(() => $msg.hidden = true, mal ? 7000 : 3500); }
function confirmar({ titulo, texto, ok = "Confirmar", peligro = false }) {
  return new Promise(res => {
    const d = document.createElement("dialog"); d.setAttribute("aria-labelledby", "ct");
    d.innerHTML = `<h3 id="ct">${esc(titulo)}</h3><p style="margin-top:10px">${esc(texto)}</p><div class="fila-btns"><button class="btn sec" value="no" autofocus>Cancelar</button><button class="btn ${peligro ? "peligro" : ""}" value="si">${esc(ok)}</button></div>`;
    d.querySelectorAll("button").forEach(b => b.onclick = () => { d.close(); res(b.value === "si"); });
    d.oncancel = () => res(false); d.onclose = () => d.remove(); document.body.append(d); d.showModal();
  });
}
const confirmarSalir = async () => !S.sucio || await confirmar({ titulo: "Tenés cambios sin guardar", texto: "Si salís ahora, se pierden los cambios de esta ficha.", ok: "Salir sin guardar", peligro: true });
addEventListener("beforeunload", e => { if (S.sucio) { e.preventDefault(); e.returnValue = ""; } });

async function api(metodo, ruta, cuerpo) {
  const init = { method: metodo, credentials: "same-origin", headers: {} };
  if (metodo !== "GET") init.headers["X-CSRF-Token"] = S.csrf;
  if (cuerpo instanceof FormData) init.body = cuerpo; else if (cuerpo !== undefined) { init.body = JSON.stringify(cuerpo); init.headers["Content-Type"] = "application/json"; }
  const res = await fetch("/api/admin" + ruta, init), data = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== "/login") { S.sucio = false; login("Tu sesión venció. Ingresá de nuevo."); throw new Error("Sesión vencida"); }
  if (!res.ok) { const e = new Error(data.error || "Error " + res.status); e.faltan = data.faltan; e.status = res.status; throw e; }
  return data;
}
const nav = () => `<nav class="seccion" aria-label="Secciones del gestor"><button data-seccion="cortes" aria-current="${S.seccion === "cortes"}">Fichas</button><button data-seccion="inv" aria-current="${S.seccion === "inv"}">Investigación asistida</button></nav>`;
app.addEventListener("click", async e => {
  const b = e.target.closest("[data-seccion]"); if (!b || b.dataset.seccion === S.seccion) return;
  if (!(await confirmarSalir())) return; S.sucio = false; S.seccion = b.dataset.seccion;
  if (S.seccion === "inv") { await invUI.iniciar(); } else pintar();
});
let invUI;
const actual = () => S.cortes.find(c => c.id === S.id);
const guardarEn = c => { const i = S.cortes.findIndex(x => x.id === c.id); i >= 0 ? S.cortes[i] = c : S.cortes.push(c); S.cortes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")); S.id = c.id; };
/** Ejecuta un cambio en el servidor. Los cambios sin guardar de las pestañas 1-2 no se pueden perder por accidente. */
async function accion(fn, ok, { permitirSucio = false } = {}) {
  if (S.sucio && !permitirSucio) return aviso("Primero guardá los cambios de Información / Compatibilidad (botón de abajo).", true);
  try { const c = await fn(); if (c?.id) guardarEn(c); S.sucio = false; aviso(ok); } catch (e) { aviso(e.message + (e.faltan ? ": " + e.faltan.join("; ") : ""), true); }
  pintar();
}
const publicado = c => c.estado === "verificado" && c.publicado;
function faltantes(c) {   // mismo criterio que el servidor, para guiar a la persona
  const f = [];
  if (!c.descripcion) f.push("Escribí la descripción (pestaña 1).");
  for (const [k, t] of [["pelos", "tipos de cabello"], ["largos", "largo necesario"], ["estilos", "estilos"]]) if (!c[k].length) f.push(`Marcá al menos un dato de «${t}» (pestaña 2).`);
  if (!c.fuentes.length) f.push("Cargá al menos una fuente con autor y enlace.");
  if (c.fuentes.some(x => !x.revisada_en)) f.push("Hay fuentes sin marcar como revisadas.");
  return f;
}

// ---------- ingreso ----------
function login(error = "") {
  document.getElementById("salir").hidden = true; document.getElementById("rol").innerHTML = "";
  app.innerHTML = `<form class="login" id="f"><h2>Ingresar</h2><label class="l" for="p">Contraseña</label><input id="p" type="password" autocomplete="current-password" required>
    <p class="err" role="alert" style="color:#ff8a8d;margin-top:8px">${esc(error)}</p><button class="btn" style="width:100%;margin-top:10px">Entrar</button></form>`;
  app.querySelector("#p").focus();
  app.querySelector("#f").onsubmit = async e => { e.preventDefault(); try { const r = await api("POST", "/login", { password: app.querySelector("#p").value }); S.csrf = r.csrf; await iniciar(); } catch (x) { login(x.message); } };
}
document.getElementById("salir").onclick = async () => { if (!(await confirmarSalir())) return; try { await api("POST", "/logout", {}); } catch {} S.csrf = ""; S.sucio = false; login(); };

// ---------- pantalla principal ----------
function lista() {
  const q = S.q.trim().toLowerCase(), n = f => S.cortes.filter(f).length;
  const filtros = { todos: () => true, borrador: c => c.estado === "borrador", pendiente: c => c.estado === "pendiente", verificado: c => c.estado === "verificado", publicado };
  const vis = S.cortes.filter(filtros[S.filtro]).filter(c => !q || c.nombre.toLowerCase().includes(q));
  const cnt = [["borrador", "Borradores"], ["pendiente", "Pendientes"], ["verificado", "Verificados"], ["publicado", "Publicados"]];
  return `<aside class="g-lista" aria-label="Lista de cortes"><div class="cnt">${cnt.map(([k, t]) => `<button data-f="${k}" aria-pressed="${S.filtro === k}"><b>${n(filtros[k])}</b><span>${t}</span></button>`).join("")}</div>
    <label class="sr" for="bq">Buscar corte</label><input id="bq" type="search" placeholder="Buscar corte…" value="${esc(S.q)}" autocomplete="off">
    <div class="filtros" role="group" aria-label="Filtrar por estado">${[["todos", "Todos"], ...cnt].map(([k, t]) => `<button data-f="${k}" aria-pressed="${S.filtro === k}">${t}</button>`).join("")}</div>
    <div>${vis.map(c => `<button class="item" data-id="${c.id}" aria-current="${c.id === S.id}"><span>${esc(c.nombre)}</span><span class="badge ${publicado(c) ? "publicado" : c.estado}">${publicado(c) ? "Publicado" : ETQ[c.estado]}</span></button>`).join("") || `<p class="muted">No hay cortes con ese filtro.</p>`}</div>
    <form id="nuevo" class="panel-card"><label class="l" for="nn" style="margin-top:0">Crear un corte nuevo</label><input id="nn" type="text" maxlength="80" required placeholder="Nombre del corte"><button class="btn sec" style="width:100%;margin-top:8px">+ Crear borrador</button></form></aside>`;
}
function pintar() {
  if (S.seccion === "inv") return invUI.pintar();
  const c = actual(), foco = document.activeElement?.id;
  document.getElementById("salir").hidden = false;
  document.getElementById("rol").innerHTML = `<span class="badge ${S.rol === "revisor" ? "verificado" : "pendiente"}">${S.rol === "revisor" ? (S.unico ? "Acceso completo" : "Revisor") : "Editor"}</span>`;
  app.innerHTML = `${nav()}<div class="g-cuerpo" data-vista="${S.vista}">${lista()}<section class="g-editor" aria-label="Edición">${c ? editor(c) : `<div class="panel-card muted">Elegí un corte de la lista o creá uno nuevo.</div>`}</section></div>`;
  enlazarLista(); if (c) enlazarEditor(c);
  if (foco === "bq") { const b = app.querySelector("#bq"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
}
function enlazarLista() {
  app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { S.filtro = S.filtro === b.dataset.f && b.closest(".cnt") ? "todos" : b.dataset.f; pintar(); });
  app.querySelector("#bq").oninput = e => { S.q = e.target.value; pintar(); };
  app.querySelectorAll(".item").forEach(b => b.onclick = async () => { if (+b.dataset.id !== S.id && !(await confirmarSalir())) return; S.sucio = false; S.id = +b.dataset.id; S.tab = 0; S.vista = "editor"; pintar(); });
  app.querySelector("#nuevo").onsubmit = e => { e.preventDefault(); S.vista = "editor"; S.tab = 0; accion(() => api("POST", "/cortes", { nombre: app.querySelector("#nn").value }), "Corte creado como borrador"); };
}

// ---------- editor ----------
const chips = (k, vals) => `<div class="chips" role="group">${OPC[k].map(o => `<label><input type="checkbox" name="${k}" value="${o.v}" ${vals.includes(o.v) ? "checked" : ""}>${esc(o.t)}</label>`).join("")}</div>`;
function editor(c) {
  const o = (v, t) => `<option value="${v}" ${(c.tiempo_peinado || "") === v ? "selected" : ""}>${t}</option>`;
  return `<button class="btn sec g-volver" id="volver" style="margin:8px 0">← Todos los cortes</button>
    <div class="row"><h2>${esc(c.nombre)}</h2><span class="badge ${publicado(c) ? "publicado" : c.estado}">${publicado(c) ? "Publicado" : ETQ[c.estado]}</span></div>
    <div class="tabs" role="tablist" aria-label="Secciones de la ficha">${TABS.map((t, i) => `<button role="tab" id="tab${i}" aria-selected="${S.tab === i}" aria-controls="pan${i}" data-t="${i}"><b>${i + 1}</b>${t}</button>`).join("")}</div>
    <form id="ficha" novalidate>
      <div role="tabpanel" id="pan0" aria-labelledby="tab0" ${S.tab === 0 ? "" : "hidden"} class="panel-card">
        <p class="hint">Escribí solo lo que podés respaldar con una fuente. Lo que cargues acá lo van a leer los clientes.</p>
        <label class="l" for="f-nombre">Nombre del corte</label><input id="f-nombre" type="text" name="nombre" maxlength="80" value="${esc(c.nombre)}" required>
        <label class="l" for="f-desc">Descripción</label><textarea id="f-desc" name="descripcion" maxlength="1000">${esc(c.descripcion)}</textarea>
        <label class="l" for="f-car">Características técnicas</label><textarea id="f-car" name="caracteristicas" maxlength="1500">${esc(c.caracteristicas)}</textarea>
        <label class="l" for="f-man">Mantenimiento</label><textarea id="f-man" name="mantenimiento" maxlength="800">${esc(c.mantenimiento)}</textarea>
        <label class="l" for="f-tp">Tiempo de peinado que requiere</label><select id="f-tp" name="tiempo_peinado">${o("", "Sin dato")}${o("poco", "Menos de 5 minutos")}${o("medio", "Entre 5 y 15 minutos")}${o("mucho", "Más de 15 minutos")}</select>
        <label class="l" for="f-nota">Notas internas (los clientes nunca las ven)</label><textarea id="f-nota" name="notas_internas" maxlength="2000">${esc(c.notas_internas)}</textarea>
      </div>
      <div role="tabpanel" id="pan1" aria-labelledby="tab1" ${S.tab === 1 ? "" : "hidden"} class="panel-card">
        <p class="hint">Si una fuente no dice nada sobre un punto, dejalo sin marcar: el asesor lo ignora en lugar de inventarlo.</p>
        ${LISTAS.map(([k, t, h]) => `<fieldset style="border:0;padding:0"><legend class="l">${t}</legend><p class="hint">${h}</p>${chips(k, c[k])}</fieldset>`).join("")}
      </div>
    </form>
    <div role="tabpanel" id="pan2" aria-labelledby="tab2" ${S.tab === 2 ? "" : "hidden"}>${fotosYVariantes(c)}</div>
    <div role="tabpanel" id="pan3" aria-labelledby="tab3" ${S.tab === 3 ? "" : "hidden"}>${fuentesYPublicacion(c)}</div>
    <div class="g-guardar"><span class="estado ${S.sucio ? "sucio" : ""}" id="estadoG">${S.sucio ? "● Tenés cambios sin guardar" : "✓ Todo guardado"}</span>
      <button class="btn sec" type="button" id="prev">Vista previa</button><button class="btn" form="ficha" id="guardar" ${S.sucio ? "" : "disabled"}>Guardar</button></div>`;
}
function fotosYVariantes(c) {
  const sel = (n, op, v) => `<select name="${n}" aria-label="${n}"><option value="">Sin dato</option>${op.map(([a, b]) => `<option value="${a}" ${v === a ? "selected" : ""}>${b}</option>`).join("")}</select>`;
  const L = [["degradado", "Degradado"], ["tijera", "Tijera"]], A = [["bajo", "Bajo"], ["medio", "Medio"], ["alto", "Alto"]], T = [["comprimida", "Comprimida"], ["equilibrada", "Equilibrada"], ["estirada", "Estirada"]];
  const fila = v => `<form class="sub-card var" data-id="${v?.id || ""}"><label class="l" style="margin-top:0">Nombre de la variante</label><input type="text" name="nombre" maxlength="80" value="${esc(v?.nombre)}" required>
    <label class="l">Descripción</label><textarea name="descripcion" maxlength="500" style="min-height:64px">${esc(v?.descripcion)}</textarea>
    <div class="fila-btns"><div><label class="l">Laterales</label>${sel("laterales", L, v?.laterales)}</div><div><label class="l">Altura</label>${sel("altura", A, v?.altura)}</div><div><label class="l">Transición</label>${sel("transicion", T, v?.transicion)}</div></div>
    <div class="fila-btns"><button class="btn sec">${v ? "Guardar variante" : "+ Agregar variante"}</button>${v ? `<button type="button" class="btn peligro" data-del="variantes/${v.id}" data-n="${esc(v.nombre)}">Borrar</button>` : ""}</div></form>`;
  return `<div class="panel-card"><h3>Fotografías</h3><p class="hint">Estos cambios se guardan al instante. Solo subí fotos propias o con permiso. <b>Nunca fotos de clientes sin su consentimiento.</b></p>
    ${r2Aviso()}<div class="galeria">${c.imagenes.map(i => `<figure><img src="/api/admin/imagenes/${i.id}" alt="${esc(i.alt)}"><figcaption>${esc(i.derechos)}<br><button class="btn peligro" style="min-height:40px;margin-top:6px;width:100%" data-delimg="${i.id}">Borrar</button></figcaption></figure>`).join("") || `<p class="muted">Todavía no hay fotos.</p>`}</div>
    <form id="subir"><label class="l">Archivo (JPG, PNG o WebP, hasta 2 MB)</label><input type="file" name="archivo" accept="image/jpeg,image/png,image/webp" required>
    <label class="l">Qué muestra la foto</label><input type="text" name="alt" maxlength="200" placeholder="Ej.: corte visto de costado">
    <label class="l">De quién es la foto o con qué permiso se usa</label><input type="text" name="derechos" maxlength="300" required placeholder="Ej.: foto propia de Las Vegas">
    <div class="chips" style="margin-top:12px"><label><input type="checkbox" name="confirmo_sin_clientes" value="1" required>Confirmo que NO es una foto de un cliente sin su consentimiento</label></div>
    <button class="btn sec" style="width:100%;margin-top:10px" ${S.r2 ? "" : "disabled"}>Subir foto</button></form></div>
    <div class="panel-card"><h3>Variantes</h3><p class="hint">Versiones del corte (por ejemplo, con degradado bajo o alto). El asesor elige la más cercana a lo que pidió la persona.</p>${c.variantes.map(fila).join("")}${fila(null)}</div>`;
}
const r2Aviso = () => S.r2 ? "" : `<div class="aviso">El almacenamiento de fotos todavía no está activado en este entorno.</div>`;
function fuentesYPublicacion(c) {
  const rev = S.rol === "revisor", falta = faltantes(c), verif = c.estado === "verificado";
  const fila = f => `<form class="sub-card fte" data-id="${f?.id || ""}"><label class="l" style="margin-top:0">Autor (persona u organización)</label><input type="text" name="autor" maxlength="120" value="${esc(f?.autor)}" required>
    <label class="l">Título</label><input type="text" name="titulo" maxlength="200" value="${esc(f?.titulo)}">
    <label class="l">Enlace (empieza con https://)</label><input type="url" name="url" maxlength="500" value="${esc(f?.url)}" required placeholder="https://">
    <label class="l">¿Qué dato de la ficha respalda?</label><textarea name="afirmacion" maxlength="500" style="min-height:64px">${esc(f?.afirmacion)}</textarea>
    <label class="l">Fecha en que la leíste</label><input type="date" name="consultada_en" value="${esc(f?.consultada_en)}">
    ${f ? `<p style="margin-top:10px"><span class="rev ${f.revisada_en ? "ok" : ""}">${f.revisada_en ? "Revisada " + esc(f.revisada_en.slice(0, 10)) : "Sin revisar"}</span></p>` : ""}
    <div class="fila-btns"><button class="btn sec">${f ? "Guardar fuente" : "+ Agregar fuente"}</button>
      ${f && rev ? `<button type="button" class="btn sec" data-revisar="${f.id}" data-v="${f.revisada_en ? 0 : 1}">${f.revisada_en ? "Quitar revisión" : "Marcar como revisada"}</button>` : ""}
      ${f ? `<button type="button" class="btn peligro" data-del="fuentes/${f.id}" data-n="${esc(f.autor)}">Borrar</button>` : ""}</div></form>`;
  const soloRev = t => rev ? "" : `<p class="hint">${t} Lo hace una persona con rol <b>revisor</b>.</p>`;
  return `<div class="panel-card"><h3>Fuentes profesionales</h3><p class="hint">Cargá solo fuentes reales que hayas leído. Un texto generado por IA no es una fuente. Si editás una fuente, vuelve a quedar «sin revisar».</p>${c.fuentes.map(fila).join("")}${fila(null)}</div>
    <div class="panel-card"><h3>Revisión y publicación</h3><p class="hint">Son tres pasos separados. Los clientes solo ven recomendaciones de fichas que completaron los tres.${S.unico ? " <b>Hoy hacés todos los pasos vos.</b>" : ""}</p>
    <ol class="pasos"><li class="${c.fuentes.length && c.fuentes.every(f => f.revisada_en) ? "hecho" : ""}"><div><b>Revisar las fuentes</b><br><span class="muted">Cada fuente se marca como revisada.</span></div></li>
      <li class="${verif ? "hecho" : ""}"><div><b>Verificar la ficha</b><br><span class="muted">${verif ? `Verificada por ${esc(c.verificado_por)}` : "Se confirma que el contenido coincide con las fuentes."}</span></div></li>
      <li class="${publicado(c) ? "hecho" : ""}"><div><b>Publicarla</b><br><span class="muted">${publicado(c) ? "Visible para los clientes." : "Recién ahí aparece en las recomendaciones."}</span></div></li></ol>
    ${falta.length && !verif ? `<p style="margin-top:12px"><b>Para poder verificarla falta:</b></p><ul class="falta-lista">${falta.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="fila-btns">
      ${c.estado === "borrador" ? `<button class="btn sec" data-est="pendiente">Enviar a revisión</button>` : ""}
      ${c.estado !== "borrador" ? `<button class="btn sec" data-est="borrador" data-pide="1">Volver a borrador</button>` : ""}
      ${c.estado === "pendiente" && rev ? `<button class="btn" data-verificar ${falta.length ? "disabled" : ""}>Verificar ficha</button>` : ""}
      ${verif && rev ? `<button class="btn ${c.publicado ? "peligro" : ""}" data-pub="${c.publicado ? 0 : 1}">${c.publicado ? "Retirar del público" : "Publicar"}</button>` : ""}</div>
    ${c.estado === "pendiente" ? soloRev("Para verificar hace falta tu revisión de las fuentes.") : ""}${verif && !rev ? soloRev("Para publicar o retirar.") : ""}
    ${verif && c.estado === "verificado" ? `<p class="hint" style="margin-top:10px">Si cambiás algo de esta ficha o de sus fuentes, vuelve a «pendiente» y se retira del público hasta volver a verificarla.</p>` : ""}</div>`;
}

function enlazarEditor(c) {
  const f = app.querySelector("#ficha");
  app.querySelector("#volver").onclick = async () => { if (!(await confirmarSalir())) return; S.sucio = false; S.vista = "lista"; pintar(); };
  app.querySelectorAll("[role=tab]").forEach(b => { b.onclick = () => { S.tab = +b.dataset.t; app.querySelectorAll("[role=tab]").forEach(x => x.setAttribute("aria-selected", String(x === b))); app.querySelectorAll("[role=tabpanel]").forEach((p, i) => p.hidden = i !== S.tab); };
    b.onkeydown = e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { const n = app.querySelector("#tab" + ((S.tab + d + 4) % 4)); n.click(); n.focus(); } }; });
  const marcar = () => { S.sucio = true; const e = app.querySelector("#estadoG"); e.textContent = "● Tenés cambios sin guardar"; e.className = "estado sucio"; app.querySelector("#guardar").disabled = false; };
  f.addEventListener("input", marcar); f.addEventListener("change", marcar);
  f.onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f).entries());
    if (!d.nombre.trim()) return aviso("El nombre no puede quedar vacío.", true);
    const cuerpo = { nombre: d.nombre, descripcion: d.descripcion, caracteristicas: d.caracteristicas, mantenimiento: d.mantenimiento, notas_internas: d.notas_internas, tiempo_peinado: d.tiempo_peinado || null };
    for (const [k] of LISTAS) cuerpo[k] = [...f.querySelectorAll(`input[name=${k}]:checked`)].map(i => i.value);
    const verificada = c.estado === "verificado";
    (async () => { if (verificada && !(await confirmar({ titulo: "Esta ficha está verificada", texto: "Si guardás cambios, vuelve a «pendiente de revisión» y se retira del público hasta que la verifiquen de nuevo.", ok: "Guardar igual", peligro: true }))) return;
      accion(() => api("PUT", "/cortes/" + c.id, cuerpo), "Cambios guardados", { permitirSucio: true }); })();
  };
  app.querySelector("#prev").onclick = () => vistaPrevia(c);
  app.querySelectorAll("[data-est]").forEach(b => b.onclick = async () => {
    if (b.dataset.pide && !(await confirmar({ titulo: "Volver a borrador", texto: "La ficha deja de poder recomendarse y se retira del público.", ok: "Volver a borrador", peligro: true }))) return;
    accion(() => api("POST", `/cortes/${c.id}/estado`, { estado: b.dataset.est }), "Estado actualizado");
  });
  const v = app.querySelector("[data-verificar]");
  if (v) v.onclick = async () => { if (await confirmar({ titulo: "Verificar ficha", texto: "Confirmás que revisaste el contenido de esta ficha contra sus fuentes. Todavía no se publica: es otro paso.", ok: "Sí, verificar" })) accion(() => api("POST", `/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: true }), "Ficha verificada. Falta publicarla."); };
  app.querySelectorAll("[data-pub]").forEach(b => b.onclick = async () => { const on = b.dataset.pub === "1";
    if (await confirmar({ titulo: on ? "Publicar ficha" : "Retirar del público", texto: on ? "Desde ahora los clientes pueden recibir esta ficha en sus recomendaciones." : "Los clientes dejan de verla y de recibirla en recomendaciones.", ok: on ? "Sí, publicar" : "Sí, retirar", peligro: !on }))
      accion(() => api("POST", `/cortes/${c.id}/publicar`, { publicado: on, confirmo: on }), on ? "Ficha publicada" : "Ficha retirada"); });
  app.querySelectorAll("[data-revisar]").forEach(b => b.onclick = () => accion(() => api("POST", `/fuentes/${b.dataset.revisar}/revisar`, { revisada: b.dataset.v === "1" }), b.dataset.v === "1" ? "Fuente marcada como revisada" : "Revisión quitada"));
  for (const [sel, tipo] of [[".var", "variantes"], [".fte", "fuentes"]]) app.querySelectorAll(sel).forEach(form => form.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(form).entries()), id = form.dataset.id;
    if (id && c.estado === "verificado" && !(await confirmar({ titulo: "Esta ficha está verificada", texto: "Cambiar esto la devuelve a «pendiente» y la retira del público.", ok: "Guardar igual", peligro: true }))) return;
    accion(() => id ? api("PUT", `/${tipo}/${id}`, d) : api("POST", `/cortes/${c.id}/${tipo}`, d), id ? "Guardado" : "Agregado"); });
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (await confirmar({ titulo: "Borrar", texto: `Vas a borrar «${b.dataset.n}». No se puede deshacer.`, ok: "Borrar", peligro: true })) accion(() => api("DELETE", "/" + b.dataset.del), "Borrado"); });
  app.querySelectorAll("[data-delimg]").forEach(b => b.onclick = async () => { if (await confirmar({ titulo: "Borrar foto", texto: "La foto se elimina para siempre.", ok: "Borrar", peligro: true })) accion(() => api("DELETE", "/imagenes/" + b.dataset.delimg), "Foto borrada"); });
  app.querySelector("#subir").onsubmit = e => { e.preventDefault(); accion(() => api("POST", `/cortes/${c.id}/imagenes`, new FormData(e.target)), "Foto subida"); };
}
function vistaPrevia(c) {
  const corte = { ...c, imagenes: c.imagenes.map(i => ({ url: `/api/admin/imagenes/${i.id}`, alt: i.alt })) };
  const d = document.createElement("dialog"); d.setAttribute("aria-label", "Vista previa para clientes"); d.style.maxHeight = "92vh"; d.style.overflow = "auto";
  d.innerHTML = `<h3>Así lo ve el cliente</h3><p class="hint">${publicado(c) ? "Esta ficha está publicada." : "Todavía NO la ven los clientes: necesita estar verificada y publicada."} Se muestran tus cambios ya guardados.</p>
    ${tarjeta({ corte, razones: [], respaldo: c.fuentes.map(f => ({ autor: f.autor, titulo: f.titulo, url: f.url, afirmacion: f.afirmacion })) }, {})}<button class="btn sec" style="width:100%" autofocus>Cerrar</button>`;
  d.querySelector("button.btn").onclick = () => d.close(); d.onclose = () => d.remove(); document.body.append(d); d.showModal();
}

async function iniciar() {
  try { const m = await api("GET", "/me"); Object.assign(S, { csrf: m.csrf, rol: m.rol, r2: m.r2, unico: m.modo_unico }); S.cortes = await api("GET", "/cortes"); S.id ??= null; S.vista = "lista"; invUI ??= crearInvestigacion({ api, aviso, confirmar, S, app, nav }); pintar(); }
  catch { login(); }
}
iniciar();
