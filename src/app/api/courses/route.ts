import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CoachingValidationError,
  createCourse,
  listCourses,
  type CourseInput,
} from '@/lib/coaching/service'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const search = new URL(request.url).searchParams
    const examId = search.get('exam_id') || undefined
    const rawStatus = search.get('status')
    if (rawStatus !== null && rawStatus !== 'active' && rawStatus !== 'inactive') {
      return NextResponse.json({ error: 'status must be active or inactive' }, { status: 400 })
    }
    const data = await listCourses(supabase, accountId, {
      exam_id: examId,
      status: (rawStatus as 'active' | 'inactive' | null) || undefined,
    })
    return NextResponse.json({ courses: data })
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
    const course = await createCourse(supabase, accountId, body as CourseInput)
    return NextResponse.json({ course }, { status: 201 })
  } catch (error) {
    if (error instanceof CoachingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}