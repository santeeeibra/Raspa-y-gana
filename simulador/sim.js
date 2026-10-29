// Simulador 3D de cortes (prototipo aislado). Cabeza y cabello son componentes separados:
// la cabeza es provisional o un GLB importado; el cabello se genera aparte (pelo.js) y es lo único editable.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cabezaProvisional, cabezaGLB } from "./cabezas.js";
import { crearPelo, PREDETERMINADO } from "./pelo.js";

const q = new URLSearchParams(location.search);
const lienzo = document.getElementById("lienzo");
const movil = matchMedia("(max-width: 720px)").matches || navigator.maxTouchPoints > 0;
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, preserveDrawingBuffer: q.has("captura") });
renderer.setPixelRatio(Math.min(devicePixelRatio, movil ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const escena = new THREE.Scene(); escena.background = new THREE.Color(0x0b0d12);
const camara = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
const controles = new OrbitControls(camara, lienzo);
Object.assign(controles, { enablePan: false, enableDamping: true, minDistance: 0.35, maxDistance: 1.1 });
controles.target.set(0, 0.0, 0);
escena.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1410, 0.9));
const clave = new THREE.DirectionalLight(0xffffff, 2.2); clave.position.set(0.5, 0.9, 0.7); escena.add(clave);
const contra = new THREE.DirectionalLight(0x9db4ff, 1.2); contra.position.set(-0.7, 0.3, -0.6); escena.add(contra);

const cabeza = new THREE.Group(); cabeza.name = "cabeza"; escena.add(cabeza);
let pelo = null, prm = { ...PREDETERMINADO };
let cabezaActual = null;

// La cabeza es intercambiable: cualquier proveedor devuelve { objeto, cuero, marco, cueroExplicito, avisos }.
function ponerCabeza(c) {
  cabeza.clear(); cabeza.add(c.objeto); cabezaActual = c;
  document.getElementById("prov").hidden = !c.provisional;
  c.avisos.forEach(a => console.warn("[cabeza]", a));
  ponerPelo();
}
function ponerPelo() {
  if (pelo) { cabeza.remove(pelo); pelo.traverse(o => o.geometry?.dispose()); }
  pelo = crearPelo(cabezaActual, { cantidad: +q.get("mechones") || (movil ? 16000 : 26000) });
  cabeza.add(pelo); pelo.actualizar(prm); estado();
}

// ---- vistas ----
const VISTAS = { frente: [0, 0.02, 1], perfil: [1, 0.02, 0], nuca: [0, 0.05, -1], tresCuartos: [0.7, 0.12, 0.7] };
let anim = null;
function vista(nombre, inmediato) {
  const dist = camara.position.distanceTo(controles.target) || 0.62;
  const destino = new THREE.Vector3(...VISTAS[nombre]).normalize().multiplyScalar(dist).add(controles.target);
  document.querySelectorAll("[data-vista]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vista === nombre)));
  if (inmediato) { camara.position.copy(destino); return; }
  anim = { desde: camara.position.clone(), hasta: destino, t: 0 };
}

// ---- controles ----
const ETQ = { superior: v => `${v} cm`, alzada: v => `${v} %`, lateral: v => `${v} cm` };
const NOMBRES = { altura: { bajo: "Bajo", medio: "Medio", alto: "Alto" }, extension: { comprimido: "Comprimido", equilibrado: "Equilibrado", estirado: "Estirado" } };
function sincronizar() {
  for (const k of ["superior", "alzada", "lateral"]) { const i = document.getElementById(k); i.value = prm[k]; document.getElementById(k + "-v").textContent = ETQ[k](prm[k]); }
  for (const k of ["altura", "extension"]) document.querySelectorAll(`[data-${k}]`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset[k] === prm[k])));
}
let pendiente = false;
const aplicar = () => { sincronizar(); if (!pelo || pendiente) return; pendiente = true; requestAnimationFrame(() => { pendiente = false; pelo.actualizar(prm); }); };
for (const k of ["superior", "alzada", "lateral"]) document.getElementById(k).addEventListener("input", e => { prm[k] = +e.target.value; aplicar(); });
for (const k of ["altura", "extension"]) document.querySelectorAll(`[data-${k}]`).forEach(b => b.onclick = () => { prm[k] = b.dataset[k]; aplicar(); });
document.querySelectorAll("[data-vista]").forEach(b => b.onclick = () => vista(b.dataset.vista));
document.getElementById("reset").onclick = () => { prm = { ...PREDETERMINADO }; aplicar(); vista("tresCuartos"); aviso("Configuración restablecida"); };
const ficha = () => `Corte clásico · Arriba ${prm.superior} cm · Alzada ${prm.alzada} % · Costados ${prm.lateral} cm · Degradado ${NOMBRES.altura[prm.altura].toLowerCase()}, ${NOMBRES.extension[prm.extension].toLowerCase()}`;
document.getElementById("guardar").onclick = () => {
  try { localStorage.setItem("lv-simulador", JSON.stringify({ corte: "clasico", ...prm, fecha: new Date().toISOString() })); } catch { /* sin almacenamiento */ }
  document.getElementById("ficha").textContent = ficha(); document.getElementById("ficha-box").hidden = false; aviso("Preferencias guardadas en este dispositivo");
};
document.getElementById("copiar").onclick = async () => { try { await navigator.clipboard.writeText(ficha()); aviso("Copiado para el barbero"); } catch { aviso("No se pudo copiar"); } };
document.getElementById("glb").onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f);
  try { const c = await cabezaGLB(url); ponerCabeza(c); aviso(c.avisos.length ? "GLB cargado con observaciones (ver consola)" : "Cabeza GLB cargada"); } catch (err) { aviso("No se pudo leer el GLB: " + err.message); }
  URL.revokeObjectURL(url);
};
function aviso(t) { const a = document.getElementById("aviso"); a.textContent = t; a.classList.add("ver"); clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove("ver"), 2200); }
function estado() { document.getElementById("estado").textContent = `${pelo.cantidad.toLocaleString("es-AR")} mechones`; }

try { const g = JSON.parse(localStorage.getItem("lv-simulador") || "null"); if (g) for (const k in PREDETERMINADO) if (k in g) prm[k] = g[k]; } catch { /* nada guardado */ }
for (const k of Object.keys(PREDETERMINADO)) if (q.has(k)) prm[k] = isNaN(+q.get(k)) ? q.get(k) : +q.get(k);
sincronizar();

// ---- arranque ----
const urlGLB = q.get("cabeza");
let inicial = null;
if (urlGLB && /^[\w./-]+\.glb$/.test(urlGLB)) { try { inicial = await cabezaGLB(urlGLB); } catch (err) { console.warn("[cabeza]", err.message); } }
ponerCabeza(inicial || cabezaProvisional());
vista(q.get("vista") in VISTAS ? q.get("vista") : "tresCuartos", true);
camara.position.setLength(0.62);

function medir() { const r = lienzo.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camara.aspect = r.width / r.height; camara.updateProjectionMatrix(); }
new ResizeObserver(medir).observe(lienzo); medir();
let cuadros = 0, t0 = performance.now(); window.__fps = 0;
renderer.setAnimationLoop(() => {
  if (anim) { anim.t = Math.min(1, anim.t + 0.06); const k = anim.t * anim.t * (3 - 2 * anim.t);
    camara.position.lerpVectors(anim.desde, anim.hasta, k).sub(controles.target).setLength(anim.desde.distanceTo(controles.target)).add(controles.target); if (anim.t === 1) anim = null; }
  controles.update(); renderer.render(escena, camara);
  cuadros++; const t = performance.now(); if (t - t0 > 1000) { window.__fps = Math.round(cuadros * 1000 / (t - t0)); cuadros = 0; t0 = t; }
});
window.__listo = true; window.__escena = escena;
