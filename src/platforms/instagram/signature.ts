import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Valida la firma X-Hub-Signature-256 que Meta envia en cada webhook.
 * Se calcula HMAC-SHA256 del cuerpo CRUDO (bytes exactos) con el App Secret.
 *
 * Importante: hay que usar el Buffer crudo, no el JSON re-serializado, o la
 * firma nunca coincidira. Por eso el server guarda req.rawBody.
 */
export function verifyInstagramSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
  if (!signatureHeader) {
    throw new Error('Falta la cabecera X-Hub-Signature-256');
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Firma de webhook invalida');
  }
}
