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
   /* Paleta de InboxPilot (brand/MANUAL_DE_MARCA.pdf y los SVG del logo). */
   --tinta:#1B1523; --tinta-2:#3A3050; --tinta-suave:#6E6480;
   --linea:#E7E3EE; --fondo:#F7F5FA; --papel:#FFFFFF;
   --morado:#833AB4; --rosa:#E1306C; --naranja:#F77737;
   --verde:#0F8A4A; --ambar:#B45309; --gris:#B4ACC8;
   --degradado:linear-gradient(120deg,#833AB4 0%,#E1306C 52%,#F77737 100%);
   --sombra:0 1px 2px rgba(27,21,35,.05), 0 8px 24px -12px rgba(27,21,35,.18);
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--fondo);color:var(--tinta);
   font-family:"Lato",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
   font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%;
   -webkit-font-smoothing:antialiased}
 .envoltura{max-width:560px;margin:0 auto;padding:14px 16px 48px}

 /* ── Cabecera de marca ─────────────────────────────────────────────── */
 header.marca{display:flex;align-items:center;justify-content:space-between;
   gap:12px;padding:10px 0 4px}
 .marca .lockup{display:flex;align-items:center;gap:9px;min-width:0}
 .marca .lockup svg{flex:0 0 auto;display:block;border-radius:8px}
 .marca .nombre{font-weight:900;font-size:1.06rem;letter-spacing:-.02em;
   white-space:nowrap}
 .marca .nombre .pilot{background:var(--degradado);-webkit-background-clip:text;
   background-clip:text;color:transparent}
 .marca .cuenta{color:var(--tinta-suave);font-size:.84rem;text-decoration:none;
   overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44%}
 .marca a.cuenta{border-bottom:1px solid var(--linea)}

 /* ── Tarjetas ──────────────────────────────────────────────────────── */
 .tarjeta{background:var(--papel);border:1px solid var(--linea);border-radius:16px;
   padding:18px;margin-top:14px;box-shadow:var(--sombra)}
 .tarjeta h2{margin:0 0 2px;font-size:.82rem;font-weight:800;letter-spacing:.06em;
   text-transform:uppercase;color:var(--tinta-suave)}

 /* ── Semaforo ──────────────────────────────────────────────────────── */
 .semaforo{display:flex;gap:13px;align-items:flex-start}
 .punto{flex:0 0 auto;width:12px;height:12px;border-radius:50%;margin-top:9px}
 .punto.activo{background:var(--verde);box-shadow:0 0 0 5px rgba(15,138,74,.13)}
 .punto.atencion{background:var(--ambar);box-shadow:0 0 0 5px rgba(180,83,9,.13)}
 .punto.sin-datos{background:var(--gris);box-shadow:0 0 0 5px rgba(180,172,200,.22)}
 .estado{font-size:1.3rem;font-weight:800;letter-spacing:-.03em;margin:0;
   line-height:1.25}
 .detalle{margin:4px 0 0;color:var(--tinta-suave);font-size:.93rem}

 /* ── Acciones ──────────────────────────────────────────────────────── */
 .boton{display:block;width:100%;margin-top:16px;padding:14px 18px;border:0;
   border-radius:12px;background:var(--degradado);color:#fff;font-size:1rem;
   font-weight:800;letter-spacing:-.01em;text-align:center;text-decoration:none;
   cursor:pointer;font-family:inherit;
   box-shadow:0 6px 16px -8px rgba(225,48,108,.7)}
 .boton:active{transform:translateY(1px)}
 .boton.suave{background:var(--papel);color:var(--tinta-2);
   border:1px solid var(--linea);font-weight:700;box-shadow:none}
 .pendiente{color:var(--tinta-suave);font-size:.93rem;margin:8px 0 0}

 /* ── Cifras ────────────────────────────────────────────────────────── */
 .cifras{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
 .cifra{background:var(--fondo);border-radius:12px;padding:12px 10px;text-align:center}
 .cifra b{display:block;font-size:1.8rem;font-weight:900;letter-spacing:-.045em;
   line-height:1.05}
 .cifra.destacada b{background:var(--degradado);-webkit-background-clip:text;
   background-clip:text;color:transparent}
 .cifra span{display:block;color:var(--tinta-suave);font-size:.74rem;
   line-height:1.3;margin-top:3px}

 /* ── Avisos ────────────────────────────────────────────────────────── */
 .aviso{background:#F4EFFA;border:1px solid #E3D8F2;border-radius:13px;
   padding:12px 14px;margin-top:14px;font-size:.93rem;color:var(--tinta-2)}
 .error{background:#FFF3F5;border:1px solid #FBD5DE;border-radius:13px;
   padding:12px 14px;margin-top:14px;font-size:.93rem;color:var(--tinta-2)}
 .error b{display:block;margin-bottom:2px;color:var(--tinta)}
 .listo{background:#EFFAF3;border:1px solid #CBEBD8;border-radius:13px;
   padding:12px 14px;margin-top:14px;font-size:.95rem;color:var(--tinta-2)}
 .fuente{color:var(--tinta-suave);font-size:.82rem;margin-top:12px}
 .pie{margin-top:22px}

 /* ── Formulario ────────────────────────────────────────────────────── */
 label{display:block;font-weight:800;font-size:.92rem;margin-top:16px}
 .ayuda{display:block;font-weight:400;color:var(--tinta-suave);font-size:.85rem;
   margin-top:3px}
 input[type=text],input[type=url]{width:100%;margin-top:7px;padding:13px 14px;
   font-size:16px;border:1px solid var(--linea);border-radius:12px;
   background:var(--papel);color:var(--tinta);font-family:inherit}
 input::placeholder{color:var(--gris)}
 input:focus{outline:0;border-color:var(--rosa);
   box-shadow:0 0 0 3px rgba(225,48,108,.14)}
 .interruptor{display:flex;align-items:flex-start;gap:11px;margin-top:18px;
   background:var(--fondo);border-radius:12px;padding:13px}
 .interruptor input{margin-top:2px;width:20px;height:20px;flex:0 0 auto;
   accent-color:var(--rosa)}
 .interruptor span{font-size:.94rem}

 /* ── Vista previa del mensaje, como se ve en Instagram ─────────────── */
 .dm{background:var(--fondo);border-radius:16px;padding:14px;margin-top:12px}
 .dm .quien{display:flex;align-items:center;gap:8px;color:var(--tinta-suave);
   font-size:.78rem;margin:0 0 10px}
 .dm .quien .avatar{width:22px;height:22px;border-radius:50%;
   background:var(--degradado);flex:0 0 auto}
 .dm .globo{background:var(--papel);border:1px solid var(--linea);
   border-radius:18px 18px 18px 5px;padding:11px 14px;font-size:.95rem;
   white-space:pre-wrap;word-break:break-word;margin-bottom:6px;
   box-shadow:0 1px 2px rgba(27,21,35,.04)}
 .dm .boton-dm{background:var(--papel);border:1px solid var(--linea);
   border-radius:12px;padding:11px;text-align:center;font-weight:800;
   font-size:.92rem;color:#0095F6}

 /* ── Pasos de la prueba, con hilo de progreso ──────────────────────── */
 ol.pasos{list-style:none;margin:16px 0 0;padding:0;position:relative}
 ol.pasos li{display:flex;gap:12px;align-items:flex-start;padding:0 0 16px;
   position:relative}
 ol.pasos li:last-child{padding-bottom:0}
 ol.pasos li::before{content:"";position:absolute;left:11px;top:24px;bottom:0;
   width:2px;background:var(--linea)}
 ol.pasos li:last-child::before{display:none}
 ol.pasos li.hecho::before{background:var(--verde)}
 ol.pasos .marca{flex:0 0 auto;width:24px;height:24px;border-radius:50%;
   border:2px solid var(--linea);background:var(--papel);display:flex;
   align-items:center;justify-content:center;font-size:.78rem;
   color:var(--tinta-suave);position:relative;z-index:1}
 ol.pasos li.hecho .marca{background:var(--verde);border-color:var(--verde);
   color:#fff;font-weight:800}
 ol.pasos li.hecho .que{font-weight:800}
 ol.pasos .que{font-size:.96rem;padding-top:1px}
 ol.pasos .cuando{display:block;color:var(--tinta-suave);font-size:.79rem;
   font-weight:400}
 .cuenta-regresiva{color:var(--tinta-suave);font-size:.85rem;margin-top:14px;
   text-align:center}

 /* ── Periodos ──────────────────────────────────────────────────────── */
 .periodo{display:flex;gap:6px;margin-top:4px;background:var(--fondo);
   padding:4px;border-radius:11px}
 .periodo a{flex:1;text-align:center;padding:8px;border-radius:8px;
   text-decoration:none;color:var(--tinta-suave);font-size:.85rem;font-weight:700}
 .periodo a.activo{background:var(--papel);color:var(--tinta);
   box-shadow:0 1px 3px rgba(27,21,35,.1)}

 code,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;
   background:var(--fondo);border:1px solid var(--linea);padding:1px 6px;
   border-radius:6px;word-break:break-all;font-weight:700}
 @media (max-width:380px){
   .envoltura{padding:12px 12px 40px}
   .cifras{grid-template-columns:1fr;gap:8px}
   .cifra{display:flex;align-items:baseline;gap:10px;text-align:left}
   .cifra b{font-size:1.35rem}
   .cifra span{margin-top:0}
   .estado{font-size:1.18rem}
 }
`;


/**
 * El logo de InboxPilot, incrustado en el HTML.
 *
 * Va inline y no como imagen a proposito: no cuesta una peticion mas, no
 * parpadea al cargar, y la politica de seguridad del sitio no deja traer nada
 * de afuera. El degradado morado-rosa-naranja y el avion son los del manual
 * (brand/logo/inboxpilot-icon.svg).
 */
function lockupDeMarca(): string {
  return `<span class="lockup">
    <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
      <defs><linearGradient id="ip" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#833AB4"/>
        <stop offset="52%" stop-color="#E1306C"/>
        <stop offset="100%" stop-color="#F77737"/>
      </linearGradient></defs>
      <rect width="512" height="512" rx="115" fill="url(#ip)"/>
      <g transform="translate(256,262) rotate(-32) scale(14.5) translate(-12.5,-12)" fill="#fff">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </g>
    </svg>
    <span class="nombre">Inbox<span class="pilot">Pilot</span></span>
  </span>`;
}

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

/**
 * El enlace, legible.
 *
 * Uno de Drive real mide 90 caracteres y partido en dos lineas no se lee ni
 * aporta: al cliente le basta reconocer SU archivo. Se muestra el nombre del
 * archivo (o el dominio) y el completo queda a un toque de distancia.
 */
function enlaceCorto(url: string): string {
  try {
    const u = new URL(url);
    const ultimo = u.pathname.split('/').filter(Boolean).pop();
    const visible = ultimo && ultimo.length <= 34 ? ultimo : u.hostname.replace(/^www\./, '');
    return `<code title="${esc(url)}">${esc(visible)}</code>`;
  } catch {
    return `<code>${esc(url)}</code>`;
  }
}

/** El semaforo. Es lo primero que se ve y responde una sola pregunta. */
function bloqueConexion(estado: EstadoConexion): string {
  if (estado.tipo === 'activo') {
    const cuenta = estado.cuentaInstagram ? ` en ${esc(estado.cuentaInstagram)}` : '';
    const ultima = estado.ultimaEntrega
      ? `Última entrega: ${esc(fecha(estado.ultimaEntrega))}`
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
    ${enlaceCorto(campana.enlace)}.</p>
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
  // Se entra al estado vacio solo si NO paso nada. Antes bastaba con que no
  // hubiera comentarios, asi que una cuenta que entrega por DM veia "todavia
  // nadie ha comentado" con doce entregas hechas.
  if (resultados.comentaron + resultados.recibieron + resultados.noSeguian === 0) {
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
      <div class="cifra destacada"><b>${resultados.recibieron}</b><span>recibieron tu recurso</span></div>
      <div class="cifra"><b>${resultados.noSeguian}</b><span>esperando seguirte</span></div>
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
    <p class="quien"><span class="avatar"></span>Así lo recibe la persona en su Instagram</p>
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
       ${lockupDeMarca()}
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
  incompleta?: boolean;
  yaLoTenia?: boolean;
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
         ${lockupDeMarca()}
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

  // Hubo actividad pero no llego a la entrega: casi siempre es que esa persona
  // ya habia recibido el recurso antes y el motor no se lo repite.
  if (datos.vencida && datos.yaLoTenia) {
    return paginaDelPanel(
      'Esa persona ya lo tenía',
      `<header class="marca">
         ${lockupDeMarca()}
         <a class="cuenta" href="/panel">Volver</a>
       </header>
       <section class="tarjeta">
         <p class="estado">Todo funcionó, pero esa persona ya lo tenía</p>
         <p class="detalle">A quien ya recibió tu recurso no se lo volvemos a enviar, para no
         parecer spam. Prueba con otro teléfono o pídele a alguien más que comente.</p>
         <ol class="pasos">${listas}</ol>
         <a class="boton" href="/panel/prueba">Probar con otra cuenta</a>
       </section>`,
    );
  }

  if (datos.vencida && datos.incompleta) {
    return paginaDelPanel(
      'La prueba quedó a medias',
      `<header class="marca">
         ${lockupDeMarca()}
         <a class="cuenta" href="/panel">Volver</a>
       </header>
       <section class="tarjeta">
         <p class="estado">Quedó a medias</p>
         <p class="detalle">Empezó bien, pero no llegó hasta el final dentro del tiempo de la
         prueba. Lo más común es que falte tocar el botón del mensaje.</p>
         <ol class="pasos">${listas}</ol>
         <a class="boton" href="/panel/prueba">Probar otra vez</a>
         <a class="boton suave" href="/panel">Volver a mi panel</a>
       </section>`,
    );
  }

  if (datos.vencida) {
    return paginaDelPanel(
      'Se acabó el tiempo de la prueba',
      `<header class="marca">
         ${lockupDeMarca()}
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
       ${lockupDeMarca()}
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
       ${lockupDeMarca()}
       ${
         (datos.cuantasCuentas ?? 1) > 1
           ? `<a class="cuenta" href="/panel/cuentas">${esc(datos.cuenta)} · ver todas</a>`
           : `<span class="cuenta">${esc(datos.cuenta)}</span>`
       }
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
          ? esc(c.conexion.quePaso)
          : c.conexion.tipo === 'activo'
            ? c.ultimaEntrega
              ? `Última entrega: ${esc(fecha(c.ultimaEntrega))}`
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
       ${lockupDeMarca()}
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
    `<header class="marca">${lockupDeMarca()}</header>
     <section class="tarjeta">
       <p class="estado">${esc(encabezado)}</p>
       <p class="detalle">${esc(cuerpo)}</p>
       ${accion ? `<a class="boton" href="${esc(accion.url)}">${esc(accion.texto)}</a>` : ''}
     </section>`,
  );
}
