// ============================================================
// Coaching catalog service — server-side CRUD for exams, courses,
// and batches. Mirrors the architecture of
// `src/lib/follow-ups/service.ts`:
//
//   - every operation takes an accountId derived from the
//     authenticated server context (never client-supplied),
//   - every referenced entity is validated to belong to the
//     current account before the write,
//   - typed error classes map cleanly onto HTTP statuses.
//
// The database also enforces cross-account integrity with
// composite FKs (migration 041); this layer adds the friendly
// validation messages and the account-scoped reference checks.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  validateBatch,
  validateCourse,
  validateExam,
} from './validation'

// ------------------------------------------------------------
// Errors — same convention as follow-ups/service.ts.
// ------------------------------------------------------------

export class CoachingValidationError extends Error {
  readonly status = 400
}

export class CoachingNotFoundError extends Error {
  readonly status = 404
}

// ------------------------------------------------------------
// Input types
// ------------------------------------------------------------

export interface ExamInput {
  name: string
  category?: string | null
  is_active?: boolean
}

export interface CourseInput {
  name: string
  exam_id?: string | null
  description?: string | null
  duration_weeks?: number | null
  fee?: number
  mode?: 'offline' | 'online' | 'hybrid'
  status?: 'active' | 'inactive'
}

export interface BatchInput {
  name: string
  course_id: string
  start_date?: string | null
  end_date?: string | null
  class_timing?: string | null
  mode?: 'offline' | 'online' | 'hybrid'
  capacity?: number | null
  fee?: number | null
  status?: 'active' | 'inactive' | 'full'
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function throwIfError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message ?? fallback)
}

/**
 * True iff `examId` belongs to `accountId`. Returns the exam row so
 * callers can reuse it instead of fetching twice.
 */
async function getExamInAccount(
  db: SupabaseClient,
  accountId: string,
  examId: string,
) {
  const { data, error } = await db
    .from('exams')
    .select('*')
    .eq('id', examId)
    .eq('account_id', accountId)
    .maybeSingle()
  throwIfError(error, 'Failed to validate exam')
  if (!data) throw new CoachingValidationError('Exam does not belong to this account')
  return data
}

/**
 * True iff `courseId` belongs to `accountId`. Returns the course row
 * so callers can reuse it instead of fetching twice.
 */
async function getCourseInAccount(
  db: SupabaseClient,
  accountId: string,
  courseId: string,
) {
  const { data, error } = await db
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .eq('account_id', accountId)
    .maybeSingle()
  throwIfError(error, 'Failed to validate course')
  if (!data) throw new CoachingValidationError('Course does not belong to this account')
  return data
}

// ------------------------------------------------------------
// EXAMS
// ------------------------------------------------------------

export async function createExam(
  db: SupabaseClient,
  accountId: string,
  input: ExamInput,
) {
  const validationError = validateExam(input)
  if (validationError) throw new CoachingValidationError(validationError)

  const { data, error } = await db
    .from('exams')
    .insert({
      account_id: accountId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      is_active: input.is_active ?? true,
    })
    .select()
    .single()
  throwIfError(error, 'Failed to create exam')
  return data
}

export async function listExams(
  db: SupabaseClient,
  accountId: string,
  filters: { is_active?: boolean } = {},
) {
  let query = db.from('exams').select('*').eq('account_id', accountId)
  if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active)
  const { data, error } = await query.order('name')
  throwIfError(error, 'Failed to list exams')
  return data ?? []
}

export async function getExam(db: SupabaseClient, accountId: string, id: string) {
  const { data, error } = await db
    .from('exams')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  throwIfError(error, 'Failed to load exam')
  if (!data) throw new CoachingNotFoundError('Exam not found')
  return data
}

export async function updateExam(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<ExamInput>,
) {
  await getExam(db, accountId, id)
  if (input.name !== undefined) {
    const nameError = validateExam({ name: input.name })
    if (nameError) throw new CoachingValidationError(nameError)
  }
  if (input.category !== undefined) {
    const categoryError = validateExam({ name: 'valid-placeholder', category: input.category })
    if (categoryError) throw new CoachingValidationError(categoryError)
  }
  if (input.is_active !== undefined) {
    const activeError = validateExam({ name: 'valid-placeholder', is_active: input.is_active })
    if (activeError) throw new CoachingValidationError(activeError)
  }

  const { data, error } = await db
    .from('exams')
    .update({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .select()
    .single()
  throwIfError(error, 'Failed to update exam')
  return data
}

export async function deleteExam(db: SupabaseClient, accountId: string, id: string) {
  await getExam(db, accountId, id)
  const { error } = await db
    .from('exams')
    .delete()
    .eq('account_id', accountId)
    .eq('id', id)
  throwIfError(error, 'Failed to delete exam')
}

// ------------------------------------------------------------
// COURSES
// ------------------------------------------------------------

export async function createCourse(
  db: SupabaseClient,
  accountId: string,
  input: CourseInput,
) {
  const validationError = validateCourse(input)
  if (validationError) throw new CoachingValidationError(validationError)
  if (input.exam_id) await getExamInAccount(db, accountId, input.exam_id)

  const { data, error } = await db
    .from('courses')
    .insert({
      account_id: accountId,
      exam_id: input.exam_id || null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      duration_weeks: input.duration_weeks ?? null,
      fee: input.fee ?? 0,
      mode: input.mode ?? 'offline',
      status: input.status ?? 'active',
    })
    .select()
    .single()
  throwIfError(error, 'Failed to create course')
  return data
}

export async function listCourses(
  db: SupabaseClient,
  accountId: string,
  filters: { exam_id?: string; status?: 'active' | 'inactive' } = {},
) {
  let query = db
    .from('courses')
    .select('*, exam:exams(*)')
    .eq('account_id', accountId)
  if (filters.exam_id) query = query.eq('exam_id', filters.exam_id)
  if (filters.status) query = query.eq('status', filters.status)
  const { data, error } = await query.order('name')
  throwIfError(error, 'Failed to list courses')
  return data ?? []
}

export async function getCourse(db: SupabaseClient, accountId: string, id: string) {
  const { data, error } = await db
    .from('courses')
    .select('*, exam:exams(*)')
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  throwIfError(error, 'Failed to load course')
  if (!data) throw new CoachingNotFoundError('Course not found')
  return data
}

export async function updateCourse(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<CourseInput>,
) {
  const current = await getCourse(db, accountId, id)

  // Validate the merged payload (existing value where input omitted).
  const validationError = validateCourse({
    name: input.name ?? current.name,
    description: input.description === undefined ? current.description : input.description,
    duration_weeks: input.duration_weeks === undefined ? current.duration_weeks : input.duration_weeks,
    fee: input.fee === undefined ? current.fee : input.fee,
    mode: input.mode ?? current.mode,
    status: input.status ?? current.status,
  })
  if (validationError) throw new CoachingValidationError(validationError)

  const newExamId = input.exam_id === undefined ? current.exam_id : input.exam_id
  if (newExamId) await getExamInAccount(db, accountId, newExamId)

  const { data, error } = await db
    .from('courses')
    .update({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.exam_id !== undefined ? { exam_id: input.exam_id || null } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.duration_weeks !== undefined ? { duration_weeks: input.duration_weeks ?? null } : {}),
      ...(input.fee !== undefined ? { fee: input.fee } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .select('*, exam:exams(*)')
    .single()
  throwIfError(error, 'Failed to update course')
  return data
}

export async function deleteCourse(db: SupabaseClient, accountId: string, id: string) {
  await getCourse(db, accountId, id)
  const { error } = await db
    .from('courses')
    .delete()
    .eq('account_id', accountId)
    .eq('id', id)
  throwIfError(error, 'Failed to delete course')
}

// ------------------------------------------------------------
// BATCHES
// ------------------------------------------------------------

export async function createBatch(
  db: SupabaseClient,
  accountId: string,
  input: BatchInput,
) {
  const validationError = validateBatch(input)
  if (validationError) throw new CoachingValidationError(validationError)
  await getCourseInAccount(db, accountId, input.course_id)

  const { data, error } = await db
    .from('batches')
    .insert({
      account_id: accountId,
      course_id: input.course_id,
      name: input.name.trim(),
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      class_timing: input.class_timing?.trim() || null,
      mode: input.mode ?? 'offline',
      capacity: input.capacity ?? null,
      fee: input.fee ?? null,
      status: input.status ?? 'active',
    })
    .select()
    .single()
  throwIfError(error, 'Failed to create batch')
  return data
}

export async function listBatches(
  db: SupabaseClient,
  accountId: string,
  filters: { course_id?: string; status?: 'active' | 'inactive' | 'full' } = {},
) {
  let query = db
    .from('batches')
    .select('*, course:courses(*)')
    .eq('account_id', accountId)
  if (filters.course_id) query = query.eq('course_id', filters.course_id)
  if (filters.status) query = query.eq('status', filters.status)
  const { data, error } = await query.order('name')
  throwIfError(error, 'Failed to list batches')
  return data ?? []
}

export async function getBatch(db: SupabaseClient, accountId: string, id: string) {
  const { data, error } = await db
    .from('batches')
    .select('*, course:courses(*)')
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  throwIfError(error, 'Failed to load batch')
  if (!data) throw new CoachingNotFoundError('Batch not found')
  return data
}

export async function updateBatch(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<BatchInput>,
) {
  const current = await getBatch(db, accountId, id)

  // Validate the merged payload (existing value where input omitted).
  const validationError = validateBatch({
    course_id: input.course_id ?? current.course_id,
    name: input.name ?? current.name,
    start_date: input.start_date === undefined ? current.start_date : input.start_date,
    end_date: input.end_date === undefined ? current.end_date : input.end_date,
    class_timing: input.class_timing === undefined ? current.class_timing : input.class_timing,
    mode: input.mode ?? current.mode,
    capacity: input.capacity === undefined ? current.capacity : input.capacity,
    fee: input.fee === undefined ? current.fee : input.fee,
    status: input.status ?? current.status,
  })
  if (validationError) throw new CoachingValidationError(validationError)

  const newCourseId = input.course_id ?? current.course_id
  if (newCourseId) await getCourseInAccount(db, accountId, newCourseId)

  const { data, error } = await db
    .from('batches')
    .update({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.course_id !== undefined ? { course_id: input.course_id } : {}),
      ...(input.start_date !== undefined ? { start_date: input.start_date || null } : {}),
      ...(input.end_date !== undefined ? { end_date: input.end_date || null } : {}),
      ...(input.class_timing !== undefined ? { class_timing: input.class_timing?.trim() || null } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
      ...(input.fee !== undefined ? { fee: input.fee ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .select('*, course:courses(*)')
    .single()
  throwIfError(error, 'Failed to update batch')
  return data
}

export async function deleteBatch(db: SupabaseClient, accountId: string, id: string) {
  await getBatch(db, accountId, id)
  const { error } = await db
    .from('batches')
    .delete()
    .eq('account_id', accountId)
    .eq('id', id)
  throwIfError(error, 'Failed to delete batch')
}