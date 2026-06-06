export interface Transaction {
  id: string;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
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
  currency: 'EGP' | 'SAR' | 'USD';
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
  currency: 'EGP' | 'SAR' | 'USD';
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
