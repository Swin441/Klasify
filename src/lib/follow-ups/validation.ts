export const FOLLOW_UP_TYPES = [
  'call',
  'whatsapp',
  'counselling',
  'fee_follow_up',
  'admission_follow_up',
  'other',
] as const

export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number]

export const FOLLOW_UP_STATUSES = ['pending', 'completed', 'cancelled'] as const
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  counselling: 'Counselling',
  fee_follow_up: 'Fee Follow-up',
  admission_follow_up: 'Admission Follow-up',
  other: 'Other',
}

export const FOLLOW_UP_OUTCOMES = [
  'Student interested',
  'Asked for fee details',
  'Wants to visit institute',
  'Wants to discuss with parents',
  'Payment expected',
  'Not interested',
  'No response',
  'Other',
] as const

export function isFollowUpType(value: unknown): value is FollowUpType {
  return typeof value === 'string' && (FOLLOW_UP_TYPES as readonly string[]).includes(value)
}

export function isFollowUpStatus(value: unknown): value is FollowUpStatus {
  return typeof value === 'string' && (FOLLOW_UP_STATUSES as readonly string[]).includes(value)
}

export function isOverdueFollowUp(
  followUp: { status: FollowUpStatus; scheduled_at: string },
  now: Date = new Date(),
): boolean {
  return followUp.status === 'pending' && new Date(followUp.scheduled_at).getTime() < now.getTime()
}

export function asiaKolkataDayBounds(now: Date = new Date()): {
  start: Date
  end: Date
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00+05:30`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

export function validateScheduledAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'scheduled_at is required'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'scheduled_at must be a valid date'
  return null
}

export function validateText(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | null {
  if (value == null || value === '') return required ? `${field} is required` : null
  if (typeof value !== 'string') return `${field} must be text`
  if (value.length > maxLength) return `${field} must be ${maxLength} characters or fewer`
  return null
}

export function assertPendingTransition(
  current: FollowUpStatus,
  action: 'complete' | 'reschedule' | 'cancel',
): string | null {
  if (current !== 'pending') {
    return `A ${current} follow-up cannot be ${action}d`
  }
  return null
}
