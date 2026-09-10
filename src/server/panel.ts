import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { logger } from '../utils/logger.js';
import type { PanelStore } from '../store/panelStore.js';
import { esc } from './html.js';
import { asincrono } from './app.js';
import { mensajeDelPanel, paginaDelPanel, renderPanel } from './panel/vista.js';
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
      paginaDelPanel(
        'Entrar a tu panel',
        `<header class="marca"><span class="nombre">InboxPilot</span></header>
         <section class="tarjeta">
           <p class="estado">Entra a tu panel</p>
           <p class="detalle">Toca el botón para abrir tu panel en este teléfono. No necesitas
           clave: queda abierto aquí.</p>
           <form method="POST" action="/panel/entrar">
             <input type="hidden" name="t" value="${esc(token)}">
             <button class="boton" type="submit">Entrar a mi panel</button>
           </form>
         </section>`,
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
        mensajeDelPanel(
          'Sesión cerrada',
          'Cerraste sesión',
          'Ya saliste del panel. Para volver a entrar usa el enlace que te enviaron.',
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

    // El semaforo real (consultar a Meta y la ultima entrega) llega en la Tarea 6;
    // aqui el cascaron ya sabe pintar los tres estados.
    return res.type('html').send(
      renderPanel({
        cuenta: permiso.accountId,
        conexion: { tipo: 'sin-datos' },
        campana: 'pendiente',
        resultados: 'pendiente',
      }),
    );
    }),
  );
}

function paginaEnlaceInvalido(): string {
  return mensajeDelPanel(
    'Enlace no válido',
    'Este enlace ya no sirve',
    'Puede que se haya usado antes o que haya vencido. Pídele a quien te lo envió que te genere uno nuevo.',
  );
}

function paginaSinCuenta(): string {
  return mensajeDelPanel(
    'No encontramos esa cuenta',
    'No encontramos esa cuenta',
    'Puede que el enlace apunte a una cuenta que ya no está disponible. Escríbele a quien te dio el acceso.',
  );
}

function paginaSinSesion(): string {
  return mensajeDelPanel(
    'Necesitas entrar',
    'Necesitas entrar',
    'Abre el enlace que te enviaron para entrar a tu panel.',
  );
}
