import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { logger } from '../utils/logger.js';
import type { PanelStore } from '../store/panelStore.js';
import { esc } from './html.js';
import { asincrono } from './app.js';
import {
  SESSION_TTL_MS,
  cerrarSesion,
  idDeSesionEntrante,
  ponerCookieDeSesion,
} from './auth.js';
import { cuentaDeLaSesion } from './authz.js';

/**
 * Rutas de entrada al panel del cliente.
 *
 * Hoy se entra por ENLACE DE INVITACION: Leonardo genera el enlace con
 * `execution/invite.ts` y se lo manda al cliente por WhatsApp. El cliente lo
 * toca, confirma con un boton y queda dentro. Sin contrasena que recordar, sin
 * correo que espere en spam, sin depender de Meta.
 *
 * EL CANJE VA POR POST, y no es un capricho: la invitacion es de un solo uso, y
 * un GET lo dispara cualquiera que MIRE el enlace sin abrirlo — el
 * previsualizador de WhatsApp, el prefetch del navegador, un antivirus o un
 * proxy corporativo. Con GET, el cliente recibia "este enlace ya no sirve" antes
 * de tocarlo, y la sesion se la llevaba el crawler. Los crawlers no envian POST.
 *
 * Facebook entra como segundo proveedor cuando Meta verifique el negocio (su
 * inicio de sesion para empresas exige acceso avanzado a public_profile, que hoy
 * pide verificacion). Cuando llegue, solo se suma otra ruta que termine llamando
 * a `abrirSesion`: el resto del panel no se entera de por donde llego la persona.
 */

/** Pagina simple en el estilo llano del panel. La Tarea 5 le pone la cara definitiva. */
function pagina(titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;
 margin:0 auto;padding:24px 20px;line-height:1.6;color:#1a1a1a;background:#f7f8fa}
 .tarjeta{background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:20px;margin-top:16px}
 h1{font-size:1.4rem;margin:0 0 8px}
 p{margin:8px 0}
 button{margin-top:12px;padding:12px 18px;background:#0d1b2a;color:#fff;border:0;
 border-radius:8px;font-size:1rem;cursor:pointer}
 button.suave{background:#eceff3;color:#1a1a1a}
 small{color:#5b6570}
</style></head><body>${cuerpo}</body></html>`;
}

async function abrirSesion(res: Response, panel: PanelStore, userId: string): Promise<void> {
  const session = await panel.createSession(userId, SESSION_TTL_MS);
  ponerCookieDeSesion(res, session);
}

export function registrarRutasDelPanel(app: Express, panel: PanelStore): void {
  // Solo para los formularios del panel. El webhook sigue con su parser propio.
  const formulario = express.urlencoded({ extended: false, limit: '4kb' });

  /**
   * Paso 1: mirar el enlace. NO consume la invitacion, solo muestra el boton.
   * Que un crawler abra esto no le cuesta nada al cliente.
   */
  app.get('/panel/entrar', (req: Request, res: Response) => {
    const token = typeof req.query.t === 'string' ? req.query.t : '';
    if (!token) return res.status(400).type('html').send(paginaEnlaceInvalido());
    return res.type('html').send(
      pagina(
        'Entrar a tu panel',
        `<div class="tarjeta">
           <h1>Entra a tu panel</h1>
           <p>Toca el botón para abrir tu panel en este teléfono. No necesitas clave.</p>
           <form method="POST" action="/panel/entrar">
             <input type="hidden" name="t" value="${esc(token)}">
             <button type="submit">Entrar a mi panel</button>
           </form>
         </div>`,
      ),
    );
  });

  /** Paso 2: canjear de verdad. Aqui si se quema la invitacion. */
  app.post(
    '/panel/entrar',
    formulario,
    asincrono(async (req: Request, res: Response) => {
    const cuerpo = req.body as Record<string, unknown> | undefined;
    const token = typeof cuerpo?.t === 'string' ? cuerpo.t : '';
    if (!token) return res.status(400).type('html').send(paginaEnlaceInvalido());

    const invitacion = await panel.redeemInvite(token);
    if (!invitacion) {
      // Vencido, ya usado o inventado: al cliente le decimos lo mismo y en
      // lenguaje llano. No damos pistas sobre cual de los tres fue.
      return res.status(401).type('html').send(paginaEnlaceInvalido());
    }

    try {
      // Identidad propia por canje, con id aleatorio: derivarlo del reloj hacia
      // que dos canjes del mismo milisegundo colapsaran en una sola persona.
      const user = await panel.upsertUser({
        provider: 'invite',
        providerUserId: `${invitacion.accountId}:${randomUUID()}`,
      });
      await panel.grantAccess({
        userId: user.id,
        accountId: invitacion.accountId,
        role: invitacion.role,
      });
      // Si el navegador traia una sesion vieja, se cierra: no dejamos sesiones
      // sueltas vivas 30 dias despues de entrar de nuevo.
      const anterior = idDeSesionEntrante(req);
      if (anterior) await panel.deleteSession(anterior);

      await abrirSesion(res, panel, user.id);
      logger.info({ account: invitacion.accountId }, 'Panel: invitacion canjeada');
      return res.redirect(303, '/panel');
    } catch (err) {
      // La invitacion ya quedo marcada como usada. Devolverla evita que un fallo
      // de base deje al cliente fuera y sin enlace.
        await panel.releaseInvite(token);
        throw err;
      }
    }),
  );

  app.post(
    '/panel/salir',
    formulario,
    asincrono(async (req: Request, res: Response) => {
      await cerrarSesion(req, res, panel);
      return res.type('html').send(
        pagina(
          'Sesión cerrada',
          `<div class="tarjeta"><h1>Cerraste sesión</h1>
           <p>Ya saliste del panel. Para volver a entrar usa el enlace que te enviaron.</p></div>`,
        ),
      );
    }),
  );

  /**
   * El panel. Aqui solo confirma quien entro y a que cuenta llega; la Tarea 5 le
   * pone el semaforo, la prueba en vivo y el resto.
   */
  app.get(
    '/panel',
    asincrono(async (req: Request, res: Response) => {
    // La cuenta sale de la sesion, nunca de la peticion. Si la URL pide una
    // cuenta concreta, la puerta comprueba el permiso antes de darla.
    const pedida = typeof req.query.cuenta === 'string' ? req.query.cuenta : undefined;
    const permiso = await cuentaDeLaSesion(req, panel, pedida);
    if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
    if (permiso === 'sin-cuenta') {
      // 404 y no 403: un 403 le confirmaria al curioso que esa cuenta existe.
      return res.status(404).type('html').send(paginaSinCuenta());
    }

    const lista = permiso.todas
      .map((c) => `<li>${esc(c.accountId)} <small>(${esc(c.role)})</small></li>`)
      .join('');

    return res.type('html').send(
      pagina(
        'Tu panel',
        `<div class="tarjeta">
           <h1>Ya estás dentro</h1>
           <p>Tu sesión quedó abierta en este teléfono. No tienes que recordar ninguna clave.</p>
           <p><strong>Tus cuentas:</strong></p>
           <ul>${lista}</ul>
           <p><small>Aquí van a aparecer el estado de tu automatización, la prueba en vivo y tus
           resultados.</small></p>
           <form method="POST" action="/panel/salir">
             <button class="suave" type="submit">Cerrar sesión</button>
             </form>
           </div>`,
        ),
      );
    }),
  );
}

function paginaEnlaceInvalido(): string {
  return pagina(
    'Enlace no válido',
    `<div class="tarjeta"><h1>Este enlace ya no sirve</h1>
     <p>Puede que se haya usado antes o que haya vencido. Pídele a quien te lo envió que te
     genere uno nuevo.</p></div>`,
  );
}

function paginaSinCuenta(): string {
  return pagina(
    'No encontramos esa cuenta',
    `<div class="tarjeta"><h1>No encontramos esa cuenta</h1>
     <p>Puede que el enlace apunte a una cuenta que ya no está disponible. Escríbele a quien te
     dio el acceso.</p></div>`,
  );
}

function paginaSinSesion(): string {
  return pagina(
    'Necesitas entrar',
    `<div class="tarjeta"><h1>Necesitas entrar</h1>
     <p>Abre el enlace que te enviaron para entrar a tu panel.</p></div>`,
  );
}
