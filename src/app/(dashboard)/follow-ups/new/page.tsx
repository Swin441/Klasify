'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CalendarClock } from 'lucide-react'
import Link from 'next/link'
import { FollowUpForm } from '@/components/follow-ups/follow-up-form'

function NewFollowUpPageContent() {
  const searchParams = useSearchParams()
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/follow-ups" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to follow-ups">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2 text-primary">
            <CalendarClock className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Follow-ups</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Schedule a follow-up</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep the next counsellor action visible and account-scoped.</p>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <FollowUpForm
          initialContactId={searchParams.get('contact_id') ?? undefined}
          initialDealId={searchParams.get('deal_id') ?? undefined}
        />
      </div>
    </div>
  )
}

export default function NewFollowUpPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40" />}>
      <NewFollowUpPageContent />
    </Suspense>
  )
}
