import type { Category } from './types';

// Stable ids so migrations and seeds can reference specific categories.
export const CATEGORY_IDS = {
  otherIncome: 'cat-income-other',
  groceries: 'cat-essentials-groceries',
} as const;

const income = (id: string, name: string): Category => ({
  id,
  name,
  kind: 'income',
  bucket: 'income',
  isDefault: true,
});

const expense = (id: string, name: string, bucket: Category['bucket']): Category => ({
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

  expense('cat-lifestyle-dining', 'مطاعم وقهوة', 'lifestyle'),
  expense('cat-lifestyle-clothing', 'ملابس', 'lifestyle'),
  expense('cat-lifestyle-entertainment', 'ترفيه', 'lifestyle'),
  expense('cat-lifestyle-personal-care', 'عناية شخصية', 'lifestyle'),
  expense('cat-lifestyle-gadgets', 'أجهزة وأدوات', 'lifestyle'),

  expense('cat-giving-sadaqah', 'صدقة', 'giving'),
  expense('cat-giving-family', 'مساعدة الأهل', 'giving'),
  expense('cat-giving-gifts', 'هدايا', 'giving'),
];
