import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * ¿Esta direccion apunta a la red de adentro?
 *
 * Existe porque el panel abre enlaces que escribe el cliente. Sin este filtro,
 * cualquiera con acceso al panel puede hacer que NUESTRO servidor pida cosas de
 * la red interna: la base de datos, el endpoint de metadatos del proveedor de
 * nube (que reparte credenciales), o los puertos de otros servicios. Eso se
 * llama SSRF y es de las formas mas baratas de entrar a una infraestructura.
 *
 * Ojo con la trampa: exigir `https://` NO alcanza. Un host publico puede
 * responder con una redireccion a `http://127.0.0.1:5432`, y quien sigue las
 * redirecciones automaticamente termina pidiendola. Por eso las redirecciones
 * se siguen a mano y cada salto se vuelve a revisar.
 */

/** Rangos que nunca deben alcanzarse desde un enlace escrito por un cliente. */
function esIpDeAdentro(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unicas locales
    if (v6.startsWith('fe80')) return true; // enlace local
    // IPv4 disfrazada de IPv6 (::ffff:127.0.0.1)
    const dentro = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dentro?.[1]) return esIpDeAdentro(dentro[1]);
    return false;
  }

  const partes = ip.split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // no la entendemos: se trata como peligrosa
  }
  const [a, b] = partes as [number, number, number, number];
  if (a === 0 || a === 127) return true; // esta maquina
  if (a === 10) return true; // privada
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 169 && b === 254) return true; // enlace local: metadatos de la nube
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
  if (a >= 224) return true; // multicast y reservadas
  return false;
}

/** Nombres que ni vale la pena resolver. */
const NOMBRES_DE_ADENTRO = /^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i;

export type Veredicto = { permitido: true } | { permitido: false; motivo: string };

/**
 * ¿Se puede pedir esta direccion sin salir de internet publica?
 *
 * @param resolver inyectable para poder probarlo sin depender del DNS real.
 */
export async function esDireccionPublica(
  url: URL,
  resolver: (host: string) => Promise<Array<{ address: string }>> = (host) =>
    lookup(host, { all: true }),
): Promise<Veredicto> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { permitido: false, motivo: 'protocolo no permitido' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (NOMBRES_DE_ADENTRO.test(host)) return { permitido: false, motivo: 'nombre interno' };

  // Si ya es una IP, no hay que resolver nada.
  if (isIP(host)) {
    return esIpDeAdentro(host)
      ? { permitido: false, motivo: 'direccion interna' }
      : { permitido: true };
  }

  let direcciones: Array<{ address: string }>;
  try {
    direcciones = await resolver(host);
  } catch {
    return { permitido: false, motivo: 'no se pudo resolver el nombre' };
  }
  if (direcciones.length === 0) return { permitido: false, motivo: 'sin direcciones' };

  // TODAS tienen que ser publicas: basta una interna para rechazar (un atacante
  // puede publicar un nombre que resuelva a varias, publica e interna a la vez).
  for (const { address } of direcciones) {
    if (esIpDeAdentro(address)) return { permitido: false, motivo: 'resuelve a red interna' };
  }
  return { permitido: true };
}
