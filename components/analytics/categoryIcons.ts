import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';

import type { ColorToken } from '@/constants/theme';
import type { Bucket } from '@/store/types';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

// Icons for the spending footprint tiles (pure; no category record carries an icon). The default categories by id;
// any other category (one the user made) by its bucket.
const BY_ID: Record<string, IconName> = {
  'cat-essentials-rent': 'home',
  'cat-essentials-groceries': 'shopping-cart',
  'cat-essentials-transport': 'directions-bus',
  'cat-essentials-telecom': 'wifi',
  'cat-essentials-bills': 'receipt-long',
  'cat-essentials-health': 'local-hospital',
  'cat-essentials-household': 'cleaning-services',
  'cat-essentials-home-setup': 'chair',
  'cat-essentials-fees': 'account-balance',
  'cat-lifestyle-dining': 'restaurant',
  'cat-lifestyle-clothing': 'checkroom',
  'cat-lifestyle-entertainment': 'movie',
  'cat-lifestyle-personal-care': 'spa',
  'cat-lifestyle-gadgets': 'devices',
  'cat-lifestyle-misc': 'category',
  'cat-giving-sadaqah': 'volunteer-activism',
  'cat-giving-family': 'family-restroom',
  'cat-giving-gifts': 'card-giftcard',
};

const BY_BUCKET: Record<Bucket, IconName> = {
  essentials: 'home-work',
  lifestyle: 'local-cafe',
  giving: 'volunteer-activism',
  income: 'payments',
};

export function categoryIcon(categoryId: string, bucket: Bucket | undefined): IconName {
  return BY_ID[categoryId] ?? BY_BUCKET[bucket ?? 'essentials'];
}

// The footprint's colours, largest category first: the spending colour, then the other category hues; «باقي الفئات»
// is muted. Never emerald (income) or gold (gold).
export const FOOTPRINT_COLORS: ColorToken[] = ['chartSky', 'chartViolet', 'chartRose', 'chartLime'];
export const FOOTPRINT_REST_COLOR: ColorToken = 'textMuted';

// The cash-flow colours, the same everywhere: income emerald, spending sky.
export const INCOME_COLOR: ColorToken = 'primary';
export const EXPENSE_COLOR: ColorToken = 'chartSky';
// Money reserved for funds: the darker emerald (it is liquid money; gold stays for gold).
export const RESERVED_COLOR: ColorToken = 'primary900';
