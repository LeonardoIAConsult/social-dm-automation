# Deploy a producción (URL estable)

Objetivo: correr el webhook en un host fijo → URL permanente, sin túnel, sin
depender de tu PC ni de Norton. Recomendado: **Render** (gratis, deploy desde GitHub).

## Paso 0 — Subir a GitHub (una vez)
```bash
# crea el repo vacío en github.com, luego:
git remote add origin https://github.com/TU-USUARIO/social-dm-automation.git
git push -u origin main
```
El `.env` NO se sube (está en .gitignore). Los secretos van en el dashboard del host.

## Paso 1 — Crear el servicio en Render
1. Entra a https://render.com → regístrate (puedes usar tu cuenta de GitHub).
2. **New → Web Service** → conecta tu repo `social-dm-automation`.
3. Render detecta `render.yaml` (o configúralo así):
   - Runtime: **Node**
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - Health check: `/health`

## Paso 2 — Variables de entorno (secretos)
En Render → tu servicio → **Environment**, agrega (los valores están en tu `.env` local):

| Variable | Valor |
|---|---|
| `META_APP_SECRET` | (tu app secret) |
| `META_WEBHOOK_VERIFY_TOKEN` | `leodm_wh_7Kx92pAqL4vR` (o el que uses) |
| `IG_ACCESS_TOKEN` | (tu token IGAA…) |
| `IG_BUSINESS_ACCOUNT_ID` | `17841400394175663` |
| `GDRIVE_ROOT_FOLDER_ID` | (id de tu carpeta Drive) |

Las no-secretas (`NODE_ENV`, `DRY_RUN=false`, etc.) ya vienen en `render.yaml`.

## Paso 3 — Deploy y URL
Render construye y te da una URL fija tipo:
`https://social-dm-automation.onrender.com`

Verifica: abre `https://TU-APP.onrender.com/health` → `{"ok":true}`.

## Paso 4 — Reapuntar el webhook de Meta
En el panel de Meta → Instagram → webhooks, cambia la **Callback URL** a:
`https://TU-APP.onrender.com/webhooks/instagram`
(mismo verify token). Verifica y guarda. Ya no usas cloudflared.

Y la **política de privacidad** ahora es estable:
`https://TU-APP.onrender.com/privacy`

## Notas
- **Plan free de Render** duerme tras ~15 min sin tráfico → el primer webhook tras
  inactividad tarda ~30s (Render "despierta"). Meta reintenta, pero para respuesta
  instantánea considera el plan de pago (~$7/mes) que queda siempre activo.
- **Token IGAA** expira ~60 días. Hay que renovarlo (o implementar refresh) antes.
- **Estado en memoria**: se reinicia en cada deploy/dormida. Para persistencia real
  (dedupe, follow cache) migrar `ConversationStore` a Redis/Postgres.
- **Google Drive**: sube `credentials.json` como Secret File en Render y pon
  `GDRIVE_ENABLED=true` cuando lo configures.
