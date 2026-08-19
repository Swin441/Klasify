import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  createFollowUp,
  listFollowUps,
  FollowUpValidationError,
  type FollowUpInput,
} from '@/lib/follow-ups/service'
import { isFollowUpType, type FollowUpType } from '@/lib/follow-ups/validation'

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()
    const search = new URL(request.url).searchParams
    const rawType = search.get('type') || undefined
    if (rawType && !isFollowUpType(rawType)) {
      return NextResponse.json({ error: 'Invalid follow-up type' }, { status: 400 })
    }
    const data = await listFollowUps(supabase, accountId, userId, {
      view: (search.get('view') as 'today' | 'overdue' | 'upcoming' | 'my' | 'all' | null) || 'all',
      type: rawType as FollowUpType | undefined,
      assigned_to: search.get('assigned_to') || undefined,
      deal_id: search.get('deal_id') || undefined,
      contact_id: search.get('contact_id') || undefined,
    })
    return NextResponse.json({ followUps: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const followUp = await createFollowUp(supabase, accountId, userId, body as FollowUpInput)
    return NextResponse.json({ followUp }, { status: 201 })
  } catch (error) {
    if (error instanceof FollowUpValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}
