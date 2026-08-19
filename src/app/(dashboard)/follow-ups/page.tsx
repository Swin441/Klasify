'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, Clock3, Plus, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountMember, FollowUp } from '@/types'
import { FOLLOW_UP_TYPE_LABELS, isOverdueFollowUp } from '@/lib/follow-ups/validation'
import { Button } from '@/components/ui/button'

const VIEWS = [
  { key: 'today', label: "Today's" },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'my', label: 'My follow-ups' },
  { key: 'all', label: 'All follow-ups' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

type FollowUpRow = FollowUp & {
  contact?: { id: string; name?: string | null; phone: string }
  deal?: { id: string; title: string; pipeline_id: string; stage_id: string }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusClass(status: FollowUp['status']) {
  if (status === 'completed') return 'bg-emerald-500/10 text-emerald-400'
  if (status === 'cancelled') return 'bg-muted text-muted-foreground'
  return 'bg-amber-500/10 text-amber-300'
}

export default function FollowUpsPage() {
  const [view, setView] = useState<ViewKey>('today')
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [followUpsResponse, membersResponse] = await Promise.all([
      fetch(`/api/follow-ups?view=${view}`),
      fetch('/api/account/members'),
    ])
    const followUpsBody = await followUpsResponse.json().catch(() => null)
    const membersBody = await membersResponse.json().catch(() => null)
    if (!followUpsResponse.ok) {
      toast.error(followUpsBody?.error ?? 'Could not load follow-ups.')
      setLoading(false)
      return
    }
    setFollowUps((followUpsBody?.followUps ?? []) as FollowUpRow[])
    setMembers((membersBody?.members ?? []) as AccountMember[])
    setLoading(false)
  }, [view])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await load()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  async function runAction(id: string, action: 'complete' | 'cancel') {
    const outcome = action === 'complete' ? window.prompt('Optional outcome') : undefined
    if (action === 'complete' && outcome === null) return
    setBusyId(id)
    const response = await fetch(`/api/follow-ups/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(outcome === undefined ? {} : { outcome }) }),
    })
    const body = await response.json().catch(() => null)
    setBusyId(null)
    if (!response.ok) {
      toast.error(body?.error ?? 'Could not update follow-up.')
      return
    }
    toast.success(action === 'complete' ? 'Follow-up completed.' : 'Follow-up cancelled.')
    await load()
  }

  function memberName(userId?: string | null) {
    if (!userId) return 'Shared queue'
    return members.find((member) => member.user_id === userId)?.full_name || 'Assigned counsellor'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <CalendarClock className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Counsellor workspace</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Follow-ups</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep every next action attached to the lead it belongs to.</p>
        </div>
        <Button render={<Link href="/follow-ups/new" />}>
          <Plus className="mr-2 h-4 w-4" />
          Schedule follow-up
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setView(item.key)}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${view === item.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-muted/40" />)}
        </div>
      ) : followUps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Clock3 className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-medium text-foreground">No follow-ups here</h2>
          <p className="mt-1 text-sm text-muted-foreground">Schedule the next action from a deal, conversation, or this page.</p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {followUps.map((followUp) => {
            const overdue = isOverdueFollowUp(followUp)
            return (
              <article key={followUp.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/follow-ups/${followUp.id}`} className="font-medium text-foreground hover:text-primary">
                      {followUp.title}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {followUp.contact?.name || followUp.contact?.phone || 'Contact'}
                      {followUp.deal?.title ? ` · ${followUp.deal.title}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${statusClass(followUp.status)}`}>
                    {followUp.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <span className={overdue ? 'font-medium text-red-400' : ''}>
                    <Clock3 className="mr-2 inline h-4 w-4" />{formatDateTime(followUp.scheduled_at)}
                  </span>
                  <span>{FOLLOW_UP_TYPE_LABELS[followUp.type]} · {memberName(followUp.assigned_to)}</span>
                </div>
                {followUp.notes && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{followUp.notes}</p>}
                {followUp.status === 'pending' && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button size="sm" onClick={() => void runAction(followUp.id, 'complete')} disabled={busyId === followUp.id}>
                      <Check className="mr-1.5 h-4 w-4" />Complete
                    </Button>
                    <Button size="sm" variant="outline" render={<Link href={`/follow-ups/${followUp.id}`} />}>
                      <RotateCcw className="mr-1.5 h-4 w-4" />Reschedule
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void runAction(followUp.id, 'cancel')} disabled={busyId === followUp.id}>
                      <X className="mr-1.5 h-4 w-4" />Cancel
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
