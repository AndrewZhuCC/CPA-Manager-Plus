import type { MonitoringAnalyticsCredentialStatRow } from '@/services/api/usageService';
import type { AuthFileItem, CodexQuotaState, CodexQuotaWindow } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';

const UNKNOWN_AUTH_INDEX_KEY = '-';
const CODEX_FIVE_HOUR_WINDOW_SECONDS = 18_000;
const CODEX_WEEKLY_WINDOW_SECONDS = 604_800;

export type AuthFileUsageSummary = {
  estimatedCost: number;
  totalTokens: number;
  recordedSuccessCalls: number;
  recordedFailureCalls: number;
  recordedUsageAvailable: boolean;
  codexFiveHourLimitTokens: number | null;
  codexFiveHourLimitCost: number | null;
  codexFiveHourRemainingTokens: number | null;
  codexFiveHourRemainingCost: number | null;
  codexWeeklyLimitTokens: number | null;
  codexWeeklyLimitCost: number | null;
  codexWeeklyRemainingTokens: number | null;
  codexWeeklyRemainingCost: number | null;
};

export type AuthFileUsageSummaryInput = {
  retainedRows: MonitoringAnalyticsCredentialStatRow[];
  retainedAvailable?: boolean;
  fiveHourRows: MonitoringAnalyticsCredentialStatRow[];
  weeklyRows: MonitoringAnalyticsCredentialStatRow[];
  codexQuota?: CodexQuotaState;
  nowMs?: number;
};

export type AuthFileUsageSummaryMapInput = Omit<AuthFileUsageSummaryInput, 'codexQuota'> & {
  codexQuotaByKey: Map<string, CodexQuotaState | undefined>;
};

export type AuthFileUsageWindowKind = 'fiveHour' | 'weekly';

export type AuthFileUsageWindowTarget = {
  key: string;
  kind: AuthFileUsageWindowKind;
  authFileName: string;
  authIndex: string | null;
  fromMs: number;
  toMs: number;
};

export const getAuthFileUsageWindowTargetsSignature = (
  targets: AuthFileUsageWindowTarget[]
): string =>
  JSON.stringify(
    targets.map((target) => [target.key, target.kind, target.fromMs, target.toMs] as const)
  );

const normalizeKey = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const getAuthFileAuthIndex = (file: AuthFileItem): string | null =>
  normalizeAuthIndex(file.authIndex ?? file['auth_index'] ?? file['auth-index']);

const normalizeAuthIndexKey = (value: unknown): string =>
  normalizeAuthIndex(value) ?? UNKNOWN_AUTH_INDEX_KEY;

export const getAuthFileUsageSummaryKey = (file: AuthFileItem): string =>
  `${file.name}::${normalizeAuthIndexKey(getAuthFileAuthIndex(file))}`;

export const credentialStatMatchesAuthFileIdentity = (
  authFileName: string,
  authIndex: string | null,
  row: MonitoringAnalyticsCredentialStatRow
): boolean => {
  if (normalizeKey(row.auth_file_snapshot) !== normalizeKey(authFileName)) return false;
  return normalizeAuthIndex(row.auth_index) === normalizeAuthIndex(authIndex);
};

const rowMatchesAuthFile = (
  file: AuthFileItem,
  row: MonitoringAnalyticsCredentialStatRow
): boolean => {
  return credentialStatMatchesAuthFileIdentity(file.name, getAuthFileAuthIndex(file), row);
};

const sumMatchingRows = (
  file: AuthFileItem,
  rows: MonitoringAnalyticsCredentialStatRow[]
): {
  totalTokens: number;
  estimatedCost: number;
  successCalls: number;
  failureCalls: number;
} =>
  rows.filter((row) => rowMatchesAuthFile(file, row)).reduce(
    (total, row) => ({
      totalTokens: total.totalTokens + normalizeFiniteNumber(row.total_tokens),
      estimatedCost: total.estimatedCost + normalizeFiniteNumber(row.cost),
      successCalls: total.successCalls + normalizeFiniteNumber(row.success_calls),
      failureCalls: total.failureCalls + normalizeFiniteNumber(row.failure_calls),
    }),
    { totalTokens: 0, estimatedCost: 0, successCalls: 0, failureCalls: 0 }
  );

const normalizeFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const normalizeWindowSeconds = (value: unknown): number | null => {
  const numberValue = normalizeFiniteNumber(value);
  return numberValue > 0 ? numberValue : null;
};

const findCodexQuotaWindow = (
  quota: CodexQuotaState | undefined,
  limitWindowSeconds: number
): CodexQuotaWindow | null => {
  const windows = quota?.windows ?? [];
  return (
    windows.find(
      (window) => normalizeWindowSeconds(window.limitWindowSeconds) === limitWindowSeconds
    ) ?? null
  );
};

const findCodexFiveHourWindow = (quota: CodexQuotaState | undefined) =>
  findCodexQuotaWindow(quota, CODEX_FIVE_HOUR_WINDOW_SECONDS);

const findCodexWeeklyWindow = (quota: CodexQuotaState | undefined) =>
  findCodexQuotaWindow(quota, CODEX_WEEKLY_WINDOW_SECONDS);

const normalizePositiveFiniteNumber = (value: unknown): number | null => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
};

const getCodexQuotaSampleAtMs = (
  quota: CodexQuotaState | undefined,
  window: CodexQuotaWindow | null
): number | null => {
  if (quota?.status !== 'success') return null;
  if (window && Object.prototype.hasOwnProperty.call(window, 'sampledAtMs')) {
    return normalizePositiveFiniteNumber(window.sampledAtMs);
  }
  if (quota.observedFromUsageHeaders === true) {
    return normalizePositiveFiniteNumber(quota.observedAtMs);
  }
  return normalizePositiveFiniteNumber(quota.fetchedAtMs);
};

const isQuotaWindowPeriodUsable = (
  quota: CodexQuotaState | undefined,
  window: CodexQuotaWindow | null,
  limitWindowSeconds: number,
  nowMs: number
): window is CodexQuotaWindow => {
  const quotaSampleAtMs = getCodexQuotaSampleAtMs(quota, window);
  const resetAtMs = normalizePositiveFiniteNumber(window?.resetAtMs);
  const usedPercent = normalizePositiveFiniteNumber(window?.usedPercent);
  if (quotaSampleAtMs === null || resetAtMs === null || usedPercent === null) return false;
  if (!Number.isFinite(nowMs) || resetAtMs <= nowMs || quotaSampleAtMs >= resetAtMs) return false;
  return quotaSampleAtMs >= resetAtMs - limitWindowSeconds * 1000;
};

const buildAuthFileUsageWindowTarget = (
  file: AuthFileItem,
  quota: CodexQuotaState | undefined,
  kind: AuthFileUsageWindowKind,
  nowMs: number
): AuthFileUsageWindowTarget | null => {
  const window =
    kind === 'fiveHour' ? findCodexFiveHourWindow(quota) : findCodexWeeklyWindow(quota);
  const limitWindowSeconds = normalizeWindowSeconds(window?.limitWindowSeconds);
  if (limitWindowSeconds === null) return null;
  if (!isQuotaWindowPeriodUsable(quota, window, limitWindowSeconds, nowMs)) return null;

  const resetAtMs = normalizePositiveFiniteNumber(window.resetAtMs);
  const quotaSampleAtMs = getCodexQuotaSampleAtMs(quota, window);
  if (resetAtMs === null || quotaSampleAtMs === null) return null;

  return {
    key: getAuthFileUsageSummaryKey(file),
    kind,
    authFileName: file.name,
    authIndex: getAuthFileAuthIndex(file),
    fromMs: resetAtMs - limitWindowSeconds * 1000,
    toMs: quotaSampleAtMs,
  };
};

export const buildAuthFileUsageWindowTargets = (
  files: AuthFileItem[],
  codexQuotaByKey: Map<string, CodexQuotaState | undefined>,
  nowMs = Date.now()
): AuthFileUsageWindowTarget[] => {
  const targets = new Map<string, AuthFileUsageWindowTarget>();

  files.forEach((file) => {
    const key = getAuthFileUsageSummaryKey(file);
    const quota = codexQuotaByKey.get(key);
    (['fiveHour', 'weekly'] as const).forEach((kind) => {
      const target = buildAuthFileUsageWindowTarget(file, quota, kind, nowMs);
      if (target) targets.set(`${key}:${kind}`, target);
    });
  });

  return Array.from(targets.values());
};

const estimateLimitValue = (
  value: number,
  usedPercent: unknown,
  options: { allowZero?: boolean } = {}
): number | null => {
  const normalizedValue = normalizeFiniteNumber(value);
  const normalizedPercent = normalizeFiniteNumber(usedPercent);
  if (normalizedPercent <= 0) return null;
  if (options.allowZero ? normalizedValue < 0 : normalizedValue <= 0) return null;
  return normalizedValue / (normalizedPercent / 100);
};

const estimateTokenLimit = (tokens: number, usedPercent: unknown): number | null => {
  const estimate = estimateLimitValue(tokens, usedPercent);
  return estimate === null ? null : Math.round(estimate);
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const estimateCostLimit = (
  cost: number,
  tokens: number,
  usedPercent: unknown
): number | null => {
  if (normalizeFiniteNumber(tokens) <= 0) return null;
  const estimate = estimateLimitValue(cost, usedPercent, { allowZero: true });
  return estimate === null ? null : roundCurrency(estimate);
};

const estimateRemainingTokens = (limit: number | null, used: number): number | null =>
  limit === null ? null : Math.max(0, Math.round(limit - normalizeFiniteNumber(used)));

const estimateRemainingCost = (limit: number | null, used: number): number | null =>
  limit === null
    ? null
    : roundCurrency(Math.max(0, limit - normalizeFiniteNumber(used)));

export const buildAuthFileUsageSummary = (
  file: AuthFileItem,
  input: AuthFileUsageSummaryInput
): AuthFileUsageSummary | undefined => {
  const retained = sumMatchingRows(file, input.retainedRows);
  const fiveHour = sumMatchingRows(file, input.fiveHourRows);
  const weekly = sumMatchingRows(file, input.weeklyRows);
  const retainedAvailable = input.retainedAvailable ?? true;
  const hasWindowUsage = fiveHour.totalTokens > 0 || weekly.totalTokens > 0;
  const recordedUsageAvailable =
    retainedAvailable && !(retained.totalTokens <= 0 && hasWindowUsage);
  const fiveHourQuotaWindow = findCodexFiveHourWindow(input.codexQuota);
  const weeklyQuotaWindow = findCodexWeeklyWindow(input.codexQuota);
  const fiveHourWindowSeconds = normalizeWindowSeconds(
    fiveHourQuotaWindow?.limitWindowSeconds
  );
  const weeklyWindowSeconds = normalizeWindowSeconds(weeklyQuotaWindow?.limitWindowSeconds);
  const nowMs = input.nowMs ?? Date.now();
  const usableFiveHourWindow =
    fiveHourWindowSeconds !== null &&
    isQuotaWindowPeriodUsable(
      input.codexQuota,
      fiveHourQuotaWindow,
      fiveHourWindowSeconds,
      nowMs
    );
  const usableWeeklyWindow =
    weeklyWindowSeconds !== null &&
    isQuotaWindowPeriodUsable(
      input.codexQuota,
      weeklyQuotaWindow,
      weeklyWindowSeconds,
      nowMs
    );
  const fiveHourLimitTokens = estimateTokenLimit(
    fiveHour.totalTokens,
    usableFiveHourWindow ? fiveHourQuotaWindow.usedPercent : null
  );
  const fiveHourLimitCost = estimateCostLimit(
    fiveHour.estimatedCost,
    fiveHour.totalTokens,
    usableFiveHourWindow ? fiveHourQuotaWindow.usedPercent : null
  );
  const fiveHourRemainingTokens = estimateRemainingTokens(
    fiveHourLimitTokens,
    fiveHour.totalTokens
  );
  const fiveHourRemainingCost = estimateRemainingCost(
    fiveHourLimitCost,
    fiveHour.estimatedCost
  );
  const weeklyLimitTokens = estimateTokenLimit(
    weekly.totalTokens,
    usableWeeklyWindow ? weeklyQuotaWindow.usedPercent : null
  );
  const weeklyLimitCost = estimateCostLimit(
    weekly.estimatedCost,
    weekly.totalTokens,
    usableWeeklyWindow ? weeklyQuotaWindow.usedPercent : null
  );
  const weeklyRemainingTokens = estimateRemainingTokens(weeklyLimitTokens, weekly.totalTokens);
  const weeklyRemainingCost = estimateRemainingCost(weeklyLimitCost, weekly.estimatedCost);

  if (
    retained.totalTokens <= 0 &&
    retained.estimatedCost <= 0 &&
    retained.successCalls <= 0 &&
    retained.failureCalls <= 0 &&
    fiveHourLimitTokens === null &&
    fiveHourLimitCost === null &&
    fiveHourRemainingTokens === null &&
    fiveHourRemainingCost === null &&
    weeklyLimitTokens === null &&
    weeklyLimitCost === null &&
    weeklyRemainingTokens === null &&
    weeklyRemainingCost === null
  ) {
    return undefined;
  }

  return {
    estimatedCost: retained.estimatedCost,
    totalTokens: retained.totalTokens,
    recordedSuccessCalls: retained.successCalls,
    recordedFailureCalls: retained.failureCalls,
    recordedUsageAvailable,
    codexFiveHourLimitTokens: fiveHourLimitTokens,
    codexFiveHourLimitCost: fiveHourLimitCost,
    codexFiveHourRemainingTokens: fiveHourRemainingTokens,
    codexFiveHourRemainingCost: fiveHourRemainingCost,
    codexWeeklyLimitTokens: weeklyLimitTokens,
    codexWeeklyLimitCost: weeklyLimitCost,
    codexWeeklyRemainingTokens: weeklyRemainingTokens,
    codexWeeklyRemainingCost: weeklyRemainingCost,
  };
};

export const buildAuthFileUsageSummaryMap = (
  files: AuthFileItem[],
  input: AuthFileUsageSummaryMapInput
): Map<string, AuthFileUsageSummary> => {
  const summaries = new Map<string, AuthFileUsageSummary>();
  files.forEach((file) => {
    const key = getAuthFileUsageSummaryKey(file);
    const summary = buildAuthFileUsageSummary(file, {
      retainedRows: input.retainedRows,
      retainedAvailable: input.retainedAvailable,
      fiveHourRows: input.fiveHourRows,
      weeklyRows: input.weeklyRows,
      codexQuota: input.codexQuotaByKey.get(key),
      nowMs: input.nowMs,
    });
    if (summary) summaries.set(key, summary);
  });
  return summaries;
};
