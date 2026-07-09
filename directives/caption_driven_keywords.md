# Directiva: Disparo por keyword derivada del copy (modo caption)

## Objetivo
Permitir que una campaña dispare **sin registrar keyword por post**: el sistema lee el
copy del post/carrusel/reel donde comentaron y deriva la palabra clave automáticamente.

## Cuándo usarlo
El creador publica normal, con un CTA tipo «Comenta "PLANTILLA" y te la envío». Quiere que
funcione en cualquier post futuro sin editar código cada vez.

## Herramientas (Capa 3)
- `src/core/keywordExtractor.ts` → `extractKeywordFromCaption(caption)` (regex determinista).
- `src/platforms/instagram/client.ts` → `getMediaCaption(mediaId)` (Graph API, campo `caption`).
- `src/core/flowEngine.ts` → `resolveCaptionKeyword` + cache por `mediaId`.
- Campaña con `trigger.mode: 'caption'` en `campaigns.ts`.

## Flujo en runtime
1. Llega un comentario con su `mediaId`.
2. Match directo de campañas modo `keywords`. Si hay, se usa esa.
3. Si no, para campañas modo `caption`: se pide el caption del post (cacheado), se extrae la
   keyword, y si el comentario la contiene → dispara la campaña.
4. Sigue el follow-gate normal.

## Convención de copy que detecta el extractor
- Keyword entre comillas cerca de un verbo: `comenta "GUIA"`.
- Keyword en MAYÚSCULAS tras el verbo: `escribe LIBRO`.
- `comenta la palabra PLANTILLA`.
- Fallback: primera palabra en MAYÚSCULAS relevante (ignora stopwords).

## Casos extremos / gotchas
- Si el copy no tiene keyword clara → `extractKeywordFromCaption` devuelve `null` y no dispara.
  Recomendar al creador poner la keyword en MAYÚSCULAS o entre comillas.
- El cache de keyword por `mediaId` es en memoria; se pierde al reiniciar (se re-deriva).
- Si varios posts comparten CTA distinto, cada `mediaId` deriva su propia keyword.
- Ambigüedad real → aquí se enchufaría un fallback con LLM (aún no implementado).
