// Due reminders are a phone feature; on the web these are no-ops.

export interface Reminder {
  id: string;
  at: Date;
  title: string;
  body: string;
}

export async function enableReminders(): Promise<boolean> {
  return false;
}

export async function cancelReminders(): Promise<void> {}

export async function replaceReminders(_reminders: Reminder[]): Promise<void> {}

export function notificationsAvailable(): boolean {
  return false;
}

export const remindersSupported = false;
