import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Local reminders for due recurring items (native). See notifications.web.ts.
// expo-notifications is never imported at module level: in Expo Go (SDK 53+) on Android just
// loading it throws, which would take down app/_layout.tsx. It is loaded lazily, only in an
// installed build; in Expo Go every function here is a no-op.

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL_ID = 'due';
const ID_PREFIX = 'due-';

const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function notificationsAvailable(): boolean {
  return !IN_EXPO_GO;
}

// Kept for existing callers (Settings).
export const remindersSupported = notificationsAvailable();

let loaded: Promise<NotificationsModule | null> | null = null;

// The module, or null when unavailable (Expo Go) or failing to load. Loaded once.
function load(): Promise<NotificationsModule | null> {
  if (!notificationsAvailable()) return Promise.resolve(null);
  loaded ??= import('expo-notifications')
    .then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      return Notifications;
    })
    .catch(() => null);
  return loaded;
}

export interface Reminder {
  id: string;
  at: Date;
  title: string;
  body: string;
}

// Asks for permission (and creates the Android channel). Resolves whether reminders can be shown.
export async function enableReminders(): Promise<boolean> {
  try {
    const Notifications = await load();
    if (!Notifications) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'المستحقات',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

// Cancels this app's reminders.
export async function cancelReminders(): Promise<void> {
  const Notifications = await load();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

// Replaces this app's scheduled reminders with `reminders`.
export async function replaceReminders(reminders: Reminder[]): Promise<void> {
  const Notifications = await load();
  if (!Notifications) return;
  await cancelReminders();
  for (const reminder of reminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL_ID },
    });
  }
}
