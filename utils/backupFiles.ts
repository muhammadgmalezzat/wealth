import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Native backup file I/O. See backupFiles.web.ts for the browser versions.

// Writes the backup to the cache and opens the share sheet, so the user can save it to
// Google Drive, Files, email it, etc.
export async function saveBackupFile(fileName: string, contents: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(contents);
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARING_UNAVAILABLE');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'حفظ النسخة الاحتياطية',
  });
}

// Lets the user pick a backup file; resolves to its text, or null when cancelled.
export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return new File(result.assets[0].uri).text();
}
