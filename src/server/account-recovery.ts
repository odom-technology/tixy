import crypto from 'node:crypto';

import {
  getAccountData,
  getAccountByEmail,
  resetAccountPassword,
  revokeAllAccountSessions,
  saveAccountData,
} from '@/server/accounts';

export const RECOVERY_CODES_DATA_KEY = 'auth.recovery_codes';

export type RecoveryCodeSummary = {
  createdAt: number | null;
  updatedAt: number | null;
  lastUsedAt: number | null;
  remainingCount: number;
};

type RecoveryCodeEntry = {
  hash: string;
  createdAt: number;
  usedAt: number | null;
};

type RecoveryCodesRecord = {
  version: 1;
  createdAt: number;
  updatedAt: number;
  entries: RecoveryCodeEntry[];
};

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;

function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(value: string) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex');
}

function formatRecoveryCode(bytes: Buffer) {
  return bytes.toString('hex').toUpperCase().match(/.{1,4}/g)?.join('-') ?? '';
}

function createRecoveryCode() {
  return formatRecoveryCode(crypto.randomBytes(RECOVERY_CODE_BYTES));
}

function readRecoveryCodesRecord(value: unknown): RecoveryCodesRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RecoveryCodesRecord>;
  if (record.version !== 1 || !Array.isArray(record.entries)) return null;
  const entries = record.entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const candidate = entry as Partial<RecoveryCodeEntry>;
      if (typeof candidate.hash !== 'string' || !candidate.hash) return null;
      return {
        hash: candidate.hash,
        createdAt:
          typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
            ? candidate.createdAt
            : 0,
        usedAt:
          typeof candidate.usedAt === 'number' && Number.isFinite(candidate.usedAt)
            ? candidate.usedAt
            : null,
      };
    })
    .filter(Boolean) as RecoveryCodeEntry[];
  if (entries.length === 0) return null;
  return {
    version: 1,
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : entries[0].createdAt,
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : entries[0].createdAt,
    entries,
  };
}

function summarizeRecoveryCodes(record: RecoveryCodesRecord | null): RecoveryCodeSummary {
  if (!record) {
    return {
      createdAt: null,
      updatedAt: null,
      lastUsedAt: null,
      remainingCount: 0,
    };
  }

  return {
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt:
      record.entries
        .map((entry) => entry.usedAt)
        .filter((usedAt): usedAt is number => typeof usedAt === 'number')
        .sort((a, b) => b - a)[0] ?? null,
    remainingCount: record.entries.filter((entry) => !entry.usedAt).length,
  };
}

export async function getRecoveryCodeSummary(userId: string) {
  const data = await getAccountData(userId, RECOVERY_CODES_DATA_KEY);
  return summarizeRecoveryCodes(readRecoveryCodesRecord(data?.value));
}

export async function rotateRecoveryCodes(userId: string) {
  const now = Date.now();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
  const record: RecoveryCodesRecord = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: codes.map((code) => ({
      hash: hashRecoveryCode(code),
      createdAt: now,
      usedAt: null,
    })),
  };

  await saveAccountData({
    userId,
    key: RECOVERY_CODES_DATA_KEY,
    value: record,
  });

  return {
    codes,
    summary: summarizeRecoveryCodes(record),
  };
}

async function consumeRecoveryCode(userId: string, recoveryCode: string) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length < 12) return null;

  const data = await getAccountData(userId, RECOVERY_CODES_DATA_KEY);
  const record = readRecoveryCodesRecord(data?.value);
  if (!record) return null;

  const hash = hashRecoveryCode(normalized);
  const index = record.entries.findIndex(
    (entry) => !entry.usedAt && entry.hash === hash,
  );
  if (index === -1) return null;

  const now = Date.now();
  const nextRecord: RecoveryCodesRecord = {
    ...record,
    updatedAt: now,
    entries: record.entries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, usedAt: now } : entry,
    ),
  };

  await saveAccountData({
    userId,
    key: RECOVERY_CODES_DATA_KEY,
    value: nextRecord,
  });

  return summarizeRecoveryCodes(nextRecord);
}

export async function recoverAccountWithCode(input: {
  email: string;
  recoveryCode: string;
  newPassword: string;
}) {
  if (!input.newPassword || input.newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const account = await getAccountByEmail(input.email);
  if (!account || account.status !== 'active') {
    throw new Error('Invalid email or recovery code.');
  }

  const summary = await consumeRecoveryCode(account.id, input.recoveryCode);
  if (!summary) {
    throw new Error('Invalid email or recovery code.');
  }

  await resetAccountPassword({
    userId: account.id,
    newPassword: input.newPassword,
  });
  await revokeAllAccountSessions(account.id);

  return {
    account,
    summary,
  };
}
