'use client';

import { useEffect, useRef } from 'react';

import { ADMIN_NAV_ITEMS } from './nav';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} className='adm-dialog' aria-labelledby='adm-shortcuts-title' onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className='adm-dialog-head'>
        <h2 id='adm-shortcuts-title'>Keyboard</h2>
        <button type='button' className='adm-btn' data-tone='ghost' data-size='sm' onClick={onClose}>close</button>
      </div>
      <div className='adm-dialog-body'>
        <dl className='adm-shortcuts'>
          <dt><kbd className='adm-kbd'>⌘K</kbd><kbd className='adm-kbd'>/</kbd></dt><dd>Search pages, actions and players.</dd>
          <dt><kbd className='adm-kbd'>?</kbd></dt><dd>This list.</dd>
          <dt><kbd className='adm-kbd'>j</kbd><kbd className='adm-kbd'>k</kbd></dt><dd>Move down and up a table.</dd>
          <dt><kbd className='adm-kbd'>enter</kbd></dt><dd>Open the focused row.</dd>
          <dt><kbd className='adm-kbd'>esc</kbd></dt><dd>Close a sheet, dialog or the palette.</dd>
          {ADMIN_NAV_ITEMS.filter((item) => item.key).map((item) => (
            <div key={item.href} style={{ display: 'contents' }}>
              <dt><kbd className='adm-kbd'>g</kbd><kbd className='adm-kbd'>{item.key}</kbd></dt>
              <dd>Go to {item.label}.</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
