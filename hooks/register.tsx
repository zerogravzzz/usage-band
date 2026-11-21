import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Usage, Window } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

const DAYS = ['日', '月', '火', '水', '木', '金', '土']
const pad = (n: number) => String(n).padStart(2, '0')
const JST = 9 * 3600 * 1000

// Reset times shown in JST (UTC+9), independent of the runtime's timezone.
function hhmm(t: number): string {
  const d = new Date(t + JST)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function mdHhmm(t: number): string {
  const d = new Date(t + JST)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAYS[d.getUTCDay()]}) ${hhmm(t)}`
}

function remaining(ms: number): string {
  const min = Math.ceil(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d}日${h}時間`
  if (h > 0) return `${h}時間${m}分`
  return `${m}分`
}

function dot(p: number): string {
  return p >= 90 ? '🔴' : p >= 70 ? '🟡' : '🟢'
}

function bar(p: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function pick(limits: SessionRateLimit[], kind: string): Window | null {
  const w = limits.find(l => l.kind === kind)
  return w ? { percentUsed: w.percentUsed, resetsAt: w.resetsAt } : null
}

function toUsage(limits: SessionRateLimit[]): Usage {
  return { fiveHour: pick(limits, 'five_hour'), sevenDay: pick(limits, 'seven_day') }
}

function line(label: string, w: Window, t: number, long: boolean): string {
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  if (!Number.isNaN(reset) && reset <= t) {
    return `${label}  ✨ リセット済み（次の応答で更新）`
  }
  const pct = `${w.percentUsed}%`.padStart(4)
  const when = Number.isNaN(reset)
    ? ''
    : `  🔄 ${long ? mdHhmm(reset) : hhmm(reset)}（あと${remaining(reset - t)}）`
  return `${label}  ${dot(w.percentUsed)} ${bar(w.percentUsed)} ${pct}${when}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length > 0) await update($, usage, () => toUsage(rateLimits))
    // Refresh the countdown once a minute.
    $.clock.every(60_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, usage, () => toUsage(e.rateLimits))
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const u = await read($, usage)
    const t = await read($, now)
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    if (u === null || (u.fiveHour === null && u.sevenDay === null)) {
      return (
        <Box>
          <Text dimColor>⏳ 使用量は最初の応答のあとに表示されます</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {u.fiveHour ? <Text key="5h">{line('⏱️ 5時間', u.fiveHour, t, false)}</Text> : null}
        {u.sevenDay ? <Text key="7d">{line('📅 1週間', u.sevenDay, t, true)}</Text> : null}
      </Box>
    )
  })
}
