/**
 * Buffer de diagnostico en memoria. Registra los ultimos eventos (webhooks
 * recibidos, envios, errores) y los expone en /debug/last para poder depurar
 * en produccion sin acceso a los logs del host. Temporal.
 */
interface DebugEntry {
  at: string;
  note: string;
  data?: unknown;
}

const buffer: DebugEntry[] = [];

export function dbg(note: string, data?: unknown): void {
  buffer.push({ at: new Date().toISOString(), note, data });
  if (buffer.length > 40) buffer.shift();
}

export function dbgRecent(): DebugEntry[] {
  return buffer.slice().reverse();
}
