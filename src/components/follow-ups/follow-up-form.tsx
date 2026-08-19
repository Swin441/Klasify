'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Contact, Deal, Profile } from '@/types'
import { FOLLOW_UP_TYPE_LABELS, FOLLOW_UP_TYPES, type FollowUpType } from '@/lib/follow-ups/validation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

interface FollowUpFormProps {
  initialContactId?: string
  initialDealId?: string
}

function localDateTimePlusHour() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16)
}

export function FollowUpForm({ initialContactId, initialDealId }: FollowUpFormProps) {
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [contactId, setContactId] = useState(initialContactId ?? '')
  const [dealId, setDealId] = useState(initialDealId ?? '')
  const [assignedTo, setAssignedTo] = useState('')
  const [type, setType] = useState<FollowUpType>('call')
  const [title, setTitle] = useState('Follow-up')
  const [notes, setNotes] = useState('')
  const [scheduledAt, setScheduledAt] = useState(localDateTimePlusHour)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    Promise.all([
      supabase.from('contacts').select('id, name, phone').order('name'),
      supabase.from('deals').select('id, title, contact_id, pipeline_id, stage_id').order('created_at', { ascending: false }),
      supabase.from('profiles').select('user_id, full_name, account_role').order('full_name'),
    ]).then(([contactsResult, dealsResult, profilesResult]) => {
      if (cancelled) return
      setContacts((contactsResult.data ?? []) as Contact[])
      setDeals((dealsResult.data ?? []) as Deal[])
      setProfiles((profilesResult.data ?? []) as Profile[])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!dealId) return
    const deal = deals.find((item) => item.id === dealId)
    if (!deal?.contact_id) return
    ;(async () => {
      await Promise.resolve()
      setContactId(deal.contact_id as string)
    })()
  }, [dealId, deals])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contactId || !scheduledAt) {
      toast.error('Choose a contact and schedule time.')
      return
    }
    setSaving(true)
    const response = await fetch('/api/follow-ups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contactId,
        deal_id: dealId || null,
        assigned_to: assignedTo || null,
        type,
        title: title.trim() || 'Follow-up',
        notes: notes.trim() || null,
        scheduled_at: new Date(scheduledAt).toISOString(),
      }),
    })
    const result = await response.json().catch(() => null)
    setSaving(false)
    if (!response.ok) {
      toast.error(result?.error ?? 'Could not create follow-up.')
      return
    }
    toast.success('Follow-up scheduled.')
    router.push('/follow-ups')
    router.refresh()
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-2">
        <Label htmlFor="follow-up-contact">Contact</Label>
        <select
          id="follow-up-contact"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
          required
        >
          <option value="">Select a contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name || contact.phone} · {contact.phone}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="follow-up-deal">Deal / lead</Label>
        <select
          id="follow-up-deal"
          value={dealId}
          onChange={(event) => setDealId(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
        >
          <option value="">No deal linked</option>
          {deals
            .filter((deal) => !contactId || deal.contact_id === contactId)
            .map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.title}
              </option>
            ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="follow-up-assignee">Counsellor</Label>
        <select
          id="follow-up-assignee"
          value={assignedTo}
          onChange={(event) => setAssignedTo(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
        >
          <option value="">Shared queue</option>
          {profiles.map((profile) => (
            <option key={profile.user_id} value={profile.user_id}>
              {profile.full_name || profile.user_id}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
        <div className="grid gap-2">
          <Label htmlFor="follow-up-type">Follow-up type</Label>
          <select
            id="follow-up-type"
            value={type}
            onChange={(event) => setType(event.target.value as FollowUpType)}
            className="h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
          >
            {FOLLOW_UP_TYPES.map((item) => (
              <option key={item} value={item}>
                {FOLLOW_UP_TYPE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="follow-up-time">Date and time</Label>
          <Input
            id="follow-up-time"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="follow-up-title">Title</Label>
        <Input
          id="follow-up-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          placeholder="Discuss next steps"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="follow-up-notes">Notes</Label>
        <Textarea
          id="follow-up-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={5000}
          placeholder="What should the counsellor remember?"
          rows={5}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Schedule follow-up
        </Button>
      </div>
    </form>
  )
}
