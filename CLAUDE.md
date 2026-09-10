# CLAUDE.md — InboxPilot (social-dm-automation)

> Reglas y oráculo de verificación de este proyecto. El rol, la marca y las
> prohibiciones globales viven en `~/.claude/CLAUDE.md`; aquí va solo lo propio.

## Meta de este proyecto

Que un dueño de negocio sin conocimientos técnicos convierta comentarios de
Instagram en leads sin pagar un intermediario tipo ManyChat, y que pueda verlo y
manejarlo solo desde un panel. Se verifica cuando un cliente real entra por su
enlace, corre la prueba en vivo y cambia su palabra clave sin llamar a nadie.

## Dónde está lo importante

- Spec y plan vivos: `docs/specs/2026-09-10-panel-cliente-inboxpilot.md` y
  `docs/plan/2026-09-10-panel-cliente-inboxpilot.md`.
- Notas internas que NO van al repo público: `private/` (está en el .gitignore).
- **El repositorio es PÚBLICO** (`LeonardoIAConsult/social-dm-automation`): subir
  publica. Nunca hacer push sin OK explícito de Leonardo.

## Estado operativo

Los bloqueos externos vigentes, las fechas límite de infraestructura y el
registro de avance con su evidencia viven en `private/` (fuera del repo
público): `private/estado-operativo.md` y `private/ledger-panel-cliente.md`.

## Verificación (harness) — lo lee `Verify_After_Changes_LAP` v2

```
stack: Node 18+ · TypeScript estricto · Express · Postgres (pg) · Meta Graph API
build: npm run build
lint: none
types: npm run typecheck
test: npm test
dev: npm run dev | http://localhost:3000
health: http://localhost:3000/health
smoke: none
sensible: src/server/auth.ts, src/server/panel.ts, src/server/app.ts, src/store/**, src/config/env.ts, src/platforms/instagram/signature.ts, execution/invite.ts
```

- `lint: none` es real: el proyecto no tiene linter, la barrera es TypeScript en
  modo estricto más los tests. Si algún día se agrega, actualizar esta línea.
- `smoke: none` porque el humo de verdad ya vive dentro de `npm test`
  (`tests/webhookToFunnel.test.ts` recorre el webhook completo con firma real).
  Contra una base real: `DATABASE_URL=... npx tsx execution/db_smoke.ts`.

## Cómo se prueba de verdad aquí

- Toda prueba nueva se **muta**: se rompe el código a propósito y se ve fallar la
  prueba. Verde sin haberla visto roja no cuenta.
- Los tests fijan `process.env` ANTES de importar la config y usan `await
  import(...)`: `dotenv` no pisa lo que ya existe, así ninguna prueba depende del
  `.env` de la máquina ni sale a la red.
- Nada de números inventados para el cliente: un evento del embudo solo se
  registra si el hecho ocurrió de verdad.
