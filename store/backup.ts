import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { CURRENT_VERSION, migratePersistedState } from './migrations';
import { netWorthEGP } from './selectors';
import type { FinanceState } from './types';

// Backup files: pure (no React Native imports) so the format and crypto are testable in Node.
//
//   { app: 'wealth', schemaVersion, exportedAt, deviceId, encrypted, payload }
//
// Plain backups carry the data itself as `payload`. Encrypted ones carry an EncryptedPayload:
// AES-256-GCM over the JSON data, keyed by PBKDF2-SHA256 (200k iterations, random salt). The
// header is bound to the ciphertext as associated data, so it can't be swapped. The password
// is never stored.

export const BACKUP_APP = 'wealth';
export const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

export interface EncryptedPayload {
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string; // hex
  nonce: string; // hex
  ciphertext: string; // hex, includes the GCM tag
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  exportedAt: string;
  deviceId: string;
  encrypted: boolean;
  payload: unknown;
}

export type BackupErrorCode = 'INVALID_FILE' | 'UNSUPPORTED_VERSION' | 'PASSWORD_REQUIRED' | 'WRONG_PASSWORD';

export class BackupError extends Error {
  override name = 'BackupError';
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface BackupCrypto {
  randomBytes: (length: number) => Uint8Array;
  // Lower only in tests; files record the count they were made with.
  iterations?: number;
}

// --- UTF-8 (TextDecoder isn't guaranteed on Hermes) --------------------------

export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 31) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      i += 3;
    } else {
      code = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

// --- Encryption --------------------------------------------------------------

function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8Encode(password), salt, { c: iterations, dkLen: 32 });
}

// Binds the header fields that matter to the ciphertext.
function associatedData(file: Pick<BackupFile, 'app' | 'schemaVersion' | 'exportedAt' | 'deviceId'>) {
  return utf8Encode(`${file.app}|${file.schemaVersion}|${file.exportedAt}|${file.deviceId}`);
}

// --- Export ------------------------------------------------------------------

export interface ExportOptions {
  // Omit for an unencrypted backup.
  password?: string;
  now: Date;
  crypto: BackupCrypto;
}

export async function createBackup(data: FinanceState, options: ExportOptions): Promise<BackupFile> {
  const header = {
    app: BACKUP_APP,
    schemaVersion: CURRENT_VERSION,
    exportedAt: options.now.toISOString(),
    deviceId: data.settings.deviceId,
  } as const;
  if (!options.password) return { ...header, encrypted: false, payload: data };

  const iterations = options.crypto.iterations ?? PBKDF2_ITERATIONS;
  const salt = options.crypto.randomBytes(SALT_BYTES);
  const nonce = options.crypto.randomBytes(NONCE_BYTES);
  const key = await deriveKey(options.password, salt, iterations);
  const ciphertext = gcm(key, nonce, associatedData(header)).encrypt(utf8Encode(JSON.stringify(data)));
  const payload: EncryptedPayload = {
    kdf: 'pbkdf2-sha256',
    iterations,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
  return { ...header, encrypted: true, payload };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file);
}

// wealth-backup-YYYY-MM-DD.json (local date)
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `wealth-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// --- Import ------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Parses and validates the envelope only; the payload is checked when it's opened.
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('INVALID_FILE');
  }
  if (
    !isObject(raw) ||
    raw.app !== BACKUP_APP ||
    typeof raw.schemaVersion !== 'number' ||
    !Number.isInteger(raw.schemaVersion) ||
    typeof raw.exportedAt !== 'string' ||
    typeof raw.encrypted !== 'boolean' ||
    !isObject(raw.payload)
  ) {
    throw new BackupError('INVALID_FILE');
  }
  if (raw.schemaVersion < 0 || raw.schemaVersion > CURRENT_VERSION) throw new BackupError('UNSUPPORTED_VERSION');
  if (raw.encrypted && !isEncryptedPayload(raw.payload)) throw new BackupError('INVALID_FILE');
  return {
    app: BACKUP_APP,
    schemaVersion: raw.schemaVersion,
    exportedAt: raw.exportedAt,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    encrypted: raw.encrypted,
    payload: raw.payload,
  };
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    isObject(value) &&
    value.kdf === 'pbkdf2-sha256' &&
    typeof value.iterations === 'number' &&
    value.iterations > 0 &&
    ['salt', 'nonce', 'ciphertext'].every((k) => typeof value[k] === 'string' && /^[0-9a-f]+$/i.test(value[k] as string))
  );
}

export interface OpenOptions {
  password?: string;
  // Used by migrations of older exports.
  now: Date;
  newId: () => string;
}

export interface OpenedBackup {
  state: FinanceState;
  schemaVersion: number;
  exportedAt: string;
  deviceId: string;
}

// Decrypts (if needed), validates and migrates a backup to the current schema. Throws
// BackupError; never touches app state.
export async function openBackup(file: BackupFile, options: OpenOptions): Promise<OpenedBackup> {
  let data: unknown = file.payload;
  if (file.encrypted) {
    if (!options.password) throw new BackupError('PASSWORD_REQUIRED');
    const payload = file.payload as EncryptedPayload;
    const key = await deriveKey(options.password, hexToBytes(payload.salt), payload.iterations);
    let plain: Uint8Array;
    try {
      plain = gcm(key, hexToBytes(payload.nonce), associatedData(file)).decrypt(hexToBytes(payload.ciphertext));
    } catch {
      // GCM authentication fails for a wrong password (or a tampered file).
      throw new BackupError('WRONG_PASSWORD');
    }
    try {
      data = JSON.parse(utf8Decode(plain));
    } catch {
      throw new BackupError('INVALID_FILE');
    }
  }
  if (!isObject(data)) throw new BackupError('INVALID_FILE');

  // v0/v1 data has assets; v2+ has accounts. Anything else isn't Wealth data.
  const looksLikeData = file.schemaVersion <= 1 ? Array.isArray(data.assets) : Array.isArray(data.accounts);
  if (!looksLikeData) throw new BackupError('INVALID_FILE');

  const { state } = migratePersistedState(data, file.schemaVersion, {
    now: options.now.toISOString(),
    newId: options.newId,
  });
  return { state, schemaVersion: file.schemaVersion, exportedAt: file.exportedAt, deviceId: file.deviceId };
}

export interface BackupPreview {
  accounts: number;
  transactions: number;
  holdings: number;
  funds: number;
  netWorthEGP: number;
  exportedAt: string;
}

export function backupPreview(opened: OpenedBackup): BackupPreview {
  const { state } = opened;
  return {
    accounts: state.accounts.length,
    transactions: state.transactions.length,
    holdings: state.holdings.length,
    funds: state.funds.length,
    netWorthEGP: netWorthEGP(state),
    exportedAt: opened.exportedAt,
  };
}
