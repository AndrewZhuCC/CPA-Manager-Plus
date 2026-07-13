import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitoringAnalyticsResponse } from '@/services/api/usageService';
import {
  getAuthFileUsageWindowTargetsSignature,
  type AuthFileUsageWindowTarget,
} from '@/features/authFiles/model/authFileUsageSummary';
import {
  fetchAuthFileUsageRows,
  useAuthFileUsageAnalytics,
} from './useAuthFileUsageAnalytics';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getAnalytics: vi.fn(),
  },
}));

vi.mock('@/services/api/usageService', () => ({
  monitoringAnalyticsApi: {
    getAnalytics: mocks.getAnalytics,
  },
}));

const targets: AuthFileUsageWindowTarget[] = [
  {
    key: 'codex-main.json::0',
    kind: 'fiveHour',
    authFileName: 'codex-main.json',
    authIndex: '0',
    fromMs: 1_700_000_000_000,
    toMs: 1_700_010_000_000,
  },
  {
    key: 'codex-main.json::0',
    kind: 'weekly',
    authFileName: 'codex-main.json',
    authIndex: '0',
    fromMs: 1_699_500_000_000,
    toMs: 1_700_010_000_000,
  },
];

type RowsSnapshot = {
  fiveHour: number;
  weekly: number;
  windowSignature: string;
  windowTargetsComplete: boolean;
};

const analyticsResponse = (id: string): MonitoringAnalyticsResponse => ({
  generated_at_ms: 1_700_000_000_000,
  granularity: 'hour',
  credential_stats: [
    {
      id,
      auth_file_snapshot: 'codex-main.json',
      auth_index: '0',
      calls: 1,
      success_calls: 1,
      failure_calls: 0,
      success_rate: 1,
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 1,
      cost: 0.01,
      average_latency_ms: null,
      last_seen_ms: 0,
    },
  ],
});

function Harness({
  onRows,
  windowTargets = targets,
}: {
  onRows: (value: RowsSnapshot) => void;
  windowTargets?: AuthFileUsageWindowTarget[];
}) {
  const { rows, load } = useAuthFileUsageAnalytics({
    managerServiceBase: 'http://manager.local:18317',
    managementKey: 'test-key',
    enabled: true,
    includeRetained: false,
  });

  useEffect(() => {
    void load(windowTargets);
  }, [load, windowTargets]);

  useEffect(() => {
    onRows({
      fiveHour: rows.fiveHour.length,
      weekly: rows.weekly.length,
      windowSignature: rows.windowSignature,
      windowTargetsComplete: rows.windowTargetsComplete,
    });
  }, [onRows, rows]);

  return null;
}

describe('useAuthFileUsageAnalytics', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.getAnalytics.mockReset();
  });

  it('loads exact reset-aligned credential windows when retained history is disabled', async () => {
    mocks.getAnalytics.mockImplementation(
      (_base: string, _key: string, request: { from_ms: number }) =>
        Promise.resolve(
          analyticsResponse(request.from_ms === targets[0].fromMs ? 'five-hour' : 'weekly')
        )
    );
    const onRows = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<Harness onRows={onRows} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
    expect(mocks.getAnalytics.mock.calls.map((call) => call[2])).toEqual([
      {
        from_ms: targets[0].fromMs,
        to_ms: targets[0].toMs,
        now_ms: targets[0].toMs,
        filters: {
          auth_files: ['codex-main.json'],
          auth_indices: ['0'],
        },
        include: { credential_stats: true },
      },
      {
        from_ms: targets[1].fromMs,
        to_ms: targets[1].toMs,
        now_ms: targets[1].toMs,
        filters: {
          auth_files: ['codex-main.json'],
          auth_indices: ['0'],
        },
        include: { credential_stats: true },
      },
    ]);
    expect(onRows).toHaveBeenLastCalledWith({
      fiveHour: 1,
      weekly: 1,
      windowSignature: getAuthFileUsageWindowTargetsSignature(targets),
      windowTargetsComplete: true,
    });

    act(() => renderer.unmount());
  });

  it('clears rows until analytics for the new quota window finishes loading', async () => {
    const previousTargets = [targets[0]];
    const nextTargets: AuthFileUsageWindowTarget[] = [
      {
        ...targets[0],
        fromMs: targets[0].fromMs + 18_000_000,
        toMs: targets[0].toMs + 18_000_000,
      },
    ];
    let resolveNext!: (response: MonitoringAnalyticsResponse) => void;
    const nextResponse = new Promise<MonitoringAnalyticsResponse>((resolve) => {
      resolveNext = resolve;
    });
    mocks.getAnalytics
      .mockResolvedValueOnce(analyticsResponse('previous-window'))
      .mockReturnValueOnce(nextResponse);
    const onRows = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<Harness onRows={onRows} windowTargets={previousTargets} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(onRows).toHaveBeenLastCalledWith({
        fiveHour: 1,
        weekly: 0,
        windowSignature: getAuthFileUsageWindowTargetsSignature(previousTargets),
        windowTargetsComplete: true,
      });
    });

    await act(async () => {
      renderer.update(<Harness onRows={onRows} windowTargets={nextTargets} />);
      await Promise.resolve();
    });

    expect(onRows).toHaveBeenLastCalledWith({
      fiveHour: 0,
      weekly: 0,
      windowSignature: '',
      windowTargetsComplete: false,
    });

    await act(async () => {
      resolveNext(analyticsResponse('next-window'));
      await nextResponse;
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(onRows).toHaveBeenLastCalledWith({
        fiveHour: 1,
        weekly: 0,
        windowSignature: getAuthFileUsageWindowTargetsSignature(nextTargets),
        windowTargetsComplete: true,
      });
    });

    act(() => renderer.unmount());
  });

  it('marks partial window request failures so the page can retry the same targets', async () => {
    mocks.getAnalytics.mockRejectedValueOnce(new Error('temporary failure'));

    const rows = await fetchAuthFileUsageRows({
      managerServiceBase: 'http://manager.local:18317',
      managementKey: 'test-key',
      includeRetained: false,
      windowTargets: [targets[0]],
    });

    expect(rows.fiveHour).toEqual([]);
    expect(rows.windowSignature).toBe(
      getAuthFileUsageWindowTargetsSignature([targets[0]])
    );
    expect(rows.windowTargetsComplete).toBe(false);
  });

  it('marks retained history unavailable without discarding successful window rows', async () => {
    mocks.getAnalytics
      .mockRejectedValueOnce(new Error('retained query timed out'))
      .mockResolvedValueOnce(analyticsResponse('weekly-window'));

    const rows = await fetchAuthFileUsageRows({
      managerServiceBase: 'http://manager.local:18317',
      managementKey: 'test-key',
      includeRetained: true,
      windowTargets: [targets[1]],
    });

    expect(rows.retained).toEqual([]);
    expect(rows.retainedAvailable).toBe(false);
    expect(rows.weekly).toHaveLength(1);
    expect(rows.windowTargetsComplete).toBe(true);
  });

  it('scopes retained history to the current auth file names', async () => {
    mocks.getAnalytics.mockResolvedValueOnce(analyticsResponse('retained'));

    const rows = await fetchAuthFileUsageRows({
      managerServiceBase: 'http://manager.local:18317',
      managementKey: 'test-key',
      includeRetained: true,
      retainedAuthFileNames: ['codex-main.json', 'codex-main.json', ' second.json '],
      windowTargets: [],
    });

    expect(mocks.getAnalytics).toHaveBeenCalledWith(
      'http://manager.local:18317',
      'test-key',
      expect.objectContaining({
        filters: {
          auth_files: ['codex-main.json', 'second.json'],
        },
        include: { credential_stats: true },
      })
    );
    expect(rows.retainedAvailable).toBe(true);
    expect(rows.retained).toHaveLength(1);
  });
});
