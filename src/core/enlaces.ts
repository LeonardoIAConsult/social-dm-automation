import { logger } from '../utils/logger.js';

/**
 * Revisa el enlace ANTES de guardarlo.
 *
 * El error mas caro de este producto no es tecnico: es que el cliente pegue un
 * enlace de Drive que solo abre el, publique el post, y se entere una semana
 * despues de que nadie pudo abrir su guia. Para entonces perdio los leads y la
 * confianza. Por eso se revisa al guardar, no cuando falla.
 *
 * Regla de diseno: **fallar abierto**. Si NUESTRA revision no se puede hacer
 * (sin red, el sitio tarda, nos bloquean por ser un bot), se guarda igual con un
 * aviso suave. Nunca se le impide al cliente trabajar por un problema nuestro.
 */

export type RevisionDelEnlace =
  | { veredicto: 'sirve' }
  | { veredicto: 'no-sirve'; motivo: string; comoArreglarlo: string }
  | { veredicto: 'no-pudimos-revisar'; motivo: string };

const TIEMPO_MAXIMO_MS = 6000;

/** Forma del enlace. Esto no necesita red y atrapa la mayoria de los errores. */
function revisarLaForma(enlace: string): RevisionDelEnlace | undefined {
  const limpio = enlace.trim();
  if (!limpio) {
    return {
      veredicto: 'no-sirve',
      motivo: 'No escribiste ningún enlace.',
      comoArreglarlo: 'Pega la dirección del archivo o la página que quieres entregar.',
    };
  }

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return {
      veredicto: 'no-sirve',
      motivo: 'Eso no parece una dirección de internet.',
      comoArreglarlo: 'Tiene que empezar con https:// y no llevar espacios.',
    };
  }

  if (url.protocol !== 'https:') {
    return {
      veredicto: 'no-sirve',
      motivo: 'El enlace no es seguro.',
      comoArreglarlo: 'Usa la dirección que empieza con https://, no con http://.',
    };
  }

  // Un error clasico: copiar la direccion de la barra mientras editas el archivo.
  if (/docs\.google\.com|drive\.google\.com/.test(url.hostname) && /\/edit\b/.test(url.pathname)) {
    return {
      veredicto: 'no-sirve',
      motivo: 'Ese es el enlace para EDITAR tu archivo, no para verlo.',
      comoArreglarlo:
        'En Drive usa el botón Compartir, elige "Cualquiera con el enlace" y copia ese enlace.',
    };
  }

  return undefined;
}

/** ¿La respuesta nos manda a iniciar sesion? Entonces el archivo es privado. */
function pideIniciarSesion(respuesta: Response): boolean {
  const destino = respuesta.url || '';
  return /accounts\.google\.com|ServiceLogin|\/signin/.test(destino);
}

export async function revisarEnlace(
  enlace: string,
  traer: typeof fetch = fetch,
): Promise<RevisionDelEnlace> {
  const problemaDeForma = revisarLaForma(enlace);
  if (problemaDeForma) return problemaDeForma;

  const corte = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
  try {
    const respuesta = await traer(enlace.trim(), { redirect: 'follow', signal: corte });

    if (pideIniciarSesion(respuesta)) {
      return {
        veredicto: 'no-sirve',
        motivo: 'Ese archivo es privado: a quien le llegue le va a pedir iniciar sesión.',
        comoArreglarlo:
          'En Drive: Compartir → "Cualquiera con el enlace" → Lector. Después vuelve a pegarlo aquí.',
      };
    }

    if (respuesta.status === 404 || respuesta.status === 410) {
      return {
        veredicto: 'no-sirve',
        motivo: 'Esa página ya no existe.',
        comoArreglarlo: 'Revisa el enlace y vuelve a copiarlo desde donde está el archivo.',
      };
    }

    if (respuesta.status === 401 || respuesta.status === 403) {
      return {
        veredicto: 'no-sirve',
        motivo: 'Ese enlace está restringido: no cualquiera lo puede abrir.',
        comoArreglarlo: 'Haz el archivo público para cualquiera con el enlace y vuelve a pegarlo.',
      };
    }

    if (respuesta.status >= 500) {
      return {
        veredicto: 'no-pudimos-revisar',
        motivo: 'La página no respondió bien en este momento.',
      };
    }

    return { veredicto: 'sirve' };
  } catch (err) {
    // Sin red, muy lento, o el sitio nos bloquea por ser un robot. No es culpa
    // del cliente: se guarda igual y se le avisa suave.
    logger.debug({ err }, 'No se pudo revisar el enlace');
    return {
      veredicto: 'no-pudimos-revisar',
      motivo: 'No pudimos abrir el enlace desde aquí para comprobarlo.',
    };
  }
}
