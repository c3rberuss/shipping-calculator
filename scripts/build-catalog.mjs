/**
 * Genera `src/data/catalog.json` a partir de la curaduria de abajo, resolviendo
 * nombres y tasas contra los catalogos fuente extraidos de cada proveedor.
 *
 * Se ejecuta a mano cuando cambia la curaduria:
 *
 *   node scripts/build-catalog.mjs
 *
 * No corre en build ni en runtime. Si una referencia no existe en el catalogo
 * fuente, el script falla en vez de emitir un mapeo silenciosamente incorrecto.
 *
 * Sobre `match`:
 *   direct      el proveedor tiene una entrada que significa lo mismo.
 *   approximate no la tiene; se usa la mas cercana disponible y la UI debe
 *               advertirlo, porque el arancel puede no ser el que aplicarian.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src', 'data');

const shopusaSource = JSON.parse(
  readFileSync(join(DATA, 'catalogs', 'shopusa-source.json'), 'utf8'),
);
const buyexSource = JSON.parse(
  readFileSync(join(DATA, 'catalogs', 'buyex-source.json'), 'utf8'),
);
const quickboxSource = JSON.parse(
  readFileSync(join(DATA, 'catalogs', 'quickbox-source.json'), 'utf8'),
);

/**
 * Mapeo a los 264 aranceles de Quickbox, por id de categoria unificada.
 *
 * Va aparte de CURATED porque su catalogo se agrego despues (fase 4) y porque
 * asi se lee de un tiro que le falta cobertura en varias categorias donde los
 * otros dos si la tienen: no hay routers, ni drones, ni monitores como tal.
 *
 *   [arancelId, match]  |  null si no hay equivalente utilizable
 */
const QUICKBOX = {
  'laptops-computadoras': ['297.0', 'direct'],
  'celulares-tablets': ['268.0', 'direct'],
  'componentes-pc': ['231.0', 'approximate'],
  perifericos: ['231.0', 'approximate'],
  monitores: ['1607', 'approximate'],
  impresoras: ['291.0', 'direct'],
  redes: ['231.0', 'approximate'],
  smartwatch: ['1602', 'direct'],
  'accesorios-telefono': ['235.0', 'direct'],
  'cables-cargadores': ['260.0', 'direct'],
  'consolas-videojuegos': ['272.0', 'direct'],
  'juegos-fisicos': ['341.0', 'direct'],
  televisores: ['1607', 'direct'],
  audifonos: ['233.0', 'direct'],
  'bocinas-bluetooth': ['752', 'direct'],
  camaras: ['259.0', 'direct'],
  drones: ['776', 'approximate'],
  'instrumentos-musicales': ['746', 'approximate'],
  'equipo-medico': ['281.0', 'direct'],
  suplementos: ['312.0', 'approximate'],
  cosmeticos: ['273.0', 'direct'],
  'cuidado-piel-cabello': ['227.0', 'approximate'],
  'higiene-diaria': ['227.0', 'approximate'],
  perfumes: ['1591', 'direct'],
  'lentes-armazon': ['298.0', 'direct'],
  'lentes-contacto': ['299.0', 'direct'],
  ropa: ['332.0', 'direct'],
  calzado: ['342.0', 'direct'],
  'carteras-maletas': ['308.0', 'direct'],
  'relojes-joyeria': ['324.0', 'direct'],
  bisuteria: ['292.0', 'direct'],
  'sombreros-gorras': ['287.0', 'direct'],
  paraguas: ['870', 'direct'],
  'articulos-deportivos': ['237.0', 'direct'],
  bicicletas: ['253.0', 'direct'],
  'maquinas-ejercicio': ['237.0', 'approximate'],
  'patines-patinetas': ['237.0', 'approximate'],
  'linea-blanca': ['280.0', 'direct'],
  'electrodomesticos-cocina': ['280.0', 'direct'],
  microondas: ['290.0', 'direct'],
  aspiradoras: ['764', 'direct'],
  muebles: ['315.0', 'direct'],
  decoracion: ['243.0', 'direct'],
  'articulos-cocina': ['230.0', 'direct'],
  'ropa-cama': ['330.0', 'direct'],
  juguetes: ['294.0', 'direct'],
  'asientos-bebe': ['293.0', 'approximate'],
  herramientas: ['289.0', 'direct'],
  'repuestos-vehiculo': ['325.0', 'direct'],
  'accesorios-vehiculo': ['229.0', 'direct'],
  'partes-moto': ['327.0', 'direct'],
  papeleria: ['234.0', 'approximate'],
  libros: ['303.0', 'direct'],
  otros: null,
};

const VERSION = '2026-08-13';

/**
 * Curaduria. Cada entrada es:
 *   [id, label, aliases, [shopusaName, match], [buyexOptionValue, match]]
 * `null` en un proveedor significa que no tiene equivalente utilizable.
 */
const CURATED = [
  // --- Tecnologia -----------------------------------------------------------
  ['laptops-computadoras', 'Laptops y computadoras',
    ['laptop', 'macbook', 'notebook', 'pc', 'computadora', 'desktop'],
    ['Laptops, notebooks, servidores y computadoras', 'direct'],
    ['28', 'direct']],

  ['celulares-tablets', 'Celulares y tablets',
    ['celular', 'smartphone', 'iphone', 'android', 'tablet', 'ipad', 'kindle'],
    ['Smartphones, tabletas y lectores electrónicos', 'direct'],
    ['41', 'direct']],

  ['componentes-pc', 'Componentes de PC',
    ['ssd', 'disco duro', 'gpu', 'tarjeta de video', 'cpu', 'procesador', 'ram', 'motherboard'],
    ['SSD, HDD, GPU, CPU, motherboards y memoria RAM', 'direct'],
    ['152', 'direct']],

  ['perifericos', 'Teclado, mouse y periféricos',
    ['teclado', 'mouse', 'webcam', 'microfono', 'periferico'],
    ['Monitores, teclados, mouse, webcams y micrófonos', 'direct'],
    ['147', 'approximate']],

  ['monitores', 'Monitores',
    ['monitor', 'pantalla', 'display', 'hdmi'],
    ['Monitores, teclados, mouse, webcams y micrófonos', 'direct'],
    ['119', 'direct']],

  ['impresoras', 'Impresoras y escáneres',
    ['impresora', 'printer', 'escaner', 'scanner', 'impresora 3d'],
    ['Impresoras de tinta, láser, 3D y escáneres', 'direct'],
    ['87', 'direct']],

  ['redes', 'Routers y equipo de red',
    ['router', 'modem', 'switch', 'antena', 'repetidor', 'wifi'],
    ['Routers, módems, switches, antenas y repetidores', 'direct'],
    ['174', 'direct']],

  ['smartwatch', 'Smartwatches y pulseras de actividad',
    ['smartwatch', 'apple watch', 'reloj inteligente', 'fitbit', 'vr'],
    ['Smartwatches, pulseras de actividad y visores VR/AR', 'direct'],
    ['110', 'direct']],

  ['accesorios-telefono', 'Fundas y accesorios de teléfono',
    ['funda', 'case', 'protector', 'mica', 'accesorio celular', 'mochila laptop'],
    ['Fundas para teléfonos y mochilas para laptops', 'direct'],
    ['109', 'direct']],

  ['cables-cargadores', 'Cables, cargadores y baterías externas',
    ['cable', 'cargador', 'power bank', 'bateria externa', 'usb'],
    ['Cables, cargadores de pared y baterías externas', 'direct'],
    ['29', 'direct']],

  // --- Consolas, audio y video ---------------------------------------------
  ['consolas-videojuegos', 'Consolas de videojuegos',
    ['consola', 'playstation', 'ps5', 'xbox', 'nintendo', 'switch'],
    ['Consolas de videojuegos', 'direct'],
    ['14', 'direct']],

  ['juegos-fisicos', 'Videojuegos físicos',
    ['videojuego', 'juego', 'cartucho', 'disco de juego'],
    ['Cartuchos y discos físicos de videojuegos', 'direct'],
    ['15', 'direct']],

  ['televisores', 'Televisores',
    ['tv', 'televisor', 'smart tv', 'oled', 'qled', 'led'],
    ['Smart TVs LED, OLED y QLED', 'direct'],
    ['43', 'direct']],

  ['audifonos', 'Audífonos',
    ['audifono', 'auricular', 'headphone', 'airpods', 'earbuds'],
    ['Audífonos, barras de sonido y altavoces', 'direct'],
    ['65', 'direct']],

  ['bocinas-bluetooth', 'Bocinas y barras de sonido',
    ['bocina', 'parlante', 'altavoz', 'speaker', 'soundbar', 'barra de sonido'],
    ['Audífonos, barras de sonido y altavoces', 'direct'],
    ['116', 'approximate']],

  ['camaras', 'Cámaras y lentes fotográficos',
    ['camara', 'lente', 'fotografia', 'dslr', 'mirrorless', 'gopro'],
    ['Cámaras, lentes fotográficos y drones con cámara', 'direct'],
    ['72', 'direct']],

  ['drones', 'Drones',
    ['drone', 'dron', 'dji'],
    ['Cámaras, lentes fotográficos y drones con cámara', 'direct'],
    ['115', 'approximate']],

  ['instrumentos-musicales', 'Instrumentos musicales',
    ['guitarra', 'teclado musical', 'piano', 'bateria musical', 'instrumento'],
    ['Instrumentos musicales', 'direct'],
    ['85', 'direct']],

  // --- Salud y cuidado personal --------------------------------------------
  ['equipo-medico', 'Equipo médico y de diagnóstico',
    ['medico', 'oximetro', 'tensiometro', 'termometro', 'nebulizador'],
    ['Medicamentos, vitaminas, fórmulas y equipo de diagnóstico', 'direct'],
    ['84', 'direct']],

  ['suplementos', 'Vitaminas y suplementos',
    ['vitamina', 'suplemento', 'proteina', 'creatina', 'omega'],
    ['Medicamentos, vitaminas, fórmulas y equipo de diagnóstico', 'direct'],
    ['117', 'approximate']],

  ['cosmeticos', 'Cosméticos y maquillaje',
    ['maquillaje', 'cosmetico', 'labial', 'base', 'rimel'],
    ['Cosméticos y maquillaje', 'direct'],
    ['19', 'direct']],

  ['cuidado-piel-cabello', 'Cuidado de la piel y el cabello',
    ['shampoo', 'crema', 'skincare', 'acondicionador', 'serum'],
    ['Cuidado de la piel y el cabello', 'direct'],
    ['21', 'direct']],

  ['higiene-diaria', 'Productos de higiene diaria',
    ['jabon', 'desodorante', 'pasta dental', 'higiene'],
    ['Productos de higiene diaria', 'direct'],
    ['22', 'approximate']],

  ['perfumes', 'Perfumes',
    ['perfume', 'fragancia', 'colonia', 'eau de parfum'],
    ['Perfumes sujetos a restricciones', 'direct'],
    ['111', 'direct']],

  ['lentes-armazon', 'Lentes y armazones',
    ['lentes', 'anteojos', 'gafas', 'armazon', 'sol'],
    ['Aros para lentes', 'direct'],
    ['7', 'direct']],

  ['lentes-contacto', 'Lentes de contacto',
    ['lente de contacto', 'pupilente'],
    ['Lentes de contacto', 'direct'],
    ['162', 'direct']],

  // --- Moda -----------------------------------------------------------------
  ['ropa', 'Ropa',
    ['ropa', 'camisa', 'pantalon', 'vestido', 'chaqueta', 'prenda'],
    ['Prendas de vestir', 'direct'],
    ['4', 'direct']],

  ['calzado', 'Calzado',
    ['zapato', 'tenis', 'sneaker', 'bota', 'sandalia', 'calzado'],
    ['Calzado', 'direct'],
    ['3', 'direct']],

  ['carteras-maletas', 'Carteras, bolsos y maletas',
    ['cartera', 'billetera', 'bolso', 'maleta', 'mochila', 'valija'],
    ['Carteras, billeteras, bolsos y maletas', 'direct'],
    ['91', 'direct']],

  ['relojes-joyeria', 'Relojes y joyería',
    ['reloj', 'joyeria', 'anillo', 'cadena', 'oro', 'plata'],
    ['Relojes tradicionales, joyería y accesorios de moda', 'direct'],
    ['175', 'direct']],

  ['bisuteria', 'Bisutería',
    ['bisuteria', 'accesorio de moda', 'fantasia'],
    ['Relojes tradicionales, joyería y accesorios de moda', 'direct'],
    ['8', 'approximate']],

  ['sombreros-gorras', 'Sombreros, gorras y cascos',
    ['gorra', 'sombrero', 'casco', 'gorro'],
    ['Sombreros y cascos de seguridad', 'direct'],
    ['6', 'direct']],

  ['paraguas', 'Paraguas y sombrillas',
    ['paraguas', 'sombrilla', 'quitasol', 'baston'],
    ['Paraguas, sombrillas, quitasoles y bastones', 'direct'],
    ['100', 'direct']],

  // --- Deporte --------------------------------------------------------------
  ['articulos-deportivos', 'Artículos deportivos',
    ['deporte', 'balon', 'pelota', 'raqueta', 'guante'],
    ['Artículos deportivos', 'direct'],
    ['17', 'direct']],

  ['bicicletas', 'Bicicletas',
    ['bicicleta', 'bici', 'mtb', 'ciclismo'],
    ['Bicicletas sin motor', 'direct'],
    ['13', 'direct']],

  ['maquinas-ejercicio', 'Máquinas de ejercicio',
    ['caminadora', 'trotadora', 'eliptica', 'pesas', 'gimnasio'],
    ['Artículos deportivos', 'direct'],
    ['97', 'approximate']],

  ['patines-patinetas', 'Patines y patinetas',
    ['patineta', 'skate', 'patin', 'scooter'],
    ['Artículos deportivos', 'direct'],
    ['16', 'approximate']],

  // --- Hogar ----------------------------------------------------------------
  ['linea-blanca', 'Línea blanca',
    ['refrigeradora', 'lavadora', 'secadora', 'cocina', 'estufa', 'congelador'],
    ['Línea blanca y electrodomésticos', 'direct'],
    ['40', 'approximate']],

  ['electrodomesticos-cocina', 'Electrodomésticos de cocina',
    ['licuadora', 'cafetera', 'freidora', 'air fryer', 'batidora', 'tostadora'],
    ['Licuadoras, cafeteras y freidoras de aire', 'direct'],
    ['36', 'direct']],

  ['microondas', 'Microondas',
    ['microondas', 'horno de microondas'],
    ['Línea blanca y electrodomésticos', 'direct'],
    ['32', 'approximate']],

  ['aspiradoras', 'Aspiradoras y planchas',
    ['aspiradora', 'plancha', 'robot de limpieza', 'roomba'],
    ['Aspiradoras y planchas de ropa', 'direct'],
    ['48', 'direct']],

  ['muebles', 'Muebles',
    ['mueble', 'silla', 'mesa', 'escritorio', 'sofa', 'cama'],
    ['Muebles y decoración', 'direct'],
    ['70', 'direct']],

  ['decoracion', 'Decoración',
    ['adorno', 'decoracion', 'cuadro', 'espejo', 'lampara'],
    ['Muebles y decoración', 'direct'],
    ['59', 'direct']],

  ['articulos-cocina', 'Artículos de cocina y mesa',
    ['olla', 'sarten', 'vajilla', 'cuchillo', 'utensilio'],
    ['Artículos para cocina y mesa', 'direct'],
    ['9', 'direct']],

  ['ropa-cama', 'Ropa de cama y toallas',
    ['sabana', 'edredon', 'almohada', 'toalla', 'colcha'],
    ['Muebles y decoración', 'approximate'],
    ['77', 'direct']],

  // --- Infantil -------------------------------------------------------------
  ['juguetes', 'Juguetes',
    ['juguete', 'lego', 'muneca', 'peluche', 'figura'],
    ['Juguetes y artículos infantiles', 'direct'],
    ['12', 'direct']],

  ['asientos-bebe', 'Asientos y sillas para bebé',
    ['asiento de bebe', 'silla de carro', 'car seat', 'coche', 'carriola'],
    ['Juguetes y artículos infantiles', 'approximate'],
    ['129', 'direct']],

  // --- Herramientas y vehiculos --------------------------------------------
  ['herramientas', 'Herramientas',
    ['herramienta', 'taladro', 'destornillador', 'llave', 'bricolaje'],
    ['Herramientas de bricolaje', 'direct'],
    ['55', 'direct']],

  ['repuestos-vehiculo', 'Repuestos mecánicos de vehículo',
    ['repuesto', 'auto', 'carro', 'motor', 'freno', 'suspension'],
    ['Repuestos mecánicos para vehículos', 'direct'],
    ['78', 'direct']],

  ['accesorios-vehiculo', 'Accesorios y luces de vehículo',
    ['accesorio de carro', 'halogeno', 'luces', 'faro', 'tapete'],
    ['Accesorios para vehículos', 'direct'],
    ['86', 'approximate']],

  ['partes-moto', 'Repuestos y accesorios de motocicleta',
    ['moto', 'motocicleta', 'repuesto de moto'],
    ['Repuestos para motocicletas', 'direct'],
    ['125', 'direct']],

  // --- Oficina y otros ------------------------------------------------------
  ['papeleria', 'Papelería y artículos escolares',
    ['papeleria', 'cuaderno', 'lapiz', 'escolar', 'oficina'],
    ['Papelería y artículos escolares o de oficina', 'direct'],
    ['18', 'direct']],

  ['libros', 'Libros',
    ['libro', 'texto', 'novela', 'manual'],
    ['Libros', 'direct'],
    ['67', 'direct']],

  ['otros', 'Otros bienes',
    ['otro', 'varios', 'general'],
    ['Otros bienes', 'direct'],
    null],
];

// ---------------------------------------------------------------------------

const shopusaByName = new Map(shopusaSource.categories.map((c) => [c.name, c]));
const buyexByValue = new Map(buyexSource.categories.map((c) => [c.optionValue, c]));
const quickboxByArancelId = new Map(
  quickboxSource.categories.map((c) => [c.arancelId, c]),
);

const errors = [];
const categories = [];

for (const [id, label, aliases, shopusa, buyex] of CURATED) {
  const entry = { id, label, aliases, mappings: {} };

  if (shopusa === null) {
    entry.mappings.shopusa = null;
  } else {
    const [name, match] = shopusa;
    const found = shopusaByName.get(name);
    if (!found) {
      errors.push(`[${id}] Shop USA: no existe la categoria "${name}"`);
    } else {
      entry.mappings.shopusa = { name: found.name, daiRate: found.daiRate, match };
    }
  }

  if (buyex === null) {
    entry.mappings.buyex = null;
  } else {
    const [optionValue, match] = buyex;
    const found = buyexByValue.get(optionValue);
    if (!found) {
      errors.push(`[${id}] Buyex: no existe la opcion ${optionValue}`);
    } else {
      entry.mappings.buyex = {
        optionValue: found.optionValue,
        name: found.name,
        daiRate: found.daiRate,
        match,
      };
    }
  }

  if (!(id in QUICKBOX)) {
    errors.push(`[${id}] falta la entrada en el mapeo de Quickbox`);
    entry.mappings.quickbox = null;
  } else if (QUICKBOX[id] === null) {
    entry.mappings.quickbox = null;
  } else {
    const [arancelId, match] = QUICKBOX[id];
    const found = quickboxByArancelId.get(arancelId);
    if (!found) {
      errors.push(`[${id}] Quickbox: no existe el arancel ${arancelId}`);
    } else {
      entry.mappings.quickbox = {
        arancelId: found.arancelId,
        name: found.name,
        daiRate: found.daiRate,
        match,
      };
    }
  }

  categories.push(entry);
}

const ids = categories.map((c) => c.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) errors.push(`ids duplicados: ${[...new Set(dupes)].join(', ')}`);

if (errors.length > 0) {
  console.error('Errores en la curaduria:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

const out = {
  version: VERSION,
  note:
    'Catalogo unificado. Cada categoria mapea al equivalente nativo de cada proveedor y conserva SU tasa de DAI, no una unificada: los tres asignan aranceles distintos al mismo articulo. Generado por scripts/build-catalog.mjs.',
  categories,
};

writeFileSync(join(DATA, 'catalog.json'), JSON.stringify(out, null, 2) + '\n');

// Resumen para revisar la curaduria de un vistazo.
const approx = categories.filter((c) =>
  Object.values(c.mappings).some((m) => m && m.match === 'approximate'),
);
function ratesOf(c) {
  return ['shopusa', 'buyex', 'quickbox']
    .map((p) => c.mappings[p])
    .filter(Boolean)
    .map((m) => m.daiRate);
}

const divergent = categories.filter((c) => new Set(ratesOf(c)).size > 1);
const sinQuickbox = categories.filter((c) => !c.mappings.quickbox);

const pct = (m) => (m ? `${(m.daiRate * 100).toFixed(0)}%`.padStart(4) : '   -');

console.log(`catalog.json escrito: ${categories.length} categorias`);
console.log(`  mapeos aproximados     : ${approx.length}`);
console.log(`  DAI divergente         : ${divergent.length}`);
console.log(`  sin cobertura Quickbox : ${sinQuickbox.length}`);
console.log('\nCategorias donde los proveedores NO coinciden en el arancel:');
console.log(`  ${'categoria'.padEnd(38)} ShopUSA Buyex  Quickbox`);
for (const c of divergent) {
  console.log(
    `  ${c.label.padEnd(38)}${pct(c.mappings.shopusa)}  ${pct(
      c.mappings.buyex,
    )}   ${pct(c.mappings.quickbox)}`,
  );
}
