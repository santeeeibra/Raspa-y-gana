// Componente de cabello independiente de la cabeza.
// Se construye sobre CUALQUIER malla de cabeza (provisional o GLB): toma puntos de su superficie
// y calcula el largo de cada mechón con las reglas del corte. Cambiar un control recalcula los largos reales.
import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

export const PREDETERMINADO = { superior: 4, alzada: 35, lateral: 1.2, altura: "medio", extension: "equilibrado" };
const ALTURA = { bajo: -0.22, medio: 0.06, alto: 0.3 };          // dónde termina el degradado (altura normalizada)
const EXTENSION = { comprimido: 0.12, equilibrado: 0.26, estirado: 0.44 }; // ancho de la transición
const PIEL = 0.0004;                                               // 0,4 mm: rapado al ras
const PARTIDO = 0.3;                                               // raya al costado (corte clásico)

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Línea de nacimiento del pelo según el ángulo alrededor de la cabeza (0 = frente, 1 = nuca).
const NACIMIENTO = [[0, 0.5], [0.25, 0.42], [0.33, 0.3], [0.37, -0.05], [0.43, -0.05], [0.5, 0.32], [0.58, 0.32], [0.66, -0.1], [0.8, -0.45], [1, -0.6]];
function nacimiento(a) {
  for (let i = 1; i < NACIMIENTO.length; i++) {
    const [a1, y1] = NACIMIENTO[i];
    if (a <= a1) { const [a0, y0] = NACIMIENTO[i - 1]; return mix(y0, y1, (a - a0) / (a1 - a0)); }
  }
  return NACIMIENTO.at(-1)[1];
}
// Coordenadas de un punto respecto del centro del cráneo: y = altura, a = ángulo, x = costado.
function zona(p, marco) {
  const d = p.clone().sub(marco.centro).divideScalar(marco.radio);
  const n = d.clone().normalize();
  return { y: n.y, x: n.x, a: Math.abs(Math.atan2(n.x, n.z)) / Math.PI, dir: n };
}

/** Largo (en metros) del pelo en un punto, según el corte. Es la regla que define el degradado. */
export function largoEn(z, prm) {
  const superior = prm.superior / 100, lateral = prm.lateral / 100;
  const tope = ALTURA[prm.altura], ancho = EXTENSION[prm.extension];
  let costado;
  if (z.y <= tope - ancho) costado = PIEL;                            // zona rapada
  else if (z.y < tope) costado = mix(PIEL, lateral, smooth(tope - ancho, tope, z.y)); // transición del degradado
  else costado = lateral;
  const frente = 1 - smooth(0.15, 0.35, z.a);
  const arriba = Math.max(smooth(0.38, 0.62, z.y), frente * smooth(0.3, 0.45, z.y));
  return { largo: mix(costado, superior, arriba), arriba };
}

const VERT = /* glsl */`
attribute vec3 aRaiz; attribute vec3 aNormal; attribute vec3 aDir; attribute vec3 aTan; attribute float aLargo; attribute float aAzar;
uniform float uAncho; uniform vec3 uCentro; varying float vS; varying float vAzar; varying vec3 vT; varying vec3 vPos;
void main(){
  float s = position.y; float L = aLargo;
  vec3 p1 = aRaiz + aDir * L * 0.45 + aNormal * L * 0.06;
  vec3 tFin = normalize(aTan + aNormal * 0.12 - vec3(0.0, 0.2, 0.0) * (1.0 - dot(aDir, aNormal)));
  vec3 p2 = p1 + tFin * L * 0.55;
  vec3 p = (1.0-s)*(1.0-s)*aRaiz + 2.0*(1.0-s)*s*p1 + s*s*p2 + aNormal * (0.0008 + aAzar * 0.002) * s * smoothstep(0.004, 0.03, L);
  // El mechón sigue la forma del cráneo: no se despega más de lo que permiten la alzada y el largo.
  float alza = max(0.0, dot(aDir, aNormal)); float rRaiz = length(aRaiz - uCentro);
  vec3 q = p - uCentro; float r = length(q);
  float rMax = rRaiz + 0.0015 + aAzar * 0.0035 + L * (0.08 + 0.55 * alza) * s;
  p = uCentro + q / r * clamp(r, rRaiz + 0.0006 * s, rMax);
  vec3 t = normalize(2.0*(1.0-s)*(p1-aRaiz) + 2.0*s*(p2-p1) + 1e-6);
  vec4 mundo = modelMatrix * vec4(p, 1.0);
  vec3 tm = normalize(mat3(modelMatrix) * t);
  vec3 lado = normalize(cross(tm, normalize(cameraPosition - mundo.xyz)));
  mundo.xyz += lado * position.x * uAncho * (1.0 - 0.85 * s);
  vS = s; vAzar = aAzar; vT = tm; vPos = mundo.xyz;
  gl_Position = projectionMatrix * viewMatrix * mundo;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor; varying float vS; varying float vAzar; varying vec3 vT; varying vec3 vPos;
void main(){
  vec3 v = normalize(cameraPosition - vPos);
  vec3 l1 = normalize(vec3(0.5, 0.9, 0.7)); vec3 l2 = normalize(vec3(-0.7, 0.3, -0.6));
  float sinTL = sqrt(max(0.0, 1.0 - pow(dot(vT, l1), 2.0)));
  vec3 h = normalize(l1 + v); float sinTH = sqrt(max(0.0, 1.0 - pow(dot(vT, h), 2.0)));
  float ao = mix(0.35, 1.0, vS);
  vec3 base = uColor * (0.8 + 0.4 * vAzar);
  vec3 c = base * (0.25 + 0.75 * sinTL) * ao + vec3(0.9, 0.8, 0.7) * pow(sinTH, 60.0) * 0.25 * ao
         + base * 0.5 * pow(1.0 - abs(dot(vT, l2)), 2.0) * 0.3;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Crea el cabello sobre `malla` (geometría en el espacio de la cabeza). Devuelve un grupo con .actualizar(prm). */
export function crearPelo({ cuero: geometria, marco, cueroExplicito }, { cantidad = 24000, color = new THREE.Color(0.075, 0.05, 0.036) } = {}) {
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometria)).build();
  const pos = new THREE.Vector3(), nor = new THREE.Vector3();
  const raices = [];
  for (let i = 0; raices.length < cantidad && i < cantidad * 6; i++) {
    sampler.sample(pos, nor);
    const z = zona(pos, marco);
    if (nor.dot(z.dir) < 0.25) continue;                  // solo superficie externa
    if (!cueroExplicito && z.y < nacimiento(z.a) - 0.01) continue;           // fuera de la zona con pelo (cara, orejas, cuello)
    raices.push({ p: pos.clone(), n: nor.clone(), z, azar: Math.random() });
  }
  const n = raices.length;
  const base = new THREE.PlaneGeometry(1, 1, 1, 6); base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute("position", base.getAttribute("position"));
  const attr = (nombre, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k); geo.setAttribute(nombre, a); return a; };
  const aRaiz = attr("aRaiz", 3), aNormal = attr("aNormal", 3), aDir = attr("aDir", 3), aTan = attr("aTan", 3), aLargo = attr("aLargo", 1), aAzar = attr("aAzar", 1);
  raices.forEach((r, i) => { aRaiz.setXYZ(i, r.p.x, r.p.y, r.p.z); aNormal.setXYZ(i, r.n.x, r.n.y, r.n.z); aAzar.setX(i, r.azar); });
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: { uAncho: { value: 0.0011 }, uCentro: { value: marco.centro }, uColor: { value: color } } });
  const mechones = new THREE.Mesh(geo, mat); mechones.frustumCulled = false; mechones.name = "pelo-mechones";

  // Capa de sombra sobre el cuero cabelludo: muestra la transición del degradado aun donde el pelo es casi 0.
  const capa = geometria.clone(); const cp = capa.getAttribute("position"), cn = capa.getAttribute("normal");
  const cubre = new Float32Array(cp.count);
  for (let i = 0; i < cp.count; i++) { pos.fromBufferAttribute(cp, i); nor.fromBufferAttribute(cn, i); pos.addScaledVector(nor, 0.0004); cp.setXYZ(i, pos.x, pos.y, pos.z); }
  capa.setAttribute("aCubre", new THREE.BufferAttribute(cubre, 1));
  const matCapa = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uColor: { value: color } },
    vertexShader: `attribute float aCubre; varying float vC; varying vec3 vN; void main(){ vC = aCubre; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying float vC; varying vec3 vN; void main(){ float l = 0.4 + 0.6*max(0.0, dot(vN, normalize(vec3(0.5,0.9,0.7)))); gl_FragColor = vec4(uColor*l, vC); }` });
  const sombra = new THREE.Mesh(capa, matCapa); sombra.name = "pelo-sombra"; sombra.renderOrder = 1;

  const grupo = new THREE.Group(); grupo.name = "cabello"; grupo.add(sombra, mechones);
  const t = new THREE.Vector3(), objetivo = new THREE.Vector3(), d0 = new THREE.Vector3();
  grupo.actualizar = prm => {
    const alza = prm.alzada / 100;
    raices.forEach((r, i) => {
      const { largo, arriba } = largoEn(r.z, prm);
      // Dirección del peinado clásico: arriba hacia el costado opuesto a la raya y atrás; costados hacia abajo.
      const lado = r.z.x < PARTIDO ? -1 : 1;
      objetivo.set(lado * (lado < 0 ? 0.55 : 0.9), lado < 0 ? 0 : -0.35, -0.75).normalize().multiplyScalar(arriba)
        .add(t.set(0, -1, -0.35).normalize().multiplyScalar(1 - arriba));
      t.copy(objetivo).addScaledVector(r.n, -objetivo.dot(r.n)).normalize();
      const frente = 1 - smooth(0.12, 0.4, r.z.a);
      const levanta = alza * arriba * (0.45 + 0.55 * frente);
      d0.copy(t).lerp(r.n, levanta).normalize();
      aLargo.setX(i, largo); aTan.setXYZ(i, t.x, t.y, t.z); aDir.setXYZ(i, d0.x, d0.y, d0.z);
    });
    for (let i = 0; i < cp.count; i++) {
      pos.fromBufferAttribute(cp, i); const z = zona(pos, marco);
      const dentro = cueroExplicito ? 1 : smooth(nacimiento(z.a) - 0.04, nacimiento(z.a) + 0.02, z.y);
      cubre[i] = dentro * (0.35 + 0.6 * smooth(0, 0.008, largoEn(z, prm).largo));
    }
    [aLargo, aTan, aDir].forEach(a => (a.needsUpdate = true)); capa.getAttribute("aCubre").needsUpdate = true;
  };
  grupo.cantidad = n;
  return grupo;
}
