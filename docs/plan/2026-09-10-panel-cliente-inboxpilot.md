# Plan — Panel del cliente InboxPilot (v1)
**Fecha:** 2026-09-10 · **Autor:** Leonardo Antolinez · **Spec:** docs/specs/2026-09-10-panel-cliente-inboxpilot.md
**Reglas de ejecución:** este plan se ejecuta bajo las 6 reglas SDD → `Brain_Master_Business/OUTPUTS/procesos/2026-09-02-superpowers-sdd-cosecha.md` (ledger de recuperación, fresh subagent por tarea, review 2-etapas, fix-loop con breaker 5 rondas, rulings-not-stalls, model selection). Quien implemente (plan-implementer o Claude) las lee ANTES de la Tarea 1.

## 1. Objetivo

Al terminar, un dueño de negocio sin conocimientos técnicos entra al panel con
Facebook desde su celular, ve que su automatización está viva, la prueba en vivo
en menos de dos minutos, cambia su palabra clave y su enlace con vista previa, y
entiende sus resultados sin ayuda de nadie. Leonardo ve todas las cuentas de
clientes en una lista y sabe cuál necesita atención.

## 2. Contexto del problema

Hoy el cliente no toca nada: sus palabras y enlaces viven en una Google Sheet
publicada como CSV cuya dirección se pega a mano en la configuración del
servidor, y la única pantalla existente es una bandeja en inglés hecha para el
revisor de Meta. De ahí salen tres dolores: el cliente no tiene prueba de que
funcione, no puede cambiar nada sin pedirlo, y cuando algo se rompe nadie se
entera hasta que deja de llegar gente.

Se hace ahora porque el autoservicio depende de permisos de Meta que todavía no
están disponibles, y todo el valor del panel se puede entregar sin esperarlos,
bajo el modelo hecho-por-ti. El trámite con Meta corre en paralelo y no bloquea
ninguna tarea de aquí.

## 3. Spec de referencia

`docs/specs/2026-09-10-panel-cliente-inboxpilot.md` (aprobado v1). El plan DEBE
cumplir:

- Entrada con Facebook en un botón, sin contraseñas ni correos.
- Semáforo de conexión con la fecha y hora de la última entrega real.
- Prueba en vivo con progreso paso a paso: comentario detectado, DM enviado,
  botón tocado, seguimiento verificado, recurso entregado.
- Editor de campaña (palabra, enlace, mensaje, follow-gate) con vista previa
  exacta del DM y validación antes de guardar.
- Resultados en lenguaje llano a siete y treinta días, y estado vacío que dice
  qué hacer, no ceros.
- Errores traducidos a una acción con botón, empezando por reconectar Instagram.
- Autoservicio construido y apagado tras bandera; panel de Leonardo con todas
  las cuentas.
- Todo usable desde el celular, en español.

Límites de v1 que el plan NO puede cruzar: nada de responder DMs desde el panel,
constructor de flujos, cobros, otros canales, difusiones, varios usuarios por
cuenta, marca blanca, ni migración obligatoria de la Google Sheet.

## 4. Lista de tareas a implementar

### Tarea 1 — Almacén persistente del panel
- **Qué:** modelo y almacenamiento para usuarios, sesiones, cuentas, campañas y
  eventos, detrás de una interfaz intercambiable como la que ya existe para
  conversaciones. Postgres como respaldo real; memoria solo para pruebas.
- **Dónde:** `src/store/` (nuevo módulo junto a `conversationStore.ts`), esquema
  creado al arrancar como ya lo hace `PostgresConversationStore`.
- **Depende de:** ninguna.
- **Criterio de hecho:** con Postgres configurado, se crea un dato desde una
  prueba, se reinicia el proceso y el dato sigue ahí. Sin Postgres configurado,
  la app arranca igual que hoy y no se rompe ningún test existente.

### Tarea 2 — Registro de eventos del embudo
- **Qué:** cada paso del flujo deja un evento con su cuenta, su campaña, su
  usuario y su hora: comentario detectado, DM enviado, botón tocado,
  seguimiento verificado, recurso entregado, y bloqueado por no seguir. Es la
  materia prima de la prueba en vivo y de los resultados.
- **Dónde:** `src/core/flowEngine.ts` (puntos de emisión) + nuevo registro en
  `src/store/`.
- **Depende de:** Tarea 1.
- **Criterio de hecho:** correr `execution/simulate_webhook.mjs` del camino
  completo deja la secuencia de eventos en orden, con su `accountId`, y sin
  duplicados al reenviar el mismo webhook.

### Tarea 3 — Entrar al panel (identidad y sesión)
- **Cambio sobre el spec (10-sep):** el spec decía "Entrar con Facebook". Para
  una app de tipo Negocios, el único inicio de sesión que ofrece Meta es el de
  empresas, y exige acceso avanzado a `public_profile`, que a su vez pide
  verificación del negocio. Decisión: la capa de identidad no se ata a ningún
  proveedor y se arranca con **enlace de invitación** que el operador envía al
  cliente. Facebook entra como segundo proveedor cuando ese requisito esté
  cubierto (ver Tarea 13, que lo necesita igual).
- **Qué:** sesión firmada en cookie httpOnly con cierre de sesión real, y
  entrada por enlace de invitación de un solo uso y con vencimiento.
- **Dónde:** `src/server/auth.ts` + `src/server/panel.ts` + rutas en
  `src/server/app.ts` + `execution/invite.ts` (genera el enlace) + variables
  nuevas en `src/config/env.ts`.
- **Depende de:** Tarea 1.
- **Criterio de hecho:** el enlace de invitación deja al cliente dentro y la
  cookie es httpOnly; el mismo enlace no sirve dos veces ni después de vencer;
  una cookie con la firma manipulada es rechazada antes de tocar la base;
  cerrar sesión invalida la sesión de verdad, no solo borra la cookie; y con la
  bandera apagada las rutas del panel no existen.

### Tarea 4 — Resolver a quién pertenece cada cuenta
- **Qué:** relación entre la persona que entró y las cuentas de Instagram que
  puede ver, apoyada en el `AccountRegistry` que ya existe. Toda pantalla del
  panel resuelve la cuenta por esta vía y nunca por un dato de la petición.
- **Dónde:** `src/core/account.ts` + capa de autorización en `src/server/`.
- **Depende de:** Tareas 1 y 3.
- **Ojo (deuda de hoy):** la bandeja actual (`/inbox`) llama a `store.list()` sin
  `accountId`, o sea lista TODAS las conversaciones de todos los tenants. Con un
  solo cliente no hay fuga; con dos, si. Scopear `/inbox` por cuenta entra en
  esta tarea y es BLOQUEANTE antes de conectar al segundo cliente.
- **Criterio de hecho:** con dos usuarios de prueba y dos cuentas, cada uno ve
  solo la suya; pedir a mano el identificador de la cuenta ajena devuelve
  negado, no datos; y `/inbox` deja de mostrar conversaciones de cuentas ajenas.

### Tarea 5 — Cascarón del panel, móvil primero
- **Qué:** estructura visual en español, una sola columna, con el semáforo
  arriba y la acción principal visible sin desplazarse. Estados de cargando y
  de error incluidos.
- **Dónde:** `src/server/panel/` (nuevo, mismo enfoque de HTML servido que
  `inbox.ts` y `legal.ts`).
- **Depende de:** Tarea 3.
- **Criterio de hecho:** a 360 píxeles de ancho no hay desplazamiento
  horizontal, el semáforo se ve sin bajar y ningún texto queda en inglés.

### Tarea 6 — Semáforo de conexión y última entrega
- **Qué:** estado real de la cuenta consultando a Meta, con el nombre de la
  cuenta y la fecha y hora de la última entrega tomada del registro de eventos.
  En rojo, una frase llana y un solo botón.
- **Dónde:** `src/platforms/instagram/client.ts` (consulta de validez) +
  panel.
- **Depende de:** Tareas 2, 4 y 5.
- **Criterio de hecho:** con permiso válido se ve verde con fecha real; con un
  permiso vencido a propósito se ve rojo con el botón de reconexión, y ninguna
  de las dos pantallas muestra jerga técnica.

### Tarea 7 — Editor de campaña con vista previa
- **Qué:** formulario de palabra clave, enlace, mensaje y follow-gate, con la
  vista previa del DM y su botón actualizándose al escribir. Validaciones antes
  de guardar: enlace que no abre, archivo de Drive privado, palabra ya usada.
- **Dónde:** `src/core/campaigns.ts` (leer campañas desde el almacén en vez de
  la lista fija) + panel.
- **Depende de:** Tareas 1, 4 y 5.
- **Criterio de hecho:** guardar una palabra nueva cambia el DM que realmente
  sale en la siguiente prueba; un enlace roto y una palabra duplicada se
  rechazan con el motivo antes de guardar.

### Tarea 8 — Convivencia con la Google Sheet
- **Qué:** la hoja sigue siendo fuente válida para quien ya la usa. Si la cuenta
  tiene campañas en el panel, mandan las del panel; si no, se lee la hoja como
  hoy.
- **Dónde:** `src/core/resources.ts` + `src/core/campaigns.ts`.
- **Depende de:** Tarea 7.
- **Criterio de hecho:** una cuenta sin campañas en el panel entrega exactamente
  lo mismo que hoy desde su hoja; una cuenta con campañas en el panel ignora la
  hoja, y la pantalla dice cuál fuente está mandando.

### Tarea 9 — Prueba en vivo
- **Qué:** ventana de prueba de unos minutos con la instrucción exacta para el
  cliente y el progreso de los cinco pasos pintándose a medida que ocurren. Al
  cerrarse sin actividad, explica las dos causas típicas y ofrece repetir.
- **Dónde:** panel + registro de eventos.
- **Depende de:** Tareas 2, 6 y 7.
- **Criterio de hecho:** con un comentario real desde una segunda cuenta se
  pintan los cinco pasos en vivo; sin comentario, aparece el mensaje de causas y
  no un error.

### Tarea 10 — Resultados en lenguaje llano
- **Qué:** cuántas personas comentaron, cuántas recibieron y cuántas no
  recibieron por no seguir, a siete y treinta días, por campaña. Estado vacío
  con el texto del post sugerido listo para copiar.
- **Dónde:** panel + consultas sobre el registro de eventos.
- **Depende de:** Tareas 2 y 5.
- **Criterio de hecho:** los números cuadran uno a uno con los eventos de una
  simulación conocida; una cuenta sin actividad muestra la guía de qué hacer y
  ningún cero suelto.

### Tarea 11 — Errores traducidos a acción
- **Qué:** catálogo de fallos con su frase llana, su botón y su aviso. Cubre
  permiso vencido o revocado, con correo el mismo día, y envío frenado por
  límite de Meta explicado como demora, no como pérdida.
- **Dónde:** `src/server/panel/` + `src/core/sendQueue.ts` (estado del freno) +
  envío de correo.
- **Depende de:** Tareas 6 y 10.
- **Criterio de hecho:** revocar el permiso desde Meta pone el panel en rojo con
  el botón correcto y dispara el correo el mismo día; forzar el límite de envío
  muestra el mensaje de demora y la cola no pierde mensajes.

### Tarea 12 — Vista de Leonardo
- **Qué:** lista de todas las cuentas de clientes con su semáforo, ordenada por
  cuál necesita atención primero.
- **Dónde:** panel, ruta separada bajo la misma sesión.
- **Depende de:** Tareas 4 y 6.
- **Criterio de hecho:** con dos cuentas, una sana y una rota, la rota aparece
  primero; un cliente que entre a esa ruta recibe negado.

### Tarea 13 — Autoservicio detrás de bandera
- **Dependencia externa:** esta tarea necesita la verificación del negocio en
  Meta, el mismo requisito que habilita el inicio de sesión con Facebook, así
  que cubrir uno cubre el otro. Aquí entra el proveedor de identidad de Facebook
  que la Tarea 3 dejó preparado.
- **Qué:** camino completo de "Conectar mi Instagram" para que el cliente
  conecte su cuenta solo, apagado por bandera. Con la bandera apagada el cliente
  ve que su cuenta la administra su consultor.
- **Dónde:** `src/config/env.ts` (bandera) + flujo de conexión + panel.
- **Depende de:** Tareas 3, 4 y 6.
- **Criterio de hecho:** con la bandera apagada no existe ninguna forma de
  llegar a esa pantalla, ni siquiera escribiendo la dirección; encendida en
  local y con la cuenta propia, la conexión se completa y el semáforo queda en
  verde.

### Tarea 14 — Revisión de seguridad y verificación contra el spec
- **Qué:** `Sentinel_LAP diff` sobre todo el bloque, por tocar sesión,
  autorización y datos de clientes, y `Verify_After_Changes_LAP` v2 recorriendo
  un caso por cada comportamiento del spec en navegador real, con dos cuentas
  distintas.
- **Dónde:** todo el diff del plan.
- **Depende de:** Tareas 1 a 13.
- **Criterio de hecho:** veredicto GO con evidencia por capa, cero fuga de datos
  entre cuentas y ningún hallazgo alto o crítico abierto.
