import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  DealValidationError,
  createDeal,
  type DealCreateInput,
} from '@/lib/deals/service'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const deal = await createDeal(
      supabase,
      accountId,
      userId,
      body as DealCreateInput,
    )
    return NextResponse.json({ deal }, { status: 201 })
  } catch (error) {
    if (error instanceof DealValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}