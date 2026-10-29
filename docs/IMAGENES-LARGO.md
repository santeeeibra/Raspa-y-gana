# Fotos para la pregunta «¿Qué largo tenés actualmente?»

Hacen falta 4 archivos, uno por tarjeta, en `asesor/assets/opciones/largo/`:
`muy_corto.webp`, `corto.webp`, `medio.webp`, `largo.webp` (formato 480 × 291 px, WebP, calidad ~78).

## Indicación para el generador (usar la misma base en las 4 y cambiar solo el largo)
> Fotografía realista de estudio de la cabeza de un hombre vista desde atrás (sin rostro visible),
> cabello castaño oscuro, fondo gris muy oscuro uniforme, iluminación suave de estudio desde arriba,
> encuadre horizontal de la nuca a la coronilla, misma escala y posición, sin texto ni marcas de agua.
> Largo del pelo: **[LARGO]**. Sin degradado marcado; la única diferencia debe ser el largo.

- Muy corto: «rapado uniforme o casi rapado, unos 0 a 2 cm».
- Corto: «corte corto parejo de unos 2 a 5 cm, se distingue claramente del rapado».
- Medio: «pelo de unos 5 a 12 cm con algo de movimiento, cubre parte de las orejas».
- Largo: «pelo de más de 12 cm que pasa el cuello».

## Activarlas
Agregar al `asesor/assets/opciones/manifest.json` (las 4 juntas: si falta alguna, la pregunta sigue en modo texto):
```json
"largo:muy_corto": {"src": "assets/opciones/largo/muy_corto.webp", "alt": "Pelo muy corto visto desde atrás", "derechos": "Imagen ilustrativa generada con IA, provista por Las Vegas"},
"largo:corto":     {"src": "assets/opciones/largo/corto.webp", "alt": "Pelo corto visto desde atrás", "derechos": "Imagen ilustrativa generada con IA, provista por Las Vegas"},
"largo:medio":     {"src": "assets/opciones/largo/medio.webp", "alt": "Pelo de largo medio visto desde atrás", "derechos": "Imagen ilustrativa generada con IA, provista por Las Vegas"},
"largo:largo":     {"src": "assets/opciones/largo/largo.webp", "alt": "Pelo largo visto desde atrás", "derechos": "Imagen ilustrativa generada con IA, provista por Las Vegas"}
```
