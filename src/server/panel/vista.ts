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
  conexion: EstadoConexion;
  /** Bloques que todavia no tienen datos, en el orden en que apareceran. */
  campana?: { palabra: string; enlace: string } | 'pendiente';
  resultados?: { comentaron: number; recibieron: number; noSeguian: number } | 'pendiente';
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
      <p class="pendiente">Aquí vas a poder cambiar la palabra que la gente comenta y el enlace que
      reciben, y ver el mensaje tal como les va a llegar.</p>
    </section>`;
  }
  return `<section class="tarjeta">
    <h2>Tu palabra clave</h2>
    <p class="detalle">Cuando alguien comenta <code>${esc(campana.palabra)}</code>, recibe
    <code>${esc(campana.enlace)}</code>.</p>
  </section>`;
}

function bloqueResultados(resultados: DatosDelPanel['resultados']): string {
  if (resultados === 'pendiente' || !resultados) {
    return `<section class="tarjeta">
      <h2>Tus resultados</h2>
      <p class="pendiente">Aquí vas a ver cuánta gente comentó, cuánta recibió tu recurso y cuánta
      no lo recibió por no seguirte.</p>
    </section>`;
  }
  return `<section class="tarjeta">
    <h2>Tus resultados</h2>
    <div class="cifras">
      <div class="cifra"><b>${resultados.comentaron}</b><span>comentaron</span></div>
      <div class="cifra"><b>${resultados.recibieron}</b><span>recibieron</span></div>
      <div class="cifra"><b>${resultados.noSeguian}</b><span>no te seguían</span></div>
    </div>
  </section>`;
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
     ${bloqueResultados(datos.resultados)}
     <form class="pie" method="POST" action="/panel/salir">
       <button class="boton suave" type="submit">Cerrar sesión</button>
     </form>`,
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
