// ─── Channel Configuration ────────────────────────────────────────────────────

export type ConnectorType = 'marketplace' | 'erp' | 'feed';

export interface DedupTtlSeconds {
  catalog: number;
  price: number;
  stock: number;
}

export interface ChannelConfig {
  channelId: string;
  connectorType: ConnectorType;
  accountName: string;
  salesChannel: number;
  tradePolicy: string;
  affiliateId?: string;
  country: string;            // ISO 3166-1 alpha-3
  representativePostalCode: string;
  currency: string;           // ISO 4217
  dedupTtlSeconds: DedupTtlSeconds;
  minimumStock: number;
  maxRetries: number;
  dispatchEndpoint: string;
  stockAdjustmentHookEndpoint?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─── syncStatus State Machine ─────────────────────────────────────────────────

export type SyncStatus = 'pending' | 'in_flight' | 'synced' | 'skipped' | 'error' | 'exhausted';

// ─── Unavailable Reason ───────────────────────────────────────────────────────

export type UnavailableReason =
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'NOT_IN_SALES_CHANNEL'
  | 'ZERO_PRICE'
  | 'ZERO_STOCK'
  | 'BELOW_MINIMUM_STOCK'
  | 'CONTENT_VIOLATION'
  | 'MISSING_MAPPING';

// ─── Issue Types ──────────────────────────────────────────────────────────────

export type IssueType =
  | 'ZERO_PRICE'
  | 'CURRENCY_MISMATCH'
  | 'ZERO_STOCK'
  | 'BELOW_MINIMUM_STOCK'
  | 'SKU_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'NOT_IN_SALES_CHANNEL'
  | 'CONTENT_VIOLATION'
  | 'CONTENT_FETCH_ERROR'
  | 'MISSING_MAPPING'
  | 'DISPATCH_ERROR'
  | 'SYNC_EXHAUSTED'
  | 'SIMULATION_ERROR';

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueSource = 'platform' | 'connector' | 'marketplace';

export interface OfferIssue {
  issueId: string;
  accountName: string;
  channelId: string;
  skuId: string;
  issueType: IssueType;
  severity: IssueSeverity;
  description: string;
  source: IssueSource;
  createdAt: string;
  resolvedAt: string | null;
  resolved: boolean;
  ttl?: number;
}

// ─── Feed State ───────────────────────────────────────────────────────────────

export interface FeedState {
  accountName: string;
  channelId: string;
  skuId: string;
  syncStatus: SyncStatus;
  sellingPrice?: number;
  listPrice?: number;
  currency?: string;
  sellableQuantity?: number;
  isAvailable?: boolean;
  unavailableReason?: UnavailableReason | null;
  feedVersion?: string;
  lastSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  openIssueCount: number;
  retryCount: number;
  priceResolvedAt?: string;
  stockResolvedAt?: string;
  contentResolvedAt?: string;
  simulationCountry?: string;
  simulationPostalCode?: string;
  updatedAt: string;
}

// ─── Sync Event (history) ─────────────────────────────────────────────────────

export interface SyncEvent {
  accountName: string;
  channelId: string;
  skuId: string;
  syncAt: string;
  syncStatus: SyncStatus;
  sellingPrice?: number;
  sellableQuantity?: number;
  isAvailable?: boolean;
  feedVersion?: string;
  error?: string;
  ttl: number;
}

// ─── Product Feed (canonical in-memory object) ───────────────────────────────

export interface FeedIdentity {
  accountName: string;
  salesChannel: number;
  tradePolicy: string;
  channelId: string;
  productId: string;
  skuId: string;
  feedVersion: string;
  assembledAt: string;
}

export interface ImageInfo {
  url: string;
  label: string;
  isMain: boolean;
}

export interface Dimensions {
  realHeight: number;
  realWidth: number;
  realLength: number;
  realWeight: number;
  packageHeight: number;
  packageWidth: number;
  packageLength: number;
  packageWeight: number;
  unit: string;
}

export interface SkuSpecification {
  name: string;
  value: string;
  isVariation: boolean;
}

export interface CatalogContent {
  title: string;
  description: string;
  brand: string;
  vtexCategoryId: string;
  vtexCategoryPath: string;
  specifications: SkuSpecification[];
  images: ImageInfo[];
  ean: string | null;
  dimensions: Dimensions;
  isKit: boolean;
  contentVersion: string;
  contentUpdatedAt: string;
}

export interface MappingEntry {
  vtexSpecName: string;
  vtexSpecValue: string;
  channelAttrId: string | null;
  channelAttrValue: string | null;
  mapped: boolean;
}

export interface MissingMapping {
  type: 'category' | 'attribute_value';
  vtexValue: string;
  channelAttrId?: string;
}

export type MappingStatus = 'complete' | 'partial' | 'missing';

export interface MappingResult {
  vtexCategoryId: string;
  channelCategoryId: string | null;
  channelCategoryName: string | null;
  attributes: MappingEntry[];
  mappingStatus: MappingStatus;
  missingMappings: MissingMapping[];
  mappingResolvedAt: string;
}

export interface PriceResult {
  sellingPrice: number;
  listPrice: number;
  basePrice: number;
  currency: string;
  sourceOfCalculation: 'checkout_simulation';
  simulationCountry: string;
  simulationPostalCode: string;
  resolvedAt: string;
}

export interface InventoryResult {
  simulatedStockBalance: number;
  sellableQuantity: number;
  minimumStockThreshold: number;
  resolvedAt: string;
}

export interface AvailabilityResult {
  isAvailable: boolean;
  sellableQuantity: number;
  unavailableReason: UnavailableReason | null;
  catalogEligibility: boolean;
  priceEligibility: boolean;
  inventoryEligibility: boolean;
  computedAt: string;
}

export interface FeedStateSnapshot {
  syncStatus: SyncStatus;
  lastSyncAt: string;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  openIssues: OfferIssue[];
  retryCount: number;
  feedVersion: string;
}

export interface ConnectorContext {
  rawSkuResponse?: unknown;
  categoryTree?: unknown[];
  additionalFetches?: Record<string, unknown>;
}

export interface ProductFeed {
  identity: FeedIdentity;
  catalogContent: CatalogContent;
  mapping: MappingResult;
  price: PriceResult;
  inventory: InventoryResult;
  availability: AvailabilityResult;
  feedState: FeedStateSnapshot;
  connectorContext?: ConnectorContext;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export type DispatchStatus = 'success' | 'error' | 'retry';

export interface DispatchResult {
  dispatchId: string;
  status: DispatchStatus;
  externalOfferId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  processedAt: string;
}

// ─── Event Types ──────────────────────────────────────────────────────────────

export type EventType = 'catalog' | 'price' | 'stock';

export interface BroadcasterEvent {
  Domain: string;
  ActionName: string;
  IdSku: string;
  An: string;
  HasStockKeepingUnitModified?: boolean;
}

export interface QueueMessage {
  accountName: string;
  channelId: string;
  skuId: string;
  eventType: EventType;
  receivedAt: string;
}
