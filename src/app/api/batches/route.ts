import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CoachingValidationError,
  createBatch,
  listBatches,
  type BatchInput,
} from '@/lib/coaching/service'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const search = new URL(request.url).searchParams
    const courseId = search.get('course_id') || undefined
    const rawStatus = search.get('status')
    if (
      rawStatus !== null &&
      rawStatus !== 'active' &&
      rawStatus !== 'inactive' &&
      rawStatus !== 'full'
    ) {
      return NextResponse.json(
        { error: 'status must be active, inactive, or full' },
        { status: 400 },
      )
    }
    const data = await listBatches(supabase, accountId, {
      course_id: courseId,
      status: (rawStatus as 'active' | 'inactive' | 'full' | null) || undefined,
    })
    return NextResponse.json({ batches: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const batch = await createBatch(supabase, accountId, body as BatchInput)
    return NextResponse.json({ batch }, { status: 201 })
  } catch (error) {
    if (error instanceof CoachingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}