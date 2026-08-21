// ============================================================
// Deal service — server-side create/update for deals, including
// the coaching qualification fields from migration 042.
//
// Mirrors the architecture of `src/lib/follow-ups/service.ts` and
// `src/lib/coaching/service.ts`:
//
//   - every operation takes an accountId derived from the
//     authenticated server context (never client-supplied),
//   - every referenced entity (contact, pipeline, stage, assignee,
//     exam, course, batch) is validated to belong to the current
//     account before the write,
//   - dependent references are checked for consistency (a course
//     must belong to the selected exam, a batch to the selected
//     course) so the client gets a friendly 400 instead of a raw
//     composite-FK database error,
//   - typed error classes map cleanly onto HTTP statuses.
//
// The database composite FKs (migration 042) remain the final
// security/integrity boundary — this layer never weakens them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isValidUuid,
  normalizeDealQualification,
  validateDealQualification,
  type DealQualificationInput,
  type NormalizedDealQualification,
} from './validation'

// ------------------------------------------------------------
// Errors — same convention as follow-ups/coaching services.
// ------------------------------------------------------------

export class DealValidationError extends Error {
  readonly status = 400
}

export class DealNotFoundError extends Error {
  readonly status = 404
}

// ------------------------------------------------------------
// Input types
// ------------------------------------------------------------

export interface DealBaseInput {
  title?: unknown
  contact_id?: unknown
  pipeline_id?: unknown
  stage_id?: unknown
  value?: unknown
  currency?: unknown
  assigned_to?: unknown
  notes?: unknown
  expected_close_date?: unknown
}

export interface DealCreateInput extends DealBaseInput {
  title: unknown
  contact_id: unknown
  pipeline_id: unknown
  stage_id: unknown
}

export type DealUpdateInput = Partial<DealBaseInput> & DealQualificationInput

// ------------------------------------------------------------
// Select shape — includes the qualification fields plus the
// embedded exam/course/batch rows so the UI can display
// human-readable names instead of UUIDs.
// ------------------------------------------------------------

export const DEAL_SELECT = `
  id, user_id, account_id, pipeline_id, stage_id, contact_id,
  conversation_id, assigned_to, title, value, currency, notes,
  expected_close_date, status,
  exam_id, course_id, batch_id, lead_source, education,
  graduation_year, location, preparation_level, budget,
  preferred_mode, parent_involvement,
  created_at, updated_at,
  contact:contacts(id, name, phone),
  assignee:profiles!deals_assigned_to_fkey(id, full_name, email, avatar_url),
  exam:exams(id, name),
  course:courses(id, name),
  batch:batches(id, name)
`

function throwIfError(
  error: { message?: string } | null,
  fallback: string,
): void {
  if (error) throw new Error(error.message ?? fallback)
}

// ------------------------------------------------------------
// Base-field validation (title / contact / pipeline / stage / …)
// ------------------------------------------------------------

const TITLE_MAX = 200
const NOTES_MAX = 5000

function validateBase(input: DealBaseInput): void {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new DealValidationError('title is required')
  if (title.length > TITLE_MAX) {
    throw new DealValidationError(
      `title must be ${TITLE_MAX} characters or fewer`,
    )
  }

  for (const field of ['contact_id', 'pipeline_id', 'stage_id'] as const) {
    if (!isValidUuid(input[field])) {
      throw new DealValidationError(`${field} is required`)
    }
  }

  if (input.assigned_to != null && input.assigned_to !== '') {
    if (!isValidUuid(input.assigned_to)) {
      throw new DealValidationError('assigned_to must be a valid UUID')
    }
  }

  if (input.value != null && input.value !== '') {
    const value = Number(input.value)
    if (typeof input.value !== 'number' || Number.isNaN(value)) {
      throw new DealValidationError('value must be a number')
    }
    if (value < 0) throw new DealValidationError('value must be zero or greater')
  }

  if (
    input.currency != null &&
    input.currency !== '' &&
    typeof input.currency !== 'string'
  ) {
    throw new DealValidationError('currency must be text')
  }

  if (input.notes != null && input.notes !== '') {
    if (typeof input.notes !== 'string') {
      throw new DealValidationError('notes must be text')
    }
    if (input.notes.trim().length > NOTES_MAX) {
      throw new DealValidationError(
        `notes must be ${NOTES_MAX} characters or fewer`,
      )
    }
  }

  if (input.expected_close_date != null && input.expected_close_date !== '') {
    if (
      typeof input.expected_close_date !== 'string' ||
      Number.isNaN(new Date(input.expected_close_date).getTime())
    ) {
      throw new DealValidationError(
        'expected_close_date must be a valid date',
      )
    }
  }
}

// ------------------------------------------------------------
// Account-scoped reference validation
// ------------------------------------------------------------

interface DealReferences extends NormalizedDealQualification {
  contact_id: string
  pipeline_id: string
  stage_id: string
  assigned_to: string | null
}

async function assertReferences(
  db: SupabaseClient,
  accountId: string,
  refs: DealReferences,
): Promise<void> {
  // Contact belongs to the account.
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id')
    .eq('id', refs.contact_id)
    .eq('account_id', accountId)
    .maybeSingle()
  throwIfError(contactError, 'Failed to validate contact')
  if (!contact) {
    throw new DealValidationError('Contact does not belong to this account')
  }

  // Stage belongs to the pipeline, and the pipeline to the account.
  const { data: stage, error: stageError } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id')
    .eq('id', refs.stage_id)
    .eq('pipeline_id', refs.pipeline_id)
    .maybeSingle()
  throwIfError(stageError, 'Failed to validate stage')
  if (!stage) {
    throw new DealValidationError('Stage does not belong to this pipeline')
  }
  const { data: pipeline, error: pipelineError } = await db
    .from('pipelines')
    .select('id')
    .eq('id', refs.pipeline_id)
    .eq('account_id', accountId)
    .maybeSingle()
  throwIfError(pipelineError, 'Failed to validate pipeline')
  if (!pipeline) {
    throw new DealValidationError('Pipeline does not belong to this account')
  }

  // Assignee (optional) must be a member of the account.
  if (refs.assigned_to) {
    const { data: assignee, error: assigneeError } = await db
      .from('profiles')
      .select('user_id')
      .eq('user_id', refs.assigned_to)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(assigneeError, 'Failed to validate assignee')
    if (!assignee) {
      throw new DealValidationError('Assignee does not belong to this account')
    }
  }

  // Exam (optional) belongs to the account.
  if (refs.exam_id) {
    const { data: exam, error: examError } = await db
      .from('exams')
      .select('id')
      .eq('id', refs.exam_id)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(examError, 'Failed to validate exam')
    if (!exam) {
      throw new DealValidationError('Exam does not belong to this account')
    }
  }

  // Course (optional) belongs to the account and, when an exam is
  // selected, to that exam.
  if (refs.course_id) {
    const { data: course, error: courseError } = await db
      .from('courses')
      .select('id, exam_id')
      .eq('id', refs.course_id)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(courseError, 'Failed to validate course')
    if (!course) {
      throw new DealValidationError('Course does not belong to this account')
    }
    if (refs.exam_id && course.exam_id !== refs.exam_id) {
      throw new DealValidationError(
        'Course does not belong to the selected exam',
      )
    }
  }

  // Batch (optional) belongs to the account, requires a course, and
  // must belong to the selected course.
  if (refs.batch_id) {
    if (!refs.course_id) {
      throw new DealValidationError('A batch requires a course')
    }
    const { data: batch, error: batchError } = await db
      .from('batches')
      .select('id, course_id')
      .eq('id', refs.batch_id)
      .eq('account_id', accountId)
      .maybeSingle()
    throwIfError(batchError, 'Failed to validate batch')
    if (!batch) {
      throw new DealValidationError('Batch does not belong to this account')
    }
    if (batch.course_id !== refs.course_id) {
      throw new DealValidationError(
        'Batch does not belong to the selected course',
      )
    }
  }
}

// ------------------------------------------------------------
// Create / update
// ------------------------------------------------------------

export async function createDeal(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: DealCreateInput & DealQualificationInput,
) {
  validateBase(input)
  const qualificationError = validateDealQualification(input)
  if (qualificationError) throw new DealValidationError(qualificationError)

  const qualification = normalizeDealQualification(input)
  const value =
    input.value == null || input.value === '' ? 0 : Number(input.value)
  const currency =
    typeof input.currency === 'string' && input.currency.trim()
      ? input.currency.trim()
      : null
  const notes =
    typeof input.notes === 'string' && input.notes.trim()
      ? input.notes.trim()
      : null
  const closeDate =
    typeof input.expected_close_date === 'string' &&
    input.expected_close_date.trim()
      ? input.expected_close_date.trim()
      : null

  await assertReferences(db, accountId, {
    ...qualification,
    contact_id: String(input.contact_id),
    pipeline_id: String(input.pipeline_id),
    stage_id: String(input.stage_id),
    assigned_to:
      input.assigned_to == null || input.assigned_to === ''
        ? null
        : String(input.assigned_to),
  })

  const { data, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: userId,
      title: String(input.title).trim(),
      value,
      ...(currency ? { currency } : {}),
      contact_id: String(input.contact_id),
      pipeline_id: String(input.pipeline_id),
      stage_id: String(input.stage_id),
      assigned_to:
        input.assigned_to == null || input.assigned_to === ''
          ? null
          : String(input.assigned_to),
      notes,
      expected_close_date: closeDate,
      status: 'open',
      ...qualification,
    })
    .select(DEAL_SELECT)
    .single()
  throwIfError(error, 'Failed to create deal')
  return data
}

export async function updateDeal(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: DealUpdateInput,
) {
  const { data: current, error: currentError } = await db
    .from('deals')
    .select(
      'id, title, value, currency, contact_id, pipeline_id, stage_id, assigned_to, notes, expected_close_date, exam_id, course_id, batch_id, lead_source, education, graduation_year, location, preparation_level, budget, preferred_mode, parent_involvement',
    )
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  throwIfError(currentError, 'Failed to load deal')
  if (!current) throw new DealNotFoundError('Deal not found')

  // Merge the incoming payload over the current row so partial
  // updates keep unspecified fields intact.
  const merged = {
    title: input.title ?? current.title,
    contact_id: input.contact_id ?? current.contact_id,
    pipeline_id: input.pipeline_id ?? current.pipeline_id,
    stage_id: input.stage_id ?? current.stage_id,
    value: input.value === undefined ? current.value : input.value,
    currency: input.currency === undefined ? current.currency : input.currency,
    assigned_to:
      input.assigned_to === undefined ? current.assigned_to : input.assigned_to,
    notes: input.notes === undefined ? current.notes : input.notes,
    expected_close_date:
      input.expected_close_date === undefined
        ? current.expected_close_date
        : input.expected_close_date,
    exam_id: input.exam_id === undefined ? current.exam_id : input.exam_id,
    course_id:
      input.course_id === undefined ? current.course_id : input.course_id,
    batch_id: input.batch_id === undefined ? current.batch_id : input.batch_id,
    lead_source:
      input.lead_source === undefined ? current.lead_source : input.lead_source,
    education:
      input.education === undefined ? current.education : input.education,
    graduation_year:
      input.graduation_year === undefined
        ? current.graduation_year
        : input.graduation_year,
    location:
      input.location === undefined ? current.location : input.location,
    preparation_level:
      input.preparation_level === undefined
        ? current.preparation_level
        : input.preparation_level,
    budget: input.budget === undefined ? current.budget : input.budget,
    preferred_mode:
      input.preferred_mode === undefined
        ? current.preferred_mode
        : input.preferred_mode,
    parent_involvement:
      input.parent_involvement === undefined
        ? current.parent_involvement
        : input.parent_involvement,
  }

  validateBase(merged)
  const qualificationError = validateDealQualification(merged)
  if (qualificationError) throw new DealValidationError(qualificationError)

  const qualification = normalizeDealQualification(merged)
  await assertReferences(db, accountId, {
    ...qualification,
    contact_id: String(merged.contact_id),
    pipeline_id: String(merged.pipeline_id),
    stage_id: String(merged.stage_id),
    assigned_to:
      merged.assigned_to == null || merged.assigned_to === ''
        ? null
        : String(merged.assigned_to),
  })

  const value =
    merged.value == null || merged.value === '' ? 0 : Number(merged.value)
  const currency =
    typeof merged.currency === 'string' && merged.currency.trim()
      ? merged.currency.trim()
      : null
  const notes =
    typeof merged.notes === 'string' && merged.notes.trim()
      ? merged.notes.trim()
      : null
  const closeDate =
    typeof merged.expected_close_date === 'string' &&
    merged.expected_close_date.trim()
      ? merged.expected_close_date.trim()
      : null

  const { data, error } = await db
    .from('deals')
    .update({
      title: String(merged.title).trim(),
      value,
      currency,
      contact_id: String(merged.contact_id),
      pipeline_id: String(merged.pipeline_id),
      stage_id: String(merged.stage_id),
      assigned_to:
        merged.assigned_to == null || merged.assigned_to === ''
          ? null
          : String(merged.assigned_to),
      notes,
      expected_close_date: closeDate,
      ...qualification,
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .select(DEAL_SELECT)
    .single()
  throwIfError(error, 'Failed to update deal')
  return data
}