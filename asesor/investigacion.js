// Investigación asistida (gestor). La IA o una persona PROPONEN; cada paso importante lo decide y firma una persona.
import { PREGUNTAS } from "./engine.js";
import { esc, tarjeta } from "./vista.js";

const EST = { pendiente: "Pendiente", investigando: "Investigando", propuesta_preparada: "Propuesta preparada", en_revision: "En revisión", aprobada: "Aprobada", rechazada: "Rechazada" };
const FLUJO = ["pendiente", "investigando", "propuesta_preparada", "en_revision", "aprobada"];
const NIVEL = { encontrada: "Encontrada", leida: "Leída", validada: "Validada" };
const NIVEL_AYUDA = { encontrada: "Apareció, pero nadie confirmó haberla leído.", leida: "Alguien leyó el documento (o se guardó su texto).", validada: "Un revisor confirmó que es una fuente profesional confiable." };
const CAMPOS = [["descripcion", "Descripción", "t"], ["caracteristicas", "Características técnicas", "t"], ["mantenimiento", "Mantenimiento", "t"], ["tiempo_peinado", "Tiempo de peinado", "tp"],
  ["pelos", "Tipos de cabello", "l"], ["largos", "Largo necesario", "l"], ["estilos", "Estilos", "l"], ["entradas", "Entradas", "l"], ["densidades", "Densidad", "l"], ["volumenes", "Volumen", "l"], ["laterales", "Laterales", "l"], ["alturas", "Altura del degradado", "l"], ["transiciones", "Transición", "l"]];
const ETQ_CAMPO = Object.fromEntries(CAMPOS.map(c => [c[0], c[1]]));
const OPC = Object.fromEntries(PREGUNTAS.map(p => [p.campo, p.opciones.filter(o => o.v !== "no_se")]));
OPC.entradas = [{ v: "cuidar", t: "Sirve para cuidar las entradas" }, { v: "volumen", t: "Sirve para conservar volumen" }];
const TIEMPOS = { poco: "Menos de 5 minutos", medio: "Entre 5 y 15 minutos", mucho: "Más de 15 minutos" };
const TABS = ["Fuentes encontradas", "Revisión de afirmaciones", "Vista previa", "Aprobar y publicar"];
const fmt = (campo, v) => Array.isArray(v) ? v.map(x => OPC[campo]?.find(o => o.v === x)?.t || x).join(", ") : campo === "tiempo_peinado" ? (TIEMPOS[v] || v) : v;
const fecha = s => s ? String(s).slice(0, 16).replace("T", " ") : "";

export function crearInvestigacion(ctx) {
  const { api, aviso, confirmar, S, app, nav } = ctx;
  const V = { pant: "biblioteca", invs: [], inv: null, cap: null, q: "", tab: 0, sel: new Set() };

  async function cargarBase() { [V.invs, V.cap] = await Promise.all([api("GET", "/investigaciones"), api("GET", "/investigaciones/capacidades")]); }
  async function abrir(id) { V.inv = await api("GET", "/investigaciones/" + id); V.pant = "inv"; V.sel.clear(); pintar(); }
  async function accion(fn, ok) { try { const r = await fn(); if (r?.id && r.fuentes) V.inv = r; aviso(ok); } catch (e) { aviso(e.message + (e.faltan ? ": " + e.faltan.join("; ") : ""), true); if (e.status === 502 && V.inv) V.inv = await api("GET", "/investigaciones/" + V.inv.id); } pintar(); }
  async function iniciar() { try { await cargarBase(); V.pant = "biblioteca"; pintar(); } catch (e) { aviso(e.message, true); } }

  const chipEstado = e => `<span class="badge ${e === "aprobada" ? "verificado" : e === "rechazada" ? "" : "pendiente"}">${EST[e]}</span>`;
  const demoTag = i => i.demo ? `<span class="badge" style="color:#fff;background:var(--red);border-color:var(--red)">DEMO</span>` : "";

  // ---------- 1. Biblioteca de cortes ----------
  async function biblioteca() {
    const cortes = S.cortes, q = V.q.trim().toLowerCase();
    const ult = id => V.invs.find(i => i.corte_id === id);
    const vis = cortes.filter(c => !q || c.nombre.toLowerCase().includes(q));
    app.innerHTML = `${nav()}<h2>Investigación asistida</h2><p class="hint">Elegí un corte para investigarlo y armar su ficha con fuentes reales. La IA propone; una persona decide.</p>
      ${avisoCap()}<button class="btn" id="nueva" style="width:100%;margin:6px 0 10px">+ Nueva investigación</button>
      <label class="sr" for="bq">Buscar corte</label><input id="bq" type="search" placeholder="Buscar en la biblioteca…" value="${esc(V.q)}" autocomplete="off">
      <div style="margin-top:10px">${vis.map(c => { const i = ult(c.id); return `<div class="item sub-card" style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin:8px 0">
        <div><b>${esc(c.nombre)}</b><br><span class="small muted">Ficha: ${c.estado === "verificado" ? (c.publicado ? "publicada" : "verificada") : c.estado}</span>${i ? `<br>${chipEstado(i.estado)} ${demoTag(i)} <span class="small muted">${i.n_fuentes} fuentes · ${i.n_afirmaciones} afirmaciones</span>` : ""}</div>
        <button class="btn sec" data-c="${c.id}" ${i && ["aprobada", "rechazada"].includes(i.estado) ? "" : ""}>${i && !["aprobada", "rechazada"].includes(i.estado) ? "Continuar" : "Investigar"}</button></div>`; }).join("") || `<p class="muted">No hay cortes con ese nombre.</p>`}</div>`;
    app.querySelector("#nueva").onclick = () => { V.pant = "nueva"; pintar(); };
    app.querySelector("#bq").oninput = e => { V.q = e.target.value; biblioteca(); const b = app.querySelector("#bq"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); };
    app.querySelectorAll("[data-c]").forEach(b => b.onclick = async () => {
      const id = +b.dataset.c, abierta = V.invs.find(i => i.corte_id === id && !["aprobada", "rechazada"].includes(i.estado));
      if (abierta) return abrir(abierta.id);
      accion(() => api("POST", "/investigaciones", { corte_id: id }).then(r => (V.pant = "inv", r)), "Investigación creada").then(cargarBase);
    });
  }
  const avisoCap = () => !V.cap ? "" : (V.cap.ia && V.cap.busqueda
    ? `<div class="aviso">Investigación automática disponible (${esc(V.cap.redactor)} + ${esc(V.cap.buscador)}). Hoy usaste ${V.cap.uso_hoy.busquedas || 0}/${V.cap.limites.busquedas} búsquedas y ${V.cap.uso_hoy.propuestas || 0}/${V.cap.limites.propuestas} propuestas.</div>`
    : `<div class="aviso"><b>Investigación automática no disponible.</b> Podés trabajar a mano: cargá fuentes reales, marcá cuáles leíste y escribí cada afirmación con su cita. ${V.cap.ia || V.cap.busqueda ? "(Falta configurar " + (V.cap.ia ? "el buscador" : "Workers AI") + ".)" : ""}</div>`);

  // ---------- 2. Nueva investigación ----------
  function nueva() {
    const libres = S.cortes.filter(c => !V.invs.some(i => i.corte_id === c.id && !["aprobada", "rechazada"].includes(i.estado)));
    app.innerHTML = `${nav()}<button class="btn sec" id="atras" style="margin-bottom:8px">← Biblioteca</button><h2>Nueva investigación</h2>${avisoCap()}
      <form id="f" class="panel-card"><label class="l" for="corte" style="margin-top:0">Corte existente</label>
      <select id="corte"><option value="">— Crear un corte nuevo —</option>${libres.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select>
      <div id="nn"><label class="l" for="nombre">Nombre del corte nuevo</label><input id="nombre" type="text" maxlength="80" placeholder="Ej.: Taper fade clásico"><p class="hint">Se crea como borrador: no se muestra a los clientes.</p></div>
      <label class="l" for="consulta">Qué buscar (opcional)</label><input id="consulta" type="text" maxlength="200" placeholder="Si lo dejás vacío se usa el nombre del corte"><p class="hint">Solo se usa si la búsqueda automática está disponible.</p>
      <button class="btn" style="width:100%;margin-top:12px">Crear investigación</button></form>`;
    const sel = app.querySelector("#corte"), nn = app.querySelector("#nn");
    sel.onchange = () => nn.hidden = !!sel.value;
    app.querySelector("#atras").onclick = () => { V.pant = "biblioteca"; pintar(); };
    app.querySelector("#f").onsubmit = e => { e.preventDefault(); const b = { consulta: app.querySelector("#consulta").value }; if (sel.value) b.corte_id = +sel.value; else b.nombre = app.querySelector("#nombre").value;
      accion(async () => { const r = await api("POST", "/investigaciones", b); const nuevo = await api("GET", "/cortes"); S.cortes.splice(0, S.cortes.length, ...nuevo); V.pant = "inv"; V.tab = 0; await cargarBase(); return r; }, "Investigación creada"); };
  }

  // ---------- 3. Investigación abierta ----------
  const editable = i => ["pendiente", "investigando", "propuesta_preparada"].includes(i.estado);
  function cabecera(i) {
    const k = FLUJO.indexOf(i.estado);
    return `<button class="btn sec" id="atras" style="margin-bottom:8px">← Biblioteca</button>
      <div class="row"><h2>${esc(i.corte_nombre)}</h2><span>${demoTag(i)} ${chipEstado(i.estado)}</span></div>
      ${i.demo ? `<div class="aviso" style="border-color:var(--red)"><b>DEMOSTRACIÓN.</b> Los datos de esta investigación son inventados para probar el sistema. No son información profesional y no se pueden aplicar a una ficha.</div>` : ""}
      <ol class="pasos" style="grid-template-columns:repeat(5,1fr);gap:4px;margin:8px 0">${FLUJO.map((e, n) => `<li class="${k > n || i.estado === "aprobada" ? "hecho" : ""}" style="padding:6px 2px;flex-direction:column;align-items:center;text-align:center;font-size:12px;${n === k ? "border-color:var(--white)" : ""}"><span class="sr">${n === k ? "Paso actual: " : ""}</span>${EST[e]}</li>`).join("")}</ol>
      ${i.estado === "rechazada" ? `<div class="aviso">Rechazada${i.decidida_en ? " el " + esc(fecha(i.decidida_en)) : ""} por ${esc(i.decidida_por)}. Motivo: ${esc(i.nota_decision)}</div>` : ""}
      ${i.error ? `<div class="aviso" style="border-color:var(--red)">Último aviso del proveedor: ${esc(i.error)}. Tu trabajo está guardado y podés seguir a mano.</div>` : ""}
      <div class="tabs" role="tablist" aria-label="Pasos">${TABS.map((t, n) => `<button role="tab" id="itab${n}" aria-selected="${V.tab === n}" data-t="${n}"><b>${n + 1}</b>${t}</button>`).join("")}</div>`;
  }
  function inv() {
    const i = V.inv;
    app.innerHTML = `${nav()}${cabecera(i)}<div id="cont"></div>`;
    app.querySelector("#atras").onclick = async () => { await cargarBase(); V.pant = "biblioteca"; pintar(); };
    app.querySelectorAll("[role=tab]").forEach(b => { b.onclick = () => { V.tab = +b.dataset.t; inv(); }; b.onkeydown = e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { V.tab = (V.tab + d + 4) % 4; inv(); app.querySelector("#itab" + V.tab).focus(); } }; });
    [fuentes, afirmaciones, vistaPrevia, aprobar][V.tab](app.querySelector("#cont"));
  }

  // --- Fuentes encontradas ---
  function fuentes(el) {
    const i = V.inv, rev = S.rol === "revisor", auto = V.cap?.ia && V.cap?.busqueda;
    el.innerHTML = `<div class="panel-card"><h3>Fuentes encontradas</h3>
      <p class="hint">Una fuente pasa por tres niveles: <b>encontrada</b> → <b>leída</b> → <b>validada</b>. Solo las fuentes leídas pueden respaldar una afirmación y solo las validadas permiten aprobar.</p>
      ${auto ? `<div class="fila-btns"><button class="btn sec" id="buscar" ${editable(i) ? "" : "disabled"}>Buscar fuentes con el buscador</button><button class="btn" id="proponer" ${editable(i) ? "" : "disabled"}>Leer y proponer con IA (marcadas)</button></div><p class="hint">La búsqueda y la IA tienen un tope diario. Elegí hasta 3 fuentes para leer.</p>`
        : `<div class="aviso"><b>Investigación automática no disponible.</b> Cargá las fuentes a mano (abajo).</div>`}
      ${i.fuentes.map(f => `<div class="sub-card"><div class="row"><b>${esc(f.titulo || f.url)}</b><span class="rev ${f.nivel === "validada" ? "ok" : ""}" title="${esc(NIVEL_AYUDA[f.nivel])}">${NIVEL[f.nivel]}</span></div>
        <p class="small muted">${esc(f.autor || "Sin autor")} · ${f.origen === "busqueda" ? "encontrada por el buscador" : "cargada a mano"}</p><p class="small"><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--link);word-break:break-all">${esc(f.url)}</a></p>
        <p class="small muted">${NIVEL_AYUDA[f.nivel]}${f.texto_len ? ` Texto guardado: ${Math.round(f.texto_len / 1024) || 1} KB.` : ""}${f.leida_por ? ` Leída por ${esc(f.leida_por)} (${esc(fecha(f.leida_en))}).` : ""}${f.validada_por ? ` Validada por ${esc(f.validada_por)} (${esc(fecha(f.validada_en))}).` : ""}</p>
        <div class="fila-btns">${auto && editable(i) ? `<label class="chips" style="flex:0 0 auto"><span class="chips"><label><input type="checkbox" data-sel="${f.id}" ${V.sel.has(f.id) ? "checked" : ""}>Para la IA</label></span></label>` : ""}
          ${editable(i) && f.nivel === "encontrada" ? `<button class="btn sec" data-leida="${f.id}">Marcar como leída</button>` : ""}
          ${editable(i) && f.nivel !== "encontrada" && !f.texto_len ? `<button class="btn sec" data-leida="${f.id}">Pegar texto</button>` : ""}
          ${rev && f.nivel === "leida" && ["pendiente", "investigando", "propuesta_preparada", "en_revision"].includes(i.estado) ? `<button class="btn" data-val="${f.id}" data-v="1">Validar fuente</button>` : ""}
          ${rev && f.nivel === "validada" && i.estado !== "aprobada" ? `<button class="btn sec" data-val="${f.id}" data-v="0">Quitar validación</button>` : ""}
          ${editable(i) ? `<button class="btn peligro" data-del="${f.id}" data-n="${esc(f.titulo || f.url)}">Quitar</button>` : ""}</div>
        ${f.nivel === "leida" && !rev ? `<p class="hint">La validación la hace una persona con rol revisor.</p>` : ""}</div>`).join("") || `<p class="muted">Todavía no hay fuentes.</p>`}</div>
      ${editable(i) ? `<form id="nf" class="panel-card"><h3>Agregar una fuente a mano</h3><label class="l" style="margin-top:0">Autor (persona u organización)</label><input type="text" name="autor" maxlength="120" required><label class="l">Título</label><input type="text" name="titulo" maxlength="200"><label class="l">Enlace (https://…)</label><input type="url" name="url" required placeholder="https://"><p class="hint">Solo documentos reales que hayas encontrado. No pegues enlaces dudosos ni generados por IA.</p><button class="btn sec" style="width:100%">+ Agregar fuente</button></form>` : ""}`;
    el.querySelector("#nf")?.addEventListener("submit", e => { e.preventDefault(); accion(() => api("POST", `/investigaciones/${i.id}/fuentes`, Object.fromEntries(new FormData(e.target))), "Fuente agregada"); });
    el.querySelector("#buscar")?.addEventListener("click", () => accion(async () => { const r = await api("POST", `/investigaciones/${i.id}/buscar`, {}); V.cap = await api("GET", "/investigaciones/capacidades"); return r; }, "Búsqueda lista: revisá las fuentes encontradas"));
    el.querySelector("#proponer")?.addEventListener("click", () => { if (!V.sel.size) return aviso("Marcá al menos una fuente “Para la IA”.", true); accion(async () => { const r = await api("POST", `/investigaciones/${i.id}/proponer`, { fuente_ids: [...V.sel] }); V.cap = await api("GET", "/investigaciones/capacidades"); V.sel.clear(); if (r.resumen_ia) aviso(`La IA propuso ${r.resumen_ia.propuestas} afirmaciones (${r.resumen_ia.descartadas} descartadas por no tener cita literal). Falta tu revisión.`); return r; }, "Propuesta lista para revisar"); });
    el.querySelectorAll("[data-sel]").forEach(c => c.onchange = () => { c.checked ? V.sel.add(+c.dataset.sel) : V.sel.delete(+c.dataset.sel); if (V.sel.size > 3) { V.sel.delete(+c.dataset.sel); c.checked = false; aviso("Máximo 3 fuentes por vez.", true); } });
    el.querySelectorAll("[data-leida]").forEach(b => b.onclick = () => dialogoLeida(+b.dataset.leida));
    el.querySelectorAll("[data-val]").forEach(b => b.onclick = async () => { const v = b.dataset.v === "1"; if (!v || await confirmar({ titulo: "Validar fuente", texto: "Confirmás que leíste la fuente y que es un material profesional confiable para sustentar esta ficha.", ok: "Validar" })) accion(() => api("POST", `/investigaciones/fuentes/${b.dataset.val}/validar`, { validada: v }), v ? "Fuente validada" : "Validación quitada"); });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (await confirmar({ titulo: "Quitar fuente", texto: `Se quita «${b.dataset.n}» de esta investigación.`, ok: "Quitar", peligro: true })) accion(() => api("DELETE", `/investigaciones/fuentes/${b.dataset.del}`), "Fuente quitada"); });
  }
  function dialogoLeida(fid) {
    const d = document.createElement("dialog"); d.setAttribute("aria-labelledby", "dl");
    d.innerHTML = `<h3 id="dl">Marcar como leída</h3><p class="hint" style="margin-top:8px">Solo marcala si realmente leíste el documento. Si pegás el texto, después cada cita se comprueba contra ese texto.</p>
      <label class="l"><input type="checkbox" id="ok" style="width:20px;height:20px;vertical-align:middle;margin-right:8px">Confirmo que leí este documento</label>
      <label class="l" for="tx">Texto del documento (opcional, máx. 200 KB)</label><textarea id="tx" style="min-height:140px"></textarea>
      <div class="fila-btns"><button class="btn sec" id="c">Cancelar</button><button class="btn" id="g">Guardar</button></div>`;
    d.querySelector("#c").onclick = () => d.close(); d.onclose = () => d.remove();
    d.querySelector("#g").onclick = () => { if (!d.querySelector("#ok").checked) return aviso("Tenés que confirmar la lectura.", true); const t = d.querySelector("#tx").value; d.close(); accion(() => api("POST", `/investigaciones/fuentes/${fid}/leida`, { confirmo_lectura: true, ...(t.trim() ? { texto: t } : {}) }), "Fuente marcada como leída"); };
    document.body.append(d); d.showModal();
  }

  // --- Revisión de afirmaciones ---
  const campoValor = (campo, v) => { const t = CAMPOS.find(c => c[0] === campo)[2];
    if (t === "t") return `<textarea name="valor" maxlength="1500" required>${esc(v || "")}</textarea>`;
    if (t === "tp") return `<select name="valor">${Object.entries(TIEMPOS).map(([k, n]) => `<option value="${k}" ${v === k ? "selected" : ""}>${n}</option>`).join("")}</select>`;
    return `<div class="chips">${OPC[campo].map(o => `<label><input type="checkbox" name="valor" value="${o.v}" ${(v || []).includes(o.v) ? "checked" : ""}>${esc(o.t)}</label>`).join("")}</div>`; };
  const leerValor = (campo, f) => { const t = CAMPOS.find(c => c[0] === campo)[2]; return t === "l" ? [...f.querySelectorAll("input[name=valor]:checked")].map(x => x.value) : f.querySelector("[name=valor]").value; };
  function afirmaciones(el) {
    const i = V.inv, decide = ["pendiente", "investigando", "propuesta_preparada", "en_revision"].includes(i.estado), ed = editable(i);
    const fuenteDe = id => i.fuentes.find(f => f.id === id);
    el.innerHTML = `<div class="panel-card"><h3>Revisión de afirmaciones</h3><p class="hint">Cada afirmación necesita una cita de una fuente leída. Podés <b>aceptar</b>, <b>editar</b> o <b>rechazar</b>. Solo lo aceptado llega a la ficha.</p>
      ${i.afirmaciones.map(a => `<div class="sub-card" style="${a.estado === "rechazada" ? "opacity:.6" : ""}"><div class="row"><b>${esc(ETQ_CAMPO[a.campo])}</b><span><span class="badge ${a.origen === "ia" ? "pendiente" : ""}">${a.origen === "ia" ? "Propuesta por IA" : "Cargada a mano"}</span> <span class="badge ${a.estado === "aceptada" || a.estado === "editada" ? "verificado" : ""}">${{ propuesta: "Sin decidir", aceptada: "Aceptada", editada: "Editada", rechazada: "Rechazada" }[a.estado]}</span></span></div>
        <p style="margin:8px 0"><b>${esc(fmt(a.campo, a.valor))}</b></p>
        ${a.estado === "editada" ? `<p class="small muted">Valor original: ${esc(fmt(a.campo, a.valor_original))}</p>` : ""}
        ${a.evidencias.map(e => { const f = fuenteDe(e.fuente_id); return `<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid var(--blue);background:var(--night);border-radius:0 8px 8px 0">«${esc(e.fragmento)}»<br><span class="small muted">${esc(f?.titulo || f?.url || "")} · <span class="rev ${f?.nivel === "validada" ? "ok" : ""}">${NIVEL[f?.nivel]}</span>${e.referencia ? " · " + esc(e.referencia) : ""}</span>${ed ? ` <button class="btn peligro" style="min-height:36px;padding:2px 10px" data-delev="${e.id}">Quitar</button>` : ""}</blockquote>`; }).join("") || `<p class="small" style="color:var(--gold)">Sin evidencia: agregá una cita para poder aceptarla.</p>`}
        ${a.decidida_por ? `<p class="small muted">Decidida por ${esc(a.decidida_por)} (${esc(fecha(a.decidida_en))})</p>` : ""}
        ${decide ? `<div class="fila-btns"><button class="btn" data-ac="${a.id}" ${["aceptada", "editada"].includes(a.estado) ? "disabled" : ""}>Aceptar</button><button class="btn sec" data-edit="${a.id}">Editar</button><button class="btn peligro" data-rech="${a.id}" ${a.estado === "rechazada" ? "disabled" : ""}>Rechazar</button>
          ${ed ? `<button class="btn sec" data-aev="${a.id}">+ Evidencia</button>` : ""}</div>` : ""}</div>`).join("") || `<p class="muted">Todavía no hay afirmaciones. ${V.cap?.ia ? "Elegí fuentes y pedile propuestas a la IA, o " : ""}agregalas a mano abajo.</p>`}</div>
      ${ed ? `<form id="na" class="panel-card"><h3>Agregar una afirmación a mano</h3><label class="l" for="campo" style="margin-top:0">¿Qué dato es?</label><select id="campo">${CAMPOS.map(c => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>
        <label class="l">Valor</label><div id="val"></div><label class="l" for="fu">Fuente que lo respalda</label><select id="fu" required><option value="">— elegí una fuente —</option>${i.fuentes.map(f => `<option value="${f.id}">${esc(f.titulo || f.url)} (${NIVEL[f.nivel]})</option>`).join("")}</select>
        <label class="l" for="fr">Fragmento o cita textual de la fuente</label><textarea id="fr" maxlength="600" required placeholder="Copiá la frase exacta del documento que respalda este dato"></textarea><label class="l" for="rf">Referencia (sección, página…)</label><input id="rf" type="text" maxlength="200">
        <button class="btn sec" style="width:100%;margin-top:10px" ${i.fuentes.length ? "" : "disabled"}>+ Agregar afirmación</button>${i.fuentes.length ? "" : `<p class="hint">Primero cargá una fuente en la pestaña 1.</p>`}</form>` : ""}`;
    const pv = () => { el.querySelector("#val") && (el.querySelector("#val").innerHTML = campoValor(el.querySelector("#campo").value, null)); }; if (ed) { pv(); el.querySelector("#campo").onchange = pv;
      el.querySelector("#na").onsubmit = e => { e.preventDefault(); const campo = el.querySelector("#campo").value; accion(() => api("POST", `/investigaciones/${i.id}/afirmaciones`, { campo, valor: leerValor(campo, el.querySelector("#val")), evidencias: [{ fuente_id: +el.querySelector("#fu").value, fragmento: el.querySelector("#fr").value, referencia: el.querySelector("#rf").value }] }), "Afirmación agregada"); }; }
    el.querySelectorAll("[data-ac]").forEach(b => b.onclick = () => accion(() => api("PUT", `/investigaciones/afirmaciones/${b.dataset.ac}`, { estado: "aceptada" }), "Afirmación aceptada"));
    el.querySelectorAll("[data-rech]").forEach(b => b.onclick = async () => { if (await confirmar({ titulo: "Rechazar afirmación", texto: "No se va a aplicar a la ficha.", ok: "Rechazar", peligro: true })) accion(() => api("PUT", `/investigaciones/afirmaciones/${b.dataset.rech}`, { estado: "rechazada" }), "Afirmación rechazada"); });
    el.querySelectorAll("[data-delev]").forEach(b => b.onclick = () => accion(() => api("DELETE", `/investigaciones/evidencias/${b.dataset.delev}`), "Evidencia quitada"));
    el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { const a = i.afirmaciones.find(x => x.id === +b.dataset.edit), d = document.createElement("dialog"); d.setAttribute("aria-label", "Editar afirmación");
      d.innerHTML = `<h3>Editar: ${esc(ETQ_CAMPO[a.campo])}</h3><form><div id="v">${campoValor(a.campo, a.valor)}</div><p class="hint">Al guardar queda como «Editada» y se conserva el valor original. Sigue necesitando una cita de una fuente leída.</p><div class="fila-btns"><button type="button" class="btn sec" id="c">Cancelar</button><button class="btn">Guardar</button></div></form>`;
      d.querySelector("#c").onclick = () => d.close(); d.onclose = () => d.remove(); d.querySelector("form").onsubmit = e => { e.preventDefault(); const v = leerValor(a.campo, d.querySelector("#v")); d.close(); accion(() => api("PUT", `/investigaciones/afirmaciones/${a.id}`, { valor: v }), "Afirmación editada"); }; document.body.append(d); d.showModal(); });
    el.querySelectorAll("[data-aev]").forEach(b => b.onclick = () => { const d = document.createElement("dialog"); d.setAttribute("aria-label", "Agregar evidencia");
      d.innerHTML = `<h3>Agregar evidencia</h3><form><label class="l" for="f1">Fuente</label><select id="f1">${i.fuentes.map(f => `<option value="${f.id}">${esc(f.titulo || f.url)} (${NIVEL[f.nivel]})</option>`).join("")}</select><label class="l" for="f2">Fragmento o cita textual</label><textarea id="f2" maxlength="600" required></textarea><label class="l" for="f3">Referencia</label><input id="f3" type="text" maxlength="200"><div class="fila-btns"><button type="button" class="btn sec" id="c">Cancelar</button><button class="btn">Agregar</button></div></form>`;
      d.querySelector("#c").onclick = () => d.close(); d.onclose = () => d.remove(); d.querySelector("form").onsubmit = e => { e.preventDefault(); const body = { fuente_id: +d.querySelector("#f1").value, fragmento: d.querySelector("#f2").value, referencia: d.querySelector("#f3").value }; d.close(); accion(() => api("POST", `/investigaciones/afirmaciones/${b.dataset.aev}/evidencias`, body), "Evidencia agregada"); }; document.body.append(d); d.showModal(); });
  }

  // --- Vista previa ---
  function fichaResultante() {
    const i = V.inv, c = S.cortes.find(x => x.id === i.corte_id) || { nombre: i.corte_nombre }, r = { ...c, variantes: c.variantes || [], imagenes: (c.imagenes || []).map(x => ({ url: `/api/admin/imagenes/${x.id}`, alt: x.alt })) };
    const cambios = [];
    for (const a of i.afirmaciones.filter(a => ["aceptada", "editada"].includes(a.estado))) { const antes = r[a.campo];
      r[a.campo] = Array.isArray(a.valor) ? [...new Set([...(antes || []), ...a.valor])] : a.valor; cambios.push([a.campo, antes, r[a.campo]]); }
    const usadas = new Set(i.afirmaciones.filter(a => ["aceptada", "editada"].includes(a.estado)).flatMap(a => a.evidencias.map(e => e.fuente_id)));
    r.fuentes = [...(c.fuentes || []).map(f => ({ autor: f.autor, titulo: f.titulo, url: f.url, afirmacion: f.afirmacion })), ...i.fuentes.filter(f => usadas.has(f.id)).map(f => ({ autor: f.autor || "Sin autor", titulo: f.titulo, url: f.url, afirmacion: "" }))];
    return { r, cambios };
  }
  function vistaPrevia(el) {
    const i = V.inv, { r, cambios } = fichaResultante();
    el.innerHTML = `<div class="panel-card"><h3>Vista previa de la ficha pública</h3><p class="hint">Así se vería la ficha <b>si se aprueba</b> lo aceptado. Los clientes no la ven hasta que esté verificada y publicada.</p>
      ${cambios.length ? `<h4>Qué cambia</h4><ul class="simple">${cambios.map(([c, a, d]) => `<li><b>${esc(ETQ_CAMPO[c])}:</b> ${a && a.length ? esc(fmt(c, a)) : "<span class='muted'>vacío</span>"} → ${esc(fmt(c, d))}</li>`).join("")}</ul>` : `<p class="muted">Todavía no hay afirmaciones aceptadas: la ficha quedaría igual.</p>`}</div>
      ${tarjeta({ corte: r, razones: [], respaldo: r.fuentes }, { demo: !!i.demo })}`;
  }

  // --- Aprobar y publicar ---
  function aprobar(el) {
    const i = V.inv, rev = S.rol === "revisor", c = S.cortes.find(x => x.id === i.corte_id), estadoFicha = c?.estado;
    const act = i.afirmaciones.filter(a => ["aceptada", "editada"].includes(a.estado)), sinDecidir = i.afirmaciones.filter(a => a.estado === "propuesta").length;
    const val = id => i.fuentes.find(f => f.id === id)?.nivel === "validada";
    const falta = []; if (!act.length) falta.push("No hay afirmaciones aceptadas."); if (sinDecidir) falta.push(`Quedan ${sinDecidir} afirmaciones sin decidir.`);
    for (const a of act) if (!a.evidencias.some(e => val(e.fuente_id))) falta.push(`«${ETQ_CAMPO[a.campo]}» no tiene una fuente validada.`);
    const sig = { pendiente: [["investigando", "Empezar a investigar"]], investigando: [["propuesta_preparada", "Marcar propuesta preparada"]], propuesta_preparada: [["investigando", "Volver a investigar"], ["en_revision", "Enviar a revisión"]], en_revision: [["propuesta_preparada", "Volver a la propuesta"]] }[i.estado] || [];
    const pasos = [["1", "Aprobar la investigación", i.estado === "aprobada" ? `Aprobada por ${esc(i.decidida_por)} el ${esc(fecha(i.decidida_en))}. Lo aceptado ya está en la ficha.` : "Aplica a la ficha solo lo aceptado. Lo hace una persona con rol revisor."],
      ["2", "Verificar la ficha", estadoFicha === "verificado" ? `Verificada por ${esc(c.verificado_por)}.` : "Confirmar que el contenido coincide con las fuentes."], ["3", "Publicar", c?.publicado ? "Visible para los clientes." : "Recién ahí entra en las recomendaciones."]];
    el.innerHTML = `<div class="panel-card"><h3>Estado de la investigación</h3><p class="hint">La IA <b>nunca</b> aprueba, verifica ni publica. Cada paso lo hace una persona y queda registrado con fecha.</p>
      <div class="fila-btns">${sig.map(([e, t]) => `<button class="btn sec" data-est="${e}">${t}</button>`).join("")}${["propuesta_preparada", "en_revision"].includes(i.estado) && rev ? `<button class="btn peligro" id="rechazar">Rechazar investigación</button>` : ""}</div></div>
      <div class="panel-card"><h3>Aprobar y publicar</h3><p class="hint">Son tres pasos separados. No se encadenan solos.</p>
      <ol class="pasos"><li class="${i.estado === "aprobada" ? "hecho" : ""}"><div><b>${pasos[0][1]}</b><br><span class="muted">${pasos[0][2]}</span></div></li><li class="${estadoFicha === "verificado" ? "hecho" : ""}"><div><b>${pasos[1][1]}</b><br><span class="muted">${pasos[1][2]}</span></div></li><li class="${c?.publicado ? "hecho" : ""}"><div><b>${pasos[2][1]}</b><br><span class="muted">${pasos[2][2]}</span></div></li></ol>
      ${i.estado === "en_revision" && falta.length ? `<p style="margin-top:12px"><b>Para aprobar falta:</b></p><ul class="falta-lista">${falta.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${i.demo ? `<p class="aviso" style="border-color:var(--red)">Investigación de DEMOSTRACIÓN: los botones de aprobación están bloqueados.</p>` : ""}
      <div class="fila-btns">${i.estado === "en_revision" ? `<button class="btn" id="aprobar" ${rev && !falta.length && !i.demo ? "" : "disabled"}>Aprobar investigación</button>` : ""}
        ${i.estado === "aprobada" && rev && estadoFicha === "pendiente" ? `<button class="btn" id="verificar">Verificar ficha</button>` : ""}
        ${i.estado === "aprobada" && rev && estadoFicha === "verificado" && !c.publicado ? `<button class="btn" id="publicar">Publicar ficha</button>` : ""}</div>
      ${!rev ? `<p class="hint">Aprobar, verificar y publicar lo hace una persona con rol <b>revisor</b>.</p>` : ""}</div>
      <div class="panel-card"><h3>Historial de cambios</h3>${i.historial.length ? `<ul class="simple" style="font-size:16px">${i.historial.map(h => `<li><span class="muted">${esc(fecha(h.creada_en))}</span> · <b>${esc(h.responsable)}</b> (${esc(h.rol)}) — ${esc(h.tipo.replaceAll("_", " "))}${h.despues ? `: ${esc(h.despues.slice(0, 120))}` : ""}</li>`).join("")}</ul>` : `<p class="muted">Sin movimientos.</p>`}</div>`;
    el.querySelectorAll("[data-est]").forEach(b => b.onclick = () => accion(() => api("POST", `/investigaciones/${i.id}/estado`, { estado: b.dataset.est }), "Estado actualizado"));
    el.querySelector("#rechazar")?.addEventListener("click", () => { const d = document.createElement("dialog"); d.setAttribute("aria-label", "Rechazar investigación");
      d.innerHTML = `<h3>Rechazar investigación</h3><form><label class="l" for="n">Motivo (obligatorio)</label><textarea id="n" maxlength="500" required></textarea><p class="hint">La ficha no cambia. La investigación queda cerrada.</p><div class="fila-btns"><button type="button" class="btn sec" id="c">Cancelar</button><button class="btn peligro">Rechazar</button></div></form>`;
      d.querySelector("#c").onclick = () => d.close(); d.onclose = () => d.remove(); d.querySelector("form").onsubmit = e => { e.preventDefault(); const n = d.querySelector("#n").value; d.close(); accion(() => api("POST", `/investigaciones/${i.id}/estado`, { estado: "rechazada", nota: n }), "Investigación rechazada"); }; document.body.append(d); d.showModal(); });
    const refrescar = (fn, ok) => accion(async () => { await fn(); const cs = await api("GET", "/cortes"); S.cortes.splice(0, S.cortes.length, ...cs); return await api("GET", "/investigaciones/" + i.id); }, ok);
    el.querySelector("#aprobar")?.addEventListener("click", async () => { if (await confirmar({ titulo: "Aprobar investigación", texto: "Se aplican a la ficha las afirmaciones aceptadas, se guarda una versión anterior y la ficha pasa a «pendiente». Todavía no se verifica ni se publica.", ok: "Sí, aprobar" })) refrescar(() => api("POST", `/investigaciones/${i.id}/aprobar`, { confirmo: true }), "Investigación aprobada. Faltan verificar y publicar."); });
    el.querySelector("#verificar")?.addEventListener("click", async () => { if (await confirmar({ titulo: "Verificar ficha", texto: "Confirmás que el contenido coincide con las fuentes. Todavía no se publica.", ok: "Sí, verificar" })) refrescar(() => api("POST", `/cortes/${c.id}/estado`, { estado: "verificado", confirmo_revision: true }), "Ficha verificada. Falta publicarla."); });
    el.querySelector("#publicar")?.addEventListener("click", async () => { if (await confirmar({ titulo: "Publicar ficha", texto: "Desde ahora los clientes pueden recibir esta ficha en sus recomendaciones.", ok: "Sí, publicar" })) refrescar(() => api("POST", `/cortes/${c.id}/publicar`, { publicado: true, confirmo: true }), "Ficha publicada"); });
  }

  function pintar() { ({ biblioteca, nueva, inv })[V.pant](); const h = app.querySelector("h2"); if (h) { h.tabIndex = -1; } }
  return { iniciar, pintar };
}
