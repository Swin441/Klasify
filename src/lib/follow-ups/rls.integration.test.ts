import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  listFollowUps,
  rescheduleFollowUp,
} from './service'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.RUN_FOLLOW_UP_RLS === 'true' && Boolean(url && anonKey && serviceRoleKey)
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

suite('live follow-up RLS isolation', () => {
  let principalA: Principal
  let principalB: Principal
  let bContactId: string
  let bFollowUpId: string

  async function createPrincipal(label: string): Promise<Principal> {
    const email = `follow-up-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`
    const password = `FollowUp-${Date.now()}-${Math.random().toString(36).slice(2)}!`
    const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw error ?? new Error('Could not create test user')
    const { data: profile, error: profileError } = await admin!
      .from('profiles')
      .select('account_id')
      .eq('user_id', data.user.id)
      .single()
    if (profileError || !profile?.account_id) throw profileError ?? new Error('Test account was not created')
    const client = createClient(url!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } })
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw signInError
    return { id: data.user.id, accountId: profile.account_id, client }
  }

  beforeAll(async () => {
    principalA = await createPrincipal('a')
    principalB = await createPrincipal('b')
    const { data: contact, error: contactError } = await admin!
      .from('contacts')
      .insert({ user_id: principalB.id, account_id: principalB.accountId, phone: `1666${Date.now()}`, name: 'Follow-up RLS B' })
      .select('id')
      .single()
    if (contactError || !contact) throw contactError ?? new Error('Could not create contact fixture')
    bContactId = contact.id
    const { data: followUp, error: followUpError } = await admin!
      .from('follow_ups')
      .insert({
        account_id: principalB.accountId,
        contact_id: bContactId,
        assigned_to: principalB.id,
        type: 'call',
        title: 'Follow-up RLS B',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        created_by: principalB.id,
      })
      .select('id')
      .single()
    if (followUpError || !followUp) throw followUpError ?? new Error('Could not create follow-up fixture')
    bFollowUpId = followUp.id
  }, 30_000)

  afterAll(async () => {
    await principalA?.client.auth.signOut()
    await principalB?.client.auth.signOut()
    if (principalA?.id) await admin!.auth.admin.deleteUser(principalA.id)
    if (principalB?.id) await admin!.auth.admin.deleteUser(principalB.id)
  })

  it('allows own-account follow-up create, update, complete, and read', async () => {
    const { data: contact, error: contactError } = await principalA.client
      .from('contacts')
      .insert({ user_id: principalA.id, account_id: principalA.accountId, phone: `1777${Date.now()}`, name: 'Follow-up RLS A' })
      .select('id')
      .single()
    expect(contactError).toBeNull()
    const { data: created, error: createError } = await principalA.client
      .from('follow_ups')
      .insert({
        account_id: principalA.accountId,
        contact_id: contact!.id,
        assigned_to: principalA.id,
        type: 'counselling',
        title: 'Follow-up RLS A',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        created_by: principalA.id,
      })
      .select('id, status')
      .single()
    expect(createError).toBeNull()
    expect(created?.status).toBe('pending')

    const { error: updateError } = await principalA.client
      .from('follow_ups')
      .update({ notes: 'updated by account A' })
      .eq('id', created!.id)
    expect(updateError).toBeNull()

    const { data: completed, error: completeError } = await principalA.client
      .from('follow_ups')
      .update({ status: 'completed', completed_by: principalA.id, completed_at: new Date().toISOString(), outcome: 'Student interested' })
      .eq('id', created!.id)
      .select('status, outcome')
      .single()
    expect(completeError).toBeNull()
    expect(completed).toEqual({ status: 'completed', outcome: 'Student interested' })
  })

  it('blocks Account A from reading, inserting, updating, or deleting Account B follow-ups', async () => {
    const { data: selected, error: selectError } = await principalA.client
      .from('follow_ups')
      .select('id')
      .eq('id', bFollowUpId)
    expect(selectError).toBeNull()
    expect(selected).toEqual([])

    const { data: inserted, error: insertError } = await principalA.client
      .from('follow_ups')
      .insert({ account_id: principalB.accountId, contact_id: bContactId, type: 'call', title: 'forbidden', scheduled_at: new Date().toISOString(), created_by: principalA.id })
      .select('id')
    expect(inserted == null || inserted.length === 0).toBe(true)
    expect(insertError).not.toBeNull()

    const { data: updated, error: updateError } = await principalA.client
      .from('follow_ups')
      .update({ notes: 'must remain private' })
      .eq('id', bFollowUpId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('follow_ups')
      .delete()
      .eq('id', bFollowUpId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])
  })

  it('allows User B to read and complete their account follow-up lifecycle', async () => {
    const visible = await listFollowUps(principalB.client, principalB.accountId, principalB.id, { view: 'all' })
    expect(visible.some((row) => row.id === bFollowUpId)).toBe(true)

    const rescheduledAt = new Date(Date.now() + 2 * 86400000).toISOString()
    const rescheduled = await rescheduleFollowUp(
      principalB.client,
      principalB.accountId,
      bFollowUpId,
      rescheduledAt,
    )
    if (!rescheduled) throw new Error('Reschedule returned no follow-up')
    expect(new Date(rescheduled.scheduled_at).getTime()).toBe(new Date(rescheduledAt).getTime())

    const completed = await completeFollowUp(
      principalB.client,
      principalB.accountId,
      principalB.id,
      bFollowUpId,
      'Student interested',
    )
    if (!completed) throw new Error('Complete returned no follow-up')
    expect(completed.status).toBe('completed')

    const created = await createFollowUp(principalB.client, principalB.accountId, principalB.id, {
      contact_id: bContactId,
      assigned_to: principalB.id,
      type: 'whatsapp',
      title: 'Follow-up service cancel',
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    })
    if (!created) throw new Error('Create returned no follow-up')
    const cancelled = await cancelFollowUp(
      principalB.client,
      principalB.accountId,
      principalB.id,
      created.id,
    )
    if (!cancelled) throw new Error('Cancel returned no follow-up')
    expect(cancelled.status).toBe('cancelled')
  }, 30_000)
})

if (!enabled) {
  console.warn('Skipping follow-up RLS integration tests: apply migration 040 and set RUN_FOLLOW_UP_RLS=true.')
}
