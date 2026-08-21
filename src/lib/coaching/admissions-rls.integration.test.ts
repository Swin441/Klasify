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

suite('live coaching admissions RLS isolation', () => {
  let principalA: Principal
  let principalB: Principal

  // Fixtures owned by Account B — used to verify cross-account
  // isolation for SELECT / UPDATE / DELETE and the composite-FK
  // cross-account reference guards.
  let bExamId: string
  let bCourseId: string
  let bBatchId: string
  let bContactId: string
  let bDealId: string
  let bAdmissionId: string

  // Fixtures owned by Account A — used to verify Account A's own CRUD.
  let aExamId: string
  let aCourseId: string
  let aBatchId: string
  let aContactId: string
  let aDealId: string
  let aAdmissionId: string

  async function createPrincipal(label: string): Promise<Principal> {
    const email = `admissions-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`
    const password = `Admissions-${Date.now()}-${Math.random().toString(36).slice(2)}!`
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

  async function createCatalogFixtures(accountId: string) {
    const { data: exam, error: examError } = await admin!
      .from('exams')
      .insert({ account_id: accountId, name: `Admissions RLS Exam ${Date.now()}` })
      .select('id')
      .single()
    if (examError || !exam) throw examError ?? new Error('Exam fixture failed')

    const { data: course, error: courseError } = await admin!
      .from('courses')
      .insert({
        account_id: accountId,
        exam_id: exam.id,
        name: `Admissions RLS Course ${Date.now()}`,
        fee: 1000,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
      .single()
    if (courseError || !course) throw courseError ?? new Error('Course fixture failed')

    const { data: batch, error: batchError } = await admin!
      .from('batches')
      .insert({
        account_id: accountId,
        course_id: course.id,
        name: `Admissions RLS Batch ${Date.now()}`,
        mode: 'offline',
        status: 'active',
      })
      .select('id')
      .single()
    if (batchError || !batch) throw batchError ?? new Error('Batch fixture failed')

    return { examId: exam.id, courseId: course.id, batchId: batch.id }
  }

  async function createContactAndDeal(accountId: string, userId: string) {
    const { data: contact, error: contactError } = await admin!
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: userId,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        name: `Admissions RLS Contact ${Date.now()}`,
      })
      .select('id')
      .single()
    if (contactError || !contact) throw contactError ?? new Error('Contact fixture failed')

    const { data: pipeline, error: pipelineError } = await admin!
      .from('pipelines')
      .insert({ account_id: accountId, user_id: userId, name: `Admissions RLS Pipeline ${Date.now()}` })
      .select('id')
      .single()
    if (pipelineError || !pipeline) throw pipelineError ?? new Error('Pipeline fixture failed')

    const { data: stage, error: stageError } = await admin!
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipeline.id,
        name: 'New Lead',
        position: 0,
        color: '#3b82f6',
      })
      .select('id')
      .single()
    if (stageError || !stage) throw stageError ?? new Error('Stage fixture failed')

    const { data: deal, error: dealError } = await admin!
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: userId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        contact_id: contact.id,
        title: `Admissions RLS Deal ${Date.now()}`,
        value: 1000,
        status: 'open',
      })
      .select('id')
      .single()
    if (dealError || !deal) throw dealError ?? new Error('Deal fixture failed')

    return { contactId: contact.id, dealId: deal.id }
  }

  beforeAll(async () => {
    if (!enabled) return
    principalA = await createPrincipal('a')
    principalB = await createPrincipal('b')

    // ---- Account B fixtures ---------------------------------
    const bCatalog = await createCatalogFixtures(principalB.accountId)
    bExamId = bCatalog.examId
    bCourseId = bCatalog.courseId
    bBatchId = bCatalog.batchId

    const bContactDeal = await createContactAndDeal(principalB.accountId, principalB.id)
    bContactId = bContactDeal.contactId
    bDealId = bContactDeal.dealId

    const { data: admissionB, error: admissionBError } = await admin!
      .from('admissions')
      .insert({
        account_id: principalB.accountId,
        deal_id: bDealId,
        contact_id: bContactId,
        course_id: bCourseId,
        batch_id: bBatchId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalB.id,
      })
      .select('id')
      .single()
    if (admissionBError || !admissionB) throw admissionBError ?? new Error('Admission B fixture failed')
    bAdmissionId = admissionB.id

    // ---- Account A fixtures ---------------------------------
    const aCatalog = await createCatalogFixtures(principalA.accountId)
    aExamId = aCatalog.examId
    aCourseId = aCatalog.courseId
    aBatchId = aCatalog.batchId

    const aContactDeal = await createContactAndDeal(principalA.accountId, principalA.id)
    aContactId = aContactDeal.contactId
    aDealId = aContactDeal.dealId

    await new Promise((resolve) => setTimeout(resolve, 500))
  }, 30_000)

  afterAll(async () => {
    await principalA?.client.auth.signOut()
    await principalB?.client.auth.signOut()
    if (principalA?.id) await admin!.auth.admin.deleteUser(principalA.id)
    if (principalB?.id) await admin!.auth.admin.deleteUser(principalB.id)
  })

  // ================================================================
  // DEALS — coaching qualification fields
  // ================================================================

  it('allows Account A to set coaching qualification fields on its own deal', async () => {
    const { data: updated, error: updateError } = await principalA.client
      .from('deals')
      .update({
        exam_id: aExamId,
        course_id: aCourseId,
        batch_id: aBatchId,
        lead_source: 'whatsapp',
        education: 'Graduate',
        graduation_year: 2024,
        location: 'Guwahati',
        preparation_level: 'beginner',
        budget: 5000,
        preferred_mode: 'offline',
        parent_involvement: true,
      })
      .eq('id', aDealId)
      .select('id, exam_id, course_id, batch_id, lead_source')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.exam_id).toBe(aExamId)
    expect(updated?.course_id).toBe(aCourseId)
    expect(updated?.batch_id).toBe(aBatchId)
    expect(updated?.lead_source).toBe('whatsapp')
  })

  it('blocks a deal referencing an exam from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('deals')
      .update({ exam_id: bExamId })
      .eq('id', aDealId)
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks a deal referencing a course from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('deals')
      .update({ course_id: bCourseId })
      .eq('id', aDealId)
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks a deal referencing a batch from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('deals')
      .update({ batch_id: bBatchId })
      .eq('id', aDealId)
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  // ================================================================
  // ADMISSIONS
  // ================================================================

  it('allows Account A full CRUD on its own admissions', async () => {
    const { data: created, error: insertError } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: aDealId,
        contact_id: aContactId,
        course_id: aCourseId,
        batch_id: aBatchId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 500,
        payment_status: 'partial',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id, payment_status')
      .single()
    expect(insertError).toBeNull()
    aAdmissionId = created!.id
    expect(created?.payment_status).toBe('partial')

    const { data: selected, error: selectError } = await principalA.client
      .from('admissions')
      .select('id')
      .eq('id', aAdmissionId)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('admissions')
      .update({ payment_status: 'paid', amount_paid: 1000 })
      .eq('id', aAdmissionId)
      .select('id, payment_status')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.payment_status).toBe('paid')

    const { data: deleted, error: deleteError } = await principalA.client
      .from('admissions')
      .delete()
      .eq('id', aAdmissionId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
    aAdmissionId = ''
  })

  it('blocks Account A from reading, updating, or deleting Account B admissions', async () => {
    const { data: selected, error: selectError } = await principalA.client
      .from('admissions')
      .select('id')
      .eq('id', bAdmissionId)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: updated, error: updateError } = await principalA.client
      .from('admissions')
      .update({ payment_status: 'paid' })
      .eq('id', bAdmissionId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('admissions')
      .delete()
      .eq('id', bAdmissionId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('blocks Account A from inserting an admission with Account B account_id', async () => {
    const { data, error } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalB.accountId,
        deal_id: bDealId,
        contact_id: bContactId,
        course_id: bCourseId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks an admission referencing a deal from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: bDealId,
        contact_id: aContactId,
        course_id: aCourseId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks an admission referencing a contact from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: aDealId,
        contact_id: bContactId,
        course_id: aCourseId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks an admission referencing a course from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: aDealId,
        contact_id: aContactId,
        course_id: bCourseId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks an admission referencing a batch from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: aDealId,
        contact_id: aContactId,
        course_id: aCourseId,
        batch_id: bBatchId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  // ================================================================
  // STUDENT PROFILES
  // ================================================================

  it('allows Account A full CRUD on its own student profiles', async () => {
    // Re-create an admission for Account A to attach the profile to.
    const { data: admission, error: admissionError } = await principalA.client
      .from('admissions')
      .insert({
        account_id: principalA.accountId,
        deal_id: aDealId,
        contact_id: aContactId,
        course_id: aCourseId,
        admission_date: new Date().toISOString().slice(0, 10),
        total_fee: 1000,
        amount_paid: 0,
        payment_status: 'pending',
        status: 'admitted',
        created_by: principalA.id,
      })
      .select('id')
      .single()
    expect(admissionError).toBeNull()
    aAdmissionId = admission!.id

    const { data: created, error: insertError } = await principalA.client
      .from('student_profiles')
      .insert({
        account_id: principalA.accountId,
        admission_id: aAdmissionId,
        contact_id: aContactId,
        guardian_name: 'Guardian A',
        guardian_phone: '+919999999999',
        education: 'Graduate',
        graduation_year: 2024,
      })
      .select('id, guardian_name')
      .single()
    expect(insertError).toBeNull()
    expect(created?.guardian_name).toBe('Guardian A')

    const { data: selected, error: selectError } = await principalA.client
      .from('student_profiles')
      .select('id')
      .eq('id', created!.id)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('student_profiles')
      .update({ guardian_name: 'Guardian A Updated' })
      .eq('id', created!.id)
      .select('id, guardian_name')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.guardian_name).toBe('Guardian A Updated')

    const { data: deleted, error: deleteError } = await principalA.client
      .from('student_profiles')
      .delete()
      .eq('id', created!.id)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
  })

  it('blocks Account A from reading, updating, or deleting Account B student profiles', async () => {
    // Create a student profile for Account B's admission.
    const { data: bProfile, error: bProfileError } = await admin!
      .from('student_profiles')
      .insert({
        account_id: principalB.accountId,
        admission_id: bAdmissionId,
        contact_id: bContactId,
        guardian_name: 'Guardian B',
      })
      .select('id')
      .single()
    expect(bProfileError).toBeNull()

    const { data: selected, error: selectError } = await principalA.client
      .from('student_profiles')
      .select('id')
      .eq('id', bProfile!.id)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: updated, error: updateError } = await principalA.client
      .from('student_profiles')
      .update({ guardian_name: 'must remain tenant B' })
      .eq('id', bProfile!.id)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('student_profiles')
      .delete()
      .eq('id', bProfile!.id)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('blocks a student profile referencing an admission from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('student_profiles')
      .insert({
        account_id: principalA.accountId,
        admission_id: bAdmissionId,
        contact_id: aContactId,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks a student profile referencing a contact from another account (composite FK)', async () => {
    const { data, error } = await principalA.client
      .from('student_profiles')
      .insert({
        account_id: principalA.accountId,
        admission_id: aAdmissionId,
        contact_id: bContactId,
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })
})

if (!enabled) {
  console.warn('Skipping coaching admissions RLS integration tests: apply migration 042 and set RUN_COACHING_RLS=true.')
}