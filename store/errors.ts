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
  | 'INVALID_MODE'
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
  | 'INSUFFICIENT_UNASSIGNED'
  | 'NOTHING_SELECTED'
  | 'SINKING_SCHEDULE_REQUIRED'
  | 'NOT_A_SINKING_FUND'
  | 'HOLDING_HAS_PURCHASE'
  | 'ASSET_PURCHASE_TYPE_LOCKED'
  | 'DUPLICATE_ENTRY'
  | 'PLAN_EXISTS'
  | 'OCCURRENCE_NOT_DUE'
  | 'CATEGORY_NAME_TAKEN'
  | 'CATEGORY_KIND_LOCKED'
  | 'DEFAULT_CATEGORY_DELETE'
  | 'PLAN_NOT_FOUND'
  | 'ACTION_NOT_DISMISSIBLE';

export type FinanceEntity =
  | 'account'
  | 'category'
  | 'transaction'
  | 'fund'
  | 'fundMovement'
  | 'holding'
  | 'liability'
  | 'recurringRule'
  | 'monthlyPlan';

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
  | 'expectedIncome'
  | 'planLimit'
  | 'exchangeRate'
  | 'goldPrice'
  | 'date'
  | 'deadline'
  | 'startDate'
  | 'nextDate'
  | 'purchaseDate'
  | 'endDate'
  | 'interval'
  | 'dayOfMonth';

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
