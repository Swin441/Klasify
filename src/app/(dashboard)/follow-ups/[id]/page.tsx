'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CalendarClock, Check, Clock3, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FOLLOW_UP_TYPE_LABELS } from '@/lib/follow-ups/validation'
import type { FollowUp } from '@/types'

type FollowUpDetail = FollowUp & {
  contact?: { id: string; name?: string | null; phone: string }
  deal?: { id: string; title: string; pipeline_id: string; stage_id: string; stage?: { name: string } | null }
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16)
}

function displayDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

export default function FollowUpDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [followUp, setFollowUp] = useState<FollowUpDetail | null>(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [outcome, setOutcome] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/follow-ups/${params.id}`)
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load follow-up.')
        setFollowUp(body.followUp)
        setScheduledAt(toLocalDateTime(body.followUp.scheduled_at))
        setOutcome(body.followUp.outcome ?? '')
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [params.id])

  async function action(actionName: 'complete' | 'cancel' | 'reschedule') {
    if (actionName === 'reschedule' && !scheduledAt) {
      toast.error('Choose a new date and time.')
      return
    }
    setSaving(true)
    const response = await fetch(`/api/follow-ups/${params.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: actionName,
        ...(actionName === 'complete' ? { outcome: outcome.trim() || null } : {}),
        ...(actionName === 'reschedule' ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
      }),
    })
    const body = await response.json().catch(() => null)
    setSaving(false)
    if (!response.ok) {
      toast.error(body?.error ?? 'Could not update follow-up.')
      return
    }
    setFollowUp(body.followUp)
    toast.success(actionName === 'complete' ? 'Follow-up completed.' : actionName === 'cancel' ? 'Follow-up cancelled.' : 'Follow-up rescheduled.')
    if (actionName !== 'reschedule') router.push('/follow-ups')
  }

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
  if (!followUp) {
    return <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">Follow-up not found.</div>
  }

  const pending = followUp.status === 'pending'
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/follow-ups" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to follow-ups">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2 text-primary"><CalendarClock className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Follow-up detail</span></div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">{followUp.title}</h1>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contact</p>
          <p className="mt-2 font-medium text-foreground">{followUp.contact?.name || followUp.contact?.phone || 'Contact'}</p>
          <p className="text-sm text-muted-foreground">{followUp.contact?.phone}</p>
          {followUp.deal?.title && <p className="mt-3 text-sm text-primary">Deal: {followUp.deal.title}{followUp.deal.stage?.name ? ` · ${followUp.deal.stage.name}` : ''}</p>}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Schedule</p>
          <p className="mt-2 font-medium text-foreground">{displayDate(followUp.scheduled_at)}</p>
          <p className="text-sm text-muted-foreground">{FOLLOW_UP_TYPE_LABELS[followUp.type]} · {followUp.status}</p>
          <p className="mt-2 text-xs text-muted-foreground">Created {displayDate(followUp.created_at)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Counsellor</p><p className="mt-2 text-foreground">{followUp.assigned_to ? 'Assigned counsellor' : 'Shared queue'}</p></div>
          <div><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Completion</p><p className="mt-2 text-foreground">{displayDate(followUp.completed_at)}</p></div>
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{followUp.notes || 'No notes added.'}</p>
        </div>
        {followUp.outcome && <div className="mt-5 border-t border-border pt-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Outcome</p><p className="mt-2 text-sm text-foreground">{followUp.outcome}</p></div>}
      </div>

      {pending && (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="font-medium text-foreground">Update follow-up</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="reschedule-at">Reschedule</Label><Input id="reschedule-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="outcome">Outcome when completed</Label><Textarea id="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={2000} rows={3} placeholder="What happened?" /></div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button onClick={() => void action('complete')} disabled={saving}><Check className="mr-2 h-4 w-4" />Complete</Button>
            <Button variant="outline" onClick={() => void action('reschedule')} disabled={saving}><RotateCcw className="mr-2 h-4 w-4" />Reschedule</Button>
            <Button variant="ghost" onClick={() => void action('cancel')} disabled={saving}><X className="mr-2 h-4 w-4" />Cancel</Button>
          </div>
        </div>
      )}
      {!pending && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />This follow-up is closed.</div>}
    </div>
  )
}
