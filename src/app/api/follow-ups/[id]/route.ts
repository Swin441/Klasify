import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  cancelFollowUp,
  completeFollowUp,
  FollowUpNotFoundError,
  FollowUpValidationError,
  getFollowUp,
  rescheduleFollowUp,
  updateFollowUp,
  type FollowUpInput,
} from '@/lib/follow-ups/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

function handleError(error: unknown) {
  if (error instanceof FollowUpValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof FollowUpNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return toErrorResponse(error)
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const followUp = await getFollowUp(supabase, accountId, id)
    return NextResponse.json({ followUp })
  } catch (error) {
    return handleError(error)
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const followUp = await updateFollowUp(supabase, accountId, id, body as Partial<FollowUpInput>)
    return NextResponse.json({ followUp })
  } catch (error) {
    return handleError(error)
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = body.action
    if (action === 'complete') {
      const followUp = await completeFollowUp(
        supabase,
        accountId,
        userId,
        id,
        typeof body.outcome === 'string' ? body.outcome : null,
      )
      return NextResponse.json({ followUp })
    }
    if (action === 'reschedule') {
      const followUp = await rescheduleFollowUp(
        supabase,
        accountId,
        id,
        typeof body.scheduled_at === 'string' ? body.scheduled_at : '',
      )
      return NextResponse.json({ followUp })
    }
    if (action === 'cancel') {
      const followUp = await cancelFollowUp(supabase, accountId, userId, id)
      return NextResponse.json({ followUp })
    }
    return NextResponse.json({ error: 'Unknown follow-up action' }, { status: 400 })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    const { error } = await supabase
      .from('follow_ups')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
