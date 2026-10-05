import type { RefObject } from 'react';
import type { TetrisCosmeticTheme } from '../_tetris-types';

type TetrisRightPanelProps = {
  themeState: TetrisCosmeticTheme;
  holdCanvasRef: RefObject<HTMLCanvasElement | null>;
  nextCanvasRef: RefObject<HTMLCanvasElement | null>;
};

export function TetrisRightPanel({
  themeState,
  holdCanvasRef,
  nextCanvasRef,
}: TetrisRightPanelProps) {
  return (
    <div className='hidden w-28 shrink-0 flex-col gap-3 sm:flex lg:w-32'>
      <div
        className='tet-panel'
        style={{
          background: themeState.panelBgColor,
          borderColor: themeState.panelBorderColor,
        }}
      >
        <span
          className='tet-eyebrow'
          style={{ color: themeState.panelAccentColor }}
        >
          Hold
        </span>
        <div className='tet-tray h-16'>
          <canvas ref={holdCanvasRef} width={80} height={60} />
        </div>
      </div>
      <div
        className='tet-panel'
        style={{
          background: themeState.panelBgColor,
          borderColor: themeState.panelBorderColor,
        }}
      >
        <span
          className='tet-eyebrow'
          style={{ color: themeState.panelAccentColor }}
        >
          Next
        </span>
        <div className='tet-tray p-1'>
          <canvas ref={nextCanvasRef} width={80} height={320} />
        </div>
      </div>
    </div>
  );
}
