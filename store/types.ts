export type CurrencyCode = 'EGP' | 'SAR' | 'USD';

export interface Transaction {
  id: string;
  amount: number;
  currency: CurrencyCode;
  type: 'income' | 'expense';
  category: string;
  date: string;
  note?: string;
}

export interface Asset {
  id: string;
  type: 'cash' | 'gold' | 'bank';
  name: string;
  amount: number;
  currency: CurrencyCode;
  purchasePrice?: number;
  weightGrams?: number;
  karat?: 21 | 24;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  currency: CurrencyCode;
}

export interface ExchangeRates {
  SAR_EGP: number;
  USD_EGP: number;
  lastUpdated: string;
}

export interface FinanceState {
  transactions: Transaction[];
  assets: Asset[];
  goals: Goal[];
  exchangeRates: ExchangeRates;
}
