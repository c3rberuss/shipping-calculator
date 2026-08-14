/**
 * Tipos compartidos del motor de cotizacion.
 *
 * Todo el motor son funciones puras: no tocan DOM, no hacen red y no leen
 * estado global. Las tarifas se inyectan como parametro para poder probarlas
 * con fixtures y para que un cambio de tarifa sea un cambio de datos, no de
 * codigo.
 */

export type ProviderId = 'quickbox' | 'shopusa' | 'buyex';

export type ShippingMode = 'aereo' | 'maritimo';

/** Sobre que monto se calculan los impuestos. */
export type TaxableBaseKind = 'invoice' | 'cif';

/**
 * `exact`   la formula fue replicada del codigo de produccion del proveedor.
 * `live`    el monto lo calculo el proveedor en su propia API, ahora.
 * `derived` la formula fue deducida por muestreo (no se usa hoy).
 */
export type Confidence = 'exact' | 'live' | 'derived';

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Lo que el usuario ingresa en el formulario. */
export interface QuoteInput {
  /** Peso real en libras. Debe ser > 0. */
  weightLb: number;
  /** Valor declarado de la mercaderia en USD. Debe ser >= 0. */
  declaredValueUsd: number;
  /** Id del catalogo unificado. `null` si el usuario no eligio categoria. */
  categoryId: string | null;
}

/**
 * `direct`      el proveedor tiene una entrada que significa lo mismo.
 * `approximate` no la tiene y se usa la mas cercana disponible. El arancel
 *               puede no ser el que aplicarian, asi que la oferta lo advierte.
 */
export type MappingMatch = 'direct' | 'approximate';

/**
 * Resultado de traducir la categoria elegida por el usuario al catalogo de un
 * proveedor concreto.
 *
 * El `daiRate` es el del proveedor, no uno unificado: los tres asignan
 * aranceles distintos al mismo articulo. De 54 categorias del catalogo, en 20
 * Shop USA y Buyex no coinciden (ver spec 3.4).
 *
 * `none` y `not-mapped` son estados distintos a proposito: el primero es "el
 * usuario no ha elegido", el segundo es "eligio, pero este proveedor no cubre
 * ese articulo". Producen mensajes diferentes.
 */
export type CategoryResolution =
  | { kind: 'none' }
  | {
      kind: 'resolved';
      id: string;
      label: string;
      /** Fraccion, no porcentaje. 15% se representa como 0.15. */
      daiRate: number;
      match: MappingMatch;
    }
  | { kind: 'not-mapped'; label: string };

/**
 * Entrada de un motor de proveedor: el input del usuario con la categoria ya
 * traducida al catalogo de ese proveedor. La resolucion vive en la capa de
 * catalogo, no en los motores.
 */
export interface ProviderQuoteInput {
  weightLb: number;
  declaredValueUsd: number;
  category: CategoryResolution;
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

export interface CategoryMapping {
  name: string;
  daiRate: number;
  match: MappingMatch;
  /** Solo Buyex: el `value` del option en su select. */
  optionValue?: string;
  /** Solo Quickbox: el id de arancel que espera su API. */
  arancelId?: string;
}

export interface CatalogCategory {
  id: string;
  label: string;
  /** Terminos alternativos para la busqueda de la fase 3. */
  aliases: string[];
  mappings: Record<ProviderId, CategoryMapping | null>;
}

export interface Catalog {
  version: string;
  note: string;
  categories: CatalogCategory[];
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

/** Cargo que el proveedor cobra aparte del flete y de los impuestos. */
export interface ExtraCharge {
  label: string;
  amountUsd: number;
}

export interface OfferBreakdown {
  /** Peso sobre el que realmente cobra el proveedor, tras su redondeo. */
  billableWeightLb: number;
  ratePerLbUsd: number;
  freightUsd: number;
  /**
   * Cargos propios del proveedor que no son flete ni impuesto. Quickbox cobra
   * gestion de aeropuerto y un cargo administrativo; los otros dos no.
   */
  extraCharges: ExtraCharge[];
  taxableBaseKind: TaxableBaseKind;
  taxableBaseUsd: number;
  /**
   * `false` cuando el proveedor no publica la base gravable. Quickbox cobra IVA
   * sobre un CIF que no expone, y mostrar el valor de factura en su lugar seria
   * inventar un dato.
   */
  taxableBaseDisclosed: boolean;
  /** Componentes del CIF. Cero en proveedores que gravan sobre factura. */
  insuranceUsd: number;
  customsFreightUsd: number;
  /** Fraccion. */
  daiRate: number;
  daiUsd: number;
  /** Fraccion. */
  vatRate: number;
  vatUsd: number;
  taxesTotalUsd: number;
}

/** Rango referencial en dias corridos. */
export interface TransitDays {
  min: number;
  max: number;
}

export interface Offer {
  available: true;
  /** Identificador estable: `${providerId}:${mode}`. */
  offerId: string;
  providerId: ProviderId;
  providerName: string;
  mode: ShippingMode;
  /** Costo total de traer el paquete. No incluye el valor de la compra. */
  totalUsd: number;
  breakdown: OfferBreakdown;
  /** Rango referencial en dias. `null` mientras no haya dato registrado. */
  transitDays: TransitDays | null;
  confidence: Confidence;
  /** ISO 8601 (YYYY-MM-DD). Fecha de verificacion de las tarifas. */
  ratesVerifiedAt: string;
  officialQuoterUrl: string;
  /** Advertencias legibles: exclusiones, supuestos, redondeos. */
  notes: string[];
  /**
   * Presente solo si la oferta exige una suscripcion aparte.
   *
   * Su total NO es comparable cabeza a cabeza con las de pago por envio: no
   * incluye el costo del plan. Por eso estas ofertas quedan fuera del distintivo
   * de "mas barato", aunque si se listan.
   */
  subscription?: OfferSubscription;
}

export interface OfferSubscription {
  planName: string;
  costUsd: number;
  periodMonths: number;
  includedLb: number;
  /**
   * Libras al año desde las que el plan sale mas barato que pagar por envio.
   * Se calcula, no se declara.
   */
  breakEvenLbPerPeriod: number;
}

export type UnavailableReason =
  /** El proveedor no habilita esa modalidad bajo cierto peso. */
  | 'below-minimum-weight'
  /** El proveedor necesita categoria para calcular con este valor. */
  | 'category-required'
  /** La categoria del catalogo unificado no tiene equivalente aqui. */
  | 'category-not-mapped'
  /** El proveedor no ofrece esa modalidad. */
  | 'mode-not-offered'
  /** Su API no respondio, tardo demasiado o devolvio algo inesperado. */
  | 'provider-unreachable';

/**
 * Una oferta que no se pudo calcular. Se emite explicitamente en vez de
 * omitirse: el usuario debe ver por que falta un proveedor, no que desaparezca.
 */
export interface UnavailableOffer {
  available: false;
  offerId: string;
  providerId: ProviderId;
  providerName: string;
  mode: ShippingMode;
  reason: UnavailableReason;
  /** Texto listo para mostrar, especifico del proveedor. */
  detail: string;
  officialQuoterUrl: string;
}

export type ProviderOffer = Offer | UnavailableOffer;

export interface QuoteResult {
  /** Ordenadas por `totalUsd` ascendente. */
  offers: Offer[];
  unavailable: UnavailableOffer[];
  input: QuoteInput;
}

// ---------------------------------------------------------------------------
// Tarifas
// ---------------------------------------------------------------------------

/** Escalon de tarifa. `maxLb: null` es el tramo abierto superior. */
export interface WeightTier {
  maxLb: number | null;
  ratePerLb: number;
}

export interface RatesMeta {
  providerId: ProviderId;
  providerName: string;
  /** ISO 8601 (YYYY-MM-DD). */
  verifiedAt: string;
  /** De donde se extrajo la formula o la tarifa. */
  sourceUrl: string;
  officialQuoterUrl: string;
  confidence: Confidence;
}

export interface ShopUsaModeRates {
  /** Escalonado no acumulativo: la tarifa del tramo aplica a todo el peso. */
  tiers: WeightTier[];
  transitDays: TransitDays | null;
}

export interface ShopUsaRates extends RatesMeta {
  providerId: 'shopusa';
  /** Shop USA cobra libra o fraccion. */
  weightRounding: 'ceil';
  modes: { aereo: ShopUsaModeRates };
  vatRate: number;
  taxableBaseKind: 'invoice';
  /** El DAI solo aplica por encima de este valor de factura. */
  daiThresholdUsd: number;
  volumetricNote: string;
}

export interface BuyexModeRates {
  ratePerLb: number;
  /** Peso desde el que el proveedor habilita la modalidad. */
  minWeightLb: number | null;
  transitDays: TransitDays | null;
}

/**
 * Exencion de DAI bajo cierto valor de factura.
 *
 * Buyex no la tiene en su formula: la implementa como una categoria al 0% que
 * el usuario elige a mano ("*COMPRAS MENORES A $300.00 DOLARES EXENTA DE DAI").
 * La aplicamos automaticamente porque de lo contrario Buyex saldria
 * artificialmente caro en toda compra bajo $300, que es la mayoria.
 */
export interface DaiExemption {
  /** Estricto: la etiqueta de Buyex dice "menores a", asi que $300 no exenta. */
  belowUsd: number;
  sourceOptionValue: string;
  sourceName: string;
  note: string;
}

export interface BuyexRates extends RatesMeta {
  providerId: 'buyex';
  /** Modalidad de servicio replicada. Ver spec 3.6. */
  serviceType: 'prealerta';
  weightRounding: 'round';
  minBillableLb: number;
  modes: { aereo: BuyexModeRates; maritimo: BuyexModeRates };
  vatRate: number;
  taxableBaseKind: 'cif';
  insuranceRate: number;
  customsFreightRate: number;
  daiExemption: DaiExemption;
  excludes: string[];
}

/**
 * Quickbox no lleva tarifas replicadas: su API calcula y devuelve el monto.
 * Lo que se versiona aqui son los parametros de la consulta y los metadatos.
 */
export interface QuickboxPlan {
  planId: string;
  nombre: string;
  /** 0 en el plan de pago por envio. */
  costoPlanUsd: number;
  duracionMeses: number;
  librasIncluidas: number;
  costoLibraUsd: number;
}

export interface QuickboxRates extends RatesMeta {
  providerId: 'quickbox';
  confidence: 'live';
  /** Endpoint del cotizador. */
  endpoint: string;
  /** 3 = El Salvador (1=GT, 2=PA, 3=SV, 4=CR, 5=HN). */
  paisId: string;
  /** Planes que se cotizan. El primero debe ser el de pago por envio. */
  plans: QuickboxPlan[];
  subscriptionNote: string;
  /** Corta la espera para que una API lenta no bloquee la comparacion. */
  timeoutMs: number;
  /** Sobre este valor de factura su API si cobra DAI. */
  daiThresholdUsd: number;
  /**
   * Su API exige `arancel_id` siempre. Bajo el umbral el arancel no cambia el
   * resultado (verificado), asi que se envia uno del 0% para poder cotizar sin
   * categoria, como hacen los otros dos.
   */
  noCategoryArancel: { arancelId: string; note: string };
  modes: { aereo: { transitDays: TransitDays | null } };
  notes: string[];
}
