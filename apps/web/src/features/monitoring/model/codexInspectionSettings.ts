import type {
  CodexInspectionAction,
  CodexInspectionAutoActionMode,
  CodexInspectionConfigurableSettings,
  CodexInspectionLogLevel,
  CodexInspectionStoredActionFilter,
  CodexInspectionTargetType,
} from '@/features/monitoring/codexInspection';
import type { Config } from '@/types';
import { normalizeNumberValue } from '@/utils/quota';
import { CODEX_REQUEST_HEADERS, XAI_GROK_USER_AGENT } from '@/utils/quota/constants';

export const CODEX_INSPECTION_SETTINGS_STORAGE_KEY = 'cli-proxy-codex-inspection-settings-v1';

export const CODEX_INSPECTION_AUTO_ACTION_MODES: readonly CodexInspectionAutoActionMode[] = [
  'none',
  'enable',
  'disable',
  'delete',
];

export const CODEX_INSPECTION_TARGET_TYPES: readonly CodexInspectionTargetType[] = ['codex', 'xai'];

export const DEFAULT_CODEX_INSPECTION_CODEX_USER_AGENT = CODEX_REQUEST_HEADERS['User-Agent'];
export const DEFAULT_CODEX_INSPECTION_XAI_USER_AGENT = XAI_GROK_USER_AGENT;

export const DEFAULT_CODEX_INSPECTION_SETTINGS: CodexInspectionConfigurableSettings = {
  targetTypes: ['codex'],
  targetType: 'codex',
  workers: 4,
  deleteWorkers: 4,
  timeout: 15000,
  retries: 0,
  codexUserAgent: DEFAULT_CODEX_INSPECTION_CODEX_USER_AGENT,
  xaiUserAgent: DEFAULT_CODEX_INSPECTION_XAI_USER_AGENT,
  userAgent: DEFAULT_CODEX_INSPECTION_CODEX_USER_AGENT,
  usedPercentThreshold: 100,
  sampleSize: 0,
  autoActionMode: 'none',
  autoRecoverEnabled: false,
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const clampPositiveInteger = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
};

const normalizeThreshold = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return NaN;
  if (normalized > 0 && normalized <= 1) {
    return normalized * 100;
  }
  return normalized;
};

export const readString = (value: unknown) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

type InspectionUserAgentInput = {
  codexUserAgent?: unknown;
  xaiUserAgent?: unknown;
  userAgent?: unknown;
};

export const normalizeInspectionUserAgents = (
  input?: InspectionUserAgentInput | null,
  fallback?: InspectionUserAgentInput | null
) => {
  const fallbackCodexUserAgent =
    readString(fallback?.codexUserAgent) ||
    readString(fallback?.userAgent) ||
    DEFAULT_CODEX_INSPECTION_CODEX_USER_AGENT;
  const codexUserAgent =
    readString(input?.codexUserAgent) || readString(input?.userAgent) || fallbackCodexUserAgent;
  const xaiUserAgent =
    readString(input?.xaiUserAgent) ||
    readString(fallback?.xaiUserAgent) ||
    DEFAULT_CODEX_INSPECTION_XAI_USER_AGENT;

  return {
    codexUserAgent,
    xaiUserAgent,
    userAgent: codexUserAgent,
  };
};

export const readBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

export const readNullableString = (value: unknown) => {
  const normalized = readString(value);
  return normalized || null;
};

export const readNullableNumber = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  return normalized === null || !Number.isFinite(normalized) ? null : normalized;
};

export const readNonNegativeInteger = (value: unknown, fallback: number) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.floor(normalized);
};

export const readInspectionTargetTypes = (value: unknown): CodexInspectionTargetType[] => {
  if (!Array.isArray(value)) return [];
  const selected = new Set(
    value.map((item) => readString(item).toLowerCase()).filter((item) => item.length > 0)
  );
  return CODEX_INSPECTION_TARGET_TYPES.filter((item) => selected.has(item));
};

export const normalizeInspectionTargetTypes = (
  value: unknown,
  legacyValue?: unknown,
  fallback: readonly CodexInspectionTargetType[] = DEFAULT_CODEX_INSPECTION_SETTINGS.targetTypes
): CodexInspectionTargetType[] => {
  const direct = readInspectionTargetTypes(value);
  if (direct.length > 0) return direct;

  const legacy = readString(legacyValue).toLowerCase();
  if (CODEX_INSPECTION_TARGET_TYPES.includes(legacy as CodexInspectionTargetType)) {
    return [legacy as CodexInspectionTargetType];
  }

  const normalizedFallback = readInspectionTargetTypes(fallback);
  return normalizedFallback.length > 0 ? normalizedFallback : ['codex'];
};

const isAutoActionMode = (value: string): value is CodexInspectionAutoActionMode =>
  CODEX_INSPECTION_AUTO_ACTION_MODES.includes(value as CodexInspectionAutoActionMode);

export const normalizeAutoActionMode = (
  value: unknown,
  legacyAutoExecuteActions?: unknown
): CodexInspectionAutoActionMode => {
  const normalized = readString(value).toLowerCase();
  if (isAutoActionMode(normalized)) return normalized;

  if (legacyAutoExecuteActions !== undefined) {
    return readBoolean(legacyAutoExecuteActions, false) ? 'disable' : 'none';
  }

  return DEFAULT_CODEX_INSPECTION_SETTINGS.autoActionMode;
};

export const normalizeInspectionAction = (
  value: unknown,
  fallback: CodexInspectionAction = 'keep'
): CodexInspectionAction => {
  const normalized = readString(value).toLowerCase();
  if (['keep', 'delete', 'disable', 'enable', 'reauth'].includes(normalized)) {
    return normalized as CodexInspectionAction;
  }
  return fallback;
};

export const normalizeStoredActionFilter = (value: unknown): CodexInspectionStoredActionFilter => {
  const normalized = readString(value).toLowerCase();
  if (normalized === 'http_401') return 'reauth';
  if (['all', 'delete', 'disable', 'enable', 'reauth', 'keep'].includes(normalized)) {
    return normalized as CodexInspectionStoredActionFilter;
  }
  return 'all';
};

export const normalizeLogLevel = (value: unknown): CodexInspectionLogLevel => {
  const normalized = readString(value).toLowerCase();
  if (['info', 'success', 'warning', 'error'].includes(normalized)) {
    return normalized as CodexInspectionLogLevel;
  }
  return 'info';
};

export const readConfigurableSettingsFromConfig = (
  config?: Config | null
): Partial<CodexInspectionConfigurableSettings> => {
  const clean = config?.clean ?? null;
  const cleanRecord = isRecord(clean) ? clean : {};
  return {
    targetTypes: Array.isArray(cleanRecord.targetTypes)
      ? readInspectionTargetTypes(cleanRecord.targetTypes)
      : undefined,
    targetType: readString(clean?.targetType),
    workers: normalizeNumberValue(clean?.workers) ?? undefined,
    deleteWorkers: normalizeNumberValue(clean?.deleteWorkers) ?? undefined,
    timeout: normalizeNumberValue(clean?.timeout) ?? undefined,
    retries: normalizeNumberValue(clean?.retries) ?? undefined,
    codexUserAgent: readString(clean?.codexUserAgent),
    xaiUserAgent: readString(clean?.xaiUserAgent),
    userAgent: readString(clean?.userAgent),
    usedPercentThreshold: normalizeNumberValue(clean?.usedPercentThreshold) ?? undefined,
    sampleSize: normalizeNumberValue(clean?.sampleSize) ?? undefined,
    autoActionMode:
      cleanRecord.autoActionMode === undefined
        ? undefined
        : normalizeAutoActionMode(cleanRecord.autoActionMode),
    autoRecoverEnabled: readBoolean(cleanRecord.autoRecoverEnabled, false),
  };
};

type CodexInspectionConfigurableSettingsInput = {
  targetTypes?: unknown;
  targetType?: unknown;
  workers?: unknown;
  deleteWorkers?: unknown;
  timeout?: unknown;
  retries?: unknown;
  codexUserAgent?: unknown;
  xaiUserAgent?: unknown;
  userAgent?: unknown;
  usedPercentThreshold?: unknown;
  sampleSize?: unknown;
  autoExecuteActions?: unknown;
  autoActionMode?: unknown;
  autoRecoverEnabled?: unknown;
};

export const normalizeConfigurableSettings = (
  input?: CodexInspectionConfigurableSettingsInput | null
): CodexInspectionConfigurableSettings => {
  const targetTypes = normalizeInspectionTargetTypes(
    input?.targetTypes,
    input?.targetType,
    DEFAULT_CODEX_INSPECTION_SETTINGS.targetTypes
  );
  const userAgents = normalizeInspectionUserAgents(input, DEFAULT_CODEX_INSPECTION_SETTINGS);
  const merged = {
    ...DEFAULT_CODEX_INSPECTION_SETTINGS,
    ...(input ?? {}),
  };

  const threshold = normalizeThreshold(merged.usedPercentThreshold);
  const retriesValue = normalizeNumberValue(merged.retries);
  const sampleSizeValue = normalizeNumberValue(merged.sampleSize);

  return {
    targetTypes,
    targetType: targetTypes[0],
    workers: clampPositiveInteger(
      normalizeNumberValue(merged.workers) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.workers
    ),
    deleteWorkers: clampPositiveInteger(
      normalizeNumberValue(merged.deleteWorkers) ?? undefined,
      clampPositiveInteger(
        normalizeNumberValue(merged.workers) ?? undefined,
        DEFAULT_CODEX_INSPECTION_SETTINGS.workers
      )
    ),
    timeout: clampPositiveInteger(
      normalizeNumberValue(merged.timeout) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.timeout
    ),
    retries:
      retriesValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.retries
        : Math.max(0, Math.floor(retriesValue)),
    ...userAgents,
    usedPercentThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(100, threshold))
      : DEFAULT_CODEX_INSPECTION_SETTINGS.usedPercentThreshold,
    sampleSize:
      sampleSizeValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.sampleSize
        : Math.max(0, Math.floor(sampleSizeValue)),
    autoActionMode: normalizeAutoActionMode(merged.autoActionMode, merged.autoExecuteActions),
    autoRecoverEnabled: readBoolean(merged.autoRecoverEnabled, false),
  };
};

export const loadCodexInspectionConfigurableSettings = (
  config?: Config | null
): CodexInspectionConfigurableSettings => {
  const configSettings = readConfigurableSettingsFromConfig(config);

  try {
    if (typeof localStorage === 'undefined') {
      return normalizeConfigurableSettings(configSettings);
    }
    const raw = localStorage.getItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeConfigurableSettings(configSettings);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return normalizeConfigurableSettings(configSettings);
    }
    const parsedHasTargetTypes = Object.prototype.hasOwnProperty.call(parsed, 'targetTypes');
    const parsedHasLegacyTargetType = Object.prototype.hasOwnProperty.call(parsed, 'targetType');
    const parsedHasCodexUserAgent = Object.prototype.hasOwnProperty.call(parsed, 'codexUserAgent');
    const parsedHasLegacyUserAgent = Object.prototype.hasOwnProperty.call(parsed, 'userAgent');
    return normalizeConfigurableSettings({
      ...configSettings,
      ...parsed,
      targetTypes: parsedHasTargetTypes
        ? parsed.targetTypes
        : parsedHasLegacyTargetType
          ? undefined
          : configSettings.targetTypes,
      codexUserAgent: parsedHasCodexUserAgent
        ? parsed.codexUserAgent
        : parsedHasLegacyUserAgent
          ? undefined
          : configSettings.codexUserAgent,
    });
  } catch {
    return normalizeConfigurableSettings(configSettings);
  }
};

export const saveCodexInspectionConfigurableSettings = (
  settings: Partial<CodexInspectionConfigurableSettings>
): CodexInspectionConfigurableSettings => {
  const normalized = normalizeConfigurableSettings(settings);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    console.warn('保存 Codex 巡检配置失败');
  }

  return normalized;
};

export const clearCodexInspectionConfigurableSettings = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Codex 巡检配置失败');
  }
};
