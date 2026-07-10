# App Review de Meta — para responder a CUALQUIER persona

Hoy la app tiene **Acceso Estándar**: solo mensajea a cuentas que son **tester**.
Para atender al público general necesitas **Acceso Avanzado**, que se obtiene enviando
la app a **App Review**. Esta guía tiene todo listo para que lo envíes.

## 1. Permisos a solicitar (Advanced Access)
En el panel: **App Review → Permissions and Features**. Pide Advanced Access de:

| Permiso | Para qué |
|---|---|
| `instagram_business_basic` | Info básica de la cuenta. |
| `instagram_business_manage_messages` | Enviar/recibir DMs (el core del sistema). |
| `instagram_business_manage_comments` | Recibir comentarios y responder (comment-to-DM). |

## 2. Requisitos previos (revisa antes de enviar)
- App en modo **Activo** (ya está). ✅
- **URL de política de privacidad** válida y pública (ya: `.../privacy`). ✅
- Ícono de la app, categoría y datos básicos completos (Configuración → Información básica).
- Posible **verificación de negocio** (Business Verification) en Meta Business Suite:
  suele pedir documento del negocio. Puede tardar días.

## 3. Descripción del caso de uso (pégala en el formulario)
> Nuestra app automatiza la atención de una cuenta profesional de Instagram. Cuando un
> usuario comenta una palabra clave en una publicación (indicada en el copy del post),
> la app le envía un mensaje directo con un botón para recibir un recurso gratuito
> (guía, plantilla, enlace). Al tocar el botón, la app verifica que el usuario siga la
> cuenta y le entrega el recurso. Todo ocurre dentro de las ventanas de mensajería
> permitidas por Meta; no se envían mensajes no solicitados ni masivos en frío.

## 4. Instrucciones paso a paso para el revisor (pégalas)
> 1. Comenta la palabra "GUIA" en el post de prueba: <URL del post>.
> 2. Recibirás un DM de la cuenta con un botón "Obtener el enlace".
> 3. Toca el botón. Si sigues la cuenta, recibirás el enlace al recurso.
> 4. Si no sigues, la app te pide seguir y reintentar con un botón.

(Deja un post de prueba público con la palabra clave en el copy y pon su URL arriba.)

## 5. Screencast (video obligatorio)
Graba una pantalla mostrando el flujo COMPLETO con una cuenta que NO sea admin:
1. El post con el copy que dice "comenta GUIA".
2. La otra cuenta comentando "GUIA".
3. La llegada del DM con el botón.
4. El tap y la entrega del enlace.
5. Muestra brevemente el panel donde el permiso se usa.
Sube el video en el formulario de cada permiso. Debe verse el uso REAL, sin cortes.

## 6. Checklist antes de enviar
- [ ] App en modo Activo.
- [ ] Política de privacidad accesible (`.../privacy`).
- [ ] Datos básicos + ícono + categoría completos.
- [ ] Business Verification iniciada/aprobada (si la piden).
- [ ] Post de prueba público con la palabra clave en el copy.
- [ ] Screencast del flujo completo grabado.
- [ ] Descripción y pasos (secciones 3 y 4) pegados en cada permiso.
- [ ] Enviar y esperar (revisión suele tardar días).

## Mientras tanto
Puedes seguir probando y afinando todo con **cuentas tester** (Roles → Evaluador de
Instagram). El comportamiento es idéntico; solo cambia a quién Meta permite responder.
