import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Local reminders for due recurring items (native). See notifications.web.ts.
// Local notifications work in Expo Go; only remote push needs a development build.

const CHANNEL_ID = 'due';
const ID_PREFIX = 'due-';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface Reminder {
  id: string;
  at: Date;
  title: string;
  body: string;
}

// Asks for permission (and creates the Android channel). Resolves whether reminders can be shown.
export async function enableReminders(): Promise<boolean> {
  try {
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
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

// Replaces this app's scheduled reminders with `reminders`.
export async function replaceReminders(reminders: Reminder[]): Promise<void> {
  await cancelReminders();
  for (const reminder of reminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: { title: reminder.title, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL_ID },
    });
  }
}

export const remindersSupported = true;
