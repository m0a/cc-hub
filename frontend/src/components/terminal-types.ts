// Shared terminal interfaces. Both the xterm.js and wterm implementations
// satisfy these so the rest of the app doesn't need to know which engine is
// in use.

export interface ControlModeConfig {
  paneId: string;
  sendInput: (data: string) => void;
  registerOnData: (callback: (data: Uint8Array) => void) => () => void;
  isConnected: boolean;
  onResize?: (cols: number, rows: number) => void;
  onScroll?: (lines: number) => void;
  requestContent?: () => void;
}

export interface TerminalRef {
  sendInput: (char: string) => void;
  focus: () => void;
  extractUrls: () => string[];
  getSelection: () => string;
  clearSelection: () => void;
  refreshTerminal: () => void;
  showKeyboard: () => void;
  hideKeyboard: () => void;
  getCellDimensions: () => { width: number; height: number } | null;
  getSize: () => { cols: number; rows: number } | null;
  getProposedSize: () => { cols: number; rows: number } | null;
  setExactSize: (cols: number, rows: number) => void;
  scrollToBottom: () => void;
  setInputText: (text: string) => void;
  changeFontSize: (delta: number) => number;
  getFontSize: () => number;
}
