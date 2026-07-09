# Conexiones — estado y qué hace falta

Resumen de todas las integraciones. ✅ listo en código · 🔧 requiere acción tuya · 🕓 futuro.

## 1. Instagram / Meta  🔧 (código ✅, faltan tus credenciales)
Qué falta que hagas TÚ (no lo puedo hacer por ti, requiere tu login):
1. Cuenta IG profesional (Business/Creator).
2. App en https://developers.facebook.com → producto **Instagram (Instagram API with Instagram Login)**.
3. Obtener token: usa `execution/meta_token_setup.mjs` (te da el token largo + tu IG id).
4. App Review del permiso `instagram_business_manage_messages` (para usuarios reales; mientras, agrégate como **tester**).
5. Webhook: Callback `https://TU-DOMINIO/webhooks/instagram`, Verify Token = `META_WEBHOOK_VERIFY_TOKEN`, suscribir campos `messages`, `messaging_postbacks`, `comments`.
6. Pon `DRY_RUN=false` y las 4 variables Meta en `.env`.

Detalle paso a paso: `docs/SETUP_META.md`. Prueba local sin nada de esto: `DRY_RUN=true` + `execution/simulate_webhook.mjs`.

## 2. Google Drive (PDFs por fecha/post)  🔧 (pendiente de decisiones — ver abajo)
Objetivo: entregar en el DM el documento correcto sacándolo de una carpeta de Drive
marcada por fecha/post. Requiere credenciales de Google. Decisiones pendientes antes de
construir (método de auth, convención de carpetas, link vs adjunto). Ver sección al final.

## 3. Facebook Messenger  🕓
Comparte casi toda la API de Meta. Se agrega como segundo adaptador reusando el de IG.
Mismo tipo de app/token, permiso `pages_messaging`.

## 4. Twitter/X  🕓
API de DM en tiers de pago. Adaptador aparte cuando se decida invertir.

## 5. LinkedIn / YouTube  ❌
Sin API de DM automatizado. No hay conexión viable. YouTube solo comentarios.

---

## Seguridad de credenciales (importante)
- Todo secreto vive en `.env` (git-ignored). Nunca se commitea.
- `credentials.json` / `token.json` de Google también van en `.gitignore`.
- Si un token se filtra en logs o código, se revoca y rota de inmediato.
