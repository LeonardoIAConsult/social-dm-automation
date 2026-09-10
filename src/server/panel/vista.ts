import { esc } from '../html.js';

/**
 * La cara del panel del cliente.
 *
 * Tres reglas que mandan sobre todo lo demas:
 *
 * 1. **El telefono primero.** Marcela abre esto desde el celular, entre cliente
 *    y cliente. Una sola columna, sin nada que se salga de la pantalla, y lo
 *    importante arriba: al abrir tiene que ver si su automatizacion esta viva
 *    SIN desplazarse.
 * 2. **Sin JavaScript.** La pagina se sirve entera desde el servidor y las
 *    acciones son formularios. No es purismo: la politica de seguridad del sitio
 *    bloquea los scripts en linea, y ademas asi no hay pantalla en blanco si algo
 *    de red falla.
 * 3. **En su idioma.** Ni una palabra tecnica. No se dice "token invalido", se
 *    dice "hay que volver a conectar tu Instagram", y al lado el boton.
 *
 * Aqui vive SOLO la estructura y los estados. Los datos de verdad los traen las
 * tareas siguientes: el semaforo real (Tarea 6), la campana (Tarea 7), la prueba
 * en vivo (Tarea 9) y los resultados (Tarea 10).
 */

/** Como se ve el estado de la conexion. */
export type EstadoConexion =
  | { tipo: 'activo'; cuentaInstagram?: string; ultimaEntrega?: Date }
  | { tipo: 'atencion'; quePaso: string; accion: { texto: string; url: string } }
  | { tipo: 'sin-datos' };

export interface DatosDelPanel {
  /** Nombre visible de la cuenta del cliente. */
  cuenta: string;
  /** Cuantas cuentas maneja quien entro. Con mas de una aparece el enlace a la lista. */
  cuantasCuentas?: number;
  conexion: EstadoConexion;
  /** Bloques que todavia no tienen datos, en el orden en que apareceran. */
  campana?: { palabra: string; enlace: string } | 'pendiente';
  resultados?: { comentaron: number; recibieron: number; noSeguian: number } | 'pendiente';
  /** Periodo que se esta mostrando en los resultados. */
  dias?: 7 | 30;
  /** Aviso puntual arriba de todo (ej. algo que el cliente acaba de hacer). */
  aviso?: string;
}

const ESTILOS = `
 :root{
   --tinta:#14181f; --tinta-suave:#5b6570; --linea:#e4e7ec; --fondo:#f6f7f9;
   --papel:#ffffff; --acento:#0d1b2a; --verde:#0f8a4a; --ambar:#b45309; --gris:#8a919b;
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--fondo);color:var(--tinta);
   font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
   font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%}
 .envoltura{max-width:560px;margin:0 auto;padding:16px 16px 48px}
 header.marca{display:flex;align-items:center;justify-content:space-between;gap:12px;
   padding:14px 0 6px}
 header.marca .nombre{font-weight:700;letter-spacing:-.01em}
 header.marca .cuenta{color:var(--tinta-suave);font-size:.85rem;
   overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}
 .tarjeta{background:var(--papel);border:1px solid var(--linea);border-radius:14px;
   padding:18px;margin-top:14px}
 .tarjeta h2{margin:0 0 4px;font-size:1rem;letter-spacing:-.01em}
 .semaforo{display:flex;gap:12px;align-items:flex-start}
 .punto{flex:0 0 auto;width:14px;height:14px;border-radius:50%;margin-top:6px}
 .punto.activo{background:var(--verde);box-shadow:0 0 0 4px rgba(15,138,74,.14)}
 .punto.atencion{background:var(--ambar);box-shadow:0 0 0 4px rgba(180,83,9,.14)}
 .punto.sin-datos{background:var(--gris);box-shadow:0 0 0 4px rgba(138,145,155,.14)}
 .estado{font-size:1.12rem;font-weight:650;letter-spacing:-.01em;margin:0}
 .detalle{margin:2px 0 0;color:var(--tinta-suave);font-size:.92rem}
 .boton{display:block;width:100%;margin-top:14px;padding:14px 18px;border:0;
   border-radius:10px;background:var(--acento);color:#fff;font-size:1rem;font-weight:600;
   text-align:center;text-decoration:none;cursor:pointer}
 .boton.suave{background:transparent;color:var(--tinta-suave);border:1px solid var(--linea);
   font-weight:500}
 .pendiente{color:var(--tinta-suave);font-size:.92rem;margin:6px 0 0}
 .cifras{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
 .cifra{background:var(--fondo);border-radius:10px;padding:10px;text-align:center}
 .cifra b{display:block;font-size:1.4rem;letter-spacing:-.02em}
 .cifra span{display:block;color:var(--tinta-suave);font-size:.76rem;line-height:1.25}
 .aviso{background:#eef6ff;border:1px solid #cfe3ff;border-radius:12px;padding:12px 14px;
   margin-top:14px;font-size:.94rem}
 .pie{margin-top:24px}
 label{display:block;font-weight:600;font-size:.92rem;margin-top:14px}
 .ayuda{display:block;font-weight:400;color:var(--tinta-suave);font-size:.85rem;
   margin-top:2px}
 input[type=text],input[type=url]{width:100%;margin-top:6px;padding:12px 14px;font-size:16px;
   border:1px solid var(--linea);border-radius:10px;background:var(--papel);color:var(--tinta);
   font-family:inherit}
 input:focus{outline:2px solid var(--acento);outline-offset:1px}
 .interruptor{display:flex;align-items:flex-start;gap:10px;margin-top:16px}
 .interruptor input{margin-top:3px;width:20px;height:20px;flex:0 0 auto}
 .interruptor span{font-size:.94rem}
 .error{background:#fff4f2;border:1px solid #ffd4cc;border-radius:12px;padding:12px 14px;
   margin-top:14px;font-size:.94rem}
 .error b{display:block;margin-bottom:2px}
 .dm{background:#f0f2f5;border-radius:14px;padding:14px;margin-top:10px}
 .dm .globo{background:var(--papel);border-radius:14px;padding:12px 14px;font-size:.95rem;
   white-space:pre-wrap;word-break:break-word}
 .dm .boton-dm{margin-top:8px;background:var(--papel);border:1px solid var(--linea);
   border-radius:10px;padding:10px;text-align:center;font-weight:600;font-size:.92rem;
   color:#0d6efd}
 .dm .quien{color:var(--tinta-suave);font-size:.78rem;margin:0 0 6px}
 .fuente{color:var(--tinta-suave);font-size:.82rem;margin-top:10px}
 ol.pasos{list-style:none;margin:14px 0 0;padding:0}
 ol.pasos li{display:flex;gap:10px;align-items:flex-start;padding:9px 0;
   border-top:1px solid var(--linea)}
 ol.pasos li:first-child{border-top:0}
 ol.pasos .marca{flex:0 0 auto;width:22px;height:22px;border-radius:50%;
   border:2px solid var(--linea);display:flex;align-items:center;justify-content:center;
   font-size:.8rem;color:var(--tinta-suave)}
 ol.pasos li.hecho .marca{background:var(--verde);border-color:var(--verde);color:#fff}
 ol.pasos li.hecho .que{font-weight:600}
 ol.pasos .que{font-size:.96rem}
 ol.pasos .cuando{display:block;color:var(--tinta-suave);font-size:.8rem}
 .cuenta-regresiva{color:var(--tinta-suave);font-size:.85rem;margin-top:12px}
 .listo{background:#eefaf1;border:1px solid #c9ecd6;border-radius:12px;padding:12px 14px;
   margin-top:14px;font-size:.95rem}
 .periodo{display:flex;gap:8px;margin-top:2px}
 .periodo a{flex:1;text-align:center;padding:8px;border:1px solid var(--linea);
   border-radius:8px;text-decoration:none;color:var(--tinta-suave);font-size:.86rem}
 .periodo a.activo{background:var(--acento);color:#fff;border-color:var(--acento)}
 code,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;
   background:var(--fondo);padding:1px 5px;border-radius:5px;word-break:break-all}
 @media (max-width:380px){
   .envoltura{padding:12px 12px 40px}
   .cifras{grid-template-columns:1fr;gap:8px}
   .cifra{display:flex;align-items:baseline;gap:8px;text-align:left}
   .cifra b{font-size:1.15rem}
 }
`;

/** Envoltura comun de toda pagina del panel. */
export function paginaDelPanel(titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>${ESTILOS}</style>
</head><body><div class="envoltura">${cuerpo}</div></body></html>`;
}

function fecha(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** El semaforo. Es lo primero que se ve y responde una sola pregunta. */
function bloqueConexion(estado: EstadoConexion): string {
  if (estado.tipo === 'activo') {
    const cuenta = estado.cuentaInstagram ? ` en ${esc(estado.cuentaInstagram)}` : '';
    const ultima = estado.ultimaEntrega
      ? `Última entrega: ${esc(fecha(estado.ultimaEntrega))}.`
      : 'Todavía no has entregado nada. En cuanto alguien comente tu palabra, aparece aquí.';
    return `<section class="tarjeta">
      <div class="semaforo">
        <span class="punto activo"></span>
        <div>
          <p class="estado">Tu automatización está activa${cuenta}</p>
          <p class="detalle">${ultima}</p>
        </div>
      </div>
      <a class="boton" href="/panel/prueba">Probar ahora</a>
    </section>`;
  }

  if (estado.tipo === 'atencion') {
    return `<section class="tarjeta">
      <div class="semaforo">
        <span class="punto atencion"></span>
        <div>
          <p class="estado">Hay algo que arreglar</p>
          <p class="detalle">${esc(estado.quePaso)}</p>
        </div>
      </div>
      <a class="boton" href="${esc(estado.accion.url)}">${esc(estado.accion.texto)}</a>
    </section>`;
  }

  return `<section class="tarjeta">
    <div class="semaforo">
      <span class="punto sin-datos"></span>
      <div>
        <p class="estado">Estamos revisando tu conexión</p>
        <p class="detalle">En un momento te decimos si todo está funcionando.</p>
      </div>
    </div>
  </section>`;
}

function bloqueCampana(campana: DatosDelPanel['campana']): string {
  if (campana === 'pendiente' || !campana) {
    return `<section class="tarjeta">
      <h2>Tu palabra clave</h2>
      <p class="pendiente">Todavía no has definido qué palabra entrega qué. Configúrala y en un
      minuto está funcionando.</p>
      <a class="boton" href="/panel/campana">Definir mi palabra clave</a>
    </section>`;
  }
  return `<section class="tarjeta">
    <h2>Tu palabra clave</h2>
    <p class="detalle">Cuando alguien comenta <code>${esc(campana.palabra)}</code>, recibe
    <code>${esc(campana.enlace)}</code>.</p>
    <a class="boton suave" href="/panel/campana">Cambiar palabra o enlace</a>
  </section>`;
}

function bloqueResultados(datos: DatosDelPanel): string {
  const resultados = datos.resultados;
  if (resultados === 'pendiente' || !resultados) {
    return `<section class="tarjeta">
      <h2>Tus resultados</h2>
      <p class="pendiente">Aquí vas a ver cuánta gente comentó, cuánta recibió tu recurso y cuánta
      no lo recibió por no seguirte.</p>
    </section>`;
  }

  const dias = datos.dias ?? 7;
  const periodo = `<div class="periodo">
      <a href="/panel?dias=7" class="${dias === 7 ? 'activo' : ''}">Últimos 7 días</a>
      <a href="/panel?dias=30" class="${dias === 30 ? 'activo' : ''}">Últimos 30 días</a>
    </div>`;

  // Nadie ha comentado todavia: un cero pelado hace pensar que no sirve. Mejor
  // decirle exactamente que hacer, con el texto listo para copiar.
  if (resultados.comentaron === 0) {
    const palabra = datos.campana !== 'pendiente' && datos.campana ? datos.campana.palabra : 'GUIA';
    return `<section class="tarjeta">
      <h2>Tus resultados</h2>
      ${periodo}
      <p class="pendiente">Todavía nadie ha comentado tu palabra. Publica algo invitándolos, con
      este texto por ejemplo:</p>
      <div class="dm"><div class="globo">Comenta <b>${esc(palabra)}</b> y te lo envío por mensaje 👇</div></div>
    </section>`;
  }

  const perdidas = resultados.noSeguian > 0
    ? `<p class="fuente">${resultados.noSeguian === 1 ? 'Una persona quedó' : `${resultados.noSeguian} personas quedaron`} esperando porque no te seguían. Cuando te sigan y vuelvan a tocar el botón, lo reciben.</p>`
    : '';

  return `<section class="tarjeta">
    <h2>Tus resultados</h2>
    ${periodo}
    <div class="cifras">
      <div class="cifra"><b>${resultados.comentaron}</b><span>comentaron</span></div>
      <div class="cifra"><b>${resultados.recibieron}</b><span>recibieron</span></div>
      <div class="cifra"><b>${resultados.noSeguian}</b><span>no te seguían</span></div>
    </div>
    ${perdidas}
  </section>`;
}

/**
 * El DM tal como le va a llegar a la persona. Es la pieza que le quita el miedo
 * al cliente: no tiene que imaginarse el mensaje, lo ve.
 */
export function vistaPreviaDelDm(datos: {
  bienvenida: string;
  boton: string;
  mensaje?: string;
  enlace?: string;
}): string {
  const cuerpoDeLaEntrega = [datos.mensaje, datos.enlace].filter(Boolean).join('\n');
  const entrega = cuerpoDeLaEntrega ? `<div class="globo">${esc(cuerpoDeLaEntrega)}</div>` : '';
  return `<div class="dm">
    <p class="quien">Así lo recibe la persona</p>
    <div class="globo">${esc(datos.bienvenida)}</div>
    <div class="boton-dm">${esc(datos.boton)}</div>
    ${entrega}
  </div>`;
}

export interface FormularioDeCampana {
  palabra: string;
  enlace: string;
  mensaje: string;
  exigirSeguir: boolean;
  /** Que fuente manda hoy, para que el cliente sepa que esta editando. */
  origen: 'panel' | 'hoja';
  /** Problema a mostrar arriba del formulario. */
  problema?: { que: string; comoArreglarlo?: string };
  aviso?: string;
}

/** Pantalla para editar la campana. */
export function renderEditorDeCampana(f: FormularioDeCampana): string {
  const problema = f.problema
    ? `<div class="error"><b>${esc(f.problema.que)}</b>${
        f.problema.comoArreglarlo ? esc(f.problema.comoArreglarlo) : ''
      }</div>`
    : '';
  const desdeLaHoja =
    f.origen === 'hoja'
      ? `<p class="fuente">Hoy tus palabras vienen de tu Google Sheet. Al guardar aquí, el panel
         pasa a mandar y la hoja deja de usarse para esta cuenta.</p>`
      : '';

  return paginaDelPanel(
    'Tu palabra clave',
    `<header class="marca">
       <span class="nombre">InboxPilot</span>
       <a class="cuenta" href="/panel">Volver</a>
     </header>
     ${f.aviso ? `<div class="aviso">${esc(f.aviso)}</div>` : ''}
     ${problema}
     <section class="tarjeta">
       <h2>Así queda tu mensaje</h2>
       ${vistaPreviaDelDm({
         bienvenida: '¡Hola! Gracias por escribir 😊 Toca abajo y te lo envío.',
         boton: 'Obtener el enlace',
         mensaje: f.mensaje,
         enlace: f.enlace,
       })}
     </section>
     <form method="POST" action="/panel/campana">
       <section class="tarjeta">
         <label>Palabra que la gente comenta
           <span class="ayuda">No importan las mayúsculas ni las tildes: GUIA, guía y Guia son la misma.</span>
           <input type="text" name="palabra" value="${esc(f.palabra)}" maxlength="40"
             autocapitalize="characters" required>
         </label>
         <label>Enlace que reciben
           <span class="ayuda">Un PDF de Drive, un artículo o un video. Tiene que abrirlo cualquiera.</span>
           <input type="url" name="enlace" value="${esc(f.enlace)}" maxlength="500"
             inputmode="url" required>
         </label>
         <label>Mensaje que acompaña al enlace
           <span class="ayuda">Opcional. Es lo que se lee justo antes del enlace.</span>
           <input type="text" name="mensaje" value="${esc(f.mensaje)}" maxlength="280">
         </label>
         <div class="interruptor">
           <input type="checkbox" id="seguir" name="exigirSeguir" value="si"
             ${f.exigirSeguir ? 'checked' : ''}>
           <span><label for="seguir" style="display:inline;font-weight:600">Entregar solo a quien te sigue</label>
           <span class="ayuda">Si está activo, a quien no te siga le pedimos seguirte antes de enviarle el enlace.</span></span>
         </div>
         ${desdeLaHoja}
         <button class="boton" type="submit" name="accion" value="guardar">Guardar</button>
         <button class="boton suave" type="submit" name="accion" value="previa">Ver cómo queda</button>
       </section>
     </form>`,
  );
}

/**
 * La prueba en vivo. El cliente comenta desde otro telefono y ve los pasos
 * pintarse solos.
 *
 * La pagina se refresca sola con `meta refresh`, no con JavaScript: la politica
 * de seguridad del sitio bloquea los scripts, y esto funciona igual en cualquier
 * telefono viejo.
 */
export function renderPruebaEnVivo(datos: {
  palabra: string;
  pasos: Array<{ nombre: string; hecho: boolean; hora?: Date }>;
  vencida: boolean;
  completa: boolean;
  frenadaPorSeguir: boolean;
  segundosRestantes: number;
}): string {
  const listas = datos.pasos
    .map(
      (p) => `<li class="${p.hecho ? 'hecho' : ''}">
        <span class="marca">${p.hecho ? '✓' : ''}</span>
        <span class="que">${esc(p.nombre)}
          ${p.hora ? `<span class="cuando">${esc(hora(p.hora))}</span>` : ''}
        </span>
      </li>`,
    )
    .join('');

  if (datos.completa) {
    return paginaDelPanel(
      'Prueba lista',
      `<header class="marca">
         <span class="nombre">InboxPilot</span>
         <a class="cuenta" href="/panel">Volver</a>
       </header>
       <section class="tarjeta">
         <p class="estado">Funcionó de punta a punta</p>
         <div class="listo">Comentaron, recibieron el mensaje, tocaron el botón y les llegó tu
         recurso. Así de simple lo va a vivir la gente.</div>
         <ol class="pasos">${listas}</ol>
         <a class="boton" href="/panel">Volver a mi panel</a>
       </section>`,
    );
  }

  if (datos.vencida) {
    return paginaDelPanel(
      'Se acabó el tiempo de la prueba',
      `<header class="marca">
         <span class="nombre">InboxPilot</span>
         <a class="cuenta" href="/panel">Volver</a>
       </header>
       <section class="tarjeta">
         <p class="estado">No llegó ningún comentario</p>
         <p class="detalle">Casi siempre es una de dos cosas: comentaste en otra publicación, o la
         palabra no fue exactamente <code>${esc(datos.palabra)}</code>.</p>
         <a class="boton" href="/panel/prueba">Probar otra vez</a>
         <a class="boton suave" href="/panel">Volver a mi panel</a>
       </section>`,
    );
  }

  const minutos = Math.ceil(datos.segundosRestantes / 60);
  const frenada = datos.frenadaPorSeguir
    ? `<div class="aviso">Esa persona no te sigue, así que le pedimos seguirte antes de entregarle.
       Es justo lo que hace crecer tu cuenta.</div>`
    : '';

  return paginaDelPanel(
    'Probando en vivo',
    `<meta http-equiv="refresh" content="4">
     <header class="marca">
       <span class="nombre">InboxPilot</span>
       <a class="cuenta" href="/panel">Volver</a>
     </header>
     <section class="tarjeta">
       <p class="estado">Comenta <code>${esc(datos.palabra)}</code> desde otro teléfono</p>
       <p class="detalle">Entra a cualquiera de tus publicaciones con otra cuenta de Instagram y
       comenta esa palabra. Aquí vas a ver los pasos encenderse solos.</p>
       <ol class="pasos">${listas}</ol>
       ${frenada}
       <p class="cuenta-regresiva">Esta prueba queda abierta ${minutos} minuto${minutos === 1 ? '' : 's'} más.</p>
     </section>`,
  );
}

function hora(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(d);
}

/** El panel completo. */
export function renderPanel(datos: DatosDelPanel): string {
  return paginaDelPanel(
    'Tu panel',
    `<header class="marca">
       <span class="nombre">InboxPilot</span>
       <span class="cuenta">${esc(datos.cuenta)}</span>
     </header>
     ${datos.aviso ? `<div class="aviso">${esc(datos.aviso)}</div>` : ''}
     ${bloqueConexion(datos.conexion)}
     ${bloqueCampana(datos.campana)}
     ${bloqueResultados(datos)}
     <p class="fuente">Tu cuenta de Instagram la administra tu consultor. Si algo deja de
     funcionar, avísale desde aquí y él la reconecta.</p>
     <form class="pie" method="POST" action="/panel/salir">
       <button class="boton suave" type="submit">Cerrar sesión</button>
     </form>`,
  );
}

/**
 * La lista de cuentas del operador. Ordenada por la que necesita atencion: si
 * hay una caida, tiene que estar arriba, no perdida entre las sanas.
 */
export function renderCuentasDelOperador(
  cuentas: Array<{ accountId: string; conexion: EstadoConexion; ultimaEntrega?: Date }>,
): string {
  const orden = { atencion: 0, 'sin-datos': 1, activo: 2 } as const;
  const ordenadas = [...cuentas].sort((a, b) => orden[a.conexion.tipo] - orden[b.conexion.tipo]);

  const filas = ordenadas
    .map((c) => {
      const punto = c.conexion.tipo;
      const dice =
        c.conexion.tipo === 'atencion'
          ? c.conexion.quePaso
          : c.conexion.tipo === 'activo'
            ? c.ultimaEntrega
              ? `Última entrega: ${esc(fecha(c.ultimaEntrega))}.`
              : 'Activa, sin entregas todavía.'
            : 'Sin poder confirmar.';
      return `<section class="tarjeta">
        <div class="semaforo">
          <span class="punto ${punto}"></span>
          <div>
            <p class="estado">${esc(c.accountId)}</p>
            <p class="detalle">${dice}</p>
          </div>
        </div>
        <a class="boton suave" href="/panel?cuenta=${encodeURIComponent(c.accountId)}">Abrir su panel</a>
      </section>`;
    })
    .join('');

  const enProblemas = ordenadas.filter((c) => c.conexion.tipo === 'atencion').length;
  const resumen = enProblemas
    ? `<div class="error"><b>${enProblemas} ${enProblemas === 1 ? 'cuenta necesita' : 'cuentas necesitan'} atención</b>Están arriba en la lista.</div>`
    : `<div class="listo">Todas las cuentas están respondiendo.</div>`;

  return paginaDelPanel(
    'Cuentas',
    `<header class="marca">
       <span class="nombre">InboxPilot</span>
       <a class="cuenta" href="/panel">Volver</a>
     </header>
     ${resumen}
     ${filas}`,
  );
}

/** Mensaje simple, en el mismo estilo, para los caminos que no son el panel. */
export function mensajeDelPanel(
  titulo: string,
  encabezado: string,
  cuerpo: string,
  accion?: { texto: string; url: string },
): string {
  return paginaDelPanel(
    titulo,
    `<header class="marca"><span class="nombre">InboxPilot</span></header>
     <section class="tarjeta">
       <p class="estado">${esc(encabezado)}</p>
       <p class="detalle">${esc(cuerpo)}</p>
       ${accion ? `<a class="boton" href="${esc(accion.url)}">${esc(accion.texto)}</a>` : ''}
     </section>`,
  );
}
