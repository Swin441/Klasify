import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const canRun = Boolean(url && anonKey && serviceRoleKey)

interface TestPrincipal {
  id: string
  accountId: string
  client: SupabaseClient
}

interface TenantFixtures {
  bContactId: string
  bConversationId: string
  bMessageId: string
  bPipelineId: string
  bStageId: string
  bDealId: string
  bWhatsappConfigId: string
}

const suite = canRun ? describe : describe.skip

suite('live account RLS isolation', () => {
  const admin = canRun
    ? createClient(url!, serviceRoleKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null
  let principalA: TestPrincipal
  let principalB: TestPrincipal
  let fixtures: TenantFixtures
  let aContactId: string

  async function createPrincipal(label: string): Promise<TestPrincipal> {
    const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`
    const password = `Rls-${Date.now()}-${Math.random().toString(36).slice(2)}!`
    const { data, error } = await admin!.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `RLS ${label}` },
    })
    if (error || !data.user) throw error ?? new Error('Auth user was not created')

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
        const { error: signInError } = await client.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
        return { id: data.user.id, accountId: profile.account_id, client }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`Profile/account was not created for ${label}`)
  }

  beforeAll(async () => {
    if (!canRun) return
    principalA = await createPrincipal('a')
    principalB = await createPrincipal('b')

    const { data: contact, error: contactError } = await admin!
      .from('contacts')
      .insert({
        user_id: principalB.id,
        account_id: principalB.accountId,
        phone: `1555${Date.now()}01`,
        name: 'RLS tenant B contact',
      })
      .select('id')
      .single()
    if (contactError || !contact) throw contactError ?? new Error('Contact fixture failed')

    const { data: conversation, error: conversationError } = await admin!
      .from('conversations')
      .insert({
        user_id: principalB.id,
        account_id: principalB.accountId,
        contact_id: contact.id,
        status: 'open',
      })
      .select('id')
      .single()
    if (conversationError || !conversation) {
      throw conversationError ?? new Error('Conversation fixture failed')
    }

    const { data: message, error: messageError } = await admin!
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'RLS tenant B message',
      })
      .select('id')
      .single()
    if (messageError || !message) throw messageError ?? new Error('Message fixture failed')

    const { data: pipeline, error: pipelineError } = await admin!
      .from('pipelines')
      .insert({
        user_id: principalB.id,
        account_id: principalB.accountId,
        name: 'RLS tenant B pipeline',
      })
      .select('id')
      .single()
    if (pipelineError || !pipeline) throw pipelineError ?? new Error('Pipeline fixture failed')

    const { data: stage, error: stageError } = await admin!
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipeline.id,
        name: 'RLS tenant B stage',
        position: 0,
        color: '#000000',
      })
      .select('id')
      .single()
    if (stageError || !stage) throw stageError ?? new Error('Stage fixture failed')

    const { data: deal, error: dealError } = await admin!
      .from('deals')
      .insert({
        user_id: principalB.id,
        account_id: principalB.accountId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        contact_id: contact.id,
        conversation_id: conversation.id,
        title: 'RLS tenant B deal',
      })
      .select('id')
      .single()
    if (dealError || !deal) throw dealError ?? new Error('Deal fixture failed')

    const { data: whatsappConfig, error: whatsappError } = await admin!
      .from('whatsapp_config')
      .insert({
        user_id: principalB.id,
        account_id: principalB.accountId,
        phone_number_id: `rls-${Date.now()}`,
        access_token: 'integration-test-placeholder',
        verify_token: 'integration-test-placeholder',
      })
      .select('id')
      .single()
    if (whatsappError || !whatsappConfig) {
      throw whatsappError ?? new Error('WhatsApp config fixture failed')
    }

    fixtures = {
      bContactId: contact.id,
      bConversationId: conversation.id,
      bMessageId: message.id,
      bPipelineId: pipeline.id,
      bStageId: stage.id,
      bDealId: deal.id,
      bWhatsappConfigId: whatsappConfig.id,
    }
  }, 30_000)

  afterAll(async () => {
    await principalA?.client.auth.signOut()
    await principalB?.client.auth.signOut()
    if (principalA?.id) await admin!.auth.admin.deleteUser(principalA.id)
    if (principalB?.id) await admin!.auth.admin.deleteUser(principalB.id)
  })

  it('allows own-account contact CRUD', async () => {
    const { data: inserted, error: insertError } = await principalA.client
      .from('contacts')
      .insert({
        user_id: principalA.id,
        account_id: principalA.accountId,
        phone: `1555${Date.now()}02`,
        name: 'RLS tenant A contact',
      })
      .select('id, account_id')
      .single()
    expect(insertError).toBeNull()
    expect(inserted?.account_id).toBe(principalA.accountId)
    aContactId = inserted!.id

    const { data: ownRows, error: selectError } = await principalA.client
      .from('contacts')
      .select('id')
      .eq('id', aContactId)
    expect(selectError).toBeNull()
    expect(ownRows).toHaveLength(1)

    const { data: updated, error: updateError } = await principalA.client
      .from('contacts')
      .update({ name: 'RLS tenant A updated' })
      .eq('id', aContactId)
      .select('id, name')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.name).toBe('RLS tenant A updated')

    const { data: deleted, error: deleteError } = await principalA.client
      .from('contacts')
      .delete()
      .eq('id', aContactId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toHaveLength(1)
    aContactId = ''
  })

  it('blocks cross-account SELECT across tenant-owned tables', async () => {
    const queries = await Promise.all([
      principalA.client.from('contacts').select('id').eq('id', fixtures.bContactId),
      principalA.client
        .from('conversations')
        .select('id')
        .eq('id', fixtures.bConversationId),
      principalA.client.from('messages').select('id').eq('id', fixtures.bMessageId),
      principalA.client.from('deals').select('id').eq('id', fixtures.bDealId),
      principalA.client
        .from('whatsapp_config')
        .select('id')
        .eq('id', fixtures.bWhatsappConfigId),
      principalA.client.from('accounts').select('id').eq('id', principalB.accountId),
      principalA.client.from('profiles').select('user_id').eq('account_id', principalB.accountId),
    ])

    for (const result of queries) {
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    }
  })

  it('blocks cross-account INSERT', async () => {
    const { data, error } = await principalA.client
      .from('contacts')
      .insert({
        user_id: principalA.id,
        account_id: principalB.accountId,
        phone: `1555${Date.now()}03`,
        name: 'forbidden cross-account contact',
      })
      .select('id')
    expect(data == null || data.length === 0).toBe(true)
    expect(error).not.toBeNull()
  })

  it('blocks cross-account UPDATE and DELETE', async () => {
    const { data: updated, error: updateError } = await principalA.client
      .from('contacts')
      .update({ name: 'must remain tenant B' })
      .eq('id', fixtures.bContactId)
      .select('id')
    expect(updateError).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteError } = await principalA.client
      .from('contacts')
      .delete()
      .eq('id', fixtures.bContactId)
      .select('id')
    expect(deleteError).toBeNull()
    expect(deleted).toEqual([])

    const { data: stillThere, error: verifyError } = await admin!
      .from('contacts')
      .select('id, name')
      .eq('id', fixtures.bContactId)
      .single()
    expect(verifyError).toBeNull()
    expect(stillThere?.name).toBe('RLS tenant B contact')
  })

  it('does not expose Account B through membership paths', async () => {
    const { data: accountRows, error: accountError } = await principalA.client
      .from('accounts')
      .select('id')
      .eq('id', principalB.accountId)
    expect(accountError).toBeNull()
    expect(accountRows).toEqual([])

    const { data: memberRows, error: memberError } = await principalA.client
      .from('profiles')
      .select('user_id, account_id')
      .eq('account_id', principalB.accountId)
    expect(memberError).toBeNull()
    expect(memberRows).toEqual([])
  })
})

if (!canRun) {
  console.warn(
    'Skipping live RLS integration tests: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.',
  )
}
