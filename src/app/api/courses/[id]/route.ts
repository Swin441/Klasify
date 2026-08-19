import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CoachingNotFoundError,
  CoachingValidationError,
  deleteCourse,
  getCourse,
  updateCourse,
  type CourseInput,
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
    const course = await getCourse(supabase, accountId, id)
    return NextResponse.json({ course })
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
    const course = await updateCourse(supabase, accountId, id, body as Partial<CourseInput>)
    return NextResponse.json({ course })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    await deleteCourse(supabase, accountId, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}