# Panel del cliente — InboxPilot v1
**Fecha:** 2026-09-10 · **Autor:** Leonardo Antolinez · **Estado:** aprobado v1

## 1. Overview

Un panel web donde el dueño de un negocio ve, con sus propios ojos, que su
automatización de Instagram está viva y le está trayendo gente: entra con
Facebook, ve un semáforo de conexión, corre una prueba en vivo, edita su palabra
clave y su enlace con vista previa del DM, y lee sus resultados en lenguaje
llano. **Para qué:** que el cliente confíe en el producto y lo maneje solo, sin
llamar a nadie.

Sirve a los dos modelos de venta al mismo tiempo. En *hecho-por-ti* la cuenta de
Instagram la conecta Leonardo y el cliente solo opera su campaña. En
*autoservicio* el propio cliente conecta su Instagram; ese camino se construye
completo pero nace apagado, y se enciende cuando los permisos de Meta lo
permitan.

## 2. Usuario Objetivo

**Primario — Marcela, dueña de negocio.** Vende cursos, ropa o servicios por
Instagram. Maneja su cuenta desde el celular. No sabe qué es una variable de
entorno, un webhook ni un token, y no tiene por qué saberlo. Ya usó ManyChat o
vio a alguien usarlo, así que espera algo de ese nivel de facilidad. Entra al
panel una o dos veces por semana, casi siempre desde el teléfono, y lo que
realmente quiere saber es una sola cosa: *¿esto está funcionando y me está
sirviendo?* Si ve un error técnico en inglés, no lo investiga: escribe por
WhatsApp o asume que se dañó.

**Secundario — Leonardo, operador.** Conecta cuentas de clientes, revisa que
todo esté sano y necesita ver el estado de varias cuentas sin entrar a Render ni
leer logs.

## 3. Contexto del problema

Hoy el cliente no toca nada del producto, y ese es el problema. Sus palabras y
enlaces viven en una Google Sheet que hay que publicar como CSV y cuya dirección
se pega a mano en la configuración del servidor. Cada cambio de rumbo pasa por
Leonardo. La única pantalla que existe es una bandeja escrita en inglés, con
clave básica, construida para el revisor de Meta y no para un cliente.

De ahí salen tres dolores concretos. El cliente **no tiene prueba** de que
funcione, así que desconfía en la primera semana, justo cuando se decide la
renovación. El cliente **no puede cambiar** su palabra ni su enlace sin pedirlo,
así que la herramienta se siente ajena. Y cuando algo se rompe, como un token
vencido, **nadie se entera** hasta que el cliente nota que dejaron de llegar
mensajes; el fallo es invisible para quien lo sufre.

Al mismo tiempo hay una restricción externa que manda: conectar la cuenta de
Instagram de un tercero exige permisos de Meta que no están disponibles todavía.
El panel debe dar valor completo sin depender de esa aprobación.

## 4. Alcance de la versión 1

**Incluye (v1):**
- Entrar con Facebook, en un botón, sin contraseñas ni correos de por medio.
- Semáforo de conexión de la cuenta de Instagram, con la fecha y hora de la
  última entrega real.
- Prueba en vivo: una ventana de unos minutos en la que el cliente comenta desde
  otro celular y ve en pantalla, paso a paso, cómo su comentario se convierte en
  entrega.
- Vista previa exacta del DM y del botón, tal como los verá la persona.
- Editor de campaña: palabra clave, enlace, mensaje de acompañamiento y
  follow-gate encendido o apagado.
- Resultados en lenguaje llano por campaña: cuántos comentaron, cuántos
  recibieron y cuántos no recibieron por no seguir la cuenta.
- Errores traducidos a una acción concreta con su botón, empezando por la
  reconexión de Instagram.
- Camino de autoservicio construido y apagado tras una bandera, más el panel de
  Leonardo para ver el estado de todas las cuentas.
- Todo legible y usable desde el celular.

**NO incluye (v1):**
- Responder DMs desde el panel.
- Constructor visual de flujos.
- Cobros, planes y límites por plan.
- Otros canales: WhatsApp, Messenger, Telegram.
- Envíos masivos o difusiones.
- Varios usuarios por cuenta, roles y permisos.
- Migración obligatoria de la Google Sheet: quien ya la usa sigue igual.
- Marca blanca y dominio propio por cliente.

## 5. Comportamiento esperado

**Primera entrada.** Cuando el cliente abre el enlace que le pasó Leonardo → el
sistema muestra una sola pantalla con un botón, *Entrar con Facebook*, y una
línea que explica por qué se usa Facebook. Cuando toca el botón y autoriza → el
sistema lo deja dentro y muestra su panel. Cuando su cuenta de Facebook no tiene
ningún Instagram asociado al servicio → el sistema dice que esa cuenta todavía
no está habilitada y ofrece escribirle a Leonardo, sin dejarlo en una pantalla
en blanco.

**Estado de la cuenta.** Cuando entra al panel → el sistema muestra arriba un
semáforo: en verde, el nombre de su cuenta de Instagram y la última entrega, con
su fecha y hora. En rojo, qué está pasando y un único botón para arreglarlo.

**Prueba en vivo.** Cuando toca *Probar ahora* → el sistema abre una ventana de
prueba de unos minutos y le da la instrucción exacta: comentar su palabra clave,
desde otra cuenta, en el post que él elija. Mientras la ventana está abierta →
el sistema va marcando en pantalla, en vivo, cada paso a medida que ocurre:
comentario detectado, DM enviado, botón tocado, seguimiento verificado, recurso
entregado. Cuando la ventana se cierra sin que llegara ningún comentario → el
sistema lo dice sin alarmar y explica las dos causas típicas, que el comentario
haya sido en un post distinto o que la palabra no coincida con ninguna campaña.

**Editar la campaña.** Cuando abre su campaña → el sistema muestra la palabra,
el enlace, el mensaje y el follow-gate, con la vista previa del DM al lado.
Cuando cambia cualquier cosa → la vista previa se actualiza al momento. Cuando
guarda → el sistema confirma que ya está activo y desde cuándo. Cuando pega un
enlace que no abre, o un enlace de Drive que está en privado → el sistema lo
avisa antes de guardar y le dice qué corregir. Cuando escribe una palabra que ya
está usada en otra campaña → el sistema no lo deja guardar y le muestra con cuál
choca.

**Resultados.** Cuando mira sus números → el sistema los dice en su idioma:
cuántas personas comentaron, cuántas recibieron su recurso y cuántas no lo
recibieron porque no seguían la cuenta, en los últimos siete y treinta días.
Cuando todavía no hay nada → el sistema no muestra ceros fríos, muestra qué
hacer ahora: publicar el post con la palabra clave, con el texto sugerido listo
para copiar.

**Cuando algo se rompe.** Cuando el permiso de Instagram vence o se revoca → el
sistema lo muestra en rojo arriba, en una frase sin tecnicismos, con un botón
que dice *Reconectar Instagram*, y le avisa por correo el mismo día. Cuando la
entrega falla por un límite de Meta → el sistema explica que se está enviando
más despacio y que no se perdió ningún mensaje.

**Autoservicio, apagado.** Mientras la bandera esté apagada → el cliente no ve ninguna
opción de conectar su propia cuenta, y en su lugar ve que su cuenta la administra
su consultor. Cuando se encienda la bandera → aparece el botón
*Conectar mi Instagram* y el cliente completa la conexión solo, sin que cambie
nada de lo que ya venía usando.

**Leonardo.** Cuando entra con su propia cuenta → el sistema le muestra todas
las cuentas de clientes en una lista, con el semáforo de cada una y cuál necesita
atención primero.

## 6. Posibles errores y mitigaciones

| Error/riesgo | Cuándo pasa | Mitigación |
|---|---|---|
| El cliente entra con una cuenta de Facebook que no es la dueña del Instagram del negocio | Tiene varias cuentas, o usa la personal en vez de la del negocio | El sistema no lo deja en blanco: nombra la cuenta con la que entró y ofrece salir y entrar con otra, más el contacto de Leonardo |
| El permiso de Instagram vence o el cliente lo revoca sin darse cuenta | Cambios de contraseña, revisiones de seguridad de Meta, vencimiento del token largo | Semáforo en rojo con una frase llana, botón de reconexión y aviso por correo el mismo día, no cuando el cliente lo note |
| El enlace del recurso está roto o el archivo de Drive es privado | El cliente pega el enlace desde la barra del navegador en vez de usar Compartir | Se valida al guardar y se avisa antes de publicar, con la instrucción exacta para Drive |
| Dos campañas con la misma palabra | El cliente duplica una campaña vieja o reusa una palabra | Se bloquea el guardado y se muestra con cuál campaña choca |
| La prueba en vivo no detecta nada | El comentario fue en otro post, la palabra no coincide, o el comentario se borró | Se explican las causas típicas al cerrar la ventana y se ofrece repetir la prueba |
| El cliente cambia su campaña y cree que no funciona | Espera efecto inmediato y no sabe si guardó | La confirmación dice qué quedó activo y desde cuándo, y la vista previa muestra el resultado real |
| El cliente abre el panel en el celular y no entiende dónde está parado | Pantallas densas pensadas para escritorio | Una sola columna, el semáforo primero, la acción principal siempre visible sin desplazarse |
| Se enciende el autoservicio y el camino apagado nunca se probó de verdad | La bandera se enciende en producción sin ensayo | El autoservicio se prueba con una cuenta propia antes de encender la bandera para clientes |
| El panel muestra datos de una cuenta a otro cliente | Error al resolver a quién pertenece la cuenta | Cada pantalla se prueba con dos cuentas distintas antes de dar la entrega por buena, y el bloque pasa por revisión de seguridad antes de fusionar |
