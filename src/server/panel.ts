import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { logger } from '../utils/logger.js';
import type { PanelStore } from '../store/panelStore.js';
import { esc } from './html.js';
import { asincrono } from './app.js';
import {
  mensajeDelPanel,
  paginaDelPanel,
  renderEditorDeCampana,
  renderPanel,
  renderCuentasDelOperador,
  renderPruebaEnVivo,
} from './panel/vista.js';
import { revisarEnlace } from '../core/enlaces.js';
import { armarEstadoDeConexion, type ConSalud } from './panel/estado.js';
import {
  DURACION_DE_LA_PRUEBA_MS,
  estadoDeLaPrueba,
  resumenDe,
} from './panel/resultados.js';
import { avisadorMudo, type Avisador } from '../core/avisos.js';
import { DuplicateKeywordError, type PanelCampaign } from '../store/panelStore.js';
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

export function registrarRutasDelPanel(
  app: Express,
  panel: PanelStore,
  /** Para preguntar si la cuenta sigue conectada. Sin el, el semaforo dice "revisando". */
  adapter?: ConSalud,
  /** Avisa al operador cuando una cuenta deja de responder. */
  avisador: Avisador = avisadorMudo,
  /**
   * Unica cuenta que el adaptador sabe consultar. Preguntarle por otra devolveria
   * el estado de esta, y el cliente veria un verde que no es suyo.
   */
  cuentaDelAdaptador?: string,
): void {
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
   * El cliente pide que le reconecten la cuenta. No lo puede hacer solo: el
   * permiso lo renueva quien administra la app de Meta.
   */
  app.get(
    '/panel/reconectar',
    asincrono(async (req: Request, res: Response) => {
      const permiso = await cuentaDeLaSesion(req, panel);
      if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
      if (permiso === 'sin-cuenta') return res.status(404).type('html').send(paginaSinCuenta());

      await avisador.avisar({
        accountId: permiso.accountId,
        asunto: 'cuenta-desconectada',
        detalle: `El cliente de ${permiso.accountId} pidio que le reconecten su Instagram.`,
      });

      return res.type('html').send(
        mensajeDelPanel(
          'Ya avisamos',
          'Ya avisamos',
          'Le avisamos a quien administra tu cuenta para que vuelva a conectar tu Instagram. Mientras tanto, tus publicaciones siguen ahí: en cuanto se reconecte, los mensajes se reanudan.',
          { texto: 'Volver a mi panel', url: '/panel' },
        ),
      );
    }),
  );

  /**
   * La lista de cuentas de quien maneja varias. No hace falta un rol especial:
   * se listan exactamente las cuentas a las que esa persona tiene acceso, asi
   * que un cliente con una sola cuenta ve una sola.
   */
  app.get(
    '/panel/cuentas',
    asincrono(async (req: Request, res: Response) => {
      const permiso = await cuentaDeLaSesion(req, panel);
      if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
      if (permiso === 'sin-cuenta') return res.status(404).type('html').send(paginaSinCuenta());

      // En paralelo: en serie, el operador con varias cuentas espera N veces.
      const cuentas = await Promise.all(
        permiso.todas.map(async (acceso) => {
          const conexion = await armarEstadoDeConexion(
            adapter,
            panel,
            acceso.accountId,
            cuentaDelAdaptador,
          );
          const entrega = await panel.ultimoEvento(acceso.accountId, 'resource_delivered');
          return {
            accountId: acceso.accountId,
            conexion,
            ultimaEntrega: entrega ? new Date(entrega.at) : undefined,
          };
        }),
      );
      return res.type('html').send(renderCuentasDelOperador(cuentas));
    }),
  );

  /**
   * Prueba en vivo. La ventana arranca cuando el cliente entra sin `desde`, y
   * la pagina se refresca sola mientras dura.
   */
  app.get(
    '/panel/prueba',
    asincrono(async (req: Request, res: Response) => {
      const permiso = await cuentaDeLaSesion(req, panel);
      if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
      if (permiso === 'sin-cuenta') return res.status(404).type('html').send(paginaSinCuenta());

      const ahora = Date.now();
      const desde = Number(req.query.desde);
      // La ventana tiene que ser de AHORA: ni del futuro ni mas vieja que su
      // duracion. Sin esta cota, abrir una URL vieja (o inventar un `desde`) se
      // apropiaba de la actividad reciente y la pantalla declaraba un exito que
      // el cliente nunca produjo.
      const ventanaValida =
        Number.isInteger(desde) && desde <= ahora && desde > ahora - DURACION_DE_LA_PRUEBA_MS;
      if (!ventanaValida) return res.redirect(303, `/panel/prueba?desde=${ahora}`);

      // La palabra que de verdad dispara. Antes se leia solo del panel, asi que a
      // un cliente que usa la hoja le decia literalmente "comenta tu palabra
      // clave": una instruccion imposible de seguir.
      const suyas = await panel.campaignsOf(permiso.accountId);
      const palabra = suyas[0]?.keyword;
      if (!palabra) {
        return res.type('html').send(
          mensajeDelPanel(
            'Falta tu palabra clave',
            'Primero define tu palabra',
            'Para probar hace falta saber que palabra va a comentar la gente. Definela y vuelve: la prueba toma menos de un minuto.',
            { texto: 'Definir mi palabra clave', url: '/panel/campana' },
          ),
        );
      }

      const estado = await estadoDeLaPrueba(panel, permiso.accountId, desde, ahora);
      return res.type('html').send(renderPruebaEnVivo({ palabra, ...estado }));
    }),
  );

  /** Editor de la campana: que palabra entrega que. */
  app.get(
    '/panel/campana',
    asincrono(async (req: Request, res: Response) => {
      const permiso = await cuentaDeLaSesion(req, panel);
      if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
      if (permiso === 'sin-cuenta') return res.status(404).type('html').send(paginaSinCuenta());

      const suyas = await panel.campaignsOf(permiso.accountId);
      const actual = suyas[0];
      return res.type('html').send(
        renderEditorDeCampana({
          palabra: actual?.keyword ?? '',
          enlace: actual?.url ?? '',
          mensaje: actual?.message ?? '',
          // Por defecto encendido: el follow-gate es la razon de ser del producto.
          exigirSeguir: actual ? actual.requireFollow : true,
          origen: suyas.length > 0 ? 'panel' : 'hoja',
        }),
      );
    }),
  );

  app.post(
    '/panel/campana',
    formulario,
    asincrono(async (req: Request, res: Response) => {
      const permiso = await cuentaDeLaSesion(req, panel);
      if (permiso === 'sin-sesion') return res.status(401).type('html').send(paginaSinSesion());
      if (permiso === 'sin-cuenta') return res.status(404).type('html').send(paginaSinCuenta());

      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      const texto = (clave: string) =>
        typeof cuerpo[clave] === 'string' ? (cuerpo[clave] as string).trim() : '';
      const palabra = texto('palabra');
      const enlace = texto('enlace');
      const mensaje = texto('mensaje');
      const exigirSeguir = cuerpo.exigirSeguir === 'si';
      const soloVerPrevia = cuerpo.accion === 'previa';

      const suyas = await panel.campaignsOf(permiso.accountId);
      const actual: PanelCampaign | undefined = suyas[0];
      const base = {
        palabra,
        enlace,
        mensaje,
        exigirSeguir,
        origen: (suyas.length > 0 ? 'panel' : 'hoja') as 'panel' | 'hoja',
      };

      // "Ver como queda" no guarda: es para mirar el mensaje antes de decidir.
      if (soloVerPrevia) {
        return res.type('html').send(renderEditorDeCampana(base));
      }

      // Se RECHAZA lo que no cabe, no se recorta. Recortar en silencio guardaba
      // un enlace distinto al que el cliente pego y ademas le confirmaba que
      // quedo activo: el peor error posible, porque no tiene como notarlo.
      const topes: Array<[string, string, number]> = [
        ['la palabra', palabra, 40],
        ['el enlace', enlace, 500],
        ['el mensaje', mensaje, 280],
      ];
      for (const [comoSeLlama, valor, tope] of topes) {
        if (valor.length > tope) {
          return res
            .status(400)
            .type('html')
            .send(
              renderEditorDeCampana({
                ...base,
                problema: {
                  que: `Se paso de largo ${comoSeLlama}.`,
                  comoArreglarlo: `Dejalo en ${tope} caracteres o menos. Ahora tiene ${valor.length}.`,
                },
              }),
            );
        }
      }

      if (!palabra) {
        return res.status(400).type('html').send(
          renderEditorDeCampana({
            ...base,
            problema: {
              que: 'Falta la palabra que la gente va a comentar.',
              comoArreglarlo: 'Escribe una sola palabra, corta y fácil de recordar.',
            },
          }),
        );
      }

      const revision = await revisarEnlace(enlace);
      if (revision.veredicto === 'no-sirve') {
        return res.status(400).type('html').send(
          renderEditorDeCampana({
            ...base,
            problema: { que: revision.motivo, comoArreglarlo: revision.comoArreglarlo },
          }),
        );
      }

      try {
        await panel.saveCampaign({
          id: actual?.id,
          accountId: permiso.accountId,
          keyword: palabra,
          url: enlace,
          message: mensaje || undefined,
          requireFollow: exigirSeguir,
        });
      } catch (err) {
        if (err instanceof DuplicateKeywordError) {
          return res.status(409).type('html').send(
            renderEditorDeCampana({
              ...base,
              problema: {
                que: `Ya tienes otra campaña usando la palabra "${palabra}".`,
                comoArreglarlo: 'Elige una palabra distinta para no confundir a quien comenta.',
              },
            }),
          );
        }
        throw err;
      }

      const hayQueRevisarlo = revision.veredicto === 'no-pudimos-revisar';
      logger.info({ account: permiso.accountId }, 'Panel: campana guardada');
      return res.redirect(303, `/panel?guardado=1${hayQueRevisarlo ? '&revisar=1' : ''}`);
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

    const suyas = await panel.campaignsOf(permiso.accountId);
    const actual = suyas[0];
    const dias = req.query.dias === '30' ? 30 : 7;
    const aviso =
      req.query.guardado === '1'
        ? req.query.revisar === '1'
          ? 'Guardamos tus cambios. No pudimos abrir el enlace desde aquí: ábrelo tú para confirmar que funciona.'
          : 'Guardamos tus cambios. Ya están activos.'
        : undefined;

    const conexion = await armarEstadoDeConexion(
      adapter,
      panel,
      permiso.accountId,
      cuentaDelAdaptador,
    );
    if (conexion.tipo === 'atencion') {
      // El cliente no puede reconectar solo: alguien tiene que enterarse HOY.
      await avisador.avisar({
        accountId: permiso.accountId,
        asunto: 'cuenta-desconectada',
        detalle: `La cuenta ${permiso.accountId} perdio el permiso de Instagram y no esta respondiendo.`,
      });
    }

    return res.type('html').send(
      renderPanel({
        cuenta: permiso.accountId,
        cuantasCuentas: permiso.todas.length,
        conexion,
        campana: actual ? { palabra: actual.keyword, enlace: actual.url } : 'pendiente',
        resultados: await resumenDe(panel, permiso.accountId, dias),
        dias,
        aviso,
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
