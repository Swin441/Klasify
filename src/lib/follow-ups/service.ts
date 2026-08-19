import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertPendingTransition,
  asiaKolkataDayBounds,
  isFollowUpType,
  type FollowUpStatus,
  type FollowUpType,
  validateScheduledAt,
  validateText,
} from './validation'

export interface FollowUpInput {
  contact_id: string
  deal_id?: string | null
  assigned_to?: string | null
  type: FollowUpType
  title?: string
  notes?: string | null
  scheduled_at: string
}

export interface FollowUpFilters {
  view?: 'today' | 'overdue' | 'upcoming' | 'my' | 'all'
  type?: FollowUpType
  assigned_to?: string
  deal_id?: string
  contact_id?: string
}

export class FollowUpValidationError extends Error {
  readonly status = 400
}

export class FollowUpNotFoundError extends Error {
  readonly status = 404
}

const FOLLOW_UP_SELECT = `
  id, account_id, contact_id, deal_id, assigned_to, type, title, notes,
  scheduled_at, status, completed_at, completed_by, outcome, created_by,
  created_at, updated_at,
  contact:contacts(id, name, phone),
  deal:deals(id, title, pipeline_id, stage_id, stage:pipeline_stages(name))
`

function throwIfError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback)
}

function validateInput(input: FollowUpInput): void {
  if (!input.contact_id || typeof input.contact_id !== 'string') {
    throw new FollowUpValidationError('contact_id is required')
  }
  if (!isFollowUpType(input.type)) {
    throw new FollowUpValidationError('type is invalid')
  }
  const scheduleError = validateScheduledAt(input.scheduled_at)
  if (scheduleError) throw new FollowUpValidationError(scheduleError)
  const titleError = validateText(input.title ?? 'Follow-up', 'title', 160, true)
  if (titleError) throw new FollowUpValidationError(titleError)
  const notesError = validateText(input.notes, 'notes', 5000)
  if (notesError) throw new FollowUpValidationError(notesError)
}

async function assertReferences(
  db: SupabaseClient,
  accountId: string,
  input: FollowUpInput,
): Promise<void> {
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id')
    .eq('id', input.contact_id)
    .eq('account_id', accountId)
    .maybeSingle()
  throwIfError(contactError, 'Failed to validate contact')
  if (!contact) throw new FollowUpValidationError('Contact does not belong to this account')

  if (input.deal_id) {
    const { data: deal, error: dealError } = await db
      .from('deals')
      .select('id, contact_id')
      .eq('id', input.deal_id)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(dealError, 'Failed to validate deal')
    if (!deal) throw new FollowUpValidationError('Deal does not belong to this account')
    if (deal.contact_id && deal.contact_id !== input.contact_id) {
      throw new FollowUpValidationError('Deal and contact do not match')
    }
  }

  if (input.assigned_to) {
    const { data: assignee, error: assigneeError } = await db
      .from('profiles')
      .select('user_id, account_role')
      .eq('user_id', input.assigned_to)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(assigneeError, 'Failed to validate assignee')
    if (!assignee || !['owner', 'admin', 'agent'].includes(assignee.account_role)) {
      throw new FollowUpValidationError('Assignee must be an operational member of this account')
    }
  }
}

export async function createFollowUp(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: FollowUpInput,
) {
  validateInput(input)
  await assertReferences(db, accountId, input)

  const { data, error } = await db
    .from('follow_ups')
    .insert({
      account_id: accountId,
      contact_id: input.contact_id,
      deal_id: input.deal_id || null,
      assigned_to: input.assigned_to || null,
      type: input.type,
      title: (input.title || 'Follow-up').trim(),
      notes: input.notes?.trim() || null,
      scheduled_at: new Date(input.scheduled_at).toISOString(),
      created_by: userId,
    })
    .select(FOLLOW_UP_SELECT)
    .single()
  throwIfError(error, 'Failed to create follow-up')
  return data
}

export async function listFollowUps(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  filters: FollowUpFilters = {},
) {
  let query = db
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('account_id', accountId)
    .order('scheduled_at', { ascending: true })

  if (filters.view === 'today') {
    const { start, end } = asiaKolkataDayBounds()
    query = query.gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString())
  } else if (filters.view === 'overdue') {
    query = query.eq('status', 'pending').lt('scheduled_at', new Date().toISOString())
  } else if (filters.view === 'upcoming') {
    query = query.eq('status', 'pending').gte('scheduled_at', new Date().toISOString())
  } else if (filters.view === 'my') {
    query = query.eq('assigned_to', userId)
  }

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to)
  if (filters.deal_id) query = query.eq('deal_id', filters.deal_id)
  if (filters.contact_id) query = query.eq('contact_id', filters.contact_id)

  const { data, error } = await query
  throwIfError(error, 'Failed to list follow-ups')
  return data ?? []
}

export async function getFollowUp(db: SupabaseClient, accountId: string, id: string) {
  const { data, error } = await db
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  throwIfError(error, 'Failed to load follow-up')
  if (!data) throw new FollowUpNotFoundError('Follow-up not found')
  return data
}

export async function updateFollowUp(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<FollowUpInput>,
) {
  const current = await getFollowUp(db, accountId, id)
  if (current.status !== 'pending') {
    throw new FollowUpValidationError('Only pending follow-ups can be edited')
  }
  const merged = {
    contact_id: input.contact_id ?? current.contact_id,
    deal_id: input.deal_id === undefined ? current.deal_id : input.deal_id,
    assigned_to: input.assigned_to === undefined ? current.assigned_to : input.assigned_to,
    type: input.type ?? current.type,
    title: input.title ?? current.title,
    notes: input.notes === undefined ? current.notes : input.notes,
    scheduled_at: input.scheduled_at ?? current.scheduled_at,
  } satisfies FollowUpInput
  validateInput(merged)
  await assertReferences(db, accountId, merged)

  const { data, error } = await db
    .from('follow_ups')
    .update({
      contact_id: merged.contact_id,
      deal_id: merged.deal_id || null,
      assigned_to: merged.assigned_to || null,
      type: merged.type,
      title: merged.title?.trim(),
      notes: merged.notes?.trim() || null,
      scheduled_at: new Date(merged.scheduled_at).toISOString(),
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
  throwIfError(error, 'Failed to update follow-up')
  return data
}

async function transition(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  id: string,
  action: 'complete' | 'cancel',
  outcome?: string | null,
) {
  const current = await getFollowUp(db, accountId, id)
  const transitionError = assertPendingTransition(current.status as FollowUpStatus, action)
  if (transitionError) throw new FollowUpValidationError(transitionError)
  const outcomeError = validateText(outcome, 'outcome', 2000)
  if (outcomeError) throw new FollowUpValidationError(outcomeError)

  const update = action === 'complete'
    ? { status: 'completed', completed_at: new Date().toISOString(), completed_by: userId, outcome: outcome?.trim() || null }
    : { status: 'cancelled' }
  const { data, error } = await db
    .from('follow_ups')
    .update(update)
    .eq('account_id', accountId)
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
  throwIfError(error, `Failed to ${action} follow-up`)
  return data
}

export function completeFollowUp(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  id: string,
  outcome?: string | null,
) {
  return transition(db, accountId, userId, id, 'complete', outcome)
}

export function cancelFollowUp(db: SupabaseClient, accountId: string, userId: string, id: string) {
  return transition(db, accountId, userId, id, 'cancel')
}

export async function rescheduleFollowUp(
  db: SupabaseClient,
  accountId: string,
  id: string,
  scheduledAt: string,
) {
  const current = await getFollowUp(db, accountId, id)
  const transitionError = assertPendingTransition(current.status as FollowUpStatus, 'reschedule')
  if (transitionError) throw new FollowUpValidationError(transitionError)
  const scheduleError = validateScheduledAt(scheduledAt)
  if (scheduleError) throw new FollowUpValidationError(scheduleError)

  const { data, error } = await db
    .from('follow_ups')
    .update({ scheduled_at: new Date(scheduledAt).toISOString() })
    .eq('account_id', accountId)
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
  throwIfError(error, 'Failed to reschedule follow-up')
  return data
}
