import 'dotenv/config';
import { z } from 'zod';

/**
 * Validacion estricta de variables de entorno al arrancar.
 * Si falta algo critico, el proceso muere temprano con un mensaje claro
 * en vez de fallar a mitad de un webhook.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8, 'Usa un verify token de al menos 8 caracteres'),
  META_APP_SECRET: z.string().min(1, 'META_APP_SECRET es obligatorio para validar firmas'),

  IG_ACCESS_TOKEN: z.string().min(1, 'IG_ACCESS_TOKEN es obligatorio'),
  IG_BUSINESS_ACCOUNT_ID: z.string().min(1, 'IG_BUSINESS_ACCOUNT_ID es obligatorio'),
  GRAPH_API_VERSION: z.string().default('v21.0'),

  FOLLOW_GATE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // No usamos el logger aqui: si el env esta roto, queremos el error crudo.
  console.error('❌ Variables de entorno invalidas:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
