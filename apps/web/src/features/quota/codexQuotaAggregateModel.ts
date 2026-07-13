import type { AuthFileItem } from '@/types';
import {
  getAuthFileUsageSummaryKey,
  type AuthFileUsageSummary,
  type AuthFileUsageWindowTarget,
} from '@/features/authFiles/model/authFileUsageSummary';

export type CodexQuotaAggregateWindow = {
  remainingTokens: number | null;
  remainingCost: number | null;
  estimatedCredentialCount: number;
  eligibleCredentialCount: number;
};

export type CodexQuotaAggregateSummary = {
  fiveHour: CodexQuotaAggregateWindow;
  weekly: CodexQuotaAggregateWindow;
};

type RemainingFields = Pick<
  AuthFileUsageSummary,
  | 'codexFiveHourRemainingTokens'
  | 'codexFiveHourRemainingCost'
  | 'codexWeeklyRemainingTokens'
  | 'codexWeeklyRemainingCost'
>;

const buildAggregateWindow = (
  files: AuthFileItem[],
  summaries: Map<string, AuthFileUsageSummary>,
  tokenField: keyof RemainingFields,
  costField: keyof RemainingFields,
  eligibleUsageKeys?: Set<string>
): CodexQuotaAggregateWindow => {
  let remainingTokens = 0;
  let remainingCost = 0;
  let estimatedCredentialCount = 0;

  files.forEach((file) => {
    const usageKey = getAuthFileUsageSummaryKey(file);
    if (eligibleUsageKeys && !eligibleUsageKeys.has(usageKey)) return;
    const summary = summaries.get(usageKey);
    const tokens = summary?.[tokenField];
    const cost = summary?.[costField];
    if (typeof tokens !== 'number' || typeof cost !== 'number') return;

    remainingTokens += tokens;
    remainingCost += cost;
    estimatedCredentialCount += 1;
  });

  return {
    remainingTokens: estimatedCredentialCount > 0 ? Math.round(remainingTokens) : null,
    remainingCost:
      estimatedCredentialCount > 0 ? Math.round(remainingCost * 100) / 100 : null,
    estimatedCredentialCount,
    eligibleCredentialCount: eligibleUsageKeys?.size ?? files.length,
  };
};

const getEligibleUsageKeys = (
  targets: AuthFileUsageWindowTarget[] | undefined,
  kind: AuthFileUsageWindowTarget['kind']
): Set<string> | undefined => {
  if (!targets) return undefined;
  return new Set(targets.filter((target) => target.kind === kind).map((target) => target.key));
};

export const buildCodexQuotaAggregateSummary = (
  files: AuthFileItem[],
  summaries: Map<string, AuthFileUsageSummary>,
  targets?: AuthFileUsageWindowTarget[]
): CodexQuotaAggregateSummary => ({
  fiveHour: buildAggregateWindow(
    files,
    summaries,
    'codexFiveHourRemainingTokens',
    'codexFiveHourRemainingCost',
    getEligibleUsageKeys(targets, 'fiveHour')
  ),
  weekly: buildAggregateWindow(
    files,
    summaries,
    'codexWeeklyRemainingTokens',
    'codexWeeklyRemainingCost',
    getEligibleUsageKeys(targets, 'weekly')
  ),
});
