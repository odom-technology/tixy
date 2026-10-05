export interface EnvFingerprint {
  devtools: boolean;
  webdriver: boolean;
  timeRatio: number;
  screen: { w: number; h: number };
  wasHidden: boolean;
}

export class EnvMonitor {
  private dateStart = 0;
  private perfStart = 0;
  private wasHidden = false;
  private visibilityHandler: (() => void) | null = null;

  start() {
    this.dateStart = Date.now();
    this.perfStart = performance.now();
    this.wasHidden = document.hidden;

    this.visibilityHandler = () => {
      if (document.hidden) this.wasHidden = true;
    };
    document.addEventListener('visibilitychange', this.visibilityHandler, {
      passive: true,
    });
  }

  stop() {
    if (!this.visibilityHandler) return;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
  }

  getFingerprint(): EnvFingerprint {
    const dateElapsed = Date.now() - this.dateStart;
    const perfElapsed = performance.now() - this.perfStart;
    return {
      devtools: false,
      webdriver: Boolean(
        (navigator as Navigator & { webdriver?: boolean }).webdriver,
      ),
      timeRatio:
        dateElapsed > 0 ? Math.round((perfElapsed / dateElapsed) * 1000) / 1000 : 1,
      screen: {
        w: window.screen.width,
        h: window.screen.height,
      },
      wasHidden: this.wasHidden,
    };
  }
}
