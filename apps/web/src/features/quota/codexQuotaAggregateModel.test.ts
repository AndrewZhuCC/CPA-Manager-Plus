import { describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { AuthFileUsageSummary } from '@/features/authFiles/model/authFileUsageSummary';
import { getAuthFileUsageSummaryKey } from '@/features/authFiles/model/authFileUsageSummary';
import { buildCodexQuotaAggregateSummary } from './codexQuotaAggregateModel';

const summary = (
  overrides: Partial<AuthFileUsageSummary> = {}
): AuthFileUsageSummary => ({
  estimatedCost: 0,
  totalTokens: 0,
  recordedUsageAvailable: true,
  codexFiveHourLimitTokens: null,
  codexFiveHourLimitCost: null,
  codexFiveHourRemainingTokens: null,
  codexFiveHourRemainingCost: null,
  codexWeeklyLimitTokens: null,
  codexWeeklyLimitCost: null,
  codexWeeklyRemainingTokens: null,
  codexWeeklyRemainingCost: null,
  ...overrides,
});

describe('Codex quota aggregate summary', () => {
  it('sums 5-hour and weekly remaining estimates independently', () => {
    const files: AuthFileItem[] = [
      { name: 'shared.json', type: 'codex', authIndex: '0' },
      { name: 'shared.json', type: 'codex', authIndex: '1' },
      { name: 'missing.json', type: 'codex', authIndex: '0' },
    ];
    const summaries = new Map<string, AuthFileUsageSummary>([
      [
        getAuthFileUsageSummaryKey(files[0]),
        summary({
          codexFiveHourRemainingTokens: 15_000,
          codexFiveHourRemainingCost: 0.75,
          codexWeeklyRemainingTokens: 42_000,
          codexWeeklyRemainingCost: 4.2,
        }),
      ],
      [
        getAuthFileUsageSummaryKey(files[1]),
        summary({
          codexFiveHourRemainingTokens: 25_000,
          codexFiveHourRemainingCost: 1.25,
          codexWeeklyRemainingTokens: 58_000,
          codexWeeklyRemainingCost: 5.8,
        }),
      ],
    ]);

    expect(buildCodexQuotaAggregateSummary(files, summaries)).toEqual({
      fiveHour: {
        remainingTokens: 40_000,
        remainingCost: 2,
        estimatedCredentialCount: 2,
        eligibleCredentialCount: 3,
      },
      weekly: {
        remainingTokens: 100_000,
        remainingCost: 10,
        estimatedCredentialCount: 2,
        eligibleCredentialCount: 3,
      },
    });
  });

  it('returns unavailable totals when no credential is estimable', () => {
    const files: AuthFileItem[] = [{ name: 'missing.json', type: 'codex', authIndex: '0' }];

    expect(buildCodexQuotaAggregateSummary(files, new Map())).toEqual({
      fiveHour: {
        remainingTokens: null,
        remainingCost: null,
        estimatedCredentialCount: 0,
        eligibleCredentialCount: 1,
      },
      weekly: {
        remainingTokens: null,
        remainingCost: null,
        estimatedCredentialCount: 0,
        eligibleCredentialCount: 1,
      },
    });
  });

  it('counts eligibility separately for mixed weekly-only and five-hour credentials', () => {
    const files: AuthFileItem[] = [
      { name: 'k12.json', type: 'codex', authIndex: '0' },
      { name: 'plus.json', type: 'codex', authIndex: '0' },
    ];
    const summaries = new Map<string, AuthFileUsageSummary>([
      [
        getAuthFileUsageSummaryKey(files[0]),
        summary({
          codexFiveHourRemainingTokens: 15_000,
          codexFiveHourRemainingCost: 0.75,
          codexWeeklyRemainingTokens: 42_000,
          codexWeeklyRemainingCost: 4.2,
        }),
      ],
      [
        getAuthFileUsageSummaryKey(files[1]),
        summary({
          codexFiveHourRemainingTokens: 999_999,
          codexFiveHourRemainingCost: 999.99,
          codexWeeklyRemainingTokens: 58_000,
          codexWeeklyRemainingCost: 5.8,
        }),
      ],
    ]);
    const targets = [
      {
        key: getAuthFileUsageSummaryKey(files[0]),
        kind: 'fiveHour' as const,
        authFileName: files[0].name,
        authIndex: '0',
        fromMs: 1,
        toMs: 2,
      },
      {
        key: getAuthFileUsageSummaryKey(files[0]),
        kind: 'weekly' as const,
        authFileName: files[0].name,
        authIndex: '0',
        fromMs: 1,
        toMs: 2,
      },
      {
        key: getAuthFileUsageSummaryKey(files[1]),
        kind: 'weekly' as const,
        authFileName: files[1].name,
        authIndex: '0',
        fromMs: 1,
        toMs: 2,
      },
    ];

    expect(buildCodexQuotaAggregateSummary(files, summaries, targets)).toEqual({
      fiveHour: {
        remainingTokens: 15_000,
        remainingCost: 0.75,
        estimatedCredentialCount: 1,
        eligibleCredentialCount: 1,
      },
      weekly: {
        remainingTokens: 100_000,
        remainingCost: 10,
        estimatedCredentialCount: 2,
        eligibleCredentialCount: 2,
      },
    });
  });
});
