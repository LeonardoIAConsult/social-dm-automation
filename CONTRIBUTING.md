# Contribuir a InboxPilot

¡Gracias por tu interés! Este proyecto es un motor de automatización de DMs de
Instagram conectado directo a la API de Meta, con foco en operar **dentro de las
reglas de Meta** (nada de DM masivo en frío).

## Arranque

```bash
npm install
cp .env.example .env    # rellena valores; para probar sin credenciales usa DRY_RUN=true
npm run dev             # servidor en http://localhost:3000
npm test               # tests (node:test)
npm run typecheck      # TypeScript estricto
```

Puedes probar el flujo completo **sin credenciales de Meta** con `DRY_RUN=true` y
el simulador de webhooks (ver el README).

## Antes de abrir un PR

- `npm run typecheck` y `npm test` en verde (el CI los corre igual).
- Cambios quirúrgicos: toca solo lo necesario, respeta el estilo existente.
- Si agregas comportamiento, agrega su test.
- No subas secretos: `.env`, tokens y credenciales están en `.gitignore`; el
  estado persistido (`data/`) también.

## Arquitectura (mapa rápido)

- `src/core/` — motor agnóstico de plataforma (flujo, campañas, cola de envíos,
  rate-limit, cuentas).
- `src/platforms/instagram/` — adaptador de Instagram (webhook, firma, cliente).
- `src/store/` — persistencia intercambiable (memoria / archivo / Postgres) tras
  la interfaz `ConversationStore`.
- `docs/` — arquitectura, cumplimiento (compliance), setup y deploy.

## Estilo

TypeScript estricto, sin dependencias innecesarias. Comentarios que explican el
**porqué**, no el qué. PRs enfocados y con contexto en la descripción.
