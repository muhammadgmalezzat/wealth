import type { Category } from './types';

// Stable ids so migrations and seeds can reference specific categories.
export const CATEGORY_IDS = {
  otherIncome: 'cat-income-other',
  groceries: 'cat-essentials-groceries',
} as const;

// Bills that recur at a set amount whatever you do (rent, internet, utilities): suggested
// as 'fixed' plan lines, which don't count as safe to spend.
export const FIXED_CATEGORY_IDS: readonly string[] = [
  'cat-essentials-rent',
  'cat-essentials-telecom',
  'cat-essentials-bills',
];

// Fixed so default categories are identical on every device (until the user edits them).
const DEFAULTS_UPDATED_AT = '2026-01-01T00:00:00.000Z';

const income = (id: string, name: string): Category => ({
  updatedAt: DEFAULTS_UPDATED_AT,
  id,
  name,
  kind: 'income',
  bucket: 'income',
  isDefault: true,
});

const expense = (id: string, name: string, bucket: Category['bucket']): Category => ({
  updatedAt: DEFAULTS_UPDATED_AT,
  id,
  name,
  kind: 'expense',
  bucket,
  isDefault: true,
});

export const DEFAULT_CATEGORIES: Category[] = [
  income('cat-income-salary', 'راتب'),
  income('cat-income-freelance', 'فري لانس'),
  income(CATEGORY_IDS.otherIncome, 'دخل آخر'),

  expense('cat-essentials-rent', 'إيجار', 'essentials'),
  expense(CATEGORY_IDS.groceries, 'أكل وبقالة', 'essentials'),
  expense('cat-essentials-transport', 'مواصلات', 'essentials'),
  expense('cat-essentials-telecom', 'إنترنت وموبايل', 'essentials'),
  expense('cat-essentials-bills', 'فواتير', 'essentials'),
  expense('cat-essentials-health', 'صحة', 'essentials'),
  expense('cat-essentials-household', 'مستلزمات البيت', 'essentials'),
  expense('cat-essentials-home-setup', 'تجهيز البيت', 'essentials'),

  expense('cat-lifestyle-dining', 'مطاعم وقهوة', 'lifestyle'),
  expense('cat-lifestyle-clothing', 'ملابس', 'lifestyle'),
  expense('cat-lifestyle-entertainment', 'ترفيه', 'lifestyle'),
  expense('cat-lifestyle-personal-care', 'عناية شخصية', 'lifestyle'),
  expense('cat-lifestyle-gadgets', 'أجهزة وأدوات', 'lifestyle'),
  expense('cat-lifestyle-misc', 'متفرقات', 'lifestyle'),

  expense('cat-giving-sadaqah', 'صدقة', 'giving'),
  expense('cat-giving-family', 'مساعدة الأهل', 'giving'),
  expense('cat-giving-gifts', 'هدايا', 'giving'),
];
