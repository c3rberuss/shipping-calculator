/**
 * Genera una vista previa estatica con varios escenarios ya renderizados.
 *
 *   node scripts/preview.mjs [salida.html]
 *
 * No forma parte del sitio publicado. Sirve para revisar el diseno de las
 * tarjetas sin levantar el servidor ni interactuar con el formulario.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog, quickboxRates, rates } from '../src/data/index.ts';
import { quoteAll, quoteQuickboxFor, sortOffers } from '../src/engine/index.ts';
import { renderResults } from '../src/ui/render.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src', 'styles', 'app.css'), 'utf8');
const out = process.argv[2] ?? join(ROOT, 'preview.html');

const SCENARIOS = [
  {
    title: 'Caso tipico: ropa de $250, 10 lb',
    note: 'Bajo $300 nadie cobra DAI. El maritimo de Buyex gana.',
    input: { weightLb: 10, declaredValueUsd: 250, categoryId: 'ropa' },
  },
  {
    title: 'Sobre el umbral: laptop de $1,200, 6 lb',
    note: 'Arriba de $300 aplica el DAI, y aqui la laptop esta exenta en ambos.',
    input: { weightLb: 6, declaredValueUsd: 1200, categoryId: 'laptops-computadoras' },
  },
  {
    title: 'Arancel divergente: audifonos de $600, 2 lb',
    note: 'Shop USA los grava al 15% y Buyex al 0%. Paquete liviano, sin maritimo.',
    input: { weightLb: 2, declaredValueUsd: 600, categoryId: 'audifonos' },
  },
  {
    title: 'Categoria sin equivalente: "Otros bienes", $500, 12 lb',
    note: 'Buyex no tiene equivalente: se muestra no disponible, no se oculta.',
    input: { weightLb: 12, declaredValueUsd: 500, categoryId: 'otros' },
  },
  {
    title: 'Falta la categoria con factura de $800',
    note: 'Un solo mensaje en vez de tres tarjetas de error identicas.',
    input: { weightLb: 5, declaredValueUsd: 800, categoryId: null },
  },
  {
    title: 'Paquete pesado: 40 lb de repuestos, $900',
    note: 'Aquí se ve el plan Premium de Quickbox, que cobra menos por libra pero exige suscripción anual.',
    input: { weightLb: 40, declaredValueUsd: 900, categoryId: 'repuestos-vehiculo' },
  },
  {
    title: 'Estado inicial, sin peso',
    note: '',
    input: { weightLb: NaN, declaredValueUsd: NaN, categoryId: null },
  },
];

/**
 * La vista previa si consulta a Quickbox en vivo: es un script de desarrollo y
 * el objetivo es ver las tarjetas como quedan de verdad, con sus tres cargos.
 */
const sections = [];
for (const s of SCENARIOS) {
  const local = quoteAll(s.input, catalog, rates);
  let result = local;

  if (local.offers.length > 0 || local.unavailable.length > 0) {
    // Devuelve una oferta por plan de Quickbox.
    const quickbox = await quoteQuickboxFor(s.input, catalog, {
      rates: quickboxRates,
    });
    if (quickbox.length > 0) {
      result = {
        ...local,
        offers: sortOffers([
          ...local.offers,
          ...quickbox.filter((o) => o.available),
        ]),
        unavailable: [
          ...local.unavailable,
          ...quickbox.filter((o) => !o.available),
        ],
      };
    }
  }

  sections.push(`<section class="scenario">
  <h2 class="scenario__title">${s.title}</h2>
  ${s.note ? `<p class="scenario__note">${s.note}</p>` : ''}
  <div class="results">${renderResults(result)}</div>
</section>`);
}
const body = sections.join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista previa de tarjetas</title>
<style>
${css}
.scenario { max-width: 46rem; margin: 0 auto 3rem; }
.scenario__title { font-size: 1rem; margin: 0 0 .25rem; }
.scenario__note { margin: 0 0 1rem; font-size: .85rem; color: var(--text-muted); }
.results { margin-top: 0; }
.preview-head { max-width: 46rem; margin: 0 auto; padding: 2rem 0 1rem; }
</style>
</head>
<body>
<div class="preview-head">
  <h1>Vista previa de resultados</h1>
  <p class="tagline">Escenarios renderizados con el motor real. Los desgloses estan expandidos solo en la oferta mas barata, igual que en la pagina.</p>
</div>
${body}
</body>
</html>
`;

writeFileSync(out, html);
console.log(`vista previa escrita en ${out}`);
