'use client';

import { useEffect, useRef, useState } from 'react';

/* A small form in a native dialog for one admin action. Every write the
   console makes asks for a reason here; the gate records it in the audit
   log with the result. */

export type ActionField = {
  name: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'choice';
  required?: boolean;
  min?: number;
  initial?: string;
  hint?: string;
  options?: { id: string; label: string }[];
  /** The value must equal this exactly (type-to-confirm). */
  mustEqual?: string;
};

export function ActionDialog({
  title,
  fields,
  confirm,
  tone,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: ActionField[];
  confirm: string;
  tone?: 'danger';
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.initial ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    // No close in the cleanup: React runs effects twice in development, and a
    // close there would fire onClose and drop the dialog. Unmounting removes it.
    if (element && !element.open) element.showModal();
  }, []);

  const missing = fields.some((field) => {
    const value = (values[field.name] ?? '').trim();
    if (field.required && !value) return true;
    if (field.mustEqual !== undefined && value !== field.mustEqual) return true;
    return false;
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])));
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className='adm-dialog' aria-labelledby='adm-action-title' onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className='adm-dialog-head'>
          <h2 id='adm-action-title'>{title}</h2>
        </div>
        <div className='adm-dialog-body'>
          {fields.map((field) => (
            <div key={field.name} className='adm-field'>
              <span id={`f-${field.name}`}>{field.label}</span>
              {field.type === 'choice' ? (
                <div className='adm-seg' role='radiogroup' aria-labelledby={`f-${field.name}`} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                  {field.options?.map((option) => (
                    <button
                      key={option.id}
                      type='button'
                      role='radio'
                      aria-checked={values[field.name] === option.id}
                      onClick={() => setValues((current) => ({ ...current, [field.name]: option.id }))}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : field.type === 'textarea' ? (
                <textarea
                  className='adm-textarea'
                  aria-labelledby={`f-${field.name}`}
                  maxLength={500}
                  required={field.required}
                  value={values[field.name]}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              ) : (
                <input
                  className='adm-input'
                  aria-labelledby={`f-${field.name}`}
                  type={field.type}
                  min={field.min}
                  step={field.type === 'number' ? 1 : undefined}
                  inputMode={field.type === 'number' ? 'numeric' : undefined}
                  required={field.required}
                  autoComplete='off'
                  value={values[field.name]}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
              {field.hint ? <span style={{ color: 'var(--adm-ink-3)', fontSize: 12 }}>{field.hint}</span> : null}
            </div>
          ))}
          {error ? <div className='adm-note' data-tone='alert' role='alert'>{error}</div> : null}
        </div>
        <div className='adm-dialog-foot'>
          <button type='button' className='adm-btn' data-tone='ghost' onClick={onClose}>cancel</button>
          <button type='submit' className='adm-btn' data-tone={tone === 'danger' ? 'danger' : 'primary'} disabled={missing || busy}>
            {busy ? 'working' : confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
