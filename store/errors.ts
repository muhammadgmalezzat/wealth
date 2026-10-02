// Typed validation errors thrown by store operations. User-facing (Arabic) text lives in
// utils/errorMessages.ts; the English `message` here is for developers and logs only.

export type FinanceErrorCode =
  | 'NAME_REQUIRED'
  | 'NOT_FOUND'
  | 'NOT_POSITIVE'
  | 'NEGATIVE'
  | 'NOT_A_NUMBER'
  | 'INVALID_DATE'
  | 'INVALID_MONTH'
  | 'INVALID_KARAT'
  | 'INVALID_FREQUENCY'
  | 'CURRENCY_MISMATCH'
  | 'CATEGORY_KIND_MISMATCH'
  | 'CATEGORY_BUCKET_MISMATCH'
  | 'LIABILITY_PAYMENT_NOT_EXPENSE'
  | 'SAME_ACCOUNT_TRANSFER'
  | 'ACCOUNT_IN_USE'
  | 'ACCOUNT_CURRENCY_LOCKED'
  | 'CATEGORY_IN_USE'
  | 'LIABILITY_IN_USE'
  | 'LIABILITY_CURRENCY_LOCKED'
  | 'WITHDRAW_EXCEEDS_FUND'
  | 'HOLDING_ALREADY_LINKED'
  | 'INSUFFICIENT_UNASSIGNED';

export type FinanceEntity =
  | 'account'
  | 'category'
  | 'transaction'
  | 'fund'
  | 'fundMovement'
  | 'holding'
  | 'liability'
  | 'recurringRule';

export type FinanceField =
  | 'amount'
  | 'toAmount'
  | 'rateToEGP'
  | 'openingBalance'
  | 'targetAmount'
  | 'priority'
  | 'monthlyContribution'
  | 'cashAllocation'
  | 'weightGrams'
  | 'quantity'
  | 'purchaseCostEGP'
  | 'principal'
  | 'monthlyPayment'
  | 'expectedIncomeEGP'
  | 'bucketLimit'
  | 'exchangeRate'
  | 'goldPrice'
  | 'date'
  | 'deadline'
  | 'startDate'
  | 'nextDate'
  | 'purchaseDate';

export interface FinanceErrorDetails {
  entity?: FinanceEntity;
  field?: FinanceField;
  id?: string;
}

export class FinanceValidationError extends Error {
  override name = 'FinanceValidationError';
  readonly code: FinanceErrorCode;
  readonly details: FinanceErrorDetails;

  constructor(code: FinanceErrorCode, details: FinanceErrorDetails = {}) {
    const context = Object.entries(details)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    super(context ? `${code} (${context})` : code);
    this.code = code;
    this.details = details;
  }
}
