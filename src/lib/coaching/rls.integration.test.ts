import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled =
  process.env.RUN_COACHING_RLS === 'true' && Boolean(url && anonKey && serviceRoleKey)
const admin = enabled
  ? createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

interface Principal {
  id: string
  accountId: string
  client: SupabaseClient
}

const suite = enabled ? describe : describe.skip

suite('live coaching catalog RLS isolation', () => {
  let principalA: Principal
  let principalB: Principal

  // Fixtures owned by Account B — used to verify cross-account
  // isolation for SELECT / UPDATE / DELETE and the composite-FK
  // cross-account reference guards.
  let bExamId: string
  let bCourseId: string
  let bBatchId: string

  // Fixtures owned by Account A — used to verify Account A's own CRUD.
  let aExamId: string
  let aCourseId: string
  let aBatchId: string

  async function createPrincipal(label: string): Promise<Principal> {
    const email = `coaching-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`
    const password = `Coaching-${Date.now()}-${Math.random().toString(36).slice(2)}!`
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw error ?? new Error('Could not create test user')
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data: profile, error: profileError } = await admin!
        .from('profiles')
        .select('account_id')
        .eq('user_id', data.user.id)
        .maybeSingle()
      if (profileError) throw profileError
      if (profile?.account_id) {
        const client = createClient(url!, anonKey!, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        const { error: signInError } = await client.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
        return { id: data.user.id, accountId: profile.account_id, client }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Profile/account was not created for ${label}`)
  }

  beforeAll(async () => {
    if (!enabled) return
    principalA = await createPrincipal('a')
    principalB = await createPrincipal('b')

    // ---- Account B fixtures ---------------------------------
    const { data: examB, error: examBError } = await admin!
      .from('exams')
      .insert({ account_id: principalB.accountId, name: `RLS Exam B ${Date.now()}` })
      .select('id')
      .single()
    if (examBError || !examB) throw examBError ?? new Error('Exam B fixture failed')
    bExamId = examB.id

    const { data: courseB, error: courseBError } = await admin!
      .from('courses')
      .insert({
        account_id: principalB.accountId,
        exam_id: bExamId,
        name: `RLS Course B ${Date.now()}`,
        fee: 1000,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
      .single()
    if (courseBError || !courseB) throw courseBError ?? new Error('Course B fixture failed')
    bCourseId = courseB.id

    const { data: batchB, error: batchBError } = await admin!
      .from('batches')
      .insert({
        account_id: principalB.accountId,
        course_id: bCourseId,
        name: `RLS Batch B ${Date.now()}`,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
      .single()
    if (batchBError || !batchB) throw batchBError ?? new Error('Batch B fixture failed')
    bBatchId = batchB.id

    await new Promise((resolve) => setTimeout(resolve, 500))
  }, 30_000)

  afterAll(async () => {
    await principalA?.client.auth.signOut()
    await principalB?.client.auth.signOut()
    if (principalA?.id) await admin!.auth.admin.deleteUser(principalA.id)
    if (principalB?.id) await admin!.auth.admin.deleteUser(principalB.id)
  })

  // ================================================================
  // EXAMS
  // ================================================================

  it('allows Account A full CRUD on its own exams', async () => {
    const { data: created, error: insertError } = await principalA.client
      .from('exams')
      .insert({ account_id: principalA.accountId, name: `RLS Exam A ${Date.now()}` })
      .select('id, name')
      .single()
    expect(insertError).toBeNull()
    aExamId = created!.id

    const { data: selected, error: selectError } = await principalA.client
      .from('exams')
      .select('id')
      .eq('id', aExamId)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('exams')
      .update({ name: `RLS Exam A updated ${Date.now()}` })
      .eq('id', aExamId)
      .select('id')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.id).toBe(aExamId)

    const { data: deleted, error: deleteError } = await principalA.client
      .from('exams')
      .delete()
      .eq('id', aExamId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
    aExamId = ''
  })

  it('blocks Account A from reading, updating, or deleting Account B exams', async () => {
    const { data: selected, error: selectError } = await principalA.client
      .from('exams')
      .select('id')
      .eq('id', bExamId)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: updated, error: updateError } = await principalA.client
      .from('exams')
      .update({ name: 'must remain tenant B' })
      .eq('id', bExamId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('exams')
      .delete()
      .eq('id', bExamId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('blocks Account A from inserting an exam with Account B account_id', async () => {
    const { data, error } = await principalA.client
      .from('exams')
      .insert({ account_id: principalB.accountId, name: 'forbidden cross-account exam' })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  // ================================================================
  // COURSES
  // ================================================================

  it('allows Account A full CRUD on its own courses', async () => {
    const { data: exam, error: examError } = await principalA.client
      .from('exams')
      .insert({ account_id: principalA.accountId, name: `RLS Course exam A ${Date.now()}` })
      .select('id')
      .single()
    expect(examError).toBeNull()

    const { data: created, error: insertError } = await principalA.client
      .from('courses')
      .insert({
        account_id: principalA.accountId,
        exam_id: exam!.id,
        name: `RLS Course A ${Date.now()}`,
        fee: 1500,
        mode: 'online',
        status: 'active',
      })
      .select('id, name')
      .single()
    expect(insertError).toBeNull()
    aCourseId = created!.id

    const { data: selected, error: selectError } = await principalA.client
      .from('courses')
      .select('id')
      .eq('id', aCourseId)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('courses')
      .update({ name: `RLS Course A updated ${Date.now()}` })
      .eq('id', aCourseId)
      .select('id')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.id).toBe(aCourseId)

    const { data: deleted, error: deleteError } = await principalA.client
      .from('courses')
      .delete()
      .eq('id', aCourseId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
    aCourseId = ''
  })

  it('blocks Account A from reading, updating, or deleting Account B courses', async () => {
    const { data: selected, error: selectError } = await principalA.client
      .from('courses')
      .select('id')
      .eq('id', bCourseId)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: updated, error: updateError } = await principalA.client
      .from('courses')
      .update({ name: 'must remain tenant B' })
      .eq('id', bCourseId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('courses')
      .delete()
      .eq('id', bCourseId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('blocks Account A from inserting a course with Account B account_id', async () => {
    const { data, error } = await principalA.client
      .from('courses')
      .insert({
        account_id: principalB.accountId,
        name: 'forbidden cross-account course',
        fee: 100,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks a course referencing an exam from another account (composite FK)', async () => {
    // The composite FK (account_id, exam_id) → exams(account_id, id)
    // must reject this at the database level even though the RLS
    // policy passes (account_id belongs to Account A).
    const { data, error } = await principalA.client
      .from('courses')
      .insert({
        account_id: principalA.accountId,
        exam_id: bExamId,
        name: `cross-account exam reference ${Date.now()}`,
        fee: 100,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  // ================================================================
  // BATCHES
  // ================================================================

  it('allows Account A full CRUD on its own batches', async () => {
    const { data: course, error: courseError } = await principalA.client
      .from('courses')
      .insert({
        account_id: principalA.accountId,
        name: `RLS Batch course A ${Date.now()}`,
        fee: 1000,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
      .single()
    expect(courseError).toBeNull()

    const { data: created, error: insertError } = await principalA.client
      .from('batches')
      .insert({
        account_id: principalA.accountId,
        course_id: course!.id,
        name: `RLS Batch A ${Date.now()}`,
        mode: 'online',
        status: 'active',
        capacity: 30,
      })
      .select('id, name')
      .single()
    expect(insertError).toBeNull()
    aBatchId = created!.id

    const { data: selected, error: selectError } = await principalA.client
      .from('batches')
      .select('id')
      .eq('id', aBatchId)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('batches')
      .update({ name: `RLS Batch A updated ${Date.now()}` })
      .eq('id', aBatchId)
      .select('id')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.id).toBe(aBatchId)

    const { data: deleted, error: deleteError } = await principalA.client
      .from('batches')
      .delete()
      .eq('id', aBatchId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
    aBatchId = ''
  })

  it('blocks Account A from reading, updating, or deleting Account B batches', async () => {
    const { data: selected, error: selectError } = await principalA.client
      .from('batches')
      .select('id')
      .eq('id', bBatchId)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: updated, error: updateError } = await principalA.client
      .from('batches')
      .update({ name: 'must remain tenant B' })
      .eq('id', bBatchId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('batches')
      .delete()
      .eq('id', bBatchId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('blocks Account A from inserting a batch with Account B account_id', async () => {
    const { data, error } = await principalA.client
      .from('batches')
      .insert({
        account_id: principalB.accountId,
        course_id: bCourseId,
        name: 'forbidden cross-account batch',
        mode: 'offline',
        status: 'active',
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks a batch referencing a course from another account (composite FK)', async () => {
    // The composite FK (account_id, course_id) → courses(account_id, id)
    // must reject this at the database level even though the RLS
    // policy passes (account_id belongs to Account A).
    const { data, error } = await principalA.client
      .from('batches')
      .insert({
        account_id: principalA.accountId,
        course_id: bCourseId,
        name: `cross-account course reference ${Date.now()}`,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })
})

if (!enabled) {
  console.warn('Skipping coaching RLS integration tests: apply migration 041 and set RUN_COACHING_RLS=true.')
}