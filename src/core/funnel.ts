import { logger } from '../utils/logger.js';
import type { FunnelEvent, PanelStore } from '../store/panelStore.js';

/**
 * Por donde el motor cuenta lo que va pasando en el embudo.
 *
 * Es una interfaz de un solo metodo a proposito: el FlowEngine no tiene por que
 * conocer el almacen del panel, solo necesita poder decir "esto paso". Asi el
 * motor se puede probar con un doble y el panel puede cambiar de almacen sin
 * tocarlo.
 */
export interface FunnelRecorder {
  record(event: Omit<FunnelEvent, 'id'>): Promise<void>;
}

/** No cuenta nada. Es el default: sin panel configurado, el motor va igual que siempre. */
export const noopFunnelRecorder: FunnelRecorder = {
  async record() {
    // Intencionalmente vacio.
  },
};

/**
 * Cuenta contra el almacen del panel.
 *
 * REGLA: registrar una metrica NUNCA puede tumbar una entrega. Si la base falla,
 * se pierde el dato del panel y se sigue; el DM del cliente vale mas que el
 * numerito. Por eso traga el error y solo lo deja en el log.
 */
export class StoreFunnelRecorder implements FunnelRecorder {
  constructor(private readonly store: PanelStore) {}

  async record(event: Omit<FunnelEvent, 'id'>): Promise<void> {
    try {
      await this.store.recordEvent(event);
    } catch (err) {
      logger.warn(
        { err, type: event.type, account: event.accountId },
        'No se pudo registrar el evento del embudo (el flujo sigue igual)',
      );
    }
  }
}
