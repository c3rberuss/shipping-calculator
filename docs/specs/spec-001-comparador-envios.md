# SPEC-001: Comparador de costos de envío de casilleros USA → El Salvador

- **Estado:** Borrador
- **Fecha:** 2026-08-13
- **Ámbito:** Sitio web público estático

---

## 1. Resumen y Contexto

### Problema

Las restricciones de envío directo hacia El Salvador obligan a usar servicios de casillero: el usuario compra en línea con una dirección en Estados Unidos y el proveedor se encarga de la logística de importación. Existen al menos tres proveedores usados habitualmente (Quickbox USA, Shop USA y Buyex) y los tres publican un cotizador en línea, pero cada uno vive en un sitio distinto, con formularios, catálogos de categorías y reglas de cálculo diferentes.

Comparar cuesta abrir tres pestañas, reingresar los mismos datos tres veces e interpretar tres desgloses que ni siquiera usan la misma base gravable. El resultado es que en la práctica no se compara.

### Solución

Un sitio estático, público y sin backend que recibe **una sola vez** los datos del paquete (peso, valor declarado, categoría) y muestra las ofertas de los tres proveedores lado a lado, ordenadas por costo total, con desglose expandible.

Shop USA y Buyex se calculan íntegramente en el navegador, contra fórmulas replicadas de su propio código y tarifas versionadas en el repositorio. Quickbox es la excepción: calcula del lado del servidor y se consulta en vivo contra su API, con caché, porque derivar su fórmula produciría números equivocados en los bordes (ver §3.6).

### Métrica de éxito

Una sola consulta reemplaza tres. El usuario ingresa los datos del paquete una vez y ve las ofertas comparadas sin abrir ningún sitio de proveedor.

### Alcance

**Dentro (MVP):**

- Formulario único: peso en libras, valor declarado en USD, categoría de mercadería.
- Motor de cálculo local para Shop USA y Buyex; consulta en vivo con caché para Quickbox.
- Resultados como lista de **ofertas** (no de proveedores), ordenadas por costo total ascendente.
- Desglose expandible por oferta: flete, base gravable, DAI, IVA, seguro y flete aduanero teórico cuando apliquen.
- Rango de tiempo de entrega por oferta, versionado manualmente y etiquetado como referencial.
- Fecha de vigencia de tarifas visible en cada oferta.
- Enlace directo al cotizador oficial del proveedor desde cada oferta.
- Aviso global de que los montos son estimaciones no vinculantes.
- Cotización compartible por URL (inputs serializados en el query string).
- Historial local de cotizaciones en `localStorage`.
- Despliegue como sitio estático en GitHub Pages.

**Fuera (explícitamente):**

- Peso volumétrico y campos de dimensiones. Shop USA tiene una regla volumétrica documentada (ver §4.6) que queda registrada pero no implementada.
- Job de CI que valide periódicamente el motor contra los cotizadores reales.
- Cuentas de usuario, autenticación y persistencia en servidor.
- Contratación, pago o generación de guías. El sitio compara, no intermedia.
- Proveedores distintos a los tres nombrados.
- Países destino distintos a El Salvador.
- Cotización de múltiples artículos en una misma comparación. El MVP cotiza un paquete.

---

## 2. Historias de Usuario y Casos de Uso

- **US-1:** Como comprador en línea, quiero ingresar peso, valor y categoría una sola vez y ver el costo de los tres proveedores, para elegir el más barato sin abrir tres sitios.
- **US-2:** Como comprador, quiero expandir una oferta y ver cuánto es flete y cuánto es impuesto, para entender por qué un proveedor sale más caro que otro con los mismos datos.
- **US-3:** Como comprador con un paquete pesado, quiero ver la opción marítima de Buyex como una oferta independiente de la aérea, para decidir si el ahorro justifica la espera.
- **US-4:** Como comprador, quiero saber de cuándo son las tarifas y poder abrir el cotizador oficial, para confirmar antes de comprometerme.
- **US-5:** Como comprador, quiero compartir por WhatsApp el enlace de una comparación concreta, para consultarla con alguien más.
- **US-6:** Como usuario recurrente, quiero ver mis cotizaciones anteriores y recargarlas, para no reescribir los datos de compras similares.

### Casos de uso principales

**CU-1 — Cotizar (flujo feliz)**

1. El usuario ingresa peso, valor declarado y categoría.
2. El motor calcula todas las ofertas elegibles al momento (sin botón de envío; el cálculo es reactivo).
3. Se renderiza la lista ordenada por costo total ascendente, con la más barata destacada.
4. La cotización se agrega al historial local y la URL se actualiza con los inputs.

**CU-2 — Comparar desgloses**

1. El usuario expande dos ofertas.
2. Ve la base gravable de cada una (valor de factura contra CIF) y el detalle de DAI e IVA.
3. Comprende que la diferencia proviene de reglas fiscales distintas, no de un error de cálculo.

**CU-3 — Recuperar cotización compartida**

1. El usuario abre una URL con parámetros de cotización.
2. El formulario se prellena y los resultados se muestran sin interacción adicional.

---

## 3. Especificación Técnica

### 3.1 Stack y despliegue

- **Framework:** Astro con TypeScript. Se elige por generar HTML estático con JavaScript mínimo, enviando interactividad solo en la isla de cotización.
- **Salida:** build estático puro. Sin SSR, sin funciones serverless, sin variables de entorno en runtime.
- **Hosting:** GitHub Pages con dominio propio (`ship.josueamaya.dev`), servido desde la raíz. `site` y `base` están fijos en `astro.config.mjs`.
- **CI:** GitHub Actions solo para build y publicación en cada push a la rama principal.

### 3.2 Arquitectura del motor de cálculo

El núcleo son funciones puras sin dependencias de DOM, ubicadas en `src/engine/`. Shop USA y Buyex además no tocan la red, así que se prueban con fixtures deterministas. El motor de Quickbox sí hace una petición, y recibe `fetch` inyectado para poder probarlo con respuestas capturadas de su API real.

```
src/
  engine/
    types.ts              Tipos compartidos
    index.ts              quoteAll(): orquesta los proveedores
    providers/
      shopusa.ts          Fórmula replicada
      buyex.ts            Fórmula replicada
      quickbox.ts         Consulta en vivo a su API
    quote-cache.ts        Cache de las respuestas en vivo
  data/
    catalog.json          Catálogo unificado de categorías + mapeos
    rates/
      shopusa.json
      buyex.json
      quickbox.json
  components/             Islas de UI (Astro/TS)
  pages/
    index.astro
```

Cada proveedor implementa el mismo contrato. Un proveedor puede devolver cero, una o varias ofertas (Buyex devuelve dos: aérea y marítima).

```ts
export interface ProviderEngine {
  readonly id: ProviderId;
  quote(input: QuoteInput, rates: ProviderRates, catalog: Catalog): Offer[];
}
```

### 3.3 Contratos

```ts
type ProviderId = 'quickbox' | 'shopusa' | 'buyex';
type ShippingMode = 'aereo' | 'maritimo';
type TaxableBaseKind = 'invoice' | 'cif';
type Confidence = 'exact' | 'live' | 'derived';

interface QuoteInput {
  /** Peso real en libras. > 0. */
  weightLb: number;
  /** Valor declarado de la mercadería en USD. >= 0. */
  declaredValueUsd: number;
  /** Id del catálogo unificado. null si el usuario no seleccionó categoría. */
  categoryId: string | null;
}

interface Offer {
  /** Identificador estable: `${providerId}:${mode}`. */
  offerId: string;
  providerId: ProviderId;
  providerName: string;
  mode: ShippingMode;
  /** Costo total de traer el paquete, sin incluir el valor de la compra. */
  totalUsd: number;
  breakdown: OfferBreakdown;
  /** Rango referencial en días hábiles. null si no hay dato registrado. */
  transitDays: { min: number; max: number } | null;
  confidence: Confidence;
  /** ISO 8601 (YYYY-MM-DD). Fecha en que se verificaron las tarifas. */
  ratesVerifiedAt: string;
  officialQuoterUrl: string;
  /** Advertencias legibles: exclusiones, supuestos, redondeos. */
  notes: string[];
}

interface OfferBreakdown {
  billableWeightLb: number;
  ratePerLbUsd: number;
  freightUsd: number;
  taxableBaseKind: TaxableBaseKind;
  taxableBaseUsd: number;
  /** Componentes del CIF. 0 en proveedores que gravan sobre factura. */
  insuranceUsd: number;
  customsFreightUsd: number;
  daiRate: number;   // fracción, p. ej. 0.15
  daiUsd: number;
  vatRate: number;   // fracción, p. ej. 0.13
  vatUsd: number;
  taxesTotalUsd: number;
}

/** Una oferta que no se pudo calcular no se omite en silencio. */
interface UnavailableOffer {
  offerId: string;
  providerId: ProviderId;
  providerName: string;
  mode: ShippingMode;
  reason: UnavailableReason;
  officialQuoterUrl: string;
}

type UnavailableReason =
  | 'below-minimum-weight'      // p. ej. marítimo Buyex con peso < 8 lb
  | 'category-required'         // el proveedor necesita categoría para este valor
  | 'category-not-mapped'       // la categoría del catálogo no tiene equivalente
  | 'mode-not-offered';

interface QuoteResult {
  offers: Offer[];              // ordenadas por totalUsd ascendente
  unavailable: UnavailableOffer[];
  input: QuoteInput;
}

export function quoteAll(input: QuoteInput): QuoteResult;
```

### 3.4 Modelo de datos: catálogo unificado

El problema central del comparador es que cada proveedor tiene su propio catálogo: Shop USA expone 63 categorías, Buyex expone 167, y Quickbox resuelve aranceles contra su API. No son equivalentes ni en granularidad ni en nomenclatura.

Se define un catálogo propio, curado, que actúa como fuente única para el usuario y se mapea a cada proveedor. El usuario elige **una vez**. La versión implementada tiene **54 categorías**.

```jsonc
{
  "version": "2026-08-13",
  "categories": [
    {
      "id": "laptops-computadoras",
      "label": "Laptops y computadoras",
      "aliases": ["laptop", "macbook", "notebook", "pc", "computadora"],
      "mappings": {
        "shopusa": {
          "name": "Laptops, notebooks, servidores y computadoras",
          "daiRate": 0,
          "match": "direct"
        },
        "buyex": {
          "optionValue": "28",
          "name": "COMPUTADORAS Y ACCESORIOS(EXCEPTO CABLES)",
          "daiRate": 0,
          "match": "direct"
        },
        "quickbox": null
      }
    }
  ]
}
```

Reglas del mapeo:

- Cada categoría del catálogo unificado **debe** tener mapeo para los tres proveedores, o declarar explícitamente `null` para el que no la cubra. Un `null` produce una `UnavailableOffer` con razón `category-not-mapped`, nunca un cálculo silencioso con tasa cero.
- El `daiRate` se guarda replicado por proveedor, no unificado, porque los tres asignan aranceles distintos al mismo artículo. Esto no es un caso marginal: **en 20 de las 54 categorías Shop USA y Buyex no coinciden en el arancel**, y las diferencias llegan a ser de 15 puntos. Ejemplos reales: audífonos es 15% en Shop USA y 0% en Buyex; monitores es 0% y 15%; microondas es 15% y 5%; herramientas es 10% y 0%.
- Cada mapeo declara además un `match`:
  - `direct`: el proveedor tiene una entrada que significa lo mismo.
  - `approximate`: no la tiene y se usa la más cercana disponible. La oferta lo advierte en sus `notes`, porque el arancel puede no ser el que aplicarían. En la versión implementada, 13 de 54 categorías tienen al menos un mapeo aproximado.
- El catálogo se genera con `scripts/build-catalog.mjs`, que resuelve nombres y tasas contra los catálogos extraídos de cada proveedor (`src/data/catalogs/*-source.json`) y falla si una referencia no existe. La curaduría está en ese script; `catalog.json` es producto, no fuente.
- Los catálogos de origen se versionan íntegros (64 entradas de Shop USA, 167 de Buyex) para trazabilidad y para que las pruebas puedan validar cada mapeo contra ellos.

Una inconsistencia detectada en el origen: en el catálogo de Buyex la etiqueta de `CALZADO` dice "15% DAI" pero su atributo `data-dai` es `14`, y es ese el valor que su calculadora usa. Se replica el 14 y una prueba fija la discrepancia para detectar si algún día la corrigen.

### 3.5 Modelo de datos: tarifas

Un archivo por proveedor bajo `src/data/rates/`. Todos llevan `verifiedAt` y `sourceUrl` para trazabilidad.

**`shopusa.json`**

```jsonc
{
  "providerId": "shopusa",
  "providerName": "Shop USA",
  "verifiedAt": "2026-08-13",
  "sourceUrl": "https://shopusa.la/",
  "officialQuoterUrl": "https://shopusa.la/",
  "confidence": "exact",
  "modes": {
    "aereo": {
      "weightRounding": "ceil",
      "tiers": [
        { "maxLb": 5,    "ratePerLb": 4.99 },
        { "maxLb": null, "ratePerLb": 4.40 }
      ],
      "transitDays": { "min": null, "max": null }
    }
  },
  "vatRate": 0.13,
  "taxableBaseKind": "invoice",
  "daiThresholdUsd": 300,
  "daiRequiresCategory": true
}
```

**`buyex.json`**

```jsonc
{
  "providerId": "buyex",
  "providerName": "Buyex",
  "verifiedAt": "2026-08-13",
  "sourceUrl": "https://comprabuyex.com/cotizarconbuyex/",
  "officialQuoterUrl": "https://comprabuyex.com/cotizarconbuyex/",
  "confidence": "exact",
  "serviceType": "prealerta",
  "modes": {
    "aereo":    { "ratePerLb": 4.99, "minWeightLb": null, "transitDays": { "min": null, "max": null } },
    "maritimo": { "ratePerLb": 2.99, "minWeightLb": 8,    "transitDays": { "min": null, "max": null } }
  },
  "weightRounding": "round",
  "minBillableLb": 1,
  "vatRate": 0.13,
  "taxableBaseKind": "cif",
  "insuranceRate": 0.015,
  "customsFreightRate": 0.10,
  "excludes": ["entregas locales", "entregas departamentales"]
}
```

**`quickbox.json`** — estructura análoga, poblada tras la fase de muestreo (§3.7), con `"confidence": "derived"` y un bloque `samples` con los casos observados que respaldan la fórmula.

### 3.6 Fórmulas de cálculo

Las fórmulas de Shop USA y Buyex fueron extraídas de sus bundles de producción y se replican literalmente. No son aproximaciones.

#### Shop USA

Origen: `https://shopusa.la/_next/static/chunks/pages/index-*.js` (calculadora modal, Next.js).

```
pesoFacturable = ceil(peso)                                    // libra o fracción
tarifa         = pesoFacturable <= 5 ? 4.99 : 4.40             // aplica a todo el peso
flete          = pesoFacturable * tarifa
IVA            = 0.13 * valorFactura
DAI            = (valorFactura > 300 && hayCategoria)
                   ? (daiRate * valorFactura)
                   : 0
impuestos      = IVA + DAI
totalEnvio     = flete + impuestos
```

Notas de comportamiento:

- La tarifa **no es escalonada**: un paquete de 6 lb paga `6 × 4.40`, no `5 × 4.99 + 1 × 4.40`.
- El IVA se calcula sobre el valor de factura, no sobre el CIF ni sobre el flete.
- La categoría es **opcional** cuando el valor de factura es de $300 o menos, porque el DAI no aplica.
- Caso de verificación tomado de la calculadora oficial: 1 lb, factura $100, categoría "Fundas para teléfonos y mochilas para laptops" (15%) produce flete $4.99, DAI $0.00, IVA $13.00, total $17.99.

#### Buyex (modalidad Prealerta)

Origen: `https://comprabuyex.com/app/modules/estimaciones/assets/js/estimaciones.js`, función `realizarCalculosAduaneros`.

```
pesoCobrado   = max(1, round(peso))                            // Prealerta redondea
transporte    = tarifaPorLibra * pesoCobrado                   // 4.99 aéreo | 2.99 marítimo
seguro        = precio * 0.015
fleteAduanero = precio * 0.10
cif           = precio + seguro + fleteAduanero                // = precio * 1.115
daiRate       = precio < 300 ? 0 : daiRateCategoria            // ver "exencion de DAI"
DAI           = cif * daiRate
IVA           = (cif + DAI) * 0.13
impuestos     = DAI + IVA
totalEnvio    = transporte + impuestos                         // Prealerta no suma el precio
```

**Exención de DAI bajo $300.** La fórmula de Buyex no lleva umbral: su código aplica directamente el arancel de la categoría. La exención existe, pero implementada como una **categoría seleccionable al 0%** llamada `*COMPRAS MENORES A $300.00 DOLARES EXENTA DE DAI` (opción 167 de su catálogo), que el usuario elige a mano cuando su compra está por debajo del umbral.

Este proyecto la aplica automáticamente. La razón es que no hacerlo produce una comparación falsa: Buyex saldría artificialmente caro en toda compra bajo $300, que es la mayoría, frente a Shop USA que sí lleva el umbral en código. El efecto es grande y cambia el ganador. Ejemplo con 10 lb, $250 y categoría "Ropa":

| Oferta | Sin aplicar la exención | Aplicándola |
|---|---|---|
| Shop USA aéreo | $76.50 | $76.50 |
| Buyex aéreo | $133.39 | $86.14 |
| Buyex marítimo | $113.39 | **$66.14** |

Sin la exención, Shop USA parece el más barato. Con ella, el marítimo de Buyex gana por $10.36.

El umbral es **estricto** (`< 300`), siguiendo la redacción "MENORES A $300.00" de su etiqueta, mientras que el de Shop USA exenta también en $300 exactos (su código aplica DAI solo si `valor > 300`). En una factura de exactamente $300, Shop USA no cobra DAI y Buyex sí. La diferencia es intencional y está fijada en pruebas.

La regla vive en `daiExemption` dentro de `buyex.json`, de modo que revertirla o ajustar el umbral es un cambio de datos, no de código.

Notas de comportamiento:

- Buyex tiene dos modalidades en su código: `Prealerta` y `COTI TODO INCLUIDO`. Este proyecto usa **Prealerta** por decisión de producto: el caso de uso es "ya compré, quiero traerlo", donde el precio del artículo no forma parte de la estimación de envío.
- La diferencia de redondeo con Shop USA es real y debe preservarse: Shop USA usa `ceil`, Buyex Prealerta usa `round` con mínimo de 1 lb. Un paquete de 5.4 lb factura 6 lb en Shop USA y 5 lb en Buyex.
- El "flete aduanero" del 10% es un valor teórico usado solo para construir el CIF; no es el transporte que Buyex cobra.
- El marítimo tiene un **gate de disponibilidad** en 8 lb: por debajo de ese peso la opción se deshabilita en su cotizador. No es un mínimo facturable. El motor debe emitir `UnavailableOffer` con razón `below-minimum-weight`, no forzar 8 lb.
- Las tarifas excluyen entregas locales y departamentales. Sus constantes `ENTREGA_LOCAL` y `SERVICIOS_ADICIONALES` están en cero.

#### Quickbox

Quickbox es una SPA de Ionic/Angular cuyo cotizador **no calcula en el cliente**. La página de pricing envía `{valor, peso, arancel_id, pais_id, plan_id, cliente_id}` al servidor y solo renderiza la respuesta. No hay fórmula que replicar en el bundle.

Endpoints confirmados (todos `POST`, cuerpo form-encoded, sin autenticación):

| Endpoint | Parámetros | Devuelve |
|---|---|---|
| `https://node.qs.gt/cotizador` | `valor`, `peso`, `arancel_id`, `pais_id`, `plan_id`, `cliente_id` | La cotización con su desglose |
| `https://node.qs.gt/lista/aranceles` | `pais_id` | 264 aranceles para El Salvador |
| `https://node.qs.gt/lista/planes/cotizador` | `pais_id` | Planes disponibles |
| `https://node.qs.gt/informacion/cotizador` | `pais_id` | Texto legal del cotizador |

- `pais_id`: **3** es El Salvador (1=GT, 2=PA, 3=SV, 4=CR, 5=HN), leído de `updateContry()` en su bundle.
- `plan_id`: **18** es el plan "Estándar" ($3.30/lb, gestión aduanal $4.00, seguro gratis hasta $200). Es el que corresponde a "pago por lo que traigo".
- CORS completamente abierto, preflight incluido: `Access-Control-Allow-Origin: *`.
- Latencia medida: 250–350 ms, mayormente handshake TLS.

**Estrategia adoptada: consulta en vivo, no fórmula derivada.**

El spec original preveía derivar la fórmula por muestreo. Se descartó al medir su respuesta: dos de sus cargos son compuestos sobre un CIF que no publican.

```
5 lb, arancel 15%:   factura $301 -> DAI $48.30   (no $45.15: la base es 322, no 301)
                     factura $500 -> DAI $78.60   (base 524)
"Cobro administrativo cuenta ajena": $1.41 con factura de $300, $3.27 con $301
```

Una fórmula derivada acertaría en el caso medio y fallaría en los bordes, y **un número equivocado con aire de exacto es peor que no mostrar la tarjeta**. La consulta en vivo da exactitud por definición.

Contrapartidas aceptadas:

- La tarjeta depende de un tercero. Si su API falla, cambia o tarda más de `timeoutMs` (6 s), se emite `provider-unreachable` y los otros dos siguen comparándose.
- El peso, el valor y la categoría del visitante se envían a Quickbox. El aviso del pie lo dice explícitamente; la promesa anterior de "no envía tus datos a ningún servidor" era incompatible y se corrigió.
- El tráfico escala con los visitantes. Se mitiga con caché (§3.7).

**Mapeo del desglose.** Su respuesta trae `servicios` (flete, gestión de aeropuerto, cobro administrativo) e `impuestos` (DAI, IVA-CIF), identificados por `tipo_gasto`. Detalles a preservar:

- El peso facturable es `ceil` a libra completa, y lo devuelven ya redondeado en `records.peso`.
- **El flete y la gestión de aeropuerto ya incluyen el IVA**: con 1 lb, el flete es $3.729 = 3.30 × 1.13.
- Su IVA se llama "IVA - CIF" pero **no devuelven el CIF**. El desglose marca la base gravable como no publicada y omite esa fila, en vez de mostrar el valor de factura como si lo fuera.

**Arancel cuando no hay categoría.** Su API exige `arancel_id` siempre, mientras que Shop USA y Buyex cotizan sin categoría bajo $300. Se verificó que por debajo del umbral el arancel es irrelevante: con 5 lb y $250, los aranceles de 0%, 5%, 15% y 30% devuelven **todos $61.75**. Por eso, sin categoría elegida y bajo el umbral se envía un arancel al 0% (`noCategoryArancel`) para poder cotizar igual que los otros dos. Sobre el umbral se exige categoría.

Su propio texto legal confirma de forma independiente la exención de El Salvador: *"En El Salvador el cliente tiene derecho a importar libre de aranceles, únicamente pagan IVA, compras personales por un valor hasta de U$ 300.00"*.

### 3.7 Caché de la consulta en vivo

Sin caché, cada tecleo dispararía una petición a la API de un tercero y el tráfico escalaría con los visitantes. `QuoteCache` tiene dos niveles:

1. **Memoria**: dura lo que la pestaña. Instantáneo.
2. **`localStorage` con vencimiento de 24 h**, clave `sc:quickbox-cache`, tope de 200 entradas descartando las más viejas.

La clave es `${peso}|${valor}|${arancelId}`: los tres datos que determinan la respuesta. Una cotización repetida —recargar, abrir un enlace compartido, volver sobre el historial, corregir un dato y deshacer— no vuelve a salir a la red. Una consulta que falló **no** se cachea. Si el almacenamiento no está disponible, funciona solo con el nivel de memoria.

### 3.8 Render en dos fases

`quoteAll` sigue siendo sincrónico y sin red: Shop USA y Buyex se pintan de inmediato. Quickbox se resuelve aparte con `quoteQuickboxFor` y se inserta al llegar, reordenando por precio. Esperar a la red para pintar todo haría que una consulta lenta retrase resultados que ya estaban listos.

Mientras se espera se muestra una tarjeta de carga en lugar de omitir el proveedor: si desapareciera y luego apareciera, el usuario podría decidir con una comparación incompleta sin notarlo.

Un contador de generación descarta respuestas de consultas que el usuario ya dejó atrás. Sin él, la respuesta de una entrada anterior podría pintarse sobre una comparación más nueva.

### 3.9 Serialización en URL

Los inputs se reflejan en el query string para hacer la cotización compartible:

```
/?w=5.5&v=250&c=laptops-computadoras
```

- `w`: peso en libras (decimal).
- `v`: valor declarado en USD (decimal).
- `c`: id de categoría del catálogo unificado.

Al cargar la página con parámetros válidos, el formulario se prellena y los resultados se renderizan sin interacción. La URL se actualiza con `history.replaceState` para no ensuciar el historial del navegador en cada tecleo.

### 3.10 Historial local

`localStorage`, clave `sc:history`, arreglo de entradas ordenadas de más reciente a más antigua.

```ts
interface HistoryEntry {
  id: string;              // derivado de los inputs: `${peso}|${valor}|${categoria}`
  weightLb: number;
  declaredValueUsd: number;
  categoryId: string | null;
  categoryLabel: string | null;
  savedAt: number;         // epoch en milisegundos
  cheapest: { providerName: string; mode: ShippingMode; totalUsd: number };
}
```

- Máximo 20 entradas; al superarlo se descarta la más antigua.
- Entradas con inputs idénticos se deduplican actualizando `savedAt`.
- Solo se guardan cotizaciones que produjeron al menos una oferta. Una entrada sin resultados no aporta nada al volver a abrirla.
- Una cotización se guarda cuando el input queda estable (debounce de 2500 ms), no en cada pulsación.

**Colapso de estados intermedios.** El debounce por sí solo no basta. Al llenar el formulario campo por campo, las pausas naturales entre uno y otro superan cualquier debounce razonable, y cada estado de tránsito queda registrado como si fuera una cotización. Medido sobre la implementación: tres cotizaciones reales producían **ocho entradas**, incluidas combinaciones como "2 lb · $250" que existieron solo durante el instante entre cambiar el peso y cambiar el valor. Con 20 posiciones, dos sesiones llenaban el historial de ruido.

La regla añadida: una cotización nueva guardada dentro de una ventana de **2 minutos** respecto de la anterior la **reemplaza** en vez de sumarse, porque es la misma sesión de ajuste. Pasada la ventana, se crea una entrada nueva.

La regla tiene una excepción necesaria: si la cotización entrante **ya existe** en el historial, es una revisita (el usuario recargó una entrada anterior) y no un refinamiento. Sin esa excepción, recargar una cotización vieja borraba la que se estaba armando.

Ambas constantes son configurables (`supersedeWithinMs`, `historyDebounceMs`) para poder ajustarlas sin tocar la lógica.

### 3.11 Flujo de ejecución

1. La página carga el catálogo y las tarifas como JSON importado en build time. El único fetch en runtime es el de Quickbox.
2. Si hay parámetros en la URL, se hidrata el formulario.
3. En cada cambio del formulario (con debounce), se valida el input.
4. Si el input es válido, se invoca `quoteAll(input)`.
5. Cada motor de proveedor devuelve sus ofertas o sus indisponibilidades.
6. Las ofertas se ordenan por `totalUsd` ascendente y se renderizan; la primera se marca como la más económica.
7. Las indisponibilidades se renderizan al final, atenuadas, con su razón en texto legible.
8. Se actualizan URL e historial.

---

## 4. Casos Límite y Manejo de Errores

| Escenario | Comportamiento esperado |
|---|---|
| **4.1** Peso vacío, cero o negativo | No se calcula nada. Se muestra el estado inicial del comparador, sin error agresivo. El campo se marca solo si el usuario ya interactuó con él. |
| **4.2** Valor declarado vacío o negativo | Igual que 4.1. El valor es obligatorio: sin él no hay base gravable y ningún proveedor es calculable. |
| **4.3** Categoría sin seleccionar y valor ≤ $300 | Shop USA **sí** cotiza (su DAI no aplica bajo el umbral). Buyex y Quickbox requieren categoría para el CIF: se emite `category-required`. Se sugiere al usuario seleccionar categoría para comparar los tres. |
| **4.4** Categoría sin seleccionar y valor > $300 | Ningún proveedor es calculable. Se muestra un mensaje único pidiendo la categoría, en lugar de tres tarjetas de error. |
| **4.5** Peso < 8 lb con modalidad marítima de Buyex | La oferta marítima se emite como `UnavailableOffer` con razón `below-minimum-weight` y el texto "Buyex habilita el marítimo desde 8 lb". No se fuerza el peso al mínimo ni se oculta la oferta en silencio. |
| **4.6** Paquete voluminoso | Fuera del MVP. Se muestra una nota informativa en el desglose de Shop USA: "Si el peso volumétrico supera 3 veces el peso real, Shop USA cobra el promedio entre ambos. Este cálculo no lo contempla." Regla registrada, no implementada. |
| **4.7** Categoría sin mapeo para un proveedor | `UnavailableOffer` con razón `category-not-mapped` y enlace al cotizador oficial. Nunca se aplica una tasa por defecto ni cero implícito. |
| **4.8** `localStorage` bloqueado, lleno o no disponible | El comparador funciona normalmente sin historial. Los errores de escritura se capturan y descartan; la sección de historial no se renderiza. |
| **4.9** URL con parámetros inválidos o incompletos | Se ignoran los inválidos, se aplican los válidos, no se lanza error visible. Un `c` desconocido se trata como categoría no seleccionada. |
| **4.10** Empate en el costo total entre dos ofertas | Desempate estable: primero por menor tiempo de entrega si ambos lo tienen; si persiste, por orden alfabético de proveedor. El orden no debe variar entre renders con los mismos inputs. |
| **4.11** Peso muy grande (> 500 lb) o valor muy grande (> $50,000) | Se calcula igual, pero se agrega una nota de que fuera de rangos habituales los proveedores suelen aplicar tarifas negociadas no publicadas. |
| **4.12** Errores de punto flotante en los montos | Los cálculos intermedios se hacen en punto flotante siguiendo la implementación de cada proveedor; el redondeo a dos decimales se aplica solo en la presentación y en el total, replicando el `toFixed(2)` que cada proveedor aplica en su propio código. |

### Seguridad y privacidad

- El sitio no recolecta ni transmite datos. Todo el cálculo y la persistencia son locales al navegador.
- No hay backend, no hay credenciales, no hay claves de API en el bundle. El script de muestreo de Quickbox no se incluye en el build publicado.
- Los datos que el usuario ingresa (peso, valor, categoría) no salen del dispositivo salvo que él mismo comparta la URL.
- No se cargan recursos de terceros que permitan rastreo.

### Consideraciones legales

El sitio replica tarifas públicas de terceros y las presenta como estimaciones. Debe mostrar de forma permanente y visible que no está afiliado a ninguno de los tres proveedores, que los montos son estimaciones no vinculantes y que el precio final lo determina el proveedor. Los términos de servicio de los tres proveedores no han sido revisados (ver §6).

---

## 5. Criterios de Aceptación (Definition of Done)

### Exactitud del motor

- [ ] Para Shop USA, el total calculado coincide **al centavo** con su calculadora oficial en al menos 10 casos de prueba que cubran: peso fraccionario, peso ≤ 5 lb, peso ≥ 6 lb, valor ≤ $300, valor > $300, con y sin categoría.
- [ ] El caso conocido (1 lb, $100, categoría al 15%) produce exactamente flete $4.99, DAI $0.00, IVA $13.00, total $17.99.
- [ ] Para Buyex Prealerta, el total coincide **al centavo** con su cotizador oficial en al menos 10 casos que cubran: aéreo, marítimo con peso ≥ 8 lb, peso que redondea hacia arriba, peso que redondea hacia abajo, peso < 1 lb, categorías con DAI de 0%, 15% y 30%.
- [ ] Para Quickbox no hay margen que verificar: el monto lo calcula su propia API. Lo que se prueba es el mapeo de su respuesta (contra una captura real de su API) y que un fallo degrade a "no disponible" sin romper la comparación.
- [ ] Existe un archivo de fixtures con los casos de referencia y su fuente (captura o respuesta del cotizador oficial, con fecha).

### Comportamiento funcional

- [ ] Ingresar peso, valor y categoría produce las ofertas de Shop USA y Buyex sin ninguna petición de red, y una sola petición a Quickbox por combinación distinta de peso, valor y arancel (verificable en la pestaña de red: repetir una cotización ya hecha no genera tráfico).
- [ ] Buyex aparece como dos ofertas independientes (aérea y marítima) cuando el peso es ≥ 8 lb, y como una sola cuando es menor, con la marítima listada como no disponible y su razón visible.
- [ ] Las ofertas se ordenan por costo total ascendente y la más barata está visualmente destacada.
- [ ] Cada oferta expande un desglose que muestra peso facturable, tarifa por libra, flete, base gravable con su tipo (factura o CIF), DAI con su porcentaje, IVA e impuestos totales.
- [ ] Cada oferta muestra su fecha de vigencia de tarifas y un enlace que abre el cotizador oficial del proveedor en una pestaña nueva.
- [ ] El aviso global de estimación no vinculante es visible sin necesidad de hacer scroll.
- [ ] Cada oferta muestra su rango de días de entrega, etiquetado como referencial; si no hay dato registrado, no se muestra una columna vacía ni un placeholder engañoso.

### Casos límite

- [ ] Cada uno de los escenarios de §4 tiene una prueba automatizada o un caso de verificación manual documentado.
- [ ] Ninguna categoría del catálogo unificado carece de mapeo explícito para los tres proveedores (valor concreto o `null` declarado). Verificado por una prueba que recorre el catálogo.
- [ ] Con `localStorage` deshabilitado, el comparador calcula y renderiza sin errores en consola.

### Compartir y persistir

- [ ] Cotizar actualiza la URL, y abrir esa URL en una pestaña nueva reproduce exactamente los mismos resultados.
- [ ] El historial guarda como máximo 20 entradas, deduplica inputs idénticos y permite recargar una entrada en el formulario.

### Despliegue

- [x] `pnpm build` genera un sitio estático con rutas de assets correctas tanto en la raíz del dominio como bajo el `base` del repositorio. Verificado con `BASE_PATH=/shipping-calculator`.
- [x] El workflow de GitHub Actions corre pruebas y verificación de tipos **antes** de publicar, e inyecta `site` y `base` desde `actions/configure-pages`.
- [x] Los scripts de desarrollo (`build-catalog`, `sample-quickbox`, `preview`) no forman parte del bundle publicado.
- [x] Existe favicon, página 404 y `robots.txt`; ninguna ruta del HTML publicado apunta a un archivo inexistente.
- [x] La página declara `description`, canónica y metadatos Open Graph.
- [ ] Pages habilitado en el repositorio con origen "GitHub Actions", y primer despliegue verificado en la URL pública.

---

## 6. Preguntas abiertas

1. **Rangos de tiempo de entrega.** Ninguno de los tres proveedores publica días de tránsito, así que el dato tiene que venir de la experiencia real. Todo lo demás ya está listo: la UI muestra el rango en cuanto exista y lo omite mientras sea `null`. Falta solo reemplazar cuatro valores:

   | Archivo | Campo | Oferta |
   |---|---|---|
   | `src/data/rates/shopusa.json` | `modes.aereo.transitDays` | Shop USA aéreo |
   | `src/data/rates/buyex.json` | `modes.aereo.transitDays` | Buyex aéreo |
   | `src/data/rates/buyex.json` | `modes.maritimo.transitDays` | Buyex marítimo |
   | `src/data/rates/quickbox.json` | `modes.aereo.transitDays` | Quickbox (ambos planes) |

   El formato es `{ "min": 3, "max": 7 }` en días. La prueba `rates.test.ts > tiempos de entrega` está escrita para fallar cuando se pueblen, como recordatorio de actualizarla.
2. ~~**`pais_id` y `fuente_id` de Quickbox.**~~ **Resuelto.** `pais_id` es 3 para El Salvador y `plan_id` 18 para el plan Estándar. `fuente_id` resultó irrelevante: pertenecía al buscador de aranceles de su API Laravel, no al cotizador, que vive en `node.qs.gt`.
3. ~~**Granularidad del catálogo unificado.**~~ **Resuelto.** Son 54 categorías. Ante discrepancia se conserva la tasa nativa de cada proveedor, y los mapeos sin equivalente exacto se marcan `approximate` y lo advierten en la oferta. Pendiente menor: revisar si alguna de las 13 categorías con mapeo aproximado merece dividirse en dos entradas del catálogo unificado en vez de aproximar.
4. **Términos de servicio de los tres proveedores.** No fueron revisados. Antes de publicar conviene verificar si alguno prohíbe la reproducción de sus tarifas.
5. ~~**Nombre y dominio del proyecto.**~~ **Resuelto.** Dominio `ship.josueamaya.dev`.
6. **Otras modalidades de Quickbox y Shop USA.** Se asume que ambos operan solo aéreo porque es lo único que exponen sus cotizadores. Queda por confirmar si tienen marítimo no publicado en línea.
7. **Planes de Quickbox distintos al Estándar.** Su API expone también un plan Premium ($99 por 12 meses, 33 lb incluidas, $3.00/lb extra) que a cierto volumen sale más barato. Hoy solo se cotiza el Estándar. Queda por decidir si vale mostrar ambos.
8. **Términos de uso de la API de Quickbox.** Responde sin autenticación y con CORS abierto, lo que sugiere uso público, pero no está documentada. Si alguna vez la cierran o piden identificación, la tarjeta degrada sola a "no disponible", que es el comportamiento correcto.

---

## 7. Alternativas descartadas

| Alternativa | Razón del descarte |
|---|---|
| **Llamadas en vivo a los tres cotizadores** | Shop USA y Buyex calculan en el cliente y no exponen API, así que para ellos no hay nada que llamar. Quickbox sí se consulta en vivo (§3.6). |
| **Derivar la fórmula de Quickbox por muestreo** | Era el plan original. Se descartó al medir que dos de sus cargos son compuestos sobre un CIF que no publican: la fórmula acertaría en el caso medio y fallaría en los bordes. |
| **Scraping programado con GitHub Actions que commitea un JSON** | Innecesario: dos de los tres proveedores exponen su fórmula completa en el cliente, y el tercero requiere muestreo puntual, no continuo. Añade infraestructura sin ganancia proporcional. |
| **Backend propio con proxy y caché** | Contradice el requisito de desplegar en GitHub Pages y agrega costo, operación y superficie de ataque. Habría permitido cachear la respuesta de Quickbox para todos los visitantes en vez de por dispositivo, pero no justifica mantener infraestructura. |
| **Selector de categoría independiente por proveedor** | Elimina el riesgo de mapeo erróneo pero destruye la métrica de éxito: obliga a tres selecciones, que es exactamente el tedio que el producto elimina. |
| **Selección por porcentaje de DAI más cercano** | Simple, pero puede asignar un arancel que el proveedor no aplicaría al artículo real, produciendo comparaciones incorrectas sin que el usuario lo note. |
| **Next.js o Vite + React** | Sobredimensionados para una calculadora de un formulario. Astro entrega HTML estático con JavaScript solo en la isla de cotización. |
| **Selector global de modalidad aéreo/marítimo** | Ocultaría que el marítimo de Buyex puede ser sustancialmente más barato que cualquier aéreo. Presentar una fila por oferta hace la comparación más honesta. |

---

## 8. Plan de implementación por fases

**Fase 0 — Fundaciones**
Inicializar el proyecto Astro con TypeScript, configurar `base` para GitHub Pages, el workflow de despliegue y el runner de pruebas. Definir `src/engine/types.ts`.

**Fase 1 — Motores exactos**
Implementar `shopusa.ts` y `buyex.ts` con sus fórmulas replicadas y sus archivos de tarifas. Escribir los fixtures de verificación contra los cotizadores oficiales. Al final de esta fase el motor es correcto aunque no exista UI.

**Fase 2 — Catálogo unificado**
Extraer los 63 items de Shop USA y los 167 de Buyex, curar el catálogo unificado, construir los mapeos y la prueba de completitud. Quickbox queda con mapeos en `null` hasta la fase 4.

**Fase 3 — Interfaz de comparación**
Formulario, lista de ofertas ordenada, desglose expandible, indisponibilidades, avisos de vigencia y aviso global. Con dos proveedores funcionando ya hay producto usable.

**Fase 4 — Quickbox** (completada con un enfoque distinto al previsto)
Se descubrieron sus endpoints y `pais_id`/`plan_id`, se extrajeron sus 264 aranceles y se mapearon las 54 categorías. En vez de derivar la fórmula, se implementó consulta en vivo con caché de dos niveles y degradación a "no disponible", por las razones de §3.6.

**Fase 5 — Compartir y persistir**
Serialización en URL, hidratación desde query string e historial en `localStorage`.

**Fase 6 — Publicación**
Favicon, página 404, `robots.txt`, metadatos sociales y canónica. Revisión de los avisos legales: el aviso global declara explícitamente independencia y no afiliación, que las tarifas cambian sin aviso, y remite al cotizador oficial. Corrección del pie, que prometía no enviar datos a ningún servidor cuando Quickbox se consulta en vivo.

Pendiente de terceros: los rangos de días de entrega (pregunta abierta 1) y habilitar Pages en el repositorio.
