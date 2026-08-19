import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CoachingValidationError,
  createExam,
  listExams,
  type ExamInput,
} from '@/lib/coaching/service'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const search = new URL(request.url).searchParams
    const rawActive = search.get('is_active')
    const isActive = rawActive === null ? undefined : rawActive === 'true'
    if (rawActive !== null && rawActive !== 'true' && rawActive !== 'false') {
      return NextResponse.json({ error: 'is_active must be true or false' }, { status: 400 })
    }
    const data = await listExams(supabase, accountId, { is_active: isActive })
    return NextResponse.json({ exams: data })
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
    const exam = await createExam(supabase, accountId, body as ExamInput)
    return NextResponse.json({ exam }, { status: 201 })
  } catch (error) {
    if (error instanceof CoachingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}