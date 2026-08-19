import { describe, expect, it } from 'vitest'
import {
  assertPendingTransition,
  asiaKolkataDayBounds,
  isFollowUpType,
  isOverdueFollowUp,
  validateScheduledAt,
  validateText,
} from './validation'

describe('follow-up validation', () => {
  it('accepts the coaching follow-up types and rejects unknown values', () => {
    expect(isFollowUpType('call')).toBe(true)
    expect(isFollowUpType('admission_follow_up')).toBe(true)
    expect(isFollowUpType('email')).toBe(false)
  })

  it('derives overdue only for pending follow-ups', () => {
    const now = new Date('2026-08-18T10:00:00.000Z')
    expect(isOverdueFollowUp({ status: 'pending', scheduled_at: '2026-08-18T09:59:00.000Z' }, now)).toBe(true)
    expect(isOverdueFollowUp({ status: 'completed', scheduled_at: '2026-08-18T09:59:00.000Z' }, now)).toBe(false)
    expect(isOverdueFollowUp({ status: 'pending', scheduled_at: '2026-08-18T10:01:00.000Z' }, now)).toBe(false)
  })

  it('validates scheduling and bounded text', () => {
    expect(validateScheduledAt('2026-08-18T10:00:00.000Z')).toBeNull()
    expect(validateScheduledAt('not-a-date')).toBe('scheduled_at must be a valid date')
    expect(validateText('x'.repeat(5), 'notes', 4)).toBe('notes must be 4 characters or fewer')
  })

  it('allows only pending state transitions', () => {
    expect(assertPendingTransition('pending', 'complete')).toBeNull()
    expect(assertPendingTransition('completed', 'reschedule')).toContain('cannot')
    expect(assertPendingTransition('cancelled', 'complete')).toContain('cannot')
  })

  it('uses Asia/Kolkata for today boundaries', () => {
    const { start, end } = asiaKolkataDayBounds(new Date('2026-08-18T20:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-08-18T18:30:00.000Z')
    expect(end.toISOString()).toBe('2026-08-19T18:30:00.000Z')
  })
})
