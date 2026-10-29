# Simulador 3D de cortes — arquitectura y requisitos

Prototipo aislado en `simulador/` (rama `claude/simulador-3d`). No forma parte del asesor ni de la web de producción.
La cabeza actual es **provisional** y no busca realismo: solo sirve para probar los controles.

## 1. Arquitectura

| Archivo | Responsabilidad | ¿Cambia al usar una cabeza realista? |
|---|---|---|
| `simulador/cabezas.js` | Proveedores de cabeza: `cabezaProvisional()` y `cabezaGLB(url)`. Valida el GLB, corrige escala/posición, oculta el pelo fusionado y entrega el cuero cabelludo. | No (solo se elige el GLB) |
| `simulador/pelo.js` | Componente de cabello independiente: reglas del corte (`largoEn`), raíces sobre el cuero, mechones y capa de sombra del degradado. | No |
| `simulador/sim.js` | Visor Three.js: escena, cámara 360°, vistas, controles, guardar/restablecer. | No |
| `simulador/index.html` | Interfaz y controles. | No |
| `simulador/vendor/three/` | Three.js r169 local (licencia MIT), sin CDN. | No |
| `simulador/pruebas/controles.cjs` | Prueba en navegador real de controles, guardado y reemplazo de cabeza. | No |

Contrato entre cabeza y cabello: `{ objeto, cuero, marco: { centro, radio }, cueroExplicito, provisional, avisos }`.
Cambiar de cabeza = `?cabeza=assets/cabeza.glb` o el selector «Probar otra cabeza». El cabello se regenera sobre la nueva superficie.

## 2. Qué funciona realmente y qué es aproximado

**Real (verificado en Chromium):**
- Rotación libre 360° y vistas frente / perfil / nuca / ¾.
- Largo superior: cambia el largo de cada mechón (1–12 cm).
- Alzada: cambia el ángulo de salida de los mechones de arriba (más hacia afuera de la superficie).
- Largo de costados, altura (bajo/medio/alto) y extensión (comprimido/equilibrado/estirado) del degradado: cambian el largo por altura según una regla continua de 0,4 mm hasta el largo lateral. La capa de sombra del cuero cabelludo sigue la misma regla.
- Restablecer, guardar en el dispositivo y ficha de texto para el barbero.
- Reemplazo de cabeza GLB: probado con un GLB en centímetros, con `cuero_cabelludo`, `ref_centro` y un pelo fusionado (se ocultó, se corrigió la escala ×0,01 y se usó el cuero).

**Aproximado o pendiente:**
- El aspecto del cabello (hoy son tiras finas con un sombreado simple): por eso se ve como un casco. Ver punto 4.
- La dirección del peinado clásico (raya al costado) es una regla general, no un peinado modelado.
- Sin una malla `cuero_cabelludo`, la línea de nacimiento del pelo es genérica.
- El rendimiento en celulares reales no está medido: Chromium sin GPU (SwiftShader) no es representativo.

## 3. Requisitos del GLB de la cabeza realista

**Formato y peso**
- glTF binario (`.glb`), una sola cabeza masculina adulta, **sin pelo** (rapada al 0 o calva). El pelo fusionado no sirve: no se puede editar.
- Hasta ~5 MB y 30–60 mil triángulos para celulares de gama media. Malla de una pieza, sin agujeros en el cuero cabelludo.

**Orientación, escala y posición**
- Y hacia arriba, la cara mirando a **+Z**, metros como unidad (ancho del cráneo ≈ 0,15–0,16 m). Si viene en otra escala, se corrige y se avisa.
- Un objeto vacío (Empty) llamado **`ref_centro`** en el centro del cráneo (a la altura de la parte superior de las orejas, en el medio entre frente y nuca). Si falta, se estima.
- Cuello incluido hasta la base, cerrado o cortado en limpio (sin bordes abiertos visibles desde abajo).

**Cuero cabelludo (lo más importante para el realismo)**
- Una malla aparte llamada **`cuero_cabelludo`** que cubra exactamente la zona con pelo: línea de la frente, patillas, contorno de las orejas y nuca. No se dibuja: define dónde nacen los mechones y dónde va el degradado.
- Separada 0,5–1 mm por fuera de la piel, con normales hacia afuera.
- Cualquier malla llamada `pelo`, `hair` o `cabello` se oculta automáticamente.

**Materiales**
- PBR metal/rugosidad: color base (piel, con la sombra natural del cuero rapado), normal, rugosidad; opcional oclusión. Texturas de 2048 px como máximo (1024 para celular), idealmente en KTX2/WebP.
- Sin iluminación «horneada» fuerte en la textura (el visor pone sus propias luces).
- Origen y licencia documentados: imagen de partida generada por IA (no una persona real sin permiso) y licencia de Meshy/Rodin compatible con el uso (ver evaluación previa: Meshy gratis = CC BY 4.0 con crédito).

## 4. Cabello sin aspecto de casco: plan con grupos de mechones y hair cards

Más mechones finos no lo resuelven. El realismo en tiempo real se logra con **capas**:

1. **Capa de cuero (zona rapada y degradado):** una textura de pelo corto sobre el cuero cabelludo, con la densidad y el largo controlados por la regla del degradado (`largoEn`). Es la técnica más eficiente para pelo de 0–5 mm y da la transición suave que hoy falta.
2. **Capas «shell» para 2–15 mm:** varias copias del cuero desplazadas hacia afuera, con textura de pelo y descarte por alfa. Cubren los costados y el inicio del degradado con pocas mallas.
3. **Hair cards para el largo de arriba:** tiras de 1–3 cm de ancho con textura de un grupo de pelos (alfa, raíz/punta, profundidad, variación). Se agrupan en **mechones** que siguen **curvas guía** (20–60 guías para el clásico). Cada control modifica las guías, no las tiras:
   - largo superior → largo de las guías (las cards se recortan o estiran por UV);
   - alzada → ángulo de salida de las guías en la frente y la coronilla;
   - raya y dirección → definidas por las guías del corte, no por una regla genérica.
4. **Sombreado de pelo:** sombreado anisotrópico con dos brillos y oclusión en la raíz, más alfa con dithering o «alpha to coverage» para evitar problemas de orden de transparencias.

Cómo se crean los recursos (todo sin pagar):
- En **Blender** (gratis): peinado con curvas de pelo, horneado de una textura de grupo de mechones (alfa, normal, raíz) y conversión de curvas a cards. Las guías del corte se exportan como curvas o como un JSON de puntos.
- Hay packs comerciales de hair cards (clásico de raya al costado, por ejemplo), pero son pagos y suelen estar pensados para Unreal: no se usan sin revisar la licencia.

## 5. Qué se necesita para el siguiente paso

| Recurso | Quién | Formato |
|---|---|---|
| Imágenes de referencia de la cabeza rapada (frente, perfil, ¾ posterior), luz pareja, expresión neutra | Las Vegas | PNG/JPG |
| Cabeza generada en Meshy/Rodin (plan gratis: CC BY 4.0 con crédito) | Las Vegas | GLB |
| Limpieza en Blender: orientación, escala, `ref_centro`, cuero cabelludo separado, reducción de triángulos, texturas | Blender (yo puedo guiarte paso a paso o hacerlo si se instala Blender en el entorno) | GLB |
| Textura de grupo de mechones (atlas de 4–8 variantes) | Blender (horneado) | PNG/WebP 1024–2048 px |
| Textura de pelo corto para el cuero (degradado) | Blender o foto propia | PNG/WebP con alfa |
| Guías del corte clásico (raya al costado) | Blender | JSON o GLB con curvas |

Luego: implementar las capas 1–3 en `pelo.js` sin cambiar los controles ni `cabezas.js`.

## 6. Nuevos cortes

Cada corte = un archivo de guías + parámetros de su regla (`largoEn`): zonas, raya, dirección y rangos de los controles. Los controles son los mismos; solo cambian las guías y los límites.
