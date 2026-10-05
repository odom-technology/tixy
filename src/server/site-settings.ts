import { rebrandSiteText } from '@/lib/site-branding';
import { query } from '@/server/db/client';
import {
  DEFAULT_SITE_AVAILABILITY,
  normalizeSiteAvailabilityConfig,
  validateSiteAvailabilityConfig,
  SITE_SECTIONS,
  type SiteAvailabilityConfig,
} from '@/lib/site-availability';

export type SiteSettingAudience = 'all' | 'players' | 'admins';
export type WarningBannerVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'critical'
  | 'maintenance';
export type WarningBannerDismissMode = 'none' | 'session' | '24h' | '7d';
export type MaintenanceModePhase = 'off' | 'scheduled' | 'active';

export type SiteSettingHistoryEntry = {
  updatedAt: number;
  updatedBy: string | null;
  summary: string;
};

export type SiteSettingDetails<TConfig> = {
  config: TConfig;
  updatedAt: number | null;
  updatedBy: string | null;
  history: SiteSettingHistoryEntry[];
};

export type WarningBannerConfig = {
  enabled: boolean;
  message: string;
  variant: WarningBannerVariant;
  audience: SiteSettingAudience;
  startAt: number | null;
  endAt: number | null;
  ctaLabel: string;
  ctaHref: string;
  dismissMode: WarningBannerDismissMode;
};

export type MaintenanceModeConfig = {
  enabled: boolean;
  message: string;
  startAt: number | null;
  endAt: number | null;
  allowAdminBypass: boolean;
  estimatedCompletionLastUpdatedAt: number | null;
  estimatedCompletionPreviousEndAt: number | null;
  estimatedCompletionDeltaMs: number | null;
};

export type MaintenanceModeStatus = {
  phase: MaintenanceModePhase;
  isActive: boolean;
  isScheduled: boolean;
  startsInMs: number | null;
  endsInMs: number | null;
  canBypass: boolean;
  config: MaintenanceModeConfig;
};

type SiteSettingRow = {
  id: string;
  config_json: string;
  updated_at: string | number;
  updated_by: string | null;
};

export const WARNING_BANNER_SETTINGS_ID = 'warning-banner';
export const MAINTENANCE_MODE_SETTINGS_ID = 'maintenance-mode';
export const SITE_AVAILABILITY_SETTINGS_ID = 'site-availability';

const SITE_SETTING_HISTORY_LIMIT = 20;
const DEFAULT_MAINTENANCE_MESSAGE =
  'Maintenance is in progress. We will be back shortly.';

export const DEFAULT_WARNING_BANNER: WarningBannerConfig = {
  enabled: false,
  message: '',
  variant: 'warning',
  audience: 'all',
  startAt: null,
  endAt: null,
  ctaLabel: '',
  ctaHref: '',
  dismissMode: 'none',
};

export const DEFAULT_MAINTENANCE_MODE: MaintenanceModeConfig = {
  enabled: false,
  message: DEFAULT_MAINTENANCE_MESSAGE,
  startAt: null,
  endAt: null,
  allowAdminBypass: true,
  estimatedCompletionLastUpdatedAt: null,
  estimatedCompletionPreviousEndAt: null,
  estimatedCompletionDeltaMs: null,
};

let schemaReady: Promise<void> | null = null;

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

async function ensureSiteSettingsSchema() {
  schemaReady ??= query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      updated_by TEXT
    );
  `).then(() => undefined);

  await schemaReady;
}

function getSiteBaseUrl() {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://127.0.0.1:3000'
  );
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return Math.floor(numeric);
}

function normalizeAudience(value: unknown, fallback: SiteSettingAudience) {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'all') return 'all';
  if (
    normalized === 'players' ||
    normalized === 'player' ||
    normalized === 'signed-in' ||
    normalized === 'authenticated'
  ) {
    return 'players';
  }
  if (
    normalized === 'admins' ||
    normalized === 'admin' ||
    normalized === 'admin-only'
  ) {
    return 'admins';
  }
  return fallback;
}

function normalizeWarningVariant(
  value: unknown,
  fallback: WarningBannerVariant,
) {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'info') return 'info';
  if (normalized === 'success') return 'success';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'critical' || normalized === 'error') return 'critical';
  if (normalized === 'maintenance') return 'maintenance';
  return fallback;
}

function normalizeDismissMode(
  value: unknown,
  fallback: WarningBannerDismissMode,
) {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'none') return 'none';
  if (normalized === 'session') return 'session';
  if (normalized === '24h') return '24h';
  if (normalized === '7d') return '7d';
  return fallback;
}

function normalizeCtaHref(value: unknown) {
  const href = typeof value === 'string' ? value.trim().slice(0, 300) : '';
  if (!href) return '';
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith('#') || href.startsWith('?')) return href;

  try {
    const parsed = new URL(href, getSiteBaseUrl());
    const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);
    if (!isAbsolute) return '';
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:' ||
      parsed.protocol === 'tel:'
    ) {
      return href;
    }
  } catch {
    return '';
  }

  return '';
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error('Failed to parse site settings JSON:', error);
    return null;
  }
}

export function normalizeWarningBannerConfig(
  value: unknown,
): WarningBannerConfig {
  if (!value || typeof value !== 'object') return DEFAULT_WARNING_BANNER;
  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === 'string'
      ? rebrandSiteText(record.message.trim()).slice(0, 1200)
      : '';
  const startAt = normalizeTimestamp(record.startAt);
  let endAt = normalizeTimestamp(record.endAt);
  if (startAt !== null && endAt !== null && endAt < startAt) {
    endAt = startAt;
  }
  const variant = normalizeWarningVariant(
    record.variant,
    DEFAULT_WARNING_BANNER.variant,
  );

  return {
    enabled: Boolean(record.enabled) && message.length > 0,
    message,
    variant,
    audience:
      variant === 'maintenance'
        ? 'all'
        : normalizeAudience(record.audience, DEFAULT_WARNING_BANNER.audience),
    startAt,
    endAt,
    ctaLabel:
      variant === 'maintenance'
        ? ''
        : typeof record.ctaLabel === 'string'
          ? rebrandSiteText(record.ctaLabel.trim()).slice(0, 60)
          : '',
    ctaHref: variant === 'maintenance' ? '' : normalizeCtaHref(record.ctaHref),
    dismissMode:
      variant === 'maintenance'
        ? 'none'
        : normalizeDismissMode(
            record.dismissMode,
            DEFAULT_WARNING_BANNER.dismissMode,
          ),
  };
}

export function normalizeMaintenanceModeConfig(
  value: unknown,
): MaintenanceModeConfig {
  if (!value || typeof value !== 'object') return DEFAULT_MAINTENANCE_MODE;
  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === 'string'
      ? rebrandSiteText(record.message.trim()).slice(0, 1200)
      : DEFAULT_MAINTENANCE_MODE.message;
  const startAt = normalizeTimestamp(record.startAt);
  let endAt = normalizeTimestamp(record.endAt);
  if (startAt !== null && endAt !== null && endAt < startAt) {
    endAt = startAt;
  }
  const delta = toNumber(record.estimatedCompletionDeltaMs);

  return {
    enabled: Boolean(record.enabled),
    message: message || DEFAULT_MAINTENANCE_MODE.message,
    startAt,
    endAt,
    allowAdminBypass: true,
    estimatedCompletionLastUpdatedAt: normalizeTimestamp(
      record.estimatedCompletionLastUpdatedAt,
    ),
    estimatedCompletionPreviousEndAt: normalizeTimestamp(
      record.estimatedCompletionPreviousEndAt,
    ),
    estimatedCompletionDeltaMs:
      delta !== null && Number.isFinite(delta) ? Math.trunc(delta) : null,
  };
}

function normalizeHistory(value: unknown): SiteSettingHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: SiteSettingHistoryEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const updatedAt = normalizeTimestamp(record.updatedAt);
    if (updatedAt === null) continue;
    const summary =
      typeof record.summary === 'string'
        ? record.summary.trim().slice(0, 220)
        : '';
    if (!summary) continue;
    entries.push({
      updatedAt,
      updatedBy:
        typeof record.updatedBy === 'string' && record.updatedBy.trim()
          ? record.updatedBy.trim().slice(0, 120)
          : null,
      summary,
    });
  }

  return entries
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SITE_SETTING_HISTORY_LIMIT);
}

function appendHistory(input: {
  existing: SiteSettingHistoryEntry[];
  updatedAt: number;
  updatedBy: string | null;
  summary: string;
}) {
  return [
    {
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
      summary: input.summary,
    },
    ...input.existing,
  ].slice(0, SITE_SETTING_HISTORY_LIMIT);
}

async function getSiteSettingRow(id: string) {
  if (!hasDatabaseUrl()) {
    throw new Error('DATABASE_URL is required for site settings.');
  }
  await ensureSiteSettingsSchema();
  const result = await query<SiteSettingRow>(
    `SELECT id, config_json, updated_at, updated_by
     FROM site_settings
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

function resolveSettingDetails<TConfig>(input: {
  row: SiteSettingRow | null;
  defaultConfig: TConfig;
  normalizeConfig: (value: unknown) => TConfig;
}): SiteSettingDetails<TConfig> {
  if (!input.row) {
    return {
      config: input.defaultConfig,
      updatedAt: null,
      updatedBy: null,
      history: [],
    };
  }

  const parsed = parseJson(input.row.config_json);
  const parsedRecord =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;

  return {
    config: input.normalizeConfig(parsed),
    updatedAt: toNumber(input.row.updated_at),
    updatedBy: input.row.updated_by,
    history: normalizeHistory(parsedRecord?.history),
  };
}

function rolesInclude(roles: readonly string[] | null | undefined, role: string) {
  return Boolean(roles?.some((entry) => entry.trim().toLowerCase() === role));
}

function isAudienceVisible(
  audience: SiteSettingAudience,
  roles: readonly string[] | null | undefined,
) {
  if (audience === 'all') return true;
  if (audience === 'players') return Boolean(roles?.length);
  return rolesInclude(roles, 'admin');
}

export function isWarningBannerActiveForRoles(input: {
  config: WarningBannerConfig;
  roles?: readonly string[] | null;
  now?: number;
}) {
  if (!input.config.enabled) return false;
  if (!input.config.message.trim()) return false;
  if (!isAudienceVisible(input.config.audience, input.roles)) return false;
  const now =
    typeof input.now === 'number' && Number.isFinite(input.now)
      ? input.now
      : Date.now();

  if (
    input.config.variant !== 'maintenance' &&
    input.config.startAt !== null &&
    now < input.config.startAt
  ) {
    return false;
  }
  if (input.config.endAt !== null && now > input.config.endAt) return false;
  return true;
}

export function getMaintenanceModeStatusForRoles(input: {
  config: MaintenanceModeConfig;
  roles?: readonly string[] | null;
  now?: number;
}): MaintenanceModeStatus {
  const now =
    typeof input.now === 'number' && Number.isFinite(input.now)
      ? input.now
      : Date.now();
  const canBypass =
    input.config.allowAdminBypass && rolesInclude(input.roles, 'admin');

  if (!input.config.enabled) {
    return {
      phase: 'off',
      isActive: false,
      isScheduled: false,
      startsInMs: null,
      endsInMs: null,
      canBypass,
      config: input.config,
    };
  }

  if (input.config.startAt !== null && now < input.config.startAt) {
    return {
      phase: 'scheduled',
      isActive: false,
      isScheduled: true,
      startsInMs: input.config.startAt - now,
      endsInMs:
        input.config.endAt !== null
          ? Math.max(0, input.config.endAt - now)
          : null,
      canBypass,
      config: input.config,
    };
  }

  if (input.config.endAt !== null && now > input.config.endAt) {
    return {
      phase: 'off',
      isActive: false,
      isScheduled: false,
      startsInMs: null,
      endsInMs: null,
      canBypass,
      config: input.config,
    };
  }

  return {
    phase: 'active',
    isActive: true,
    isScheduled: false,
    startsInMs: null,
    endsInMs:
      input.config.endAt !== null
        ? Math.max(0, input.config.endAt - now)
        : null,
    canBypass,
    config: input.config,
  };
}

function buildWarningSummary(config: WarningBannerConfig) {
  const state = config.enabled ? 'Enabled' : 'Disabled';
  const schedule = config.startAt || config.endAt ? 'scheduled' : 'unscheduled';
  return `${state} · ${config.variant} · ${config.audience} · ${schedule}`;
}

function buildMaintenanceSummary(
  config: MaintenanceModeConfig,
  phase: MaintenanceModePhase,
) {
  const state = config.enabled ? 'Enabled' : 'Disabled';
  const schedule = config.startAt ? 'scheduled' : 'immediate';
  const estimateChange =
    config.estimatedCompletionDeltaMs === null
      ? ''
      : config.estimatedCompletionDeltaMs > 0
        ? ` · +${Math.round(config.estimatedCompletionDeltaMs / 60000)}m`
        : config.estimatedCompletionDeltaMs < 0
          ? ` · ${Math.round(config.estimatedCompletionDeltaMs / 60000)}m`
          : '';
  return `${state} · ${phase} · ${schedule}${estimateChange}`;
}

export async function getWarningBannerSettings(): Promise<
  SiteSettingDetails<WarningBannerConfig>
> {
  if (!hasDatabaseUrl()) {
    return {
      config: DEFAULT_WARNING_BANNER,
      updatedAt: null,
      updatedBy: null,
      history: [],
    };
  }

  try {
    const row = await getSiteSettingRow(WARNING_BANNER_SETTINGS_ID);
    return resolveSettingDetails({
      row,
      defaultConfig: DEFAULT_WARNING_BANNER,
      normalizeConfig: normalizeWarningBannerConfig,
    });
  } catch (error) {
    console.error('Failed to load warning banner settings:', error);
    return {
      config: DEFAULT_WARNING_BANNER,
      updatedAt: null,
      updatedBy: null,
      history: [],
    };
  }
}

export async function getMaintenanceModeSettings(): Promise<
  SiteSettingDetails<MaintenanceModeConfig>
> {
  if (!hasDatabaseUrl()) {
    return {
      config: DEFAULT_MAINTENANCE_MODE,
      updatedAt: null,
      updatedBy: null,
      history: [],
    };
  }

  try {
    const row = await getSiteSettingRow(MAINTENANCE_MODE_SETTINGS_ID);
    const details = resolveSettingDetails({
      row,
      defaultConfig: DEFAULT_MAINTENANCE_MODE,
      normalizeConfig: normalizeMaintenanceModeConfig,
    });
    const now = Date.now();
    if (
      details.config.enabled &&
      details.config.endAt !== null &&
      details.config.endAt <= now
    ) {
      return saveMaintenanceModeConfig({
        config: {
          ...details.config,
          enabled: false,
          startAt: null,
          endAt: null,
          allowAdminBypass: true,
        },
        updatedBy: 'system:auto-maintenance-expire',
      });
    }
    return details;
  } catch (error) {
    console.error('Failed to load maintenance settings:', error);
    return {
      config: DEFAULT_MAINTENANCE_MODE,
      updatedAt: null,
      updatedBy: null,
      history: [],
    };
  }
}

export async function saveWarningBannerConfig(input: {
  config: WarningBannerConfig;
  updatedBy?: string | null;
}): Promise<SiteSettingDetails<WarningBannerConfig>> {
  const normalized = normalizeWarningBannerConfig(input.config);
  const previous = await getSiteSettingRow(WARNING_BANNER_SETTINGS_ID);
  const previousParsed = previous ? parseJson(previous.config_json) : null;
  const previousRecord =
    previousParsed && typeof previousParsed === 'object'
      ? (previousParsed as Record<string, unknown>)
      : null;
  const updatedAt = Date.now();
  const updatedBy = input.updatedBy?.trim().slice(0, 120) || null;
  const history = appendHistory({
    existing: normalizeHistory(previousRecord?.history),
    updatedAt,
    updatedBy,
    summary: buildWarningSummary(normalized),
  });

  await ensureSiteSettingsSchema();
  await query(
    `INSERT INTO site_settings (id, config_json, updated_at, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       config_json = EXCLUDED.config_json,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by`,
    [
      WARNING_BANNER_SETTINGS_ID,
      JSON.stringify({ ...normalized, history }),
      updatedAt,
      updatedBy,
    ],
  );

  return {
    config: normalized,
    updatedAt,
    updatedBy,
    history,
  };
}

export async function saveMaintenanceModeConfig(input: {
  config: MaintenanceModeConfig;
  updatedBy?: string | null;
}): Promise<SiteSettingDetails<MaintenanceModeConfig>> {
  const normalizedInput = normalizeMaintenanceModeConfig(input.config);
  const previous = await getSiteSettingRow(MAINTENANCE_MODE_SETTINGS_ID);
  const previousParsed = previous ? parseJson(previous.config_json) : null;
  const previousConfig = normalizeMaintenanceModeConfig(previousParsed);
  const previousRecord =
    previousParsed && typeof previousParsed === 'object'
      ? (previousParsed as Record<string, unknown>)
      : null;
  const updatedAt = Date.now();
  const endAtChanged = previousConfig.endAt !== normalizedInput.endAt;
  const normalized: MaintenanceModeConfig = {
    ...normalizedInput,
    estimatedCompletionLastUpdatedAt: endAtChanged
      ? updatedAt
      : previousConfig.estimatedCompletionLastUpdatedAt,
    estimatedCompletionPreviousEndAt: endAtChanged
      ? previousConfig.endAt
      : previousConfig.estimatedCompletionPreviousEndAt,
    estimatedCompletionDeltaMs: endAtChanged
      ? previousConfig.endAt !== null && normalizedInput.endAt !== null
        ? normalizedInput.endAt - previousConfig.endAt
        : null
      : previousConfig.estimatedCompletionDeltaMs,
  };
  const updatedBy = input.updatedBy?.trim().slice(0, 120) || null;
  const phase = getMaintenanceModeStatusForRoles({
    config: normalized,
    roles: null,
    now: updatedAt,
  }).phase;
  const history = appendHistory({
    existing: normalizeHistory(previousRecord?.history),
    updatedAt,
    updatedBy,
    summary: buildMaintenanceSummary(normalized, phase),
  });

  await ensureSiteSettingsSchema();
  await query(
    `INSERT INTO site_settings (id, config_json, updated_at, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       config_json = EXCLUDED.config_json,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by`,
    [
      MAINTENANCE_MODE_SETTINGS_ID,
      JSON.stringify({ ...normalized, history }),
      updatedAt,
      updatedBy,
    ],
  );

  return {
    config: normalized,
    updatedAt,
    updatedBy,
    history,
  };
}

export async function getSiteAvailabilitySettings(): Promise<SiteSettingDetails<SiteAvailabilityConfig>> {
  if (!hasDatabaseUrl()) {
    return { config: normalizeSiteAvailabilityConfig(DEFAULT_SITE_AVAILABILITY), updatedAt: null, updatedBy: null, history: [] };
  }
  const row = await getSiteSettingRow(SITE_AVAILABILITY_SETTINGS_ID);
  return resolveSettingDetails({ row, defaultConfig: normalizeSiteAvailabilityConfig(DEFAULT_SITE_AVAILABILITY), normalizeConfig: normalizeSiteAvailabilityConfig });
}

export async function saveSiteAvailabilityConfig(input: {
  config: SiteAvailabilityConfig;
  updatedBy?: string | null;
  expectedUpdatedAt: number | null;
}): Promise<SiteSettingDetails<SiteAvailabilityConfig>> {
  const normalized = validateSiteAvailabilityConfig(input.config);
  const previous = await getSiteSettingRow(SITE_AVAILABILITY_SETTINGS_ID);
  if ((previous ? Number(previous.updated_at) : null) !== input.expectedUpdatedAt) {
    throw new Error('Availability changed since you loaded it. Refresh and review the current settings.');
  }
  const parsed = previous ? parseJson(previous.config_json) : null;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  const updatedAt = Math.max(Date.now(), Number(previous?.updated_at ?? 0) + 1);
  const updatedBy = input.updatedBy?.trim().slice(0, 120) || null;
  const paused = SITE_SECTIONS.filter(({ id }) => !normalized.sections[id]).map(({ label }) => label);
  const summary = [paused.length ? `Paused: ${paused.join(', ')}` : 'All sections open', `${normalized.disabledGames.length} games paused`, `Signups ${normalized.registrationEnabled ? 'open' : 'closed'}`, `Ticket bundles ${normalized.ticketBundlesEnabled ? 'shown' : 'hidden'}`].join(' · ');
  const history = appendHistory({ existing: normalizeHistory(record?.history), updatedAt, updatedBy, summary });
  const result = await query(
    `INSERT INTO site_settings (id, config_json, updated_at, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
     WHERE site_settings.updated_at = $5::bigint RETURNING id`,
    [SITE_AVAILABILITY_SETTINGS_ID, JSON.stringify({ ...normalized, history }), updatedAt, updatedBy, input.expectedUpdatedAt],
  );
  if (!result.rowCount) throw new Error('Availability changed since you loaded it. Refresh and review the current settings.');
  return { config: normalized, updatedAt, updatedBy, history };
}
