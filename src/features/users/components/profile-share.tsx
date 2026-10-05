'use client';

/* Share a profile (docs/design/tixy-rebrand/PROFILES.md): the player card,
   a link, the image itself, and for your own card an embed for another
   site. Modelled on Hatchdle's share row: copy the image as a promise so
   Safari accepts it, and download instead when the clipboard says no. */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';

import './profile-share.css';

type Props = {
  name: string;
  /** "/u/name" */
  profilePath: string;
  /** "/u/name/card.png?v=hash" */
  cardPath: string;
  /** "/u/name/embed" */
  embedPath: string;
  isPublic: boolean;
  self: boolean;
};

export function ProfileShare({ name, profilePath, cardPath, embedPath, isPublic, self }: Props) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  const pageUrl = `${origin}${profilePath}`;
  const imageUrl = `${origin}${cardPath}`;
  const bigImage = `${cardPath}${cardPath.includes('?') ? '&' : '?'}size=2x`;
  const fileName = `tixy-${name}.png`;
  const alt = `${name}'s player card on tixy.lol`;
  const snippets = [
    {
      id: 'html',
      label: 'html',
      text: `<iframe src="${origin}${embedPath}" width="600" height="315" style="border:0;max-width:100%" title="${alt}" loading="lazy"></iframe>`,
    },
    { id: 'markdown', label: 'markdown', text: `[![${alt}](${imageUrl})](${pageUrl})` },
  ];

  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done);
    } catch {
      setStatus('This browser would not copy. Select the text and copy it.');
    }
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = bigImage;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyImage = async () => {
    try {
      const blob = fetch(bigImage).then((response) => {
        if (!response.ok) throw new Error('card');
        return response.blob();
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Card copied.');
    } catch {
      download();
      setStatus('Downloaded instead.');
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: `${name} on tixy.lol`, url: pageUrl });
    } catch {
      /* closed the sheet */
    }
  };

  return (
    <>
      <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' onClick={() => setOpen(true)}>
        <span>share</span>
      </button>
      <ArcadeDialog open={open} onClose={() => setOpen(false)} title={self ? 'Your card' : `${name}'s card`} tone='cream' maxWidth={560}>
        <div className='ps'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className='ps-card' src={cardPath} width={1200} height={630} alt={alt} />
          {self && !isPublic ? (
            <p className='ps-note'>
              Only you can see this card while your profile is not public. Change that in{' '}
              <Link href='/settings?tab=preferences'>preferences</Link>.
            </p>
          ) : null}
          <div className='ps-actions'>
            <button type='button' className='tp-btn' data-size='sm' onClick={() => void copyText(pageUrl, 'Link copied.')}>
              <span>copy link</span>
            </button>
            <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' onClick={() => void copyImage()}>
              <span>copy image</span>
            </button>
            <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' onClick={download}>
              <span>download</span>
            </button>
            {canShare ? (
              <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' onClick={() => void nativeShare()}>
                <span>more</span>
              </button>
            ) : null}
          </div>
          {self && isPublic ? (
            <div className='ps-embed'>
              <h3>embed</h3>
              <p>Paste it into a site or a README. It updates when your profile does.</p>
              {snippets.map((snippet) => (
                <div key={snippet.id} className='ps-snippet'>
                  <label htmlFor={`ps-${snippet.id}`}>{snippet.label}</label>
                  <textarea id={`ps-${snippet.id}`} readOnly rows={2} value={snippet.text} onFocus={(event) => event.currentTarget.select()} />
                  <button
                    type='button'
                    className='tp-btn'
                    data-tone='quiet'
                    data-size='sm'
                    onClick={() => void copyText(snippet.text, `${snippet.label === 'html' ? 'HTML' : 'Markdown'} copied.`)}
                  >
                    <span>copy</span>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <p className='ps-status' role='status' aria-live='polite'>
            {status}
          </p>
        </div>
      </ArcadeDialog>
    </>
  );
}
