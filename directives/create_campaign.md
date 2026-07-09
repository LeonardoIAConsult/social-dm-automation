# Directiva: Crear / editar una campaña de DM

## Objetivo
Dar de alta o modificar una automatización de DM (disparador → follow-gate → entrega de valor).

## Entradas (pedir al usuario si faltan)
- Disparador: ¿keyword manual o derivada del copy del post? (ver `caption_driven_keywords.md`)
- Si keyword manual: lista de palabras clave.
- ¿Exige seguir la cuenta? (follow-gate on/off)
- Textos: respuesta pública opcional, welcome, pedir seguir, reintento.
- Valor a entregar: texto/link/imagen (PDF, recurso, etc.).
- Opcional: restringir a un `mediaId` (un solo post).

## Herramienta (Capa 3)
- Archivo: `src/core/campaigns.ts` → arreglo `campaigns`.
- Tipo: `Campaign` (documentado en el mismo archivo).

## Procedimiento
1. Confirmar entradas arriba. Elegir `name` único y estable.
2. Agregar/editar el objeto `Campaign` en `campaigns.ts`.
3. `npm run typecheck` y `npm test` deben pasar.
4. Si añadiste lógica nueva de match, agrega un test.

## Salidas
- Campaña activa tras reiniciar el server (`npm run dev`).

## Casos extremos / gotchas
- Modo `caption`: `keywords` se ignora; se derivan del copy en runtime.
- El valor se entrega **una sola vez** por usuario (flag `delivered:<name>` en el estado).
- Envíos fuera de la ventana de 24h se bloquean (política Meta). Ver `docs/COMPLIANCE.md`.
