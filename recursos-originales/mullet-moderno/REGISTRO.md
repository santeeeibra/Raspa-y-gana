# Mullet moderno — registro del recurso audiovisual

Esta carpeta **no se publica** (la demo usa una lista blanca y el Worker sirve solo `worker/dist-demo`).

| Campo | Valor |
|---|---|
| Archivo | `flow-original.mp4` (original sin modificar) |
| Origen | Generado con IA en Google Flow (Veo) por Las Vegas, 2026-10-29 |
| Persona real | No (modelo generado) |
| Marca de agua | SynthID invisible, según Google |
| Licencia / uso comercial | **Por confirmar** con los términos vigentes de Google Flow y del plan usado. Hasta entonces: solo prueba privada (`?privado`). |
| Publicable | No |

## Análisis técnico del original
- MP4 (H.264 High + AAC estéreo), 720×1280 con franjas negras de 160 px arriba y abajo (imagen útil 720×960), 24 fps, 8,0 s, 192 cuadros, 2,8 MB.
- Movimiento: giro de ~180° (perfil izquierdo → ¾ posterior → nuca → vuelve al perfil). **No hay vista frontal.**
- Defectos de IA: salto de rotación cerca de 1,3 s; el fondo pasa de gris texturado a negro (3,3–6,8 s); destello de luz entre 4,8 y 5,2 s; los rulos superiores se reacomodan levemente. El degradado lateral y el largo de la nuca se mantienen coherentes.

## Versiones derivadas (`asesor/privado/cortes/mullet-moderno/`)
- `showcase.webm` (VP9, 540×720, sin audio, ~564 KB) y `showcase.mp4` (H.264, 540×720, faststart, sin audio, ~683 KB): sin franjas, 75–80 % más livianos.
- `poster.webp` (miniatura del video), `perfil.webp` (0,3 s), `tres_cuartos.webp` (3,0 s), `nuca.webp` (4,0 s): fotogramas elegidos fuera de los tramos con defectos.
