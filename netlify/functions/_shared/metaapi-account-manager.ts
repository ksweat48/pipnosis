const PRIMARY_ACCOUNT = process.env.METAAPI_ACCOUNT_ID || '';
const BACKUP_ACCOUNT = process.env.METAAPI_ACCOUNT_ID_FALLBACK || '';

interface AccountStatus {
  accountId: string;
  failureCount: number;
  lastFailure: number | null;
  lastSuccess: number | null;
}

const accountStatuses = new Map<string, AccountStatus>();

function initializeAccount(accountId: string): AccountStatus {
  if (!accountStatuses.has(accountId)) {
    accountStatuses.set(accountId, {
      accountId,
      failureCount: 0,
      lastFailure: null,
      lastSuccess: null
    });
  }
  return accountStatuses.get(accountId)!;
}

export function getWorkingMetaApiAccount(): string {
  const primary = initializeAccount(PRIMARY_ACCOUNT);
  const backup = BACKUP_ACCOUNT ? initializeAccount(BACKUP_ACCOUNT) : null;

  const now = Date.now();
  const FAILURE_THRESHOLD = 3;
  const COOLDOWN_MS = 5 * 60 * 1000;

  if (primary.failureCount < FAILURE_THRESHOLD) {
    return PRIMARY_ACCOUNT;
  }

  if (primary.lastFailure && now - primary.lastFailure > COOLDOWN_MS) {
    primary.failureCount = 0;
    return PRIMARY_ACCOUNT;
  }

  if (backup && backup.failureCount < FAILURE_THRESHOLD) {
    return BACKUP_ACCOUNT;
  }

  return PRIMARY_ACCOUNT;
}

export function markAccountFailed(accountId: string, error?: any): void {
  const status = initializeAccount(accountId);
  status.failureCount++;
  status.lastFailure = Date.now();

  console.warn(`[MetaApiAccountManager] Account ${accountId.slice(0, 8)}... marked as failed (count: ${status.failureCount})`);
  if (error) {
    console.warn(`[MetaApiAccountManager] Error:`, error.message || error);
  }
}

export function markAccountSuccess(accountId: string): void {
  const status = initializeAccount(accountId);

  if (status.failureCount > 0) {
    status.failureCount = 0;
    console.log(`[MetaApiAccountManager] Account ${accountId.slice(0, 8)}... recovered and marked successful`);
  }

  status.lastSuccess = Date.now();
}
