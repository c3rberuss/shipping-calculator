/**
 * Muestreo del cotizador de Quickbox para derivar su formula.
 *
 *   node scripts/sample-quickbox.mjs [salida.json]
 *
 * Quickbox calcula del lado del servidor: su cliente solo envia
 * `{valor, peso, arancel_id, pais_id, plan_id, cliente_id}` y renderiza la
 * respuesta. No hay formula que replicar en su bundle, asi que se deduce
 * observando la salida sobre una matriz de entradas.
 *
 * Este script NO forma parte del sitio publicado. Se corre a mano cuando se
 * sospecha que las tarifas cambiaron, y su salida alimenta `quickbox.json` y
 * los casos de prueba.
 *
 * Se hace en serie y con pausa entre consultas: es la API de un tercero y no
 * hay motivo para golpearla en paralelo.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'quickbox-samples.json');

const BASE = 'https://node.qs.gt';
const PAIS_SV = '3';
/** Plan "Estandar": paga por lo que traes, sin suscripcion. */
const PLAN_ESTANDAR = '18';
const PAUSA_MS = 350;

/** Un arancel por cada tasa que ofrece su catalogo para El Salvador. */
const ARANCELES = {
  0: { id: '228.0', desc: 'Accesorio de Cámara' },
  1: { id: '325.0', desc: 'Repuestos de Carro' },
  5: { id: '231.0', desc: 'Accesorio de Computacion' },
  10: { id: '744', desc: 'Abrelatas' },
  15: { id: '227.0', desc: 'Accesorio de Aseo Personal' },
  30: { id: '240.0', desc: 'Accesorios de Arma' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cotizar({ peso, valor, arancelPct }) {
  const arancel = ARANCELES[arancelPct];
  const body = new URLSearchParams({
    valor: String(valor),
    peso: String(peso),
    arancel_id: arancel.id,
    pais_id: PAIS_SV,
    plan_id: PLAN_ESTANDAR,
    cliente_id: '',
  });

  const res = await fetch(`${BASE}/cotizador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} con peso=${peso} valor=${valor}`);

  const json = await res.json();
  if (!json.result) throw new Error(`API: ${json.message}`);

  const r = json.records;
  const por = (lista, tipo) =>
    lista.find((x) => x.tipo_gasto === tipo)?.valor_numerico ?? 0;

  return {
    peso,
    valor,
    arancelPct,
    arancelId: arancel.id,
    costoLibra: Number(r.costo_libra),
    // tipo_gasto: 2 flete, 4 gestion aeropuerto, 18 cobro administrativo
    flete: por(r.servicios, 2),
    gestionAeropuerto: por(r.servicios, 4),
    cobroAdministrativo: por(r.servicios, 18),
    otrosServicios: r.servicios
      .filter((x) => ![2, 4, 18].includes(x.tipo_gasto))
      .map((x) => ({ tipo: x.tipo_gasto, nombre: x.nombre, valor: x.valor_numerico })),
    dai: por(r.impuestos, 9),
    iva: por(r.impuestos, 10),
    otrosImpuestos: r.impuestos
      .filter((x) => ![9, 10].includes(x.tipo_gasto))
      .map((x) => ({ tipo: x.tipo_gasto, nombre: x.nombre, valor: x.valor_numerico })),
    totalServicios: Number(r.total_servicios),
    totalImpuestos: Number(r.total_impuestos),
    total: Number(r.total_dolares),
    tasaImpuesto: r.tasa_impuesto,
  };
}

/**
 * Diseno del muestreo: en vez de un producto cartesiano gigante, cada bloque
 * aisla una variable para que la formula se lea directo de la serie.
 */
const PLAN = [
  // A: solo el peso cambia -> tarifa por libra y regla de redondeo.
  ...[0.1, 0.5, 0.9, 1, 1.1, 1.5, 2, 5, 5.5, 6, 10, 20, 50].map((peso) => ({
    bloque: 'peso',
    peso,
    valor: 100,
    arancelPct: 0,
  })),

  // B: solo el valor cambia, arancel 0% -> base gravable, IVA y umbral.
  ...[0, 50, 100, 199, 200, 201, 299, 300, 301, 500, 1000, 2000].map((valor) => ({
    bloque: 'valor',
    peso: 5,
    valor,
    arancelPct: 0,
  })),

  // C: solo el arancel cambia, sobre el umbral -> como se calcula el DAI.
  ...[0, 1, 5, 10, 15, 30].map((arancelPct) => ({
    bloque: 'arancel',
    peso: 5,
    valor: 500,
    arancelPct,
  })),

  // D: bajo el umbral con arancel alto -> confirma la exencion.
  ...[0, 15, 30].map((arancelPct) => ({
    bloque: 'exencion',
    peso: 5,
    valor: 250,
    arancelPct,
  })),

  // E: combinaciones sueltas para validar la formula derivada.
  { bloque: 'validacion', peso: 1, valor: 100, arancelPct: 0 },
  { bloque: 'validacion', peso: 3.7, valor: 425.5, arancelPct: 15 },
  { bloque: 'validacion', peso: 12, valor: 899, arancelPct: 10 },
  { bloque: 'validacion', peso: 25, valor: 1200, arancelPct: 5 },
  { bloque: 'validacion', peso: 0.3, valor: 45, arancelPct: 15 },
  { bloque: 'validacion', peso: 8, valor: 300, arancelPct: 30 },
  { bloque: 'validacion', peso: 40, valor: 2500, arancelPct: 1 },
];

const muestras = [];
for (const [i, caso] of PLAN.entries()) {
  const r = await cotizar(caso);
  muestras.push({ bloque: caso.bloque, ...r });
  process.stdout.write(
    `\r  ${i + 1}/${PLAN.length} muestras`.padEnd(40),
  );
  await sleep(PAUSA_MS);
}
process.stdout.write('\n');

writeFileSync(
  OUT,
  JSON.stringify(
    {
      sampledFrom: `${BASE}/cotizador`,
      paisId: PAIS_SV,
      planId: PLAN_ESTANDAR,
      planNombre: 'Estandar',
      aranceles: ARANCELES,
      muestras,
    },
    null,
    2,
  ) + '\n',
);

console.log(`${muestras.length} muestras escritas en ${OUT}`);
