import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanel, mensajeDelPanel } from '../src/server/panel/vista.js';

/**
 * La cara del panel. Se prueba el HTML que sale, porque las reglas de la Tarea 5
 * son verificables leyendolo: una sola columna, lo importante arriba, todo en
 * español y sin scripts.
 *
 * El "no hay desplazamiento horizontal a 360 px" se comprueba en navegador real
 * (capa L2 de la verificacion): aqui se comprueba lo que lo hace posible.
 */

const base = {
  cuenta: 'tienda-de-marcela',
  conexion: { tipo: 'sin-datos' } as const,
  campana: 'pendiente' as const,
  resultados: 'pendiente' as const,
};

/** Posicion del primer bloque de cada seccion, para comprobar el ORDEN. */
const posicion = (html: string, texto: string) => html.indexOf(texto);

test('lo primero que se ve es el estado de la automatizacion', async () => {
  const html = renderPanel({ ...base, conexion: { tipo: 'activo' } });

  const estado = posicion(html, 'Tu automatización está activa');
  const campana = posicion(html, 'Tu palabra clave');
  const resultados = posicion(html, 'Tus resultados');

  assert.ok(estado > 0, 'tiene que estar el semaforo');
  assert.ok(estado < campana, 'el estado va ANTES que la campana');
  assert.ok(campana < resultados, 'y los resultados al final');
});

test('la pagina esta pensada para el telefono', async () => {
  const html = renderPanel(base);

  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /max-width:560px/, 'una sola columna angosta');
  assert.match(html, /@media \(max-width:380px\)/, 'ajuste para pantallas chicas');
});

test('no lleva ni un script: la pagina funciona sin JavaScript', async () => {
  const html = renderPanel({
    ...base,
    conexion: { tipo: 'activo', ultimaEntrega: new Date() },
    campana: { palabra: 'GUIA', enlace: 'https://ejemplo.com/g.pdf' },
    resultados: { comentaron: 3, recibieron: 2, noSeguian: 1 },
  });

  assert.ok(!/<script/i.test(html), 'la politica de seguridad del sitio los bloquea igual');
  assert.ok(!/onclick|onload|javascript:/i.test(html), 'tampoco manejadores en linea');
});

test('el estado activo dice cuando fue la ultima entrega', async () => {
  const html = renderPanel({
    ...base,
    conexion: { tipo: 'activo', cuentaInstagram: '@marcela', ultimaEntrega: new Date('2026-09-10T15:30:00Z') },
  });

  assert.match(html, /Última entrega:/);
  assert.match(html, /@marcela/);
});

test('sin entregas todavia, no muestra un cero frio sino que hacer', async () => {
  const html = renderPanel({ ...base, conexion: { tipo: 'activo' } });

  assert.match(html, /Todavía no has entregado nada/);
  assert.match(html, /en cuanto alguien comente tu palabra/i);
});

test('cuando algo se rompe, lo dice en llano y da UN boton', async () => {
  const html = renderPanel({
    ...base,
    conexion: {
      tipo: 'atencion',
      quePaso: 'Tu Instagram se desconectó y por eso no está respondiendo.',
      accion: { texto: 'Reconectar Instagram', url: '/panel/reconectar' },
    },
  });

  assert.match(html, /Hay algo que arreglar/);
  assert.match(html, /Tu Instagram se desconectó/);
  assert.match(html, /Reconectar Instagram/);
  // REGLA AFINADA (Tarea 7): ahora el bloque de la campana tambien tiene su
  // accion, asi que la regla se mide donde importa: dentro del bloque de estado
  // hay UNA sola accion, para que quien ve el problema no tenga que elegir.
  const bloqueDeEstado = html.slice(
    html.indexOf('Hay algo que arreglar'),
    html.indexOf('Tu palabra clave'),
  );
  assert.equal(
    (bloqueDeEstado.match(/class="boton"/g) ?? []).length,
    1,
    'el bloque del problema ofrece una sola salida',
  );
});

test('ni una palabra tecnica en la cara del cliente', async () => {
  const html = renderPanel({
    ...base,
    conexion: {
      tipo: 'atencion',
      quePaso: 'Tu Instagram se desconectó y por eso no está respondiendo.',
      accion: { texto: 'Reconectar Instagram', url: '/panel/reconectar' },
    },
    campana: { palabra: 'GUIA', enlace: 'https://ejemplo.com/g.pdf' },
    resultados: { comentaron: 3, recibieron: 2, noSeguian: 1 },
  });
  // Solo el texto visible: las clases y los atributos no los lee el cliente.
  const visible = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();

  for (const jerga of ['token', 'webhook', 'api', 'error 4', 'null', 'undefined', 'backend']) {
    assert.ok(!visible.includes(jerga), `la palabra "${jerga}" no puede llegarle al cliente`);
  }
});

test('lo que viene de la base se escapa antes de llegar al HTML', async () => {
  const html = renderPanel({
    ...base,
    cuenta: '<img src=x onerror=alert(1)>',
    campana: { palabra: '"><script>alert(1)</script>', enlace: 'https://ok.com' },
  });

  assert.ok(!html.includes('<img src=x'), 'el nombre de la cuenta no puede inyectar HTML');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'ni la palabra clave');
});

test('los mensajes sueltos usan la misma cara', async () => {
  const html = mensajeDelPanel('Enlace no válido', 'Este enlace ya no sirve', 'Pide uno nuevo.');

  assert.match(html, /InboxPilot/);
  assert.match(html, /Este enlace ya no sirve/);
  assert.match(html, /max-width:560px/);
});
