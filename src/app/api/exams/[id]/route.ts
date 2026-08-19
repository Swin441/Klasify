import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CoachingNotFoundError,
  CoachingValidationError,
  deleteExam,
  getExam,
  updateExam,
  type ExamInput,
} from '@/lib/coaching/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

function handleError(error: unknown) {
  if (error instanceof CoachingValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof CoachingNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return toErrorResponse(error)
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const exam = await getExam(supabase, accountId, id)
    return NextResponse.json({ exam })
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
    const exam = await updateExam(supabase, accountId, id, body as Partial<ExamInput>)
    return NextResponse.json({ exam })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    await deleteExam(supabase, accountId, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}