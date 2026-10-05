'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  Save,
  Wrench,
} from 'lucide-react';

import {
  ArcadeButton,
  ArcadeField,
  ArcadeInput,
  ArcadeNotice,
  ArcadeSegmented,
  ArcadeStat,
} from '@/features/arcade/components/ui/arcade-ui';
import { AdminPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadeModal, ArcadeSwitch } from '@/features/arcade/components/ui/arcade-interactive';
import { readJson } from '@/lib/read-json';
import type { SiteAvailabilityConfig } from '@/lib/site-availability';
import type {
  MaintenanceModeConfig,
  MaintenanceModeStatus,
  SiteSettingDetails,
  WarningBannerConfig,
} from '@/server/site-settings';

import { AvailabilityEditor, availabilityConfigsEqual, describeAvailabilityChanges } from './_availability-editor';

type SettingsTab = 'availability' | 'maintenance' | 'announcements';
const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'availability', label: 'Availability' },
  { value: 'maintenance', label: 'Full maintenance' },
  { value: 'announcements', label: 'Announcements' },
];

type SiteSettingsResponse = {
  warningBanner: SiteSettingDetails<WarningBannerConfig>;
  maintenanceMode: SiteSettingDetails<MaintenanceModeConfig>;
  maintenanceStatus: MaintenanceModeStatus;
  siteAvailability: SiteSettingDetails<SiteAvailabilityConfig>;
};

type AdminSiteSettingsClientProps = {
  initialWarningBanner: SiteSettingDetails<WarningBannerConfig>;
  initialMaintenanceMode: SiteSettingDetails<MaintenanceModeConfig>;
  initialMaintenanceStatus: MaintenanceModeStatus;
  initialSiteAvailability: SiteSettingDetails<SiteAvailabilityConfig>;
};

const inputClass =
  'w-full arcade-input px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';

function toDateTimeInputValue(timestamp: number | null) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) return 'Never';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function getPreviewTone(variant: WarningBannerConfig['variant']) {
  if (variant === 'info') {
    return {
      icon: Info,
      label: 'Info',
      dot: 'bg-info text-info-on',
      eyebrow: 'text-info-text',
    };
  }
  if (variant === 'success') {
    return {
      icon: CheckCircle2,
      label: 'Success',
      dot: 'bg-prize text-prize-on',
      eyebrow: 'text-prize-text',
    };
  }
  if (variant === 'critical') {
    return {
      icon: AlertCircle,
      label: 'Critical',
      dot: 'bg-danger text-danger-on',
      eyebrow: 'text-danger-text',
    };
  }
  if (variant === 'maintenance') {
    return {
      icon: Wrench,
      label: 'Maintenance',
      dot: 'bg-danger text-danger-on',
      eyebrow: 'text-danger-text',
    };
  }
  return {
    icon: AlertTriangle,
    label: 'Notice',
    dot: 'bg-tickets text-tickets-on',
    eyebrow: 'text-tickets-text',
  };
}

function getMaintenanceStatusLabel(status: MaintenanceModeStatus) {
  if (status.phase === 'active') return 'Active';
  if (status.phase === 'scheduled') return 'Scheduled';
  return 'Off';
}

export function AdminSiteSettingsClient({
  initialWarningBanner,
  initialMaintenanceMode,
  initialMaintenanceStatus,
  initialSiteAvailability,
}: AdminSiteSettingsClientProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('availability');
  const [warningBanner, setWarningBanner] = useState(initialWarningBanner);
  const [maintenanceMode, setMaintenanceMode] = useState(initialMaintenanceMode);
  const [siteAvailability, setSiteAvailability] = useState(initialSiteAvailability);
  const [availabilityConfig, setAvailabilityConfig] = useState(initialSiteAvailability.config);
  const [confirmAvailability, setConfirmAvailability] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);
  const [availabilityConflict, setAvailabilityConflict] = useState(false);
  const [maintenanceStatus, setMaintenanceStatus] = useState(
    initialMaintenanceStatus,
  );
  const [bannerConfig, setBannerConfig] = useState(initialWarningBanner.config);
  const [maintenanceConfig, setMaintenanceConfig] = useState(
    initialMaintenanceMode.config,
  );
  const [bannerStartInput, setBannerStartInput] = useState(
    toDateTimeInputValue(initialWarningBanner.config.startAt),
  );
  const [bannerEndInput, setBannerEndInput] = useState(
    toDateTimeInputValue(initialWarningBanner.config.endAt),
  );
  const [maintenanceStartInput, setMaintenanceStartInput] = useState(
    toDateTimeInputValue(initialMaintenanceMode.config.startAt),
  );
  const [maintenanceEndInput, setMaintenanceEndInput] = useState(
    toDateTimeInputValue(initialMaintenanceMode.config.endAt),
  );
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => getPreviewTone(bannerConfig.variant),
    [bannerConfig.variant],
  );
  const availabilityChanges = describeAvailabilityChanges(siteAvailability.config, availabilityConfig);
  const availabilityDirty = !availabilityConfigsEqual(siteAvailability.config, availabilityConfig);

  const applyResponse = (payload: SiteSettingsResponse) => {
    setWarningBanner(payload.warningBanner);
    setMaintenanceMode(payload.maintenanceMode);
    setMaintenanceStatus(payload.maintenanceStatus);
    setSiteAvailability(payload.siteAvailability);
    setAvailabilityConfig(payload.siteAvailability.config);
    setBannerConfig(payload.warningBanner.config);
    setMaintenanceConfig(payload.maintenanceMode.config);
    setBannerStartInput(toDateTimeInputValue(payload.warningBanner.config.startAt));
    setBannerEndInput(toDateTimeInputValue(payload.warningBanner.config.endAt));
    setMaintenanceStartInput(
      toDateTimeInputValue(payload.maintenanceMode.config.startAt),
    );
    setMaintenanceEndInput(
      toDateTimeInputValue(payload.maintenanceMode.config.endAt),
    );
  };

  const loadSettings = async () => {
    setBusy('load');
    setNotice(null);
    setError(null);
    setAvailabilityConflict(false);
    try {
      const payload = await readJson<SiteSettingsResponse>(
        '/api/admin/site-settings',
      );
      applyResponse(payload);
      setNotice('Site settings loaded.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (confirmedMaintenance = false) => {
    if (activeTab === 'availability') {
      setNotice(null);
      setError(null);
      if (!availabilityConfig.message.trim()) {
        setError('Enter a visitor message before publishing availability settings.');
        return;
      }
      if (availabilityDirty) setConfirmAvailability(true);
      return;
    }
    setNotice(null);
    setError(null);
    const bannerStartAt = parseDateTimeInputValue(bannerStartInput);
    const bannerEndAt = parseDateTimeInputValue(bannerEndInput);
    const maintenanceStartAt = parseDateTimeInputValue(maintenanceStartInput);
    const maintenanceEndAt = parseDateTimeInputValue(maintenanceEndInput);
    const ctaLabel = bannerConfig.ctaLabel.trim();
    const ctaHref = bannerConfig.ctaHref.trim();

    if (activeTab === 'announcements' && bannerConfig.enabled && !bannerConfig.message.trim()) {
      setError('Banner message is required when the banner is enabled.');
      return;
    }
    if (activeTab === 'announcements' && ((ctaLabel && !ctaHref) || (!ctaLabel && ctaHref))) {
      setError('CTA label and URL must both be set or both be empty.');
      return;
    }
    if (activeTab === 'announcements' && bannerStartAt !== null && bannerEndAt !== null && bannerEndAt < bannerStartAt) {
      setError('Banner end time cannot be before banner start time.');
      return;
    }
    if (
      activeTab === 'maintenance' &&
      maintenanceStartAt !== null &&
      maintenanceEndAt !== null &&
      maintenanceEndAt < maintenanceStartAt
    ) {
      setError('Maintenance end time cannot be before maintenance start time.');
      return;
    }
    const maintenanceAccessChanged = maintenanceConfig.enabled !== maintenanceMode.config.enabled ||
      maintenanceStartInput !== toDateTimeInputValue(maintenanceMode.config.startAt) ||
      maintenanceEndInput !== toDateTimeInputValue(maintenanceMode.config.endAt);
    if (activeTab === 'maintenance' && maintenanceAccessChanged && !confirmedMaintenance) {
      setConfirmMaintenance(true);
      return;
    }

    setBusy('save');
    try {
      const payload = await readJson<SiteSettingsResponse>(
        '/api/admin/site-settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(activeTab === 'announcements' ? {
            warningBanner: {
              ...bannerConfig,
              message: bannerConfig.message.trim(),
              startAt: bannerStartAt,
              endAt: bannerEndAt,
              ctaLabel,
              ctaHref,
            },
          } : {
            maintenanceMode: {
              ...maintenanceConfig,
              message: maintenanceConfig.message.trim(),
              startAt: maintenanceStartAt,
              endAt: maintenanceEndAt,
              allowAdminBypass: true,
            },
          }),
        },
      );
      if (activeTab === 'announcements') {
        setWarningBanner(payload.warningBanner);
        setBannerConfig(payload.warningBanner.config);
      } else {
        setMaintenanceMode(payload.maintenanceMode);
        setMaintenanceConfig(payload.maintenanceMode.config);
        setMaintenanceStatus(payload.maintenanceStatus);
      }
      setNotice(`${activeTab === 'announcements' ? 'Announcement' : 'Full maintenance'} settings saved.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveAvailability = async () => {
    setConfirmAvailability(false);
    setBusy('save');
    setNotice(null);
    setError(null);
    try {
      const payload = await readJson<SiteSettingsResponse>('/api/admin/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteAvailability: availabilityConfig,
          siteAvailabilityUpdatedAt: siteAvailability.updatedAt,
        }),
      });
      setSiteAvailability(payload.siteAvailability);
      setAvailabilityConfig(payload.siteAvailability.config);
      setAvailabilityConflict(false);
      setNotice('Availability changes are live.');
    } catch (caught) {
      const message = (caught as Error).message;
      setAvailabilityConflict(message.startsWith('Availability changed'));
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
    <AdminPageFrame
      title='Site settings'
      subtitle='Control access, full maintenance, and visitor announcements.'
      actions={(
        <>
          <ArcadeButton
            type='button'
            disabled={busy !== null}
            onClick={() => void loadSettings()}
          >
            <RefreshCw size={16} />
            Refresh
          </ArcadeButton>
          <ArcadeButton
            type='button'
            disabled={busy !== null || (activeTab === 'availability' && !availabilityDirty)}
            onClick={() => void saveSettings()}
            tone='primary'
          >
            <Save size={16} />
            {activeTab === 'availability' ? 'Review & publish' : 'Save changes'}
          </ArcadeButton>
        </>
      )}
      contentClassName='space-y-6'
    >
        <div className='overflow-x-auto pb-1'>
          <ArcadeSegmented
            items={SETTINGS_TABS}
            value={activeTab}
            onChange={(next) => {
              setActiveTab(next);
              setNotice(null);
              setError(null);
            }}
            ariaLabel='Site settings section'
          />
        </div>

        {activeTab === 'availability' ? (
          <div className='grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(18rem,21rem)]'>
            <AvailabilityEditor
              config={availabilityConfig}
              saved={siteAvailability.config}
              onChange={setAvailabilityConfig}
              disabled={busy !== null}
            />
            <aside>
              <HistoryPanel
                title='Availability history'
                updatedAt={siteAvailability.updatedAt}
                updatedBy={siteAvailability.updatedBy}
                history={siteAvailability.history}
              />
            </aside>
          </div>
        ) : null}

        {activeTab === 'announcements' ? (
          <section className='grid gap-3 sm:grid-cols-2'>
            <ArcadeStat
              label='Banner'
              value={bannerConfig.enabled ? 'Enabled' : 'Off'}
              detail={bannerConfig.variant}
            />
            <ArcadeStat
              label='Last published'
              value={formatTimestamp(warningBanner.updatedAt)}
              detail={warningBanner.updatedBy ? `By ${warningBanner.updatedBy}` : 'No changes yet'}
            />
          </section>
        ) : null}
        {activeTab === 'maintenance' ? (
          <section className='grid gap-3 sm:grid-cols-2'>
            <ArcadeStat
              label='Maintenance'
              value={getMaintenanceStatusLabel(maintenanceStatus)}
              detail={`Updated ${formatTimestamp(maintenanceMode.updatedAt)}`}
            />
            <ArcadeStat
              label='Admin bypass'
              value={maintenanceConfig.allowAdminBypass ? 'On' : 'Off'}
              detail='Admin role'
            />
          </section>
        ) : null}

        {notice ? <div role='status'><ArcadeNotice tone='success'>{notice}</ArcadeNotice></div> : null}
        {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}
        {availabilityConflict ? (
          <div className='flex flex-wrap items-center gap-3'>
            <p className='text-sm text-body'>Your draft remains here until you refresh and review the latest live settings.</p>
            <ArcadeButton type='button' size='sm' onClick={() => void loadSettings()} disabled={busy !== null}>
              <RefreshCw size={14} /> Refresh live settings
            </ArcadeButton>
          </div>
        ) : null}

        <section className={activeTab === 'availability' ? 'hidden' : 'grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]'}>
          <div className='space-y-5'>
            <section className={activeTab === 'announcements' ? 'arcade-card p-5' : 'hidden'}>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <h2 className='arcade-kicker'>Banners</h2>
                <span className='inline-flex items-center gap-2 text-sm font-semibold text-body'>
                  Enabled
                  <ArcadeSwitch
                    checked={bannerConfig.enabled}
                    label='Banner enabled'
                    onChange={(next) =>
                      setBannerConfig((current) => ({
                        ...current,
                        enabled: next,
                      }))
                    }
                  />
                </span>
              </div>

              <div className='mt-5 grid gap-4 md:grid-cols-2'>
                <ArcadeField label='Type'>
                  <select
                    value={bannerConfig.variant}
                    onChange={(event) =>
                      setBannerConfig((current) => ({
                        ...current,
                        variant: event.target
                          .value as WarningBannerConfig['variant'],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value='info'>Info</option>
                    <option value='success'>Success</option>
                    <option value='warning'>Warning</option>
                    <option value='critical'>Critical</option>
                    <option value='maintenance'>Maintenance</option>
                  </select>
                </ArcadeField>

                <ArcadeField label='Audience'>
                  <select
                    value={bannerConfig.audience}
                    onChange={(event) =>
                      setBannerConfig((current) => ({
                        ...current,
                        audience: event.target
                          .value as WarningBannerConfig['audience'],
                      }))
                    }
                    disabled={bannerConfig.variant === 'maintenance'}
                    className={inputClass}
                  >
                    <option value='all'>All visitors</option>
                    <option value='players'>Signed-in players</option>
                    <option value='admins'>Admins</option>
                  </select>
                </ArcadeField>
              </div>

              <ArcadeField label='Message' className='mt-4'>
                <textarea
                  value={bannerConfig.message}
                  onChange={(event) =>
                    setBannerConfig((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  rows={4}
                  className={inputClass}
                />
              </ArcadeField>

              <div className='mt-4 grid gap-4 md:grid-cols-2'>
                <ArcadeField label='Start'>
                  <input
                    type='datetime-local'
                    value={bannerStartInput}
                    onChange={(event) => setBannerStartInput(event.target.value)}
                    className={inputClass}
                  />
                </ArcadeField>
                <ArcadeField label='End'>
                  <input
                    type='datetime-local'
                    value={bannerEndInput}
                    onChange={(event) => setBannerEndInput(event.target.value)}
                    className={inputClass}
                  />
                </ArcadeField>
              </div>

              <div className='mt-4 grid gap-4 md:grid-cols-3'>
                <ArcadeField label='Dismiss' className='md:col-span-1'>
                  <select
                    value={bannerConfig.dismissMode}
                    onChange={(event) =>
                      setBannerConfig((current) => ({
                        ...current,
                        dismissMode: event.target
                          .value as WarningBannerConfig['dismissMode'],
                      }))
                    }
                    disabled={bannerConfig.variant === 'maintenance'}
                    className={inputClass}
                  >
                    <option value='none'>None</option>
                    <option value='session'>Session</option>
                    <option value='24h'>24 hours</option>
                    <option value='7d'>7 days</option>
                  </select>
                </ArcadeField>
                <ArcadeField label='CTA label' className='md:col-span-1'>
                  <ArcadeInput
                    value={bannerConfig.ctaLabel}
                    onChange={(event) =>
                      setBannerConfig((current) => ({
                        ...current,
                        ctaLabel: event.target.value,
                      }))
                    }
                    disabled={bannerConfig.variant === 'maintenance'}
                  />
                </ArcadeField>
                <ArcadeField label='CTA URL' className='md:col-span-1'>
                  <ArcadeInput
                    value={bannerConfig.ctaHref}
                    onChange={(event) =>
                      setBannerConfig((current) => ({
                        ...current,
                        ctaHref: event.target.value,
                      }))
                    }
                    disabled={bannerConfig.variant === 'maintenance'}
                  />
                </ArcadeField>
              </div>
            </section>

            <section className={activeTab === 'maintenance' ? 'arcade-card p-5' : 'hidden'}>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <h2 className='arcade-kicker'>Maintenance</h2>
                <span className='inline-flex items-center gap-2 text-sm font-semibold text-body'>
                  Redirect users
                  <ArcadeSwitch
                    checked={maintenanceConfig.enabled}
                    label='Redirect users'
                    onChange={(next) =>
                      setMaintenanceConfig((current) => ({
                        ...current,
                        enabled: next,
                      }))
                    }
                  />
                </span>
              </div>

              <ArcadeField label='Page message' className='mt-4'>
                <textarea
                  value={maintenanceConfig.message}
                  onChange={(event) =>
                    setMaintenanceConfig((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  rows={4}
                  className={inputClass}
                />
              </ArcadeField>

              <div className='mt-4 grid gap-4 md:grid-cols-2'>
                <ArcadeField label='Start'>
                  <input
                    type='datetime-local'
                    value={maintenanceStartInput}
                    onChange={(event) =>
                      setMaintenanceStartInput(event.target.value)
                    }
                    className={inputClass}
                  />
                </ArcadeField>
                <ArcadeField label='End'>
                  <input
                    type='datetime-local'
                    value={maintenanceEndInput}
                    onChange={(event) => setMaintenanceEndInput(event.target.value)}
                    className={inputClass}
                  />
                </ArcadeField>
              </div>
            </section>
          </div>

          <aside className='space-y-5'>
            <section className={activeTab === 'announcements' ? 'arcade-card p-5' : 'hidden'}>
              <h2 className='arcade-kicker'>Preview</h2>
              <div className='mt-4 rounded-well border-2 border-ink bg-well px-4 py-3 inset-shadow-well'>
                <div className='flex items-start gap-3'>
                  <span
                    className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink ${preview.dot}`}
                  >
                    <preview.icon className='h-4 w-4' aria-hidden={true} />
                  </span>
                  <div className='min-w-0'>
                    <p className={`arcade-kicker ${preview.eyebrow}`}>
                      {preview.label}
                    </p>
                    <p className='mt-1 whitespace-pre-wrap break-words text-sm font-medium text-body'>
                      {bannerConfig.message.trim() || 'Banner preview'}
                    </p>
                    {bannerConfig.ctaLabel.trim() && bannerConfig.ctaHref.trim() ? (
                      <span className='mt-3 inline-flex rounded-key border-2 border-ink bg-key-face px-3 py-1.5 text-xs font-semibold text-key-face-on'>
                        {bannerConfig.ctaLabel.trim()}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {activeTab === 'announcements' ? <HistoryPanel
              title='Banner history'
              updatedAt={warningBanner.updatedAt}
              updatedBy={warningBanner.updatedBy}
              history={warningBanner.history}
            /> : null}
            {activeTab === 'maintenance' ? <HistoryPanel
              title='Maintenance history'
              updatedAt={maintenanceMode.updatedAt}
              updatedBy={maintenanceMode.updatedBy}
              history={maintenanceMode.history}
            /> : null}
          </aside>
        </section>
    </AdminPageFrame>
    {confirmAvailability ? (
      <ArcadeModal
        title='Publish availability changes?'
        tone='tickets'
        onClose={() => setConfirmAvailability(false)}
        maxWidth='40rem'
        actions={(
          <>
            <ArcadeButton type='button' onClick={() => setConfirmAvailability(false)}>Keep editing</ArcadeButton>
            <ArcadeButton type='button' tone='primary' onClick={() => void saveAvailability()}>Publish changes</ArcadeButton>
          </>
        )}
      >
        <p className='text-sm leading-6 text-body'>
          These access changes take effect for everyone, including admins. The admin controls remain available.
          Existing saved sessions and wagers can finish or settle so tickets are not stranded. Daily puzzles pause immediately.
        </p>
        <ul className='mt-4 max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-strong'>
          {availabilityChanges.map((change) => <li key={change}>{change}</li>)}
        </ul>
      </ArcadeModal>
    ) : null}
    {confirmMaintenance ? (
      <ArcadeModal
        title='Change full maintenance access?'
        tone='danger'
        onClose={() => setConfirmMaintenance(false)}
        maxWidth='38rem'
        actions={(
          <>
            <ArcadeButton type='button' onClick={() => setConfirmMaintenance(false)}>Keep editing</ArcadeButton>
            <ArcadeButton type='button' tone='danger' onClick={() => {
              setConfirmMaintenance(false);
              void saveSettings(true);
            }}>Confirm & save</ArcadeButton>
          </>
        )}
      >
        <p className='text-sm leading-6 text-body'>
          Full maintenance redirects visitors away from the site when active. Admins can still access the control room.
          Confirm the access window before saving.
        </p>
        <ul className='mt-4 list-disc space-y-2 pl-5 text-sm text-strong'>
          <li>Redirect visitors: {maintenanceMode.config.enabled ? 'on' : 'off'} → {maintenanceConfig.enabled ? 'on' : 'off'}</li>
          <li>Start: {maintenanceStartInput || 'Immediately'}</li>
          <li>End: {maintenanceEndInput || 'Until switched off'}</li>
        </ul>
      </ArcadeModal>
    ) : null}
    </>
  );
}

function HistoryPanel({
  title,
  updatedAt,
  updatedBy,
  history,
}: {
  title: string;
  updatedAt: number | null;
  updatedBy: string | null;
  history: SiteSettingDetails<unknown>['history'];
}) {
  return (
    <section className='arcade-card p-5'>
      <h2 className='arcade-kicker'>{title}</h2>
      <p className='mt-2 text-sm text-faint'>
        Updated {formatTimestamp(updatedAt)}
        {updatedBy ? ` by ${updatedBy}` : ''}
      </p>
      <div className='mt-4 space-y-3'>
        {history.length === 0 ? (
          <p className='text-sm text-faint'>No history yet.</p>
        ) : (
          history.slice(0, 5).map((entry) => (
            <div
              key={`${entry.updatedAt}:${entry.summary}`}
              className='arcade-card-inset p-3'
            >
              <p className='text-sm font-medium text-body'>{entry.summary}</p>
              <p className='mt-1 text-xs text-faint'>
                {formatTimestamp(entry.updatedAt)}
                {entry.updatedBy ? ` by ${entry.updatedBy}` : ''}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
