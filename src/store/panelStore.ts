import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalize } from '../core/textMatch.js';

/**
 * Almacen del PANEL del cliente: quien entra, que cuenta puede ver, que campanas
 * tiene y que paso en su embudo.
 *
 * Vive aparte de `conversationStore` a proposito: aquel guarda el estado de las
 * conversaciones (lo que necesita el motor); este guarda lo que necesita la
 * pantalla. Misma idea de diseno: una interfaz, dos implementaciones (memoria
 * para tests, Postgres para produccion) y `init()` crea las tablas si no existen
 * (sin ORM ni migraciones; el volumen es bajo).
 *
 * Spec: docs/specs/2026-09-10-panel-cliente-inboxpilot.md (Tarea 1 del plan).
 */

/**
 * De donde viene la identidad de quien entra al panel.
 *
 * - `invite`: enlace de invitacion que Leonardo le manda al cliente (hoy).
 * - `facebook`: inicio de sesion con Facebook. Requiere verificacion del
 *   negocio en Meta, asi que se enciende cuando eso este hecho.
 *
 * El panel no pregunta de donde vino nadie: resuelve la persona y sus cuentas
 * igual en los dos casos.
 */
export type IdentityProvider = 'invite' | 'facebook';

/** Persona que entra al panel. */
export interface PanelUser {
  /** Id propio, no el del proveedor. */
  id: string;
  provider: IdentityProvider;
  /** Id de la persona en el proveedor. Unico junto con `provider`. */
  providerUserId: string;
  name?: string;
  email?: string;
  /** Epoch ms. */
  createdAt: number;
}

/** Sesion abierta. El id va firmado en la cookie; borrarla = cerrar sesion. */
export interface PanelSession {
  id: string;
  userId: string;
  createdAt: number;
  /** Epoch ms. Pasada esta hora, `getSession` la trata como inexistente. */
  expiresAt: number;
}

/**
 * Quien puede ver que cuenta. Es la unica fuente para autorizar una pantalla:
 * la cuenta NUNCA se resuelve desde un dato que mande el navegador.
 */
export interface AccountAccess {
  userId: string;
  /** `accountId` del AccountRegistry (src/core/account.ts). */
  accountId: string;
  /** 'owner' = el cliente dueno de la cuenta; 'staff' = Leonardo operando. */
  role: 'owner' | 'staff';
}

/** Campana editable desde el panel: palabra clave -> recurso. */
export interface PanelCampaign {
  id: string;
  accountId: string;
  /** Palabra tal como la escribio el cliente (para mostrarla igual). */
  keyword: string;
  /** Palabra normalizada (sin tildes/mayusculas/signos). Es la clave de unicidad. */
  keywordNormalized: string;
  /** Enlace que se entrega (PDF de Drive, articulo, video...). */
  url: string;
  /** Texto que acompana al enlace. */
  message?: string;
  requireFollow: boolean;
  updatedAt: number;
}

/** Los pasos del embudo, en el orden en que ocurren. */
export type FunnelEventType =
  | 'comment_detected'
  | 'dm_sent'
  | 'button_tapped'
  | 'follow_verified'
  | 'resource_delivered'
  | 'blocked_not_following';

/** Un paso que ocurrio. Materia prima de la prueba en vivo y de los resultados. */
export interface FunnelEvent {
  id: string;
  accountId: string;
  /**
   * Campana que lo disparo, si se pudo atribuir. Guarda el identificador que sea
   * la fuente de verdad en ese momento: hoy el `name` de la campana en codigo
   * (src/core/campaigns.ts); cuando el panel sea la fuente (Tarea 8), el id de
   * `panel_campaigns`. Ambos son texto y ambos identifican una sola campana.
   */
  campaignId?: string;
  /**
   * Clave natural del hecho, para que reenviar el mismo webhook no cuente dos
   * veces (ej. `cuenta:comment:<commentId>`). Si no se pasa, se usa el id del
   * evento, o sea no dedup: cada llamada es un hecho distinto.
   */
  dedupeKey?: string;
  /** Id de la persona en la plataforma (quien comento / recibio). */
  platformUserId: string;
  type: FunnelEventType;
  /** Epoch ms. */
  at: number;
}

export interface PanelStore {
  /** Crea las tablas si no existen. Llamar UNA vez al arrancar, antes de servir. */
  init(): Promise<void>;

  /** Crea la persona o actualiza nombre/email si ya existia. Idempotente. */
  upsertUser(user: {
    provider: IdentityProvider;
    providerUserId: string;
    name?: string;
    email?: string;
  }): Promise<PanelUser>;
  getUserByProvider(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<PanelUser | undefined>;
  /** La persona detras de una sesion viva. */
  getUserById(id: string): Promise<PanelUser | undefined>;

  /**
   * Crea una invitacion y devuelve el enlace-token EN CLARO una sola vez: en la
   * base solo queda su hash, asi que ni una fuga de la base entrega accesos.
   */
  createInvite(invite: {
    accountId: string;
    role: AccountAccess['role'];
    ttlMs: number;
    label?: string;
  }): Promise<{ token: string; expiresAt: number }>;
  /** Canjea el token: devuelve a que cuenta da acceso, o undefined si no sirve. */
  redeemInvite(token: string): Promise<{ accountId: string; role: AccountAccess['role'] } | undefined>;
  /**
   * Devuelve una invitacion ya canjeada al estado de sin usar. Se llama cuando
   * el canje se quemo pero la sesion no llego a crearse: sin esto, un fallo de
   * base deja al cliente fuera y sin enlace.
   */
  releaseInvite(token: string): Promise<void>;

  createSession(userId: string, ttlMs: number): Promise<PanelSession>;
  /** Devuelve undefined si no existe o si ya vencio. */
  getSession(id: string): Promise<PanelSession | undefined>;
  deleteSession(id: string): Promise<void>;

  grantAccess(access: AccountAccess): Promise<void>;
  accountsOf(userId: string): Promise<AccountAccess[]>;
  /** La pregunta que hace toda pantalla del panel antes de mostrar nada. */
  hasAccess(userId: string, accountId: string): Promise<boolean>;

  /** Crea o reemplaza la campana (por id). Normaliza la palabra clave. */
  saveCampaign(campaign: {
    id?: string;
    accountId: string;
    keyword: string;
    url: string;
    message?: string;
    requireFollow: boolean;
  }): Promise<PanelCampaign>;
  campaignsOf(accountId: string): Promise<PanelCampaign[]>;
  /** Busca por palabra normalizada: 'guía' encuentra 'GUIA'. */
  campaignByKeyword(accountId: string, keyword: string): Promise<PanelCampaign | undefined>;
  deleteCampaign(accountId: string, id: string): Promise<void>;

  recordEvent(event: Omit<FunnelEvent, 'id'>): Promise<FunnelEvent>;
  /** Eventos de la cuenta desde un momento dado, del mas viejo al mas nuevo. */
  eventsSince(accountId: string, sinceMs: number): Promise<FunnelEvent[]>;
}

/**
 * Hash del token de invitacion. En la base NUNCA se guarda el token en claro:
 * si alguien lee la tabla, no se lleva accesos, igual que con las contrasenas.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Techo del almacen en memoria: sin el, un proceso largo se come la RAM. */
const MAX_EVENTOS_EN_MEMORIA = 10_000;

/** Cota dura de lectura: ninguna pantalla necesita mas, y evita traer la tabla entera. */
const MAX_EVENTOS_POR_CONSULTA = 5_000;

/** Error de negocio: la palabra ya la usa otra campana de la misma cuenta. */
export class DuplicateKeywordError extends Error {
  constructor(readonly keyword: string, readonly existingCampaignId: string) {
    super(`la palabra "${keyword}" ya la usa otra campana`);
    this.name = 'DuplicateKeywordError';
  }
}

// ---------------------------------------------------------------------------
// En memoria (tests y desarrollo). No sobrevive reinicios, y esta bien: para
// eso esta la implementacion de Postgres.
// ---------------------------------------------------------------------------

export class InMemoryPanelStore implements PanelStore {
  private readonly users = new Map<string, PanelUser>();
  private readonly sessions = new Map<string, PanelSession>();
  private readonly access: AccountAccess[] = [];
  private readonly campaigns = new Map<string, PanelCampaign>();
  /**
   * Indexado por clave de dedup en vez de un array con busqueda lineal: antes
   * cada evento recorria TODOS los anteriores, asi que llenar la tabla saturaba
   * la CPU del proceso. Ademas se poda, para no quedarse sin memoria.
   */
  private readonly events = new Map<string, FunnelEvent>();
  private readonly invites = new Map<
    string,
    { accountId: string; role: AccountAccess['role']; expiresAt: number; usada: boolean }
  >();

  async init(): Promise<void> {
    // Nada que crear.
  }

  async upsertUser(user: {
    provider: IdentityProvider;
    providerUserId: string;
    name?: string;
    email?: string;
  }): Promise<PanelUser> {
    const existing = await this.getUserByProvider(user.provider, user.providerUserId);
    const merged: PanelUser = existing
      ? { ...existing, name: user.name ?? existing.name, email: user.email ?? existing.email }
      : { id: randomUUID(), createdAt: Date.now(), ...user };
    this.users.set(merged.id, merged);
    return merged;
  }

  async getUserByProvider(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<PanelUser | undefined> {
    for (const u of this.users.values()) {
      if (u.provider === provider && u.providerUserId === providerUserId) return u;
    }
    return undefined;
  }

  async getUserById(id: string): Promise<PanelUser | undefined> {
    return this.users.get(id);
  }

  async createInvite(invite: {
    accountId: string;
    role: AccountAccess['role'];
    ttlMs: number;
    label?: string;
  }): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + invite.ttlMs;
    this.invites.set(hashInviteToken(token), {
      accountId: invite.accountId,
      role: invite.role,
      expiresAt,
      usada: false,
    });
    return { token, expiresAt };
  }

  async redeemInvite(
    token: string,
  ): Promise<{ accountId: string; role: AccountAccess['role'] } | undefined> {
    const key = hashInviteToken(token);
    const inv = this.invites.get(key);
    if (!inv || inv.usada || inv.expiresAt <= Date.now()) return undefined;
    inv.usada = true;
    return { accountId: inv.accountId, role: inv.role };
  }

  async releaseInvite(token: string): Promise<void> {
    const inv = this.invites.get(hashInviteToken(token));
    if (inv) inv.usada = false;
  }

  async createSession(userId: string, ttlMs: number): Promise<PanelSession> {
    const now = Date.now();
    const session: PanelSession = {
      id: randomUUID(),
      userId,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<PanelSession | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async grantAccess(access: AccountAccess): Promise<void> {
    const i = this.access.findIndex(
      (a) => a.userId === access.userId && a.accountId === access.accountId,
    );
    if (i >= 0) this.access[i] = access;
    else this.access.push(access);
  }

  async accountsOf(userId: string): Promise<AccountAccess[]> {
    return this.access.filter((a) => a.userId === userId);
  }

  async hasAccess(userId: string, accountId: string): Promise<boolean> {
    return this.access.some((a) => a.userId === userId && a.accountId === accountId);
  }

  async saveCampaign(input: {
    id?: string;
    accountId: string;
    keyword: string;
    url: string;
    message?: string;
    requireFollow: boolean;
  }): Promise<PanelCampaign> {
    const keywordNormalized = normalize(input.keyword);
    const clash = await this.campaignByKeyword(input.accountId, input.keyword);
    if (clash && clash.id !== input.id) {
      throw new DuplicateKeywordError(input.keyword, clash.id);
    }
    const campaign: PanelCampaign = {
      id: input.id ?? randomUUID(),
      accountId: input.accountId,
      keyword: input.keyword,
      keywordNormalized,
      url: input.url,
      message: input.message,
      requireFollow: input.requireFollow,
      updatedAt: Date.now(),
    };
    this.campaigns.set(campaign.id, campaign);
    return campaign;
  }

  async campaignsOf(accountId: string): Promise<PanelCampaign[]> {
    return [...this.campaigns.values()]
      .filter((c) => c.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async campaignByKeyword(accountId: string, keyword: string): Promise<PanelCampaign | undefined> {
    const wanted = normalize(keyword);
    return [...this.campaigns.values()].find(
      (c) => c.accountId === accountId && c.keywordNormalized === wanted,
    );
  }

  async deleteCampaign(accountId: string, id: string): Promise<void> {
    const c = this.campaigns.get(id);
    if (c?.accountId === accountId) this.campaigns.delete(id);
  }

  async recordEvent(event: Omit<FunnelEvent, 'id'>): Promise<FunnelEvent> {
    const id = randomUUID();
    const dedupeKey = event.dedupeKey ?? id;
    const clave = `${event.accountId} ${dedupeKey}`;
    const ya = this.events.get(clave);
    if (ya) return ya;
    const stored: FunnelEvent = { ...event, id, dedupeKey };
    this.events.set(clave, stored);
    if (this.events.size > MAX_EVENTOS_EN_MEMORIA) {
      // Poda del mas viejo (los Map conservan orden de insercion), para que un
      // proceso largo no crezca sin techo.
      const primero = this.events.keys().next().value;
      if (primero !== undefined) this.events.delete(primero);
    }
    return stored;
  }

  async eventsSince(accountId: string, sinceMs: number): Promise<FunnelEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.accountId === accountId && e.at >= sinceMs)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_EVENTOS_POR_CONSULTA);
  }
}

// ---------------------------------------------------------------------------
// Postgres (produccion). Misma forma que PostgresConversationStore.
// ---------------------------------------------------------------------------

/** Lo minimo que necesitamos de `pg.Pool`, para poder testear con un doble. */
export interface PanelQueryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
}

interface UserRow {
  id: string;
  provider: string;
  provider_user_id: string;
  name: string | null;
  email: string | null;
  created_at: string | number | Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string | number | Date;
  expires_at: string | number | Date;
}

interface AccessRow {
  user_id: string;
  account_id: string;
  role: string;
}

interface CampaignRow {
  id: string;
  account_id: string;
  keyword: string;
  keyword_normalized: string;
  url: string;
  message: string | null;
  require_follow: boolean;
  updated_at: string | number | Date;
}

interface EventRow {
  id: string;
  account_id: string;
  campaign_id: string | null;
  platform_user_id: string;
  type: string;
  at: string | number | Date;
  dedupe_key: string;
}

/**
 * Toma la fila que un INSERT ... RETURNING tiene que haber devuelto. Si no vino,
 * algo fallo en la base: mejor decirlo con nombre y apellido que reventar mas
 * abajo con un 'undefined'.
 */
function required<R>(rows: R[], que: string): R {
  const row = rows[0];
  if (!row) throw new Error(`la base no devolvio la fila esperada al guardar ${que}`);
  return row;
}

/** ¿Es una violacion de indice unico (SQLSTATE 23505) sobre esta tabla? */
function esViolacionDeUnicidad(err: unknown, tabla: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; constraint?: string; table?: string };
  return e.code === '23505' && (e.table === tabla || (e.constraint ?? '').includes(tabla));
}

/** Postgres devuelve timestamptz como Date; lo pasamos a epoch ms. */
function ms(value: string | number | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export class PostgresPanelStore implements PanelStore {
  constructor(private readonly db: PanelQueryable) {}

  async init(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_users (
         id               text        PRIMARY KEY,
         provider         text        NOT NULL,
         provider_user_id text        NOT NULL,
         name             text,
         email            text,
         created_at       timestamptz NOT NULL DEFAULT now(),
         UNIQUE (provider, provider_user_id)
       )`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_sessions (
         id         text        PRIMARY KEY,
         user_id    text        NOT NULL REFERENCES panel_users(id) ON DELETE CASCADE,
         created_at timestamptz NOT NULL DEFAULT now(),
         expires_at timestamptz NOT NULL
       )`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_account_access (
         user_id    text NOT NULL REFERENCES panel_users(id) ON DELETE CASCADE,
         account_id text NOT NULL,
         role       text NOT NULL,
         PRIMARY KEY (user_id, account_id)
       )`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_campaigns (
         id                 text        PRIMARY KEY,
         account_id         text        NOT NULL,
         keyword            text        NOT NULL,
         keyword_normalized text        NOT NULL,
         url                text        NOT NULL,
         message            text,
         require_follow     boolean     NOT NULL DEFAULT true,
         updated_at         timestamptz NOT NULL DEFAULT now(),
         UNIQUE (account_id, keyword_normalized)
       )`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_events (
         id               text        PRIMARY KEY,
         account_id       text        NOT NULL,
         campaign_id      text,
         platform_user_id text        NOT NULL,
         type             text        NOT NULL,
         at               timestamptz NOT NULL,
         dedupe_key       text        NOT NULL
       )`,
    );
    // MIGRACION de tablas que ya existen. `CREATE TABLE IF NOT EXISTS` no agrega
    // columnas a una tabla creada antes: sin esto, una base que ya tenia
    // `panel_events` se queda sin `dedupe_key` y toda escritura de evento falla.
    // Lo encontro la base REAL; ninguna prueba con doble lo habria visto.
    await this.db.query('ALTER TABLE panel_events ADD COLUMN IF NOT EXISTS dedupe_key text');
    // Las filas viejas no tienen clave: se les pone su propio id, que es unico y
    // equivale a "este evento no deduplica con ningun otro".
    await this.db.query('UPDATE panel_events SET dedupe_key = id WHERE dedupe_key IS NULL');
    await this.db.query('ALTER TABLE panel_events ALTER COLUMN dedupe_key SET NOT NULL');

    // La unicidad va por (cuenta, clave), no por clave sola. Con la clave global,
    // el prefijo de cuenta dependia de que el llamador se acordara de ponerlo, y
    // ante choque el INSERT devolvia la fila del OTRO tenant.
    await this.db.query(
      'ALTER TABLE panel_events DROP CONSTRAINT IF EXISTS panel_events_dedupe_key_key',
    );
    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS panel_events_cuenta_dedupe
         ON panel_events (account_id, dedupe_key)`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS panel_invites (
         token_hash text        PRIMARY KEY,
         account_id text        NOT NULL,
         role       text        NOT NULL,
         label      text,
         created_at timestamptz NOT NULL DEFAULT now(),
         expires_at timestamptz NOT NULL,
         used_at    timestamptz
       )`,
    );
    // Los resultados y la prueba en vivo siempre preguntan "de esta cuenta,
    // desde tal hora": ese es el indice que importa.
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS panel_events_account_at ON panel_events (account_id, at DESC)',
    );
  }

  async upsertUser(user: {
    provider: IdentityProvider;
    providerUserId: string;
    name?: string;
    email?: string;
  }): Promise<PanelUser> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO panel_users (id, provider, provider_user_id, name, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET name  = COALESCE(EXCLUDED.name,  panel_users.name),
                     email = COALESCE(EXCLUDED.email, panel_users.email)
       RETURNING *`,
      [randomUUID(), user.provider, user.providerUserId, user.name ?? null, user.email ?? null],
    );
    return toUser(required(rows, 'la persona'));
  }

  async getUserByProvider(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<PanelUser | undefined> {
    const { rows } = await this.db.query<UserRow>(
      'SELECT * FROM panel_users WHERE provider = $1 AND provider_user_id = $2',
      [provider, providerUserId],
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<PanelUser | undefined> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM panel_users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async createInvite(invite: {
    accountId: string;
    role: AccountAccess['role'];
    ttlMs: number;
    label?: string;
  }): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    const { rows } = await this.db.query<{ expires_at: string | number | Date }>(
      `INSERT INTO panel_invites (token_hash, account_id, role, label, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
       RETURNING expires_at`,
      [hashInviteToken(token), invite.accountId, invite.role, invite.label ?? null, String(invite.ttlMs)],
    );
    return { token, expiresAt: ms(required(rows, 'la invitacion').expires_at) };
  }

  async redeemInvite(
    token: string,
  ): Promise<{ accountId: string; role: AccountAccess['role'] } | undefined> {
    // Un solo UPDATE hace de candado: si dos personas abren el mismo enlace a la
    // vez, solo la primera se lleva la fila (used_at IS NULL deja de cumplirse).
    const { rows } = await this.db.query<{ account_id: string; role: string }>(
      `UPDATE panel_invites SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING account_id, role`,
      [hashInviteToken(token)],
    );
    const r = rows[0];
    return r ? { accountId: r.account_id, role: r.role as AccountAccess['role'] } : undefined;
  }

  async releaseInvite(token: string): Promise<void> {
    await this.db.query('UPDATE panel_invites SET used_at = NULL WHERE token_hash = $1', [
      hashInviteToken(token),
    ]);
  }

  async createSession(userId: string, ttlMs: number): Promise<PanelSession> {
    const { rows } = await this.db.query<SessionRow>(
      `INSERT INTO panel_sessions (id, user_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
       RETURNING *`,
      [randomUUID(), userId, String(ttlMs)],
    );
    const r = required(rows, 'la sesion');
    return { id: r.id, userId: r.user_id, createdAt: ms(r.created_at), expiresAt: ms(r.expires_at) };
  }

  async getSession(id: string): Promise<PanelSession | undefined> {
    // La expiracion la decide la base, no el reloj del contenedor.
    const { rows } = await this.db.query<SessionRow>(
      'SELECT * FROM panel_sessions WHERE id = $1 AND expires_at > now()',
      [id],
    );
    const r = rows[0];
    return r
      ? { id: r.id, userId: r.user_id, createdAt: ms(r.created_at), expiresAt: ms(r.expires_at) }
      : undefined;
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.query('DELETE FROM panel_sessions WHERE id = $1', [id]);
  }

  async grantAccess(access: AccountAccess): Promise<void> {
    await this.db.query(
      `INSERT INTO panel_account_access (user_id, account_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, account_id) DO UPDATE SET role = EXCLUDED.role`,
      [access.userId, access.accountId, access.role],
    );
  }

  async accountsOf(userId: string): Promise<AccountAccess[]> {
    const { rows } = await this.db.query<AccessRow>(
      'SELECT * FROM panel_account_access WHERE user_id = $1 ORDER BY account_id',
      [userId],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      accountId: r.account_id,
      role: r.role as AccountAccess['role'],
    }));
  }

  async hasAccess(userId: string, accountId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ one: number }>(
      'SELECT 1 AS one FROM panel_account_access WHERE user_id = $1 AND account_id = $2',
      [userId, accountId],
    );
    return rows.length > 0;
  }

  async saveCampaign(input: {
    id?: string;
    accountId: string;
    keyword: string;
    url: string;
    message?: string;
    requireFollow: boolean;
  }): Promise<PanelCampaign> {
    const keywordNormalized = normalize(input.keyword);
    const clash = await this.campaignByKeyword(input.accountId, input.keyword);
    if (clash && clash.id !== input.id) {
      throw new DuplicateKeywordError(input.keyword, clash.id);
    }
    try {
      return await this.insertarCampana(input, keywordNormalized);
    } catch (err) {
      // Dos guardados simultaneos de la misma palabra pasan los dos el chequeo
      // de arriba y el segundo viola el indice unico. Sin esto sale como un 500
      // crudo de Postgres en vez de "esa palabra ya la usa otra campana".
      if (esViolacionDeUnicidad(err, 'panel_campaigns')) {
        const clash = await this.campaignByKeyword(input.accountId, input.keyword);
        throw new DuplicateKeywordError(input.keyword, clash?.id ?? 'desconocida');
      }
      throw err;
    }
  }

  private async insertarCampana(
    input: {
      id?: string;
      accountId: string;
      keyword: string;
      url: string;
      message?: string;
      requireFollow: boolean;
    },
    keywordNormalized: string,
  ): Promise<PanelCampaign> {
    const { rows } = await this.db.query<CampaignRow>(
      `INSERT INTO panel_campaigns
         (id, account_id, keyword, keyword_normalized, url, message, require_follow, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         keyword            = EXCLUDED.keyword,
         keyword_normalized = EXCLUDED.keyword_normalized,
         url                = EXCLUDED.url,
         message            = EXCLUDED.message,
         require_follow     = EXCLUDED.require_follow,
         updated_at         = now()
       RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.accountId,
        input.keyword,
        keywordNormalized,
        input.url,
        input.message ?? null,
        input.requireFollow,
      ],
    );
    return toCampaign(required(rows, 'la campana'));
  }

  async campaignsOf(accountId: string): Promise<PanelCampaign[]> {
    const { rows } = await this.db.query<CampaignRow>(
      'SELECT * FROM panel_campaigns WHERE account_id = $1 ORDER BY updated_at DESC',
      [accountId],
    );
    return rows.map(toCampaign);
  }

  async campaignByKeyword(accountId: string, keyword: string): Promise<PanelCampaign | undefined> {
    const { rows } = await this.db.query<CampaignRow>(
      'SELECT * FROM panel_campaigns WHERE account_id = $1 AND keyword_normalized = $2',
      [accountId, normalize(keyword)],
    );
    return rows[0] ? toCampaign(rows[0]) : undefined;
  }

  async deleteCampaign(accountId: string, id: string): Promise<void> {
    await this.db.query('DELETE FROM panel_campaigns WHERE account_id = $1 AND id = $2', [
      accountId,
      id,
    ]);
  }

  async recordEvent(event: Omit<FunnelEvent, 'id'>): Promise<FunnelEvent> {
    const id = randomUUID();
    // ON CONFLICT DO UPDATE (y no DO NOTHING) para que el RETURNING traiga la
    // fila que YA estaba: reenviar el mismo webhook devuelve el evento original
    // en vez de crear uno nuevo o quedarse sin fila.
    const { rows } = await this.db.query<EventRow>(
      `INSERT INTO panel_events
         (id, account_id, campaign_id, platform_user_id, type, at, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000), $7)
       ON CONFLICT (account_id, dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
       RETURNING *`,
      [
        id,
        event.accountId,
        event.campaignId ?? null,
        event.platformUserId,
        event.type,
        event.at,
        event.dedupeKey ?? id,
      ],
    );
    return toEvent(required(rows, 'el evento'));
  }

  async eventsSince(accountId: string, sinceMs: number): Promise<FunnelEvent[]> {
    const { rows } = await this.db.query<EventRow>(
      `SELECT * FROM panel_events
       WHERE account_id = $1 AND at >= to_timestamp($2::double precision / 1000)
       ORDER BY at ASC
       LIMIT $3`,
      [accountId, sinceMs, MAX_EVENTOS_POR_CONSULTA],
    );
    return rows.map(toEvent);
  }
}

function toUser(r: UserRow): PanelUser {
  return {
    id: r.id,
    provider: r.provider as PanelUser['provider'],
    providerUserId: r.provider_user_id,
    name: r.name ?? undefined,
    email: r.email ?? undefined,
    createdAt: ms(r.created_at),
  };
}

function toCampaign(r: CampaignRow): PanelCampaign {
  return {
    id: r.id,
    accountId: r.account_id,
    keyword: r.keyword,
    keywordNormalized: r.keyword_normalized,
    url: r.url,
    message: r.message ?? undefined,
    requireFollow: r.require_follow,
    updatedAt: ms(r.updated_at),
  };
}

function toEvent(r: EventRow): FunnelEvent {
  return {
    id: r.id,
    accountId: r.account_id,
    campaignId: r.campaign_id ?? undefined,
    platformUserId: r.platform_user_id,
    type: r.type as FunnelEventType,
    at: ms(r.at),
    dedupeKey: r.dedupe_key,
  };
}
