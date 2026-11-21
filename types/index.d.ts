export type Window = { percentUsed: number; resetsAt?: string }
export type Usage = { fiveHour: Window | null; sevenDay: Window | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null; now: number }
  }
}
