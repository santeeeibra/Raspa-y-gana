// Proveedores de cabeza. El cabello (pelo.js) y los controles (sim.js) no dependen de cuál se use.
// Contrato: { objeto, cuero, marco: { centro, radio }, cueroExplicito, provisional, avisos }.
// Requisitos del GLB: docs/SIMULADOR-3D.md.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const ES_PELO = /^(pelo|hair|cabello)/i, ES_CUERO = /^(cuero_cabelludo|scalp)/i;
const ANCHO_ESPERADO = 0.155; // m, ancho de cráneo de un adulto (de oreja a oreja sin orejas ~0,15–0,16)

// ---- cabeza provisional: solo para probar los controles, sin pretensión de realismo ----
export function cabezaProvisional() {
  const cabeza = new THREE.Group(); cabeza.name = "cabeza-provisional";
  const piel = new THREE.MeshStandardMaterial({ color: 0xb98466, roughness: 0.62 });
  const g = new THREE.SphereGeometry(0.1, 128, 96), p = g.getAttribute("position"), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const y = v.y / 0.1;
    const abajo = Math.max(0, -y), adelante = Math.max(0, v.z / 0.1);
    v.x *= 0.78 * (1 - 0.32 * abajo * abajo);
    v.z *= 0.97 * (1 - 0.18 * abajo) ; v.z += 0.012 * abajo * adelante;
    v.y *= y < 0 ? 1.22 : 1.0;
    if (y > 0.2 && v.z > 0) v.z *= 1 - 0.06 * (y - 0.2);           // frente algo más plana
    p.setXYZ(i, v.x, v.y + 0.01, v.z);
  }
  g.computeVertexNormals();
  const craneo = new THREE.Mesh(g, piel); craneo.name = "craneo";
  const oreja = new THREE.SphereGeometry(1, 24, 16);
  const orejas = [-1, 1].map(s => { const m = new THREE.Mesh(oreja, piel); m.scale.set(0.011, 0.03, 0.02); m.position.set(s * 0.079, -0.006, -0.008); m.rotation.y = s * 0.35; return m; });
  const nariz = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), piel); nariz.scale.set(0.012, 0.024, 0.014); nariz.position.set(0, -0.03, 0.097);
  const cuello = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.16, 48, 1, true), piel); cuello.position.set(0, -0.16, -0.018);
  cabeza.add(craneo, ...orejas, nariz, cuello);
  return { objeto: cabeza, cuero: g, marco: { centro: new THREE.Vector3(0, 0.01, 0), radio: 0.1 }, cueroExplicito: false, provisional: true, avisos: [] };
}


// Geometría en el espacio de la cabeza (solo posición + normales) para muestrear raíces y la capa de sombra.
function geometriaDe(mallas, raiz) {
  const inv = new THREE.Matrix4().copy(raiz.matrixWorld).invert();
  const geos = mallas.map(o => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", o.geometry.getAttribute("position").clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); g.computeVertexNormals();
    return g.index ? g.toNonIndexed() : g;
  });
  return geos.length === 1 ? geos[0] : mergeGeometries(geos);
}

// ---- cabeza GLB realista ----
export async function cabezaGLB(url) {
  const raiz = (await new GLTFLoader().loadAsync(url)).scene;
  const avisos = [], mallas = [], cueros = [];
  let ref = null;
  raiz.traverse(o => {
    if (o.name === "ref_centro") ref = o;
    if (!o.isMesh) return;
    if (ES_PELO.test(o.name)) { o.visible = false; avisos.push(`Se ocultó "${o.name}": el pelo del GLB no se usa, se genera aparte.`); return; }
    (ES_CUERO.test(o.name) ? cueros : mallas).push(o);
  });
  if (!mallas.length) throw new Error("El GLB no tiene mallas de cabeza");
  cueros.forEach(o => { o.visible = false; });             // el cuero es solo guía: no se dibuja

  // Escala y posición: el GLB debería venir en metros, mirando a +Z, con el origen en el centro del cráneo.
  raiz.updateMatrixWorld(true);
  const caja = new THREE.Box3(); mallas.forEach(o => caja.expandByObject(o));
  const tam = caja.getSize(new THREE.Vector3());
  let escala = 1;
  if (Math.abs(tam.x - ANCHO_ESPERADO) / ANCHO_ESPERADO > 0.25) { escala = ANCHO_ESPERADO / tam.x; avisos.push(`Escala corregida ×${escala.toFixed(3)} (ancho ${tam.x.toFixed(3)} m; se esperaba ~${ANCHO_ESPERADO} m).`); }
  if (tam.z > tam.x * 1.6 || tam.y < tam.x * 0.8) avisos.push("Proporciones raras: revisar que Y sea arriba y que la cara mire a +Z.");
  const centro = new THREE.Vector3();
  if (ref) ref.getWorldPosition(centro);
  else { centro.set((caja.min.x + caja.max.x) / 2, caja.max.y - 0.092 / escala, (caja.min.z + caja.max.z) / 2); avisos.push("Sin \"ref_centro\": el centro del cráneo se estimó desde la caja."); }
  raiz.position.sub(centro); raiz.scale.setScalar(escala); raiz.position.multiplyScalar(escala);
  const objeto = new THREE.Group(); objeto.name = "cabeza-glb"; objeto.add(raiz); objeto.updateMatrixWorld(true);

  const cueroExplicito = cueros.length > 0;
  if (!cueroExplicito) avisos.push("Sin malla \"cuero_cabelludo\": la zona con pelo se estima con una línea genérica (menos precisa).");
  const cuero = geometriaDe(cueroExplicito ? cueros : mallas, objeto);
  objeto.traverse(o => { if (o.isMesh && o.material && !cueros.includes(o)) o.material.side = THREE.FrontSide; });
  return { objeto, cuero, marco: { centro: new THREE.Vector3(), radio: 0.1 }, cueroExplicito, provisional: false, avisos };
}
