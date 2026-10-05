'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Menu, Search, X } from 'lucide-react';

import { ADMIN_DOCS_ITEM, ADMIN_NAV, ADMIN_NAV_ITEMS, activeNavItem } from './nav';
import { CommandPalette } from './palette';
import { ShortcutsDialog } from './shortcuts';
import { ToastProvider } from './toast';

const ICON = { size: 15, strokeWidth: 2, strokeLinecap: 'square' as const, 'aria-hidden': true };

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function AdminShell({ adminName, children }: { adminName: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [railOpen, setRailOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingG = useRef<number | null>(null);
  const active = activeNavItem(pathname);

  useEffect(() => {
    setRailOpen(false);
  }, [pathname]);

  const openPalette = useCallback(() => {
    setHelpOpen(false);
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('dialog[open]')) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const item = ADMIN_NAV_ITEMS.find((entry) => entry.key === event.key.toLowerCase());
        if (item) {
          event.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (event.key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 900);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPalette, router]);

  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [railOpen]);

  return (
    <div className='adm'>
      <ToastProvider>
        <a href='#adm-main' className='adm-visually-hidden'>Skip to content</a>
        <div className='adm-shell'>
          <aside className='adm-rail' data-open={railOpen} aria-label='Admin navigation'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Link href='/admin' className='adm-brand'>
                tixy <span className='adm-brand-sub'>admin</span>
              </Link>
              {railOpen ? (
                <button type='button' className='adm-btn' data-tone='ghost' data-icon style={{ marginLeft: 'auto' }} onClick={() => setRailOpen(false)} aria-label='Close navigation'>
                  <X {...ICON} />
                </button>
              ) : null}
            </div>
            <button type='button' className='adm-search-button' onClick={openPalette} aria-keyshortcuts='Control+K Meta+K'>
              <Search {...ICON} />
              <span>search or jump</span>
              <kbd className='adm-kbd'>⌘K</kbd>
            </button>
            <nav className='adm-nav' aria-label='Admin sections'>
              {ADMIN_NAV.map((group) => (
                <div key={group.label} className='adm-nav-group'>
                  <span className='adm-nav-group-label'>{group.label}</span>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className='adm-nav-link'
                        aria-current={active?.href === item.href ? 'page' : undefined}
                        title={item.key ? `g then ${item.key}` : undefined}
                      >
                        <Icon {...ICON} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className='adm-rail-foot'>
              <a className='adm-nav-link' href={ADMIN_DOCS_ITEM.href} target='_blank' rel='noreferrer'>
                <ADMIN_DOCS_ITEM.icon {...ICON} />
                <span>{ADMIN_DOCS_ITEM.label}</span>
              </a>
              <Link className='adm-nav-link' href='/'>
                <ArrowUpRight {...ICON} />
                <span>back to tixy</span>
              </Link>
              <button type='button' className='adm-nav-link' style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => setHelpOpen(true)}>
                <span className='adm-kbd' aria-hidden='true'>?</span>
                <span>shortcuts</span>
              </button>
              <span className='adm-nav-group-label' style={{ paddingTop: 8 }}>Signed in as {adminName}</span>
            </div>
          </aside>

          <div className='adm-main'>
            <div className='adm-mobilebar'>
              <button type='button' className='adm-btn' data-tone='ghost' data-icon onClick={() => setRailOpen(true)} aria-label='Open navigation' aria-expanded={railOpen}>
                <Menu {...ICON} />
              </button>
              <Link href='/admin' className='adm-brand'>
                tixy <span className='adm-brand-sub'>admin</span>
              </Link>
              <button type='button' className='adm-btn' data-tone='ghost' data-icon style={{ marginLeft: 'auto' }} onClick={openPalette} aria-label='Search or jump'>
                <Search {...ICON} />
              </button>
            </div>
            <main id='adm-main' tabIndex={-1} style={{ outline: 'none', minWidth: 0 }}>
              {children}
            </main>
          </div>
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </ToastProvider>
    </div>
  );
}
