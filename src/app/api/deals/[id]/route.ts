import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  DealNotFoundError,
  DealValidationError,
  updateDeal,
  type DealUpdateInput,
} from '@/lib/deals/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

function handleError(error: unknown) {
  if (error instanceof DealValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof DealNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return toErrorResponse(error)
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const deal = await updateDeal(supabase, accountId, id, body as DealUpdateInput)
    return NextResponse.json({ deal })
  } catch (error) {
    return handleError(error)
  }
}