import type { ConSalud } from './estado.js';

/**
 * Guarda por unos segundos la respuesta de "¿la cuenta sigue conectada?".
 *
 * El limite de peticiones de Meta es POR APLICACION, o sea compartido entre
 * todos tus clientes. Sin este cache, cada vez que alguien abre su panel se
 * gasta una llamada, y la pantalla de un operador con diez cuentas gasta diez de
 * golpe. Un cliente recargando en bucle podia agotar la cuota y dejar sin
 * enviar DMs a TODOS los demas.
 *
 * Diez segundos de retraso en el semaforo no le cambian la vida a nadie; quedarse
 * sin cuota, si.
 */

interface Guardado {
  cuando: number;
  valor: Awaited<ReturnType<NonNullable<ConSalud['salud']>>>;
}

export const VIGENCIA_MS = 60_000;

/**
 * Un fallo se guarda mucho menos que un exito. Con la misma vigencia, un solo
 * tropiezo de Meta dejaba la pantalla diciendo "estamos revisando" durante un
 * minuto entero despues de que Meta ya respondia bien.
 */
export const VIGENCIA_DEL_FALLO_MS = 5_000;

export function conCache(adapter: ConSalud | undefined, vigenciaMs = VIGENCIA_MS): ConSalud | undefined {
  if (!adapter?.salud) return adapter;
  const preguntar = adapter.salud.bind(adapter);
  let guardado: Guardado | undefined;
  let enVuelo: Promise<Guardado['valor']> | undefined;

  return {
    async salud() {
      const ahora = Date.now();
      const vigente =
        guardado?.valor.estado === 'ok' ? vigenciaMs : Math.min(VIGENCIA_DEL_FALLO_MS, vigenciaMs);
      if (guardado && ahora - guardado.cuando < vigente) return guardado.valor;
      // Si ya hay una consulta en curso, se comparte: diez pestanas abiertas a la
      // vez no pueden convertirse en diez llamadas a Meta.
      if (!enVuelo) {
        enVuelo = preguntar()
          .then((valor) => {
            guardado = { cuando: Date.now(), valor };
            return valor;
          })
          .finally(() => {
            enVuelo = undefined;
          });
      }
      return enVuelo;
    },
  };
}
