-- ============================================================
-- 040_follow_ups.sql — coaching institute follow-up queue
--
-- Follow-ups are account-scoped operational work. A contact is always
-- retained as the primary relationship; a deal is optional so a
-- counsellor can schedule work from an inbox conversation before a
-- pipeline deal exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS follow_ups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id       UUID REFERENCES deals(id) ON DELETE SET NULL,
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN (
    'call',
    'whatsapp',
    'counselling',
    'fee_follow_up',
    'admission_follow_up',
    'other'
  )),
  title         TEXT NOT NULL DEFAULT 'Follow-up',
  notes         TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome       TEXT,
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT follow_ups_notes_length CHECK (notes IS NULL OR char_length(notes) <= 5000),
  CONSTRAINT follow_ups_outcome_length CHECK (outcome IS NULL OR char_length(outcome) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_account_schedule
  ON follow_ups(account_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_follow_ups_assignee_schedule
  ON follow_ups(account_id, assigned_to, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_follow_ups_contact
  ON follow_ups(account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_deal
  ON follow_ups(account_id, deal_id)
  WHERE deal_id IS NOT NULL;

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follow_ups_select ON follow_ups;
CREATE POLICY follow_ups_select ON follow_ups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS follow_ups_insert ON follow_ups;
CREATE POLICY follow_ups_insert ON follow_ups FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = follow_ups.contact_id
        AND c.account_id = follow_ups.account_id
    )
    AND (
      follow_ups.deal_id IS NULL
      OR EXISTS (
        SELECT 1 FROM deals d
        WHERE d.id = follow_ups.deal_id
          AND d.account_id = follow_ups.account_id
          AND (d.contact_id IS NULL OR d.contact_id = follow_ups.contact_id)
      )
    )
    AND (
      follow_ups.assigned_to IS NULL
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = follow_ups.assigned_to
          AND p.account_id = follow_ups.account_id
          AND p.account_role IN ('owner', 'admin', 'agent')
      )
    )
  );

DROP POLICY IF EXISTS follow_ups_update ON follow_ups;
CREATE POLICY follow_ups_update ON follow_ups FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = follow_ups.contact_id
        AND c.account_id = follow_ups.account_id
    )
    AND (
      follow_ups.deal_id IS NULL
      OR EXISTS (
        SELECT 1 FROM deals d
        WHERE d.id = follow_ups.deal_id
          AND d.account_id = follow_ups.account_id
          AND (d.contact_id IS NULL OR d.contact_id = follow_ups.contact_id)
      )
    )
    AND (
      follow_ups.assigned_to IS NULL
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = follow_ups.assigned_to
          AND p.account_id = follow_ups.account_id
          AND p.account_role IN ('owner', 'admin', 'agent')
      )
    )
  );

DROP POLICY IF EXISTS follow_ups_delete ON follow_ups;
CREATE POLICY follow_ups_delete ON follow_ups FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON follow_ups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
