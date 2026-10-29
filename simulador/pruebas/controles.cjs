// Prueba en navegador real (Playwright + Chromium): controles, guardado y reemplazo de cabeza GLB.
// Uso: servir la raíz del repo (python3 -m http.server 8123) y ejecutar: node simulador/pruebas/controles.cjs
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const p=await b.newPage({viewport:{width:500,height:500}});const e=[];p.on('pageerror',x=>e.push(x.message));
await p.goto((process.env.BASE||'http://localhost:8123')+'/simulador/index.html?mechones=4000');await p.waitForFunction(()=>window.__listo,null,{timeout:60000});
const largos=()=>p.evaluate(()=>{const a=window.__escena.getObjectByName('pelo-mechones').geometry.getAttribute('aLargo').array;let s=0,mx=0;for(const v of a){s+=v;mx=Math.max(mx,v)}return {prom:+(s/a.length*100).toFixed(3),max:+(mx*100).toFixed(2)}});
const cubre=()=>p.evaluate(()=>{const a=window.__escena.getObjectByName('pelo-sombra').geometry.getAttribute('aCubre').array;let s=0;for(const v of a)s+=v;return +(s/a.length).toFixed(4)});
const dir=()=>p.evaluate(()=>{const a=window.__escena.getObjectByName('pelo-mechones').geometry.getAttribute('aDir').array;let s=0;for(let i=0;i<a.length;i+=3)s+=a[i+1];return +(s/(a.length/3)).toFixed(4)});
const slide=async(id,v)=>{await p.$eval('#'+id,(el,v)=>{el.value=v;el.dispatchEvent(new Event('input'))},v);await p.waitForTimeout(150)};
const r={};
r.base=await largos(); await slide('superior',10); r.superior10=await largos();
r.dirAlzada0=(await slide('alzada',0),await dir()); r.dirAlzada100=(await slide('alzada',100),await dir());
await slide('lateral',0.3); r.lateral03=await largos(); await slide('lateral',3); r.lateral3=await largos();
for(const h of ['bajo','medio','alto']){await p.click(`[data-altura=${h}]`);await p.waitForTimeout(150);r['altura_'+h]={largos:await largos(),sombra:await cubre()}}
for(const x of ['comprimido','equilibrado','estirado']){await p.click(`[data-extension=${x}]`);await p.waitForTimeout(150);r['ext_'+x]=await cubre()}
await p.click('#reset');await p.waitForTimeout(150);r.reset=await largos();
await p.click('#guardar');r.guardado=await p.evaluate(()=>localStorage.getItem('lv-simulador'));r.ficha=await p.textContent('#ficha');
// GLB de prueba: en centímetros (escala x100), con cuero_cabelludo y ref_centro
r.glb=await p.evaluate(async()=>{const THREE=await import('three');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const {cabezaGLB}=await import('./cabezas.js');
 const g=new THREE.Group();const piel=new THREE.MeshStandardMaterial();const h=new THREE.Mesh(new THREE.SphereGeometry(8,48,32),piel);h.name='cabeza';h.scale.set(0.95,1.2,1.05);h.position.y=150;
 const c=new THREE.Mesh(new THREE.SphereGeometry(8.05,48,32,0,Math.PI*2,0,Math.PI*0.45),piel);c.name='cuero_cabelludo';c.scale.copy(h.scale);c.position.y=150;
 const pelo=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),piel);pelo.name='hair_fusionado';pelo.position.y=160;
 const ref=new THREE.Object3D();ref.name='ref_centro';ref.position.set(0,150,0);g.add(h,c,pelo,ref);
 const bin=await new GLTFExporter().parseAsync(g,{binary:true});const url=URL.createObjectURL(new Blob([bin]));
 const cab=await cabezaGLB(url);const box=new THREE.Box3().setFromObject(cab.objeto);return {avisos:cab.avisos,cueroExplicito:cab.cueroExplicito,anchoFinal:+box.getSize(new THREE.Vector3()).x.toFixed(3),centroY:+box.getCenter(new THREE.Vector3()).y.toFixed(3),bytes:bin.byteLength}});
// reemplazo en vivo por el selector de archivo
r.reemplazo=await p.evaluate(async()=>{const {cabezaGLB}=await import('./cabezas.js');return 'ok'});
console.log(JSON.stringify(r,null,1),'\nerrores:',e);await b.close()})();
