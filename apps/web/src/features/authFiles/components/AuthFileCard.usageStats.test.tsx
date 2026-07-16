import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { AuthFileUsageSummary } from '@/features/authFiles/model/authFileUsageSummary';
import { AuthFileCard } from './AuthFileCard';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const textContent = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');

const findStatValue = (renderer: ReactTestRenderer, label: string): string => {
  const labelNode = renderer.root.findAllByType('span').find((node) => textContent(node) === label);
  if (!labelNode?.parent) throw new Error(`Stat label not found: ${label}`);
  const valueNode = labelNode.parent
    .findAllByType('span')
    .find((node) => node !== labelNode && textContent(node) !== label);
  if (!valueNode) throw new Error(`Stat value not found: ${label}`);
  return textContent(valueNode);
};

const findMetaValue = (renderer: ReactTestRenderer, label: string): string => {
  const labelNode = renderer.root.findAllByType('span').find((node) => textContent(node) === label);
  if (!labelNode?.parent) throw new Error(`Metadata label not found: ${label}`);
  const valueNode = labelNode.parent
    .findAllByType('span')
    .find((node) => node !== labelNode && textContent(node) !== label);
  if (!valueNode) throw new Error(`Metadata value not found: ${label}`);
  return textContent(valueNode);
};

const renderCard = (file: AuthFileItem, usageSummary?: AuthFileUsageSummary): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AuthFileCard
        file={file}
        usageSummary={usageSummary}
        compact
        selected={false}
        resolvedTheme="dark"
        disableControls={false}
        deleting={null}
        statusUpdating={{}}
        statusBarCache={new Map()}
        onShowModels={vi.fn()}
        onDownload={vi.fn()}
        onOpenPrefixProxyEditor={vi.fn()}
        onDelete={vi.fn()}
        onToggleStatus={vi.fn()}
        onToggleSelect={vi.fn()}
      />
    );
  });
  return renderer;
};

const usageSummary = (overrides: Partial<AuthFileUsageSummary> = {}): AuthFileUsageSummary => ({
  estimatedCost: 1.25,
  totalTokens: 10_000,
  recordedSuccessCalls: 21,
  recordedFailureCalls: 4,
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

describe('AuthFileCard recorded request counts', () => {
  it('prefers persisted monitoring counts over reset CPA runtime totals', () => {
    const renderer = renderCard(
      { name: 'credential.json', type: 'codex', success: 0, failed: 0 },
      usageSummary()
    );

    expect(findStatValue(renderer, 'stats.success')).toBe('21');
    expect(findStatValue(renderer, 'stats.failure')).toBe('4');
  });

  it('falls back to CPA runtime totals when recorded monitoring usage is unavailable', () => {
    const renderer = renderCard(
      { name: 'credential.json', type: 'codex', success: 7, failed: 2 },
      usageSummary({ recordedUsageAvailable: false })
    );

    expect(findStatValue(renderer, 'stats.success')).toBe('7');
    expect(findStatValue(renderer, 'stats.failure')).toBe('2');
  });
});

describe('AuthFileCard file timestamps', () => {
  it('shows the stable file creation time supplied by Manager Server', () => {
    const createdAt = '2026-07-15T00:09:10.123456789Z';
    const renderer = renderCard({
      name: 'credential.json',
      type: 'codex',
      file_created_at: createdAt,
      modtime: '2026-07-15T01:10:11Z',
    });

    expect(findMetaValue(renderer, 'auth_files.file_created')).toBe(
      new Date(createdAt).toLocaleString()
    );
    expect(findMetaValue(renderer, 'auth_files.file_modified')).toBe(
      new Date('2026-07-15T01:10:11Z').toLocaleString()
    );
  });
});
