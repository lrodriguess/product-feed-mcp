import { EventType } from '../types';

export type EventDomain = 'Catalog' | 'Pricing' | 'Logistics';

export interface BroadcasterPayload {
  Domain: EventDomain;
  ActionName: string;
  IdSku: string;
  An: string;
  HasStockKeepingUnitModified?: boolean;
}

const DOMAIN_TO_EVENT_TYPE: Record<string, EventType> = {
  Catalog: 'catalog',
  Pricing: 'price',
  Logistics: 'stock',
};

export function domainToEventType(domain: string): EventType {
  return DOMAIN_TO_EVENT_TYPE[domain] ?? 'catalog';
}
