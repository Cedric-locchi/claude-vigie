import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ITheme, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Theme, ThemeService } from '../../core/theme.service';
import { VigieService } from '../../core/vigie.service';

const THEMES: Record<Theme, ITheme> = {
  dark: {
    // Mêmes valeurs que les variables de styles.css (xterm veut des couleurs fixes) ; ANSI calées sur la même clarté que les accents.
    background: '#070a0f', foreground: '#cdd1d8', cursor: '#e8ebef', selectionBackground: '#273e5c',
    black: '#232932', red: '#fc7a79', green: '#78c89e', yellow: '#ffbb49', blue: '#79b1f9', magenta: '#bb99e3', cyan: '#65d0dc', white: '#e8ebef',
    brightBlack: '#9299a2', brightRed: '#ffa4a1', brightGreen: '#95e6bb', brightYellow: '#ffd57e', brightBlue: '#a3ceff', brightMagenta: '#d8bcfa', brightCyan: '#96e7f1', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#333840', cursor: '#161b22', selectionBackground: '#c2daf9',
    black: '#161b22', red: '#ba2b2e', green: '#0b7643', yellow: '#9c5400', blue: '#145ec1', magenta: '#7945ab', cyan: '#00737e', white: '#7b8187',
    brightBlack: '#4f565e', brightRed: '#d74745', brightGreen: '#249057', brightYellow: '#bb731b', brightBlue: '#3778d7', brightMagenta: '#8f5fc0', brightCyan: '#1597aa', brightWhite: '#cdd1d8',
  },
};

export type TerminalStatus = 'connecting' | 'open' | 'closed';

/** Relie un xterm.js au PTY du daemon : le daemon possède le process, l'UI ne fait que s'y rattacher. */
@Injectable()
export class TerminalVm {
  private readonly vigie = inject(VigieService);
  private socket: WebSocket | null = null;
  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private observer: ResizeObserver | null = null;
  private pty: ReturnType<TerminalVm['connect']> | null = null;
  private repaintTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly theme = inject(ThemeService).theme;
  readonly status = signal<TerminalStatus>('connecting');
  private disposed = false;
  private onOpen: (() => void) | null = null;
  private reconnect: (() => void) | null = null;

  constructor() {
    // Sortie de veille : on se rattache au PTY sans attendre que l'ancienne connexion se déclare morte.
    effect(() => {
      if (this.vigie.wakes()) untracked(() => this.reconnect?.());
    });
    // Le terminal suit le sélecteur de thème sans être recréé.
    effect(() => {
      const theme = THEMES[this.theme()];
      if (this.term) this.term.options.theme = theme;
    });
  }

  /** Connexion seule (testable sans DOM) : renvoie de quoi écrire et redimensionner. */
  connect(terminalId: string, onData: (data: string) => void) {
    let retryMs = 1000;
    const open = (replay: boolean) => {
      const ws = this.vigie.terminalSocket(terminalId);
      this.socket = ws;
      // Le daemon rejoue tout le buffer à la connexion : après une reconnexion, on repart d'un écran vierge.
      let first = replay;
      ws.onopen = () => { retryMs = 1000; this.status.set('open'); this.onOpen?.(); };
      ws.onmessage = (e) => {
        if (first) { first = false; this.term?.reset(); }
        onData(String(e.data));
      };
      ws.onclose = () => {
        if (this.socket !== ws || this.disposed) return;
        this.status.set('closed');
        setTimeout(() => { if (!this.disposed && this.socket === ws) open(true); }, retryMs);
        retryMs = Math.min(retryMs * 2, 10_000); // ponytail: terminal supprimé côté daemon = essais toutes les 10 s jusqu'à la fermeture de l'onglet
      };
    };
    this.reconnect = () => {
      const old = this.socket;
      open(true);
      old?.close();
    };
    open(false);
    const send = (msg: object) => this.socket?.readyState === WebSocket.OPEN && this.socket.send(JSON.stringify(msg));
    return {
      input: (data: string) => send({ type: 'input', data }),
      resize: (cols: number, rows: number) => send({ type: 'resize', cols, rows }),
    };
  }

  /**
   * xterm mesure la largeur d'un caractère à l'ouverture : avec la police de secours, les colonnes se décalent
   * une fois JetBrains Mono arrivée. On attend donc la police (embarquée, quelques ms) avant d'ouvrir.
   */
  attach(host: HTMLElement, terminalId: string): void {
    const ready = document.fonts?.load(`13.5px 'JetBrains Mono'`) ?? Promise.resolve();
    void ready.catch(() => undefined).then(() => {
      if (this.disposed) return;
      this.open(host, terminalId);
      if (this.wantsFocus) this.term?.focus();
    });
  }

  /** focus() demandé avant l'ouverture (police en chargement) : appliqué dès que le terminal existe. */
  private wantsFocus = false;

  private open(host: HTMLElement, terminalId: string): void {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Menlo, monospace", fontSize: 13.5, lineHeight: 1.3,
      theme: THEMES[this.theme()], cursorBlink: true, scrollback: 10_000, macOptionIsMeta: true, allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    this.term = term;
    this.fitAddon = fit;

    const pty = this.connect(terminalId, (d) => term.write(d));
    this.pty = pty;
    term.onData(pty.input);
    term.onResize(({ cols, rows }) => pty.resize(cols, rows));
    // Le rejeu du buffer brut ne reconstitue pas fidèlement un écran plein (Claude Code, vim…) : on fait tout redessiner.
    this.onOpen = () => { this.fit(); this.repaint(); };

    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(host);
  }

  fit(): void {
    // Un terminal masqué (onglet inactif) a une taille nulle : on attend qu'il soit visible.
    const el = this.term?.element;
    if (el && el.offsetParent !== null) this.fitAddon?.fit();
  }

  /**
   * Redessine l'écran : xterm repeint ses lignes, et l'app du PTY reçoit un SIGWINCH (le noyau ne l'envoie que si
   * la taille change, d'où une ligne de moins puis la vraie taille) pour réémettre son écran complet.
   */
  repaint(): void {
    const term = this.term;
    if (!term || !this.pty) return;
    term.refresh(0, term.rows - 1);
    this.pty.resize(term.cols, Math.max(1, term.rows - 1));
    clearTimeout(this.repaintTimer);
    // Espacé pour que l'app voie deux tailles distinctes (deux SIGWINCH rapprochés fusionnent).
    this.repaintTimer = setTimeout(() => this.term && this.pty?.resize(this.term.cols, this.term.rows), 50);
  }

  focus(): void {
    if (this.term) this.term.focus();
    else this.wantsFocus = true;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.repaintTimer);
    this.observer?.disconnect();
    this.socket?.close();
    this.term?.dispose();
  }
}
