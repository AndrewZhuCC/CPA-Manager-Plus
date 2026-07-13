import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  monitoringAnalyticsApi,
  type MonitoringAnalyticsCredentialStatRow,
  type MonitoringAnalyticsInclude,
  type MonitoringAnalyticsResponse,
} from '@/services/api/usageService';
import {
  credentialStatMatchesAuthFileIdentity,
  getAuthFileUsageWindowTargetsSignature,
  type AuthFileUsageWindowTarget,
} from '@/features/authFiles/model/authFileUsageSummary';

const AUTH_FILE_USAGE_HISTORY_FROM_MS = 1;
const AUTH_FILE_USAGE_REQUEST_CONCURRENCY = 4;
const AUTH_FILE_USAGE_ANALYTICS_INCLUDE = {
  credential_stats: true,
} satisfies MonitoringAnalyticsInclude;

export type AuthFileUsageRows = {
  retained: MonitoringAnalyticsCredentialStatRow[];
  retainedAvailable: boolean;
  fiveHour: MonitoringAnalyticsCredentialStatRow[];
  weekly: MonitoringAnalyticsCredentialStatRow[];
  windowSignature: string;
  windowTargetsComplete: boolean;
};

const createEmptyRows = (): AuthFileUsageRows => ({
  retained: [],
  retainedAvailable: false,
  fiveHour: [],
  weekly: [],
  windowSignature: getAuthFileUsageWindowTargetsSignature([]),
  windowTargetsComplete: true,
});

const readCredentialStats = (
  response: MonitoringAnalyticsResponse | null
): MonitoringAnalyticsCredentialStatRow[] => response?.credential_stats ?? [];

export interface FetchAuthFileUsageRowsOptions {
  managerServiceBase: string;
  managementKey: string;
  includeRetained?: boolean;
  retainedAuthFileNames?: string[];
  windowTargets?: AuthFileUsageWindowTarget[];
}

type AuthFileUsageWindowTargetResult = {
  rows: MonitoringAnalyticsCredentialStatRow[];
  succeeded: boolean;
};

const fetchWindowTargetRows = async (
  managerServiceBase: string,
  managementKey: string,
  target: AuthFileUsageWindowTarget
): Promise<AuthFileUsageWindowTargetResult> => {
  try {
    const response = await monitoringAnalyticsApi.getAnalytics(
      managerServiceBase,
      managementKey,
      {
        from_ms: target.fromMs,
        to_ms: target.toMs,
        now_ms: target.toMs,
        filters: {
          auth_files: [target.authFileName],
          ...(target.authIndex === null ? {} : { auth_indices: [target.authIndex] }),
        },
        include: AUTH_FILE_USAGE_ANALYTICS_INCLUDE,
      }
    );
    return {
      rows: readCredentialStats(response).filter((row) =>
        credentialStatMatchesAuthFileIdentity(target.authFileName, target.authIndex, row)
      ),
      succeeded: true,
    };
  } catch {
    return { rows: [], succeeded: false };
  }
};

const fetchWindowRows = async (
  managerServiceBase: string,
  managementKey: string,
  targets: AuthFileUsageWindowTarget[]
): Promise<Pick<AuthFileUsageRows, 'fiveHour' | 'weekly' | 'windowTargetsComplete'>> => {
  const rows: Pick<
    AuthFileUsageRows,
    'fiveHour' | 'weekly' | 'windowTargetsComplete'
  > = {
    fiveHour: [],
    weekly: [],
    windowTargetsComplete: true,
  };

  for (let index = 0; index < targets.length; index += AUTH_FILE_USAGE_REQUEST_CONCURRENCY) {
    const batch = targets.slice(index, index + AUTH_FILE_USAGE_REQUEST_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (target) => ({
        target,
        result: await fetchWindowTargetRows(managerServiceBase, managementKey, target),
      }))
    );
    results.forEach((result) => {
      rows[result.target.kind].push(...result.result.rows);
      if (!result.result.succeeded) rows.windowTargetsComplete = false;
    });
  }

  return rows;
};

export async function fetchAuthFileUsageRows({
  managerServiceBase,
  managementKey,
  includeRetained = true,
  retainedAuthFileNames = [],
  windowTargets = [],
}: FetchAuthFileUsageRowsOptions): Promise<AuthFileUsageRows> {
  const nowMs = Date.now();
  const retainedFiles = Array.from(
    new Set(retainedAuthFileNames.map((name) => name.trim()).filter(Boolean))
  );
  const retainedRequest = includeRetained
    ? monitoringAnalyticsApi.getAnalytics(
        managerServiceBase,
        managementKey,
        {
          from_ms: AUTH_FILE_USAGE_HISTORY_FROM_MS,
          to_ms: nowMs,
          now_ms: nowMs,
          ...(retainedFiles.length > 0
            ? { filters: { auth_files: retainedFiles } }
            : {}),
          include: AUTH_FILE_USAGE_ANALYTICS_INCLUDE,
        }
      )
        .then((response) => ({ response, available: true }))
        .catch(() => ({ response: null, available: false }))
    : Promise.resolve({ response: null, available: false });
  const [retained, windowRows] = await Promise.all([
    retainedRequest,
    fetchWindowRows(managerServiceBase, managementKey, windowTargets),
  ]);

  return {
    retained: readCredentialStats(retained.response),
    retainedAvailable: retained.available,
    fiveHour: windowRows.fiveHour,
    weekly: windowRows.weekly,
    windowSignature: getAuthFileUsageWindowTargetsSignature(windowTargets),
    windowTargetsComplete: windowRows.windowTargetsComplete,
  };
}

export interface UseAuthFileUsageAnalyticsOptions {
  managerServiceBase: string;
  managementKey: string;
  enabled: boolean;
  includeRetained?: boolean;
}

export function useAuthFileUsageAnalytics({
  managerServiceBase,
  managementKey,
  enabled,
  includeRetained = true,
}: UseAuthFileUsageAnalyticsOptions) {
  const [rows, setRows] = useState<AuthFileUsageRows>(createEmptyRows);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async (windowTargets: AuthFileUsageWindowTarget[] = []) => {
    if (!managerServiceBase || !enabled) {
      requestIdRef.current += 1;
      setRows(createEmptyRows());
      setLoading(false);
      return true;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setRows((current) => ({
      retained: includeRetained ? current.retained : [],
      retainedAvailable: includeRetained ? current.retainedAvailable : false,
      fiveHour: [],
      weekly: [],
      windowSignature: '',
      windowTargetsComplete: false,
    }));
    try {
      const nextRows = await fetchAuthFileUsageRows({
        managerServiceBase,
        managementKey,
        includeRetained,
        windowTargets,
      });

      if (requestId !== requestIdRef.current) return false;
      setRows(nextRows);
      return nextRows.windowTargetsComplete;
    } catch {
      if (requestId === requestIdRef.current) {
        setRows(createEmptyRows());
      }
      return false;
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, includeRetained, managementKey, managerServiceBase]);

  useLayoutEffect(() => {
    requestIdRef.current += 1;
    setRows(createEmptyRows());
    setLoading(false);
  }, [enabled, includeRetained, managementKey, managerServiceBase]);

  return { rows, loading, load };
}
