'use client';

import { TournamentCreateModal as SharedTournamentCreateModal } from '@/features/arcade/components/tournaments/create-modal';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

/**
 * Pool passes straight through to the shared create modal — pool has no
 * extra fields beyond what the shared modal already renders.
 */
// fallow-ignore-next-line duplicate-export
export function TournamentCreateModal({ open, onClose, onCreated }: Props) {
  return (
    <SharedTournamentCreateModal
      open={open}
      onClose={onClose}
      onCreated={onCreated}
      gameType='8-ball'
    />
  );
}
