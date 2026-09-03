# Cumplimiento (LEE ESTO ANTES DE USAR)

Este sistema está diseñado para operar **dentro** de las políticas de Meta. Si lo fuerzas fuera de ellas, Meta puede **restringir o banear tu cuenta y tu app**. Reglas clave (Instagram Messaging API, 2026):

## 1. Ventana de 24 horas
Solo puedes enviar mensajes a un usuario **dentro de las 24h** desde su última interacción contigo. La ventana **abre y se renueva** cuando el usuario:
- te manda un DM,
- comenta uno de tus posts/reels,
- responde tu story,
- toca un botón/CTA que envía mensaje.

El engine respeta esto: `flowEngine.ts` no envía si la ventana está cerrada (excepto respuestas privadas a comentarios, que tienen su propia ventana).

## 2. Nada de DM masivo en frío
**No puedes** mandar DMs a gente que no te ha contactado. Eso es spam para Meta = ban. Lo "masivo" permitido es responder a muchos usuarios que **sí** iniciaron contacto (comentaron, escribieron), no salir a buscar desconocidos.

## 3. Límite de tasa
~200 mensajes automatizados por hora dentro de ventanas abiertas. No lo excedas.

## 4. Follow-gate
Usamos el campo oficial `is_user_follow_business` del Graph API para saber si la persona te sigue, y solo entonces entregar el valor. Esto es lícito. **No** condiciones prohibidas (ej. pedir que etiqueten, comenten X veces, etc., como requisito engañoso). Mantén el intercambio honesto: "sígueme y te mando el recurso".

## 5. Permisos y App Review
Requiere cuenta profesional (Business/Creator), app en developers.facebook.com y el permiso `instagram_business_manage_messages` aprobado en App Review. Ver `SETUP_META.md`.

## 6. Contenido
No entregues nada que viole políticas (spam, engaños, contenido prohibido). El valor debe ser real.

---
Si Meta cambia estas reglas, **las docs oficiales mandan**, no este archivo. Revisa:
https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
