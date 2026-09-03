import 'dotenv/config';
import { z } from 'zod';

/**
 * Validacion estricta de variables de entorno al arrancar.
 * Si falta algo critico, el proceso muere temprano con un mensaje claro
 * en vez de fallar a mitad de un webhook.
 *
 * DRY_RUN=true permite arrancar y probar el flujo SIN credenciales reales de
 * Meta: los envios y consultas al Graph API se simulan (se loguean). Ideal para
 * probar la logica de campanas/follow-gate localmente antes de conectar Meta.
 */
const bool = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v) => v.toLowerCase() === 'true');

const base = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DRY_RUN: bool('false'),
  FOLLOW_GATE_ENABLED: bool('true'),

  // Recurso por defecto (ej. agenda/Calendar) para DMs SIN palabra clave.
  // OFF por defecto: un DM normal ("hola", una pregunta) NO recibe auto-respuesta.
  // Ponlo en true solo si quieres que cada DM sin keyword reciba el link por defecto.
  DM_DEFAULT_ENABLED: bool('false'),

  // Google Sheet publicada como CSV con el mapa palabra -> link (opcional).
  RESOURCES_SHEET_CSV_URL: z.string().default(''),

  // En DRY_RUN estos valores simulan la respuesta del Graph API.
  SIM_IS_FOLLOWER: bool('true'),
  SIM_CAPTION: z.string().default('Comenta "GUIA" y te la mando 🎁'),
  SIM_MEDIA_TIMESTAMP: z.string().default(''), // ISO; vacio = ahora
  SIM_DRIVE_LINK: z.string().default('https://drive.google.com/file/d/DEMO/view'),

  // ── Google Drive (entrega de PDFs por fecha del post) ──
  GDRIVE_ENABLED: bool('false'),
  // Carpeta raiz que contiene las subcarpetas con fecha (una por post/fecha).
  GDRIVE_ROOT_FOLDER_ID: z.string().default(''),
  // Ruta al JSON de la cuenta de servicio de Google Cloud.
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default('credentials.json'),
  // Formato de fecha esperado en el nombre de la subcarpeta (solo referencia).
  GDRIVE_DATE_FORMAT: z.string().default('YYYY-MM-DD'),

  // Credenciales Meta. En DRY_RUN pueden quedar vacias (se validan solo en real).
  META_WEBHOOK_VERIFY_TOKEN: z.string().default('dev-verify-token'),
  META_APP_SECRET: z.string().default('dev-app-secret'),
  IG_ACCESS_TOKEN: z.string().default(''),
  IG_BUSINESS_ACCOUNT_ID: z.string().default(''),
  GRAPH_API_VERSION: z.string().default('v21.0'),

  // Bandeja de conversaciones (/inbox), protegida con Basic Auth. Si ambas
  // quedan vacias, la bandeja responde 503 (deshabilitada) para no exponer
  // conversaciones sin autenticacion.
  INBOX_USER: z.string().default(''),
  INBOX_PASS: z.string().default(''),

  // ── Persistencia del estado de conversaciones ──
  // 'memory' (default): estado en RAM, se pierde al reiniciar (bien para dev/DRY_RUN).
  // 'file': estado en un JSON local que sobrevive reinicios. Evita re-enviar DMs
  //   ya entregados (flag 'delivered') tras un restart/redeploy = clave anti-ban Meta.
  //   Requiere disco persistente en el host (VPS/Oracle Cloud; NO el disco efimero
  //   de Render free — ahi usa un disco montado o vuelve a 'memory').
  // 'postgres': estado en Postgres externo (Neon/Supabase). Sobrevive reinicios
  //   AUNQUE el disco del host sea efimero (caso Render Free) — es el backend para
  //   blindar /inbox en la revision de Meta. Requiere DATABASE_URL.
  STORE_BACKEND: z.enum(['memory', 'file', 'postgres']).default('memory'),
  STORE_FILE_PATH: z.string().default('./data/conversations.json'),
  /** Cadena de conexion Postgres (solo si STORE_BACKEND=postgres). Ej: Neon/Supabase. */
  DATABASE_URL: z.string().default(''),
  /** Solo si tu Postgres usa cert autofirmado: desactiva la verificacion TLS.
   *  Default false = se VERIFICA el certificado (Neon/Supabase funcionan asi). */
  DATABASE_SSL_NO_VERIFY: bool('false'),

  // ── Rate limit anti-ban (gap #3) ──
  // Tope de envios por hora y por cuenta. Backstop para no pasar el limite de
  // Meta (~200 msg/h por cuenta). 0 = deshabilitado. Al alcanzarlo, el envio se
  // OMITE (no se encola). Default conservador, por debajo del tope real.
  // Vacio ('') -> default (no 0): evitar apagar el backstop en silencio; para
  // desactivarlo hay que poner 0 explicito.
  RATE_LIMIT_PER_HOUR: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).default(180),
  ),

  // ── Cola de envios (gap #2) ──
  // OPT-IN. Apagado (default) = envio sincrono como siempre. Encendido = el
  // webhook encola y responde rapido; la cola aplica rate-limit (requeue si topa)
  // y reintenta fallos transitorios con backoff. En memoria (jobs se pierden al
  // reiniciar); durabilidad = siguiente paso si el volumen lo pide.
  SEND_QUEUE_ENABLED: bool('false'),
  /** Intentos totales por envio antes de rendirse (incluye el primero). */
  SEND_QUEUE_MAX_ATTEMPTS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).default(4),
  ),
});

const schema = base.superRefine((val, ctx) => {
  // El backend postgres exige DATABASE_URL (aplica incluso en DRY_RUN).
  if (val.STORE_BACKEND === 'postgres' && val.DATABASE_URL.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'obligatorio cuando STORE_BACKEND=postgres',
    });
  }
  if (val.DRY_RUN) return; // en simulacion no exigimos credenciales reales
  const required: Array<[keyof typeof val, string]> = [
    ['META_WEBHOOK_VERIFY_TOKEN', 'obligatorio (min 8 chars) en modo real'],
    ['META_APP_SECRET', 'obligatorio para validar firmas en modo real'],
    ['IG_ACCESS_TOKEN', 'obligatorio en modo real'],
    ['IG_BUSINESS_ACCOUNT_ID', 'obligatorio en modo real'],
  ];
  for (const [key, msg] of required) {
    const v = val[key];
    if (typeof v !== 'string' || v.trim() === '' || v.startsWith('dev-')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: msg });
    }
  }
  if (val.META_WEBHOOK_VERIFY_TOKEN.length < 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['META_WEBHOOK_VERIFY_TOKEN'],
      message: 'min 8 caracteres',
    });
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // No usamos el logger aqui: si el env esta roto, queremos el error crudo.
  console.error('❌ Variables de entorno invalidas:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
