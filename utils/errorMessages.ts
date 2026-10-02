import { BackupError, type BackupErrorCode } from '@/store/backup';
import {
  FinanceValidationError,
  type FinanceEntity,
  type FinanceErrorCode,
  type FinanceField,
} from '@/store/errors';

// The single place where store error codes become user-facing Arabic text.

const ENTITY_LABELS: Record<FinanceEntity, string> = {
  account: 'الحساب',
  category: 'التصنيف',
  transaction: 'المعاملة',
  fund: 'الصندوق',
  fundMovement: 'حركة الصندوق',
  holding: 'الاستثمار',
  liability: 'الالتزام',
  recurringRule: 'المعاملة المتكررة',
};

const FIELD_LABELS: Record<FinanceField, string> = {
  amount: 'المبلغ',
  toAmount: 'المبلغ المستلم',
  rateToEGP: 'سعر الصرف',
  openingBalance: 'الرصيد',
  targetAmount: 'المبلغ المستهدف',
  priority: 'الأولوية',
  monthlyContribution: 'المساهمة الشهرية',
  cashAllocation: 'المبلغ المخصص نقداً',
  weightGrams: 'الوزن',
  quantity: 'الكمية',
  purchaseCostEGP: 'سعر الشراء',
  principal: 'أصل المبلغ',
  monthlyPayment: 'القسط الشهري',
  expectedIncomeEGP: 'الدخل المتوقع',
  bucketLimit: 'حد الميزانية',
  exchangeRate: 'سعر الصرف',
  goldPrice: 'سعر الذهب',
  date: 'التاريخ',
  deadline: 'الموعد النهائي',
  startDate: 'تاريخ البداية',
  nextDate: 'التاريخ القادم',
  purchaseDate: 'تاريخ الشراء',
};

type Details = FinanceValidationError['details'];

const field = (d: Details) => (d.field ? FIELD_LABELS[d.field] : 'القيمة');
const entity = (d: Details) => (d.entity ? ENTITY_LABELS[d.entity] : 'العنصر');

const MESSAGES: Record<FinanceErrorCode, (d: Details) => string> = {
  NAME_REQUIRED: () => 'الرجاء إدخال الاسم',
  NOT_FOUND: (d) => `${entity(d)} غير موجود`,
  NOT_POSITIVE: (d) => `${field(d)} يجب أن يكون أكبر من صفر`,
  NEGATIVE: (d) => `${field(d)} لا يمكن أن يكون سالباً`,
  NOT_A_NUMBER: (d) => `${field(d)} يجب أن يكون رقماً صحيحاً`,
  INVALID_DATE: (d) => `${field(d)} يجب أن يكون بصيغة YYYY-MM-DD`,
  INVALID_MONTH: () => 'الشهر يجب أن يكون بصيغة YYYY-MM',
  INVALID_KARAT: () => 'العيار يجب أن يكون 18 أو 21 أو 24',
  INVALID_FREQUENCY: () => 'التكرار غير صالح',
  CURRENCY_MISMATCH: (d) => `العملة يجب أن تطابق عملة ${entity(d)}`,
  CATEGORY_KIND_MISMATCH: () => 'نوع التصنيف لا يطابق نوع المعاملة',
  CATEGORY_BUCKET_MISMATCH: () => 'تصنيفات الدخل فقط تستخدم بند الدخل',
  LIABILITY_PAYMENT_NOT_EXPENSE: () => 'سداد الالتزامات يكون بمصروف فقط',
  SAME_ACCOUNT_TRANSFER: () => 'لا يمكن التحويل إلى نفس الحساب',
  ACCOUNT_IN_USE: () => 'هذا الحساب مرتبط بمعاملات، يمكنك أرشفته بدلاً من حذفه',
  ACCOUNT_CURRENCY_LOCKED: () => 'لا يمكن تغيير عملة حساب له معاملات',
  CATEGORY_IN_USE: () => 'هذا التصنيف مستخدم في معاملات',
  LIABILITY_IN_USE: () => 'هذا الالتزام عليه دفعات مسجلة',
  LIABILITY_CURRENCY_LOCKED: () => 'لا يمكن تغيير عملة التزام عليه دفعات',
  WITHDRAW_EXCEEDS_FUND: () => 'لا يمكن سحب أكثر من المبلغ المخصص نقداً في الصندوق',
  HOLDING_ALREADY_LINKED: () => 'هذا الاستثمار مربوط بصندوق آخر بالفعل',
  INSUFFICIENT_UNASSIGNED: () => 'المبلغ أكبر من الفلوس اللي بدون وظيفة',
  NOTHING_SELECTED: () => 'أدخل مبلغاً لصندوق واحد على الأقل',
  SINKING_SCHEDULE_REQUIRED: () => 'حدد التكرار وتاريخ الاستحقاق القادم',
  NOT_A_SINKING_FUND: () => 'هذا الصندوق ليس صندوق مصاريف دورية',
  ASSET_PURCHASE_TYPE_LOCKED: () => 'لا يمكن تغيير نوع معاملة شراء الذهب',
  HOLDING_HAS_PURCHASE: () => 'الذهب ده مسجل بمعاملة شراء؛ احذف معاملة الشراء بدلاً منه',
};

const BACKUP_MESSAGES: Record<BackupErrorCode, string> = {
  INVALID_FILE: 'الملف ده مش نسخة احتياطية سليمة من Wealth',
  UNSUPPORTED_VERSION: 'النسخة الاحتياطية دي من إصدار أحدث من التطبيق؛ حدّث التطبيق الأول',
  PASSWORD_REQUIRED: 'النسخة الاحتياطية دي محمية بكلمة سر',
  WRONG_PASSWORD: 'كلمة السر غلط',
};

export function errorMessage(error: unknown): string {
  if (error instanceof FinanceValidationError) return MESSAGES[error.code](error.details);
  if (error instanceof BackupError) return BACKUP_MESSAGES[error.code];
  return 'حدث خطأ غير متوقع، حاول مرة أخرى';
}
