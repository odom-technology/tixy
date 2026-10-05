'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import {
  Activity,
  Bell,
  Check,
  Copy,
  KeyRound,
  Laptop,
  LogOut,
  MessageSquare,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { AccountSettings } from '@/features/account/account-settings';
import {
  ARCADE_DASHBOARD_SECTIONS,
} from '@/features/arcade/components/arcade-game-registry';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeField,
  ArcadeInput,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadeNotice,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeSwitch } from '@/features/arcade/components/ui/arcade-interactive';
import { TixySelect, type TixySelectOption } from '@/features/arcade/components/ui/tixy-select';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { applyArcadeTheme, type ArcadeThemeId } from '@/features/arcade/lib/arcade-themes';
import { ThemePicker } from '@/app/settings/_theme-picker';
import type { FeedbackEntry } from '@/server/feedback';
import { ProfileEditForm, type ProfileEditFormProps } from '@/app/profile/_profile-edit-form';

export type SettingsTab = 'overview' | 'profile' | 'preferences' | 'security' | 'activity';

type Account = {
  email: string;
  username: string | null;
  status: string;
  roles: string[];
  lastLoginAt: number | null;
};

type SettingsClientProps = {
  account: Account;
  activeTab: SettingsTab;
  initialSettings: AccountSettings;
  initialSessions: AccountSession[];
  initialRecoveryCodeSummary: RecoveryCodeSummary;
  initialUnreadCount: number;
  initialFeedbackEntries: FeedbackEntry[];
  profileEditor: ProfileEditFormProps | null;
};

type AccountSession = {
  id: string;
  isCurrent: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  userAgent: string | null;
  ipAddress: string | null;
};

type RecoveryCodeSummary = {
  createdAt: number | null;
  updatedAt: number | null;
  lastUsedAt: number | null;
  remainingCount: number;
};

const VISIBILITY_OPTIONS: TixySelectOption<AccountSettings['profileVisibility']>[] = [
  { value: 'public', label: 'public', hint: 'Anyone with the link, and your card can be shared.' },
  { value: 'players', label: 'players', hint: 'Signed-in players only. No card in link previews.' },
  { value: 'private', label: 'private', hint: 'Only you.' },
];

const toggleRows: Array<['gameNotifications' | 'feedbackNotifications', string]> = [
  ['gameNotifications', 'Game and friend notifications'],
  ['feedbackNotifications', 'Feedback status notifications'],
];

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}> = [
  { id: 'overview', label: 'Overview', icon: Settings },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'preferences', label: 'Preferences', icon: Check },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'activity', label: 'Activity', icon: Activity },
];

async function readJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return 'Unknown';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatUserAgent(userAgent: string | null) {
  if (!userAgent) return 'Unknown device';
  if (userAgent.includes('Edg/')) return 'Edge browser';
  if (userAgent.includes('Chrome')) return 'Chrome browser';
  if (userAgent.includes('Firefox')) return 'Firefox browser';
  if (userAgent.includes('Safari')) return 'Safari browser';
  return userAgent.slice(0, 80);
}

function feedbackStatusTone(
  status: FeedbackEntry['status'],
): 'prize' | 'primary' | undefined {
  if (status === 'resolved') return 'prize';
  if (status === 'dismissed') return undefined;
  return 'primary';
}

function feedbackCategoryLabel(category: FeedbackEntry['category']) {
  if (category === 'game_request') return 'Game request';
  if (category === 'bug') return 'Bug report';
  if (category === 'performance') return 'Floor speed';
  if (category === 'layout') return 'Floor layout';
  if (category === 'account') return 'Player card';
  if (category === 'privacy') return 'Privacy';
  if (category === 'purchase') return 'Purchase';
  if (category === 'ads') return 'Ads';
  return 'Other';
}

export function SettingsClient({
  account,
  activeTab,
  initialSettings,
  initialSessions,
  initialRecoveryCodeSummary,
  initialUnreadCount,
  initialFeedbackEntries,
  profileEditor,
}: SettingsClientProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settings, setSettings] = useState(initialSettings);
  const [sessions, setSessions] = useState(initialSessions);
  const [recoveryCodeSummary, setRecoveryCodeSummary] = useState(
    initialRecoveryCodeSummary,
  );
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* What the server has. A theme is saved the moment it is picked, on top
     of this, so unsaved edits elsewhere in the form are not saved with it. */
  const savedSettings = useRef(initialSettings);
  const themeSaves = useRef<Promise<void>>(Promise.resolve());
  const [themeSaving, setThemeSaving] = useState(false);

  useEffect(() => {
    applyArcadeTheme(document.documentElement, settings.arcadeTheme);
  }, [settings.arcadeTheme]);

  const chooseTheme = (arcadeTheme: ArcadeThemeId) => {
    setSettings((current) => ({ ...current, arcadeTheme }));
    setThemeSaving(true);
    setError(null);
    setNotice(null);
    // One save at a time, in the order they were picked.
    themeSaves.current = themeSaves.current.then(async () => {
      const next = { ...savedSettings.current, arcadeTheme };
      try {
        await readJsonResponse(
          await fetch('/api/account/data', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'settings', value: next }),
          }),
        );
        savedSettings.current = next;
        router.refresh();
      } catch {
        setError('The theme did not save. Pick it again to retry.');
      } finally {
        setThemeSaving(false);
      }
    });
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      setNotice(null);
      return;
    }
    setBusy('password');
    setError(null);
    setNotice(null);
    try {
      await readJsonResponse(
        await fetch('/api/account/password', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword,
            newPassword,
          }),
        }),
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password updated.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('preferences');
    setError(null);
    setNotice(null);
    try {
      await readJsonResponse(
        await fetch('/api/account/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'settings',
            value: settings,
          }),
        }),
      );
      savedSettings.current = settings;
      setNotice('Settings saved.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const revokeOtherSessions = async () => {
    setBusy('sessions');
    setError(null);
    setNotice(null);
    try {
      const payload = await readJsonResponse<{ sessions: AccountSession[] }>(
        await fetch('/api/account/sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'revoke-other-sessions' }),
        }),
      );
      setSessions(payload.sessions);
      setNotice('Other sessions signed out.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const generateRecoveryCodes = async () => {
    setBusy('recovery-codes');
    setError(null);
    setNotice(null);
    try {
      const payload = await readJsonResponse<{
        codes: string[];
        summary: RecoveryCodeSummary;
      }>(
        await fetch('/api/account/recovery-codes', {
          method: 'POST',
        }),
      );
      setNewRecoveryCodes(payload.codes);
      setRecoveryCodeSummary(payload.summary);
      setNotice('Recovery codes generated. Save them now; they will not be shown again.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyRecoveryCodes = async () => {
    if (newRecoveryCodes.length === 0) return;
    try {
      await navigator.clipboard.writeText(newRecoveryCodes.join('\n'));
      setNotice('Recovery codes copied.');
      setError(null);
    } catch {
      setError('Unable to copy recovery codes from this browser.');
      setNotice(null);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setBusy('delete');
    setError(null);
    setNotice(null);
    try {
      await readJsonResponse(
        await fetch('/api/account/me', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Deleted from account settings' }),
        }),
      );
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(null);
    }
  };

  return (
    <AppPageFrame
      title='Settings'
      subtitle='Manage your player card, preferences, security, and activity in one place.'
      actions={
        <>
          <ArcadeLinkButton size='sm' tone='ghost' href='/profile'>View player card</ArcadeLinkButton>
          <ArcadeLinkButton size='sm' tone='ghost' href='/social?view=alerts'>Alerts</ArcadeLinkButton>
        </>
      }
      contentClassName='grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]'
    >
      <nav aria-label='Settings sections' className='arcade-scrollbar min-w-0 overflow-x-auto lg:sticky lg:top-24 lg:overflow-visible'>
        <div className='flex min-w-max gap-2 lg:min-w-0 lg:flex-col lg:gap-1.5 lg:rounded-panel lg:border lg:border-soft lg:bg-panel lg:p-3'>
          <p className='arcade-kicker mb-2 hidden px-3 pt-1 lg:block'>Account settings</p>
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                href={tab.id === 'overview' ? '/settings' : `/settings?tab=${tab.id}`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-2 rounded-key border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:w-full ${
                  activeTab === tab.id
                    ? 'border-primary bg-primary text-primary-on shadow-chip'
                    : 'border-soft bg-raised text-body hover:border-strong hover:text-strong'
                }`}
              >
                <Icon size={16} aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className='min-w-0 space-y-6'>

      {notice ? (
        <div role='status'>
          <ArcadeNotice tone='success' icon={<Check aria-hidden size={12} />}>
            {notice}
          </ArcadeNotice>
        </div>
      ) : null}
      {error ? <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div> : null}

      {activeTab === 'overview' ? (
        <OverviewTab account={account} unreadCount={initialUnreadCount} sessions={sessions} />
      ) : null}
      {activeTab === 'profile' && profileEditor ? <ProfileEditForm {...profileEditor} /> : null}
      {activeTab === 'preferences' ? (
        <PreferencesTab
          settings={settings}
          setSettings={setSettings}
          busy={busy}
          onSubmit={savePreferences}
          onThemeChange={chooseTheme}
          themeSaving={themeSaving}
        />
      ) : null}
      {activeTab === 'security' ? (
        <SecurityTab
          currentPassword={currentPassword}
          newPassword={newPassword}
          confirmPassword={confirmPassword}
          recoveryCodeSummary={recoveryCodeSummary}
          newRecoveryCodes={newRecoveryCodes}
          sessions={sessions}
          deleteConfirm={deleteConfirm}
          busy={busy}
          setCurrentPassword={setCurrentPassword}
          setNewPassword={setNewPassword}
          setConfirmPassword={setConfirmPassword}
          setDeleteConfirm={setDeleteConfirm}
          onSavePassword={savePassword}
          onGenerateRecoveryCodes={generateRecoveryCodes}
          onCopyRecoveryCodes={copyRecoveryCodes}
          onRevokeOtherSessions={revokeOtherSessions}
          onDeleteAccount={deleteAccount}
        />
      ) : null}
      {activeTab === 'activity' ? (
        <ActivityTab
          unreadCount={initialUnreadCount}
          feedbackEntries={initialFeedbackEntries}
          sessions={sessions}
        />
      ) : null}
      </div>
    </AppPageFrame>
  );
}

function OverviewTab({
  account,
  unreadCount,
  sessions,
}: {
  account: Account;
  unreadCount: number;
  sessions: AccountSession[];
}) {
  return (
    <div className='grid gap-5 lg:grid-cols-[0.8fr_1.2fr]'>
      <ArcadePanel className='overflow-hidden'>
        <ArcadeMarquee tone='cream' size='sm'>
          Account
        </ArcadeMarquee>
        <div className='space-y-4 p-5'>
          <div>
            <p className='arcade-kicker'>Signed in as</p>
            <p className='mt-1 break-words text-sm font-semibold text-strong'>{account.email}</p>
          </div>
          <dl className='grid gap-3 border-t border-soft pt-4 text-sm sm:grid-cols-2'>
            <div>
              <dt className='arcade-kicker'>Username</dt>
              <dd className='mt-1 text-strong'>{account.username ?? 'Unset'}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Access</dt>
              <dd className='mt-1 capitalize text-strong'>{account.status}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Floor roles</dt>
              <dd className='mt-1 capitalize text-strong'>{account.roles.join(', ')}</dd>
            </div>
            <div>
              <dt className='arcade-kicker'>Last entry</dt>
              <dd className='mt-1 text-strong'>{formatDate(account.lastLoginAt)}</dd>
            </div>
          </dl>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-1'>
            <OverviewCard
              href='/settings?tab=profile'
              icon={User}
              label='Profile'
              detail='Edit your player card, avatar, bio, and public details.'
            />
            <OverviewCard
              href='/settings?tab=security'
              icon={ShieldCheck}
              label='Security'
              detail={`${sessions.length.toLocaleString()} active session${sessions.length === 1 ? '' : 's'}.`}
            />
          </div>
        </div>
      </ArcadePanel>

      <ArcadePanel className='overflow-hidden'>
        <ArcadeMarquee tone='info' size='sm'>
          Settings dashboard
        </ArcadeMarquee>
        <div className='grid gap-3 p-5 sm:grid-cols-2'>
          <OverviewCard
            href='/settings?tab=preferences'
            icon={Settings}
            label='Preferences'
            detail='Theme, profile visibility, default dashboard, and notifications.'
          />
          <OverviewCard
            href='/settings?tab=activity'
            icon={Activity}
            label='Activity'
            detail='Alerts, feedback notes, and checked-in devices.'
          />
          <OverviewCard
            href='/social?view=alerts'
            icon={Bell}
            label='Alerts'
            detail={`${unreadCount.toLocaleString()} unread alert${unreadCount === 1 ? '' : 's'}.`}
          />
          <OverviewCard
            href='/social'
            icon={Users}
            label='Friends'
            detail='Manage friends and pending requests.'
          />
          <OverviewCard
            href='/feedback'
            icon={MessageSquare}
            label='Feedback'
            detail='Review your notes or send a new one.'
          />
          <OverviewCard
            href='/players'
            icon={Users}
            label='Players'
            detail='Browse the player directory.'
          />
        </div>
      </ArcadePanel>
    </div>
  );
}

function OverviewCard({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  detail: string;
}) {
  return (
    <Link href={href} className='block h-full min-w-0'>
      <div className='arcade-card-inset h-full p-4 transition hover:brightness-110'>
        <div className='flex items-start gap-3'>
          <span className='rounded-key border border-ink bg-raised p-2 text-primary-text'>
            <Icon size={17} aria-hidden />
          </span>
          <div className='min-w-0'>
            <h2 className='text-sm font-semibold text-strong'>{label}</h2>
            <p className='mt-1 text-sm leading-6 text-faint'>{detail}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function PreferencesTab({
  settings,
  setSettings,
  busy,
  onSubmit,
  onThemeChange,
  themeSaving,
}: {
  settings: AccountSettings;
  setSettings: Dispatch<SetStateAction<AccountSettings>>;
  busy: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onThemeChange: (id: ArcadeThemeId) => void;
  themeSaving: boolean;
}) {
  return (
    <ArcadePanel className='overflow-hidden'>
      <ArcadeMarquee tone='info' size='sm'>
        Preferences
      </ArcadeMarquee>
      <form onSubmit={onSubmit} className='space-y-5 p-5'>
        <ThemePicker value={settings.arcadeTheme} onChange={onThemeChange} saving={themeSaving} />

        <div className='grid gap-4 sm:grid-cols-2'>
          {/* Not ArcadeField: a <label> around a list would send every
              press on an option back to the button. */}
          <div className='min-w-0'>
            <span id='pref-visibility' className='arcade-kicker arc-field-label mb-2 block'>Profile visibility</span>
            <TixySelect<AccountSettings['profileVisibility']>
              labelledBy='pref-visibility'
              value={settings.profileVisibility}
              options={VISIBILITY_OPTIONS}
              onChange={(profileVisibility) =>
                setSettings((current) => ({ ...current, profileVisibility }))
              }
            />
          </div>
          <div className='min-w-0'>
            <span id='pref-section' className='arcade-kicker arc-field-label mb-2 block'>Default floor section</span>
            <TixySelect<AccountSettings['defaultDashboardSection']>
              labelledBy='pref-section'
              value={settings.defaultDashboardSection}
              options={ARCADE_DASHBOARD_SECTIONS.map((section) => ({
                value: section.id as AccountSettings['defaultDashboardSection'],
                label: section.label.toLowerCase(),
              }))}
              onChange={(defaultDashboardSection) =>
                setSettings((current) => ({ ...current, defaultDashboardSection }))
              }
            />
          </div>
        </div>

        <div className='space-y-3'>
          {toggleRows.map(([key, label]) => (
            <div
              key={key}
              className='arcade-card-inset flex items-center justify-between gap-4 px-3 py-2.5 text-sm text-body'
            >
              <span>{label}</span>
              <ArcadeSwitch
                checked={Boolean(settings[key])}
                onChange={(next) =>
                  setSettings((current) => ({
                    ...current,
                    [key]: next,
                  }))
                }
                label={label}
              />
            </div>
          ))}
        </div>
        <ArcadeButton
          type='submit'
          tone='primary'
          disabled={busy === 'preferences'}
        >
          <Save size={16} />
          {busy === 'preferences' ? 'Saving' : 'Save settings'}
        </ArcadeButton>
      </form>
    </ArcadePanel>
  );
}

function SecurityTab({
  currentPassword,
  newPassword,
  confirmPassword,
  recoveryCodeSummary,
  newRecoveryCodes,
  sessions,
  deleteConfirm,
  busy,
  setCurrentPassword,
  setNewPassword,
  setConfirmPassword,
  setDeleteConfirm,
  onSavePassword,
  onGenerateRecoveryCodes,
  onCopyRecoveryCodes,
  onRevokeOtherSessions,
  onDeleteAccount,
}: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  recoveryCodeSummary: RecoveryCodeSummary;
  newRecoveryCodes: string[];
  sessions: AccountSession[];
  deleteConfirm: string;
  busy: string | null;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  setDeleteConfirm: (value: string) => void;
  onSavePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onGenerateRecoveryCodes: () => Promise<void>;
  onCopyRecoveryCodes: () => Promise<void>;
  onRevokeOtherSessions: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}) {
  return (
    <div className='space-y-5'>
      <div className='grid items-start gap-5 lg:grid-cols-2'>
        <ArcadePanel className='overflow-hidden'>
          <ArcadeMarquee tone='cream' size='sm'>
            Password
          </ArcadeMarquee>
          <form onSubmit={onSavePassword} className='space-y-4 p-5'>
            <ArcadeField label='Current password'>
              <ArcadeInput
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete='current-password'
                type='password'
                required
              />
            </ArcadeField>
            <ArcadeField label='New password'>
              <ArcadeInput
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete='new-password'
                type='password'
                minLength={8}
                required
              />
            </ArcadeField>
            <ArcadeField label='Confirm new password'>
              <ArcadeInput
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete='new-password'
                type='password'
                minLength={8}
                required
              />
            </ArcadeField>
            <ArcadeButton
              type='submit'
              tone='primary'
              disabled={busy === 'password'}
            >
              <Save size={16} />
              {busy === 'password' ? 'Saving' : 'Save password'}
            </ArcadeButton>
          </form>
        </ArcadePanel>

        <ArcadePanel className='overflow-hidden'>
          <ArcadeMarquee
            tone='cream'
            size='sm'
            trailing={<KeyRound aria-hidden size={15} />}
          >
            Recovery codes
          </ArcadeMarquee>
          <div className='space-y-4 p-5'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
              <p className='text-sm leading-6 text-faint'>
                One-time fallback codes for password recovery.
              </p>
              <ArcadeButton
                type='button'
                tone='primary'
                size='sm'
                onClick={() => void onGenerateRecoveryCodes()}
                disabled={busy === 'recovery-codes'}
              >
                <KeyRound size={14} />
                {busy === 'recovery-codes' ? 'Generating' : 'Generate'}
              </ArcadeButton>
            </div>

            <dl className='arcade-card-inset grid gap-3 p-4 text-sm sm:grid-cols-3'>
              <div>
                <dt className='arcade-kicker'>Remaining</dt>
                <dd className='arcade-num mt-1 text-lg font-semibold text-strong'>
                  {recoveryCodeSummary.remainingCount}
                </dd>
              </div>
              <div>
                <dt className='arcade-kicker'>Generated</dt>
                <dd className='mt-1 text-body'>
                  {formatDate(recoveryCodeSummary.createdAt)}
                </dd>
              </div>
              <div>
                <dt className='arcade-kicker'>Last used</dt>
                <dd className='mt-1 text-body'>
                  {formatDate(recoveryCodeSummary.lastUsedAt)}
                </dd>
              </div>
            </dl>

            {newRecoveryCodes.length > 0 ? (
              <div className='arcade-card-inset p-4'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <ArcadeChip tone='tickets'>Save these codes now</ArcadeChip>
                  <ArcadeButton
                    type='button'
                    size='sm'
                    onClick={() => void onCopyRecoveryCodes()}
                  >
                    <Copy size={14} />
                    Copy
                  </ArcadeButton>
                </div>
                <div className='mt-4 grid gap-2 sm:grid-cols-2'>
                  {newRecoveryCodes.map((code) => (
                    <code
                      key={code}
                      className='arcade-num rounded-tag border border-soft bg-panel px-3 py-2 text-sm text-strong'
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </ArcadePanel>
      </div>

      <ArcadePanel className='overflow-hidden'>
        <ArcadeMarquee tone='cream' size='sm'>
          Active sessions
        </ArcadeMarquee>
        <div className='space-y-4 p-5'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <p className='text-sm leading-6 text-faint'>
              Machines currently checked into this player card.
            </p>
            <ArcadeButton
              type='button'
              size='sm'
              disabled={
                sessions.filter((session) => !session.isCurrent).length === 0 ||
                busy === 'sessions'
              }
              onClick={() => void onRevokeOtherSessions()}
            >
              <LogOut size={14} />
              {busy === 'sessions' ? 'Signing out' : 'Sign out others'}
            </ArcadeButton>
          </div>

          {sessions.length === 0 ? (
            <p className='arcade-card-inset px-4 py-6 text-center text-sm text-faint'>
              No active sessions found.
            </p>
          ) : (
            <div className='border-t border-soft'>
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className='flex flex-col gap-2 border-b border-soft py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='min-w-0'>
                    <p className='flex flex-wrap items-center gap-2 text-sm font-semibold text-strong'>
                      {formatUserAgent(session.userAgent)}
                      {session.isCurrent ? (
                        <ArcadeChip tone='prize'>Current</ArcadeChip>
                      ) : null}
                    </p>
                    <p className='mt-1 text-xs text-faint'>
                      Created {formatDate(session.createdAt)}
                      {session.ipAddress ? ` from ${session.ipAddress}` : ''}
                    </p>
                  </div>
                  <p className='text-xs text-faint'>
                    Expires {formatDate(session.expiresAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </ArcadePanel>

      <ArcadePanel className='overflow-hidden'>
        <ArcadeMarquee tone='danger' size='sm'>
          Delete account
        </ArcadeMarquee>
        <div className='p-5'>
          <p className='text-sm leading-6 text-faint'>
            This closes your player card for good. Type DELETE to confirm.
          </p>
          <div className='mt-4 flex flex-col gap-3 sm:flex-row sm:items-end'>
            <ArcadeField label='Type DELETE' className='grow'>
              <ArcadeInput
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder='DELETE'
              />
            </ArcadeField>
            <ArcadeButton
              type='button'
              tone='danger'
              disabled={deleteConfirm !== 'DELETE' || busy === 'delete'}
              onClick={() => void onDeleteAccount()}
            >
              <Trash2 size={16} />
              {busy === 'delete' ? 'Deleting' : 'Delete'}
            </ArcadeButton>
          </div>
        </div>
      </ArcadePanel>
    </div>
  );
}

function ActivityTab({
  unreadCount,
  feedbackEntries,
  sessions,
}: {
  unreadCount: number;
  feedbackEntries: FeedbackEntry[];
  sessions: AccountSession[];
}) {
  const openFeedbackCount = feedbackEntries.filter(
    (entry) => entry.status === 'open',
  ).length;

  return (
    <div className='space-y-6'>
      <section className='grid gap-4 sm:grid-cols-3'>
        <SummaryCard
          icon={<Bell size={18} />}
          label='Unread alerts'
          value={unreadCount.toLocaleString()}
          href='/social?view=alerts'
        />
        <SummaryCard
          icon={<MessageSquare size={18} />}
          label='Open notes'
          value={openFeedbackCount.toLocaleString()}
          href='/feedback'
        />
        <SummaryCard
          icon={<Laptop size={18} />}
          label='Active sessions'
          value={sessions.length.toLocaleString()}
          href='/settings?tab=security'
        />
      </section>

      <div className='grid gap-5 lg:grid-cols-2'>
        <section className='arcade-card space-y-4 p-5'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <h2 className='text-lg font-semibold'>Feedback notes</h2>
              <p className='mt-1 text-sm text-faint'>
                Recent game requests and bug reports from this account.
              </p>
            </div>
            <Link href='/feedback?category=game_request' className='arcade-link text-sm'>
              New note
            </Link>
          </div>
          {feedbackEntries.length === 0 ? (
            <EmptyState text='No feedback notes submitted yet.' />
          ) : (
            <div className='space-y-3'>
              {feedbackEntries.map((entry) => (
                <FeedbackRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>

        <section className='arcade-card space-y-4 p-5'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <h2 className='text-lg font-semibold'>Active machines</h2>
              <p className='mt-1 text-sm text-faint'>
                Devices currently checked into this player card.
              </p>
            </div>
            <Link href='/settings?tab=security' className='arcade-link text-sm'>
              Manage
            </Link>
          </div>
          {sessions.length === 0 ? (
            <EmptyState text='No active machines found.' />
          ) : (
            <div className='space-y-3'>
              {sessions.slice(0, 6).map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className='arcade-card p-5 transition hover:brightness-110'
    >
      <div className='flex items-center justify-between gap-3'>
        <span className='text-sm font-medium text-faint'>{label}</span>
        <span className='text-primary-text'>{icon}</span>
      </div>
      <p className='arcade-num mt-4 text-3xl font-semibold'>{value}</p>
    </Link>
  );
}

function FeedbackRow({ entry }: { entry: FeedbackEntry }) {
  return (
    <Link
      href={`/feedback/${encodeURIComponent(entry.id)}`}
      className='block arcade-card-inset p-4 transition hover:brightness-110'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <ArcadeChip tone={feedbackStatusTone(entry.status)}>
          {entry.status}
        </ArcadeChip>
        <span className='text-xs capitalize text-faint'>
          {feedbackCategoryLabel(entry.category)}
        </span>
        <span className='text-xs text-faint'>{formatDate(entry.createdAt)}</span>
      </div>
      <p className='mt-2 line-clamp-3 text-sm leading-6 text-faint'>
        {entry.message}
      </p>
      {entry.adminNote ? (
        <p className='mt-2 line-clamp-2 text-xs text-primary-text'>
          Admin note: {entry.adminNote}
        </p>
      ) : null}
    </Link>
  );
}

function SessionRow({ session }: { session: AccountSession }) {
  return (
    <article className='arcade-card-inset p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {session.isCurrent ? (
          <ArcadeChip tone='prize'>Current</ArcadeChip>
        ) : null}
        <span className='text-sm font-semibold text-strong'>
          {formatUserAgent(session.userAgent)}
        </span>
      </div>
      <dl className='mt-3 grid gap-2 text-xs text-faint sm:grid-cols-2'>
        <Detail label='Started' value={formatDate(session.createdAt)} />
        <Detail label='Expires' value={formatDate(session.expiresAt)} />
        <Detail label='IP' value={session.ipAddress ?? 'Unknown'} />
      </dl>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='font-semibold text-body'>{label}</dt>
      <dd className='mt-1'>{value}</dd>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className='arcade-card-inset px-4 py-8 text-center text-sm text-faint'>
      {text}
    </p>
  );
}
