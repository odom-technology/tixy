import type { FrameId } from '@/features/brand/avatars/frames';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';

/* An avatar with its art kit frame drawn over the edge. The frame is a ring
   in the avatar's own 96 unit square, so it sits on any avatar at any size.
   Without a frame this is the plain avatar. */
export function FramedAvatar({
  name,
  imageUrl,
  frame,
  size = 'md',
  href,
}: {
  name?: string | null;
  imageUrl?: string | null;
  frame?: FrameId | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  href?: string;
}) {
  const avatar = <ProfileAvatar name={name} imageUrl={imageUrl} size={size} href={href} />;
  if (!frame) return avatar;
  return (
    <span className='relative inline-flex shrink-0 rounded-full leading-none'>
      {avatar}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/art/frames/frame-${frame}.svg`}
        alt=''
        aria-hidden
        className='pointer-events-none absolute inset-0 h-full w-full'
      />
    </span>
  );
}
