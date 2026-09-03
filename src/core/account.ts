import type { Platform } from './types.js';

/**
 * Una cuenta = un tenant del SaaS: la cuenta de red social de un cliente, con su
 * propio token y config. Hoy hay una sola (desde env); el dashboard/OAuth (fases
 * siguientes) agregara mas. El estado y las campanas se aislan por `id`.
 */
export interface Account {
  /** Id estable del tenant. Para la cuenta unica de env = 'default'. */
  id: string;
  platform: Platform;
  /** IG business account id — sirve para rutear el webhook a la cuenta correcta. */
  igBusinessAccountId: string;
  /** Token de acceso de ESTA cuenta (no global). */
  accessToken: string;
  /** Nombre visible en el dashboard. */
  label?: string;
  /** URL CSV de la hoja de recursos de esta cuenta (opcional). */
  resourcesSheetCsvUrl?: string;
}

/**
 * Resuelve cuentas por id (para el estado) y por IG id (para rutear webhooks
 * entrantes a la cuenta dueña). En fases siguientes se respaldara en la DB; hoy
 * lo implementa `EnvAccountRegistry` con la cuenta unica.
 */
export interface AccountRegistry {
  byId(id: string): Account | undefined;
  byIgId(igBusinessAccountId: string): Account | undefined;
  all(): Account[];
  /** Cuenta a usar cuando no se puede resolver por IG id (compat single-account). */
  primary(): Account | undefined;
}

/** Id del tenant por defecto (cuenta unica / compat single-account). */
export const DEFAULT_ACCOUNT_ID = 'default';

/**
 * Registry en memoria a partir de una lista de cuentas. La fuente (env hoy, DB
 * manana) construye la lista y se la pasa; el registry solo indexa y resuelve.
 */
export class InMemoryAccountRegistry implements AccountRegistry {
  private readonly byIdMap = new Map<string, Account>();
  private readonly byIgMap = new Map<string, Account>();

  constructor(private readonly accounts: Account[]) {
    for (const a of accounts) {
      this.byIdMap.set(a.id, a);
      if (a.igBusinessAccountId) this.byIgMap.set(a.igBusinessAccountId, a);
    }
  }

  byId(id: string): Account | undefined {
    return this.byIdMap.get(id);
  }

  byIgId(igBusinessAccountId: string): Account | undefined {
    return this.byIgMap.get(igBusinessAccountId);
  }

  all(): Account[] {
    return [...this.accounts];
  }

  primary(): Account | undefined {
    return this.accounts[0];
  }
}
