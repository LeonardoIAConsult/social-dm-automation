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
});

const schema = base.superRefine((val, ctx) => {
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
