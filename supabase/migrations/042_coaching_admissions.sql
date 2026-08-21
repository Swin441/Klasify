-- ============================================================
-- 042_coaching_admissions.sql — Phase 2B/2C admissions foundation
--
-- Adds the coaching qualification fields to `deals` and the two
-- new account-scoped entities that represent a converted
-- opportunity:
--
--   admissions        — a successfully converted deal (fee, payment
--                       state, course, batch, counsellor)
--   student_profiles  — minimal post-admission student information
--                       (guardian, education) for future phases
--
-- Tenancy: every row is account-scoped via account_id and the
-- existing is_account_member() RLS helper (migration 017).
--
-- Cross-account integrity is enforced AT THE DATABASE LEVEL with
-- composite foreign keys, following the exact pattern established
-- in migration 041:
--
--   deals(account_id, exam_id)   → exams(account_id, id)
--   deals(account_id, course_id) → courses(account_id, id)
--   deals(account_id, batch_id)  → batches(account_id, id)
--   admissions(account_id, deal_id)    → deals(account_id, id)
--   admissions(account_id, contact_id) → contacts(account_id, id)
--   admissions(account_id, course_id)  → courses(account_id, id)
--   admissions(account_id, batch_id)   → batches(account_id, id)
--   student_profiles(account_id, admission_id) → admissions(account_id, id)
--   student_profiles(account_id, contact_id)   → contacts(account_id, id)
--
-- A deal can therefore never reference another account's exam /
-- course / batch, and an admission can never reference another
-- account's deal / contact / course / batch, no matter what the
-- client sends.
--
-- Idempotent — safe to run multiple times. Tables/indexes use
-- IF NOT EXISTS; policies are dropped before recreate (Postgres
-- has no CREATE POLICY IF NOT EXISTS).
--
-- NOTE ON PIPELINE SEEDING
--   The existing `pipelines` / `pipeline_stages` schema is
--   account-scoped and user-created; there is no "default
--   pipeline" concept. Auto-creating a pipeline + stages for
--   every account in a migration would be an invasive data
--   mutation that could conflict with existing custom pipelines.
--   Default coaching stages are therefore seeded by the
--   application layer (a "create default pipeline" action) in a
--   later Phase 2B task, not by this migration.
-- ============================================================

-- ============================================================
-- FK-TARGET UNIQUE KEYS
--
-- Composite FKs require a unique index on the referenced
-- (account_id, id) pair. Migration 041 already created these for
-- exams and courses; deals, contacts, batches, and admissions
-- need theirs here.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_account_id
  ON deals(account_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_id
  ON contacts(account_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_account_id
  ON batches(account_id, id);

-- ============================================================
-- DEALS — coaching qualification fields
--
-- All new fields are nullable so existing deals keep working
-- after the migration. Composite FKs guarantee same-account
-- references at the database level.
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS exam_id UUID,
  ADD COLUMN IF NOT EXISTS course_id UUID,
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS education TEXT,
  ADD COLUMN IF NOT EXISTS graduation_year INTEGER,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS preparation_level TEXT,
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS preferred_mode TEXT,
  ADD COLUMN IF NOT EXISTS parent_involvement BOOLEAN NOT NULL DEFAULT false;

-- lead_source domain
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_lead_source_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_lead_source_check
      CHECK (lead_source IS NULL OR lead_source IN (
        'whatsapp', 'walk_in', 'phone', 'referral',
        'website', 'facebook', 'instagram', 'other'
      ));
  END IF;
END $$;

-- preparation_level domain
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_preparation_level_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_preparation_level_check
      CHECK (preparation_level IS NULL OR preparation_level IN (
        'beginner', 'intermediate', 'advanced'
      ));
  END IF;
END $$;

-- preferred_mode domain (mirrors courses/batches mode)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_preferred_mode_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_preferred_mode_check
      CHECK (preferred_mode IS NULL OR preferred_mode IN (
        'offline', 'online', 'hybrid'
      ));
  END IF;
END $$;

-- graduation_year sanity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_graduation_year_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_graduation_year_check
      CHECK (graduation_year IS NULL OR graduation_year BETWEEN 1950 AND 2100);
  END IF;
END $$;

-- budget non-negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_budget_non_negative' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_budget_non_negative
      CHECK (budget IS NULL OR budget >= 0);
  END IF;
END $$;

-- Composite account-safe FKs. Drop-then-add so a re-run converges.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_account_exam_fk' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_account_exam_fk;
  END IF;
END $$;
ALTER TABLE deals
  ADD CONSTRAINT deals_account_exam_fk
  FOREIGN KEY (account_id, exam_id)
  REFERENCES exams(account_id, id)
  ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_account_course_fk' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_account_course_fk;
  END IF;
END $$;
ALTER TABLE deals
  ADD CONSTRAINT deals_account_course_fk
  FOREIGN KEY (account_id, course_id)
  REFERENCES courses(account_id, id)
  ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_account_batch_fk' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_account_batch_fk;
  END IF;
END $$;
ALTER TABLE deals
  ADD CONSTRAINT deals_account_batch_fk
  FOREIGN KEY (account_id, batch_id)
  REFERENCES batches(account_id, id)
  ON DELETE SET NULL;

-- Indexes for the new qualification filters.
CREATE INDEX IF NOT EXISTS idx_deals_account_exam
  ON deals(account_id, exam_id) WHERE exam_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_account_course
  ON deals(account_id, course_id) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_account_batch
  ON deals(account_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_account_lead_source
  ON deals(account_id, lead_source) WHERE lead_source IS NOT NULL;

-- ============================================================
-- ADMISSIONS
--
-- A successfully converted deal. One admission per deal per
-- account (UNIQUE(account_id, deal_id)). All references are
-- account-safe via composite FKs.
-- ============================================================
CREATE TABLE IF NOT EXISTS admissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id          UUID NOT NULL,
  contact_id       UUID NOT NULL,
  course_id        UUID NOT NULL,
  batch_id         UUID,
  admission_date   DATE NOT NULL,
  total_fee        NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status   TEXT NOT NULL DEFAULT 'pending'
                   CHECK (payment_status IN ('pending', 'partial', 'paid')),
  payment_date     DATE,
  payment_reference TEXT,
  status           TEXT NOT NULL DEFAULT 'admitted'
                   CHECK (status IN ('admitted', 'cancelled')),
  counsellor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes            TEXT,
  created_by       UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admissions_account_deal_unique UNIQUE (account_id, deal_id),
  CONSTRAINT admissions_total_fee_non_negative CHECK (total_fee >= 0),
  CONSTRAINT admissions_amount_paid_non_negative CHECK (amount_paid >= 0),
  CONSTRAINT admissions_amount_paid_lte_total CHECK (amount_paid <= total_fee),
  CONSTRAINT admissions_notes_length CHECK (notes IS NULL OR char_length(notes) <= 5000),
  CONSTRAINT admissions_payment_reference_length
    CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 200),
  CONSTRAINT admissions_account_deal_fk FOREIGN KEY (account_id, deal_id)
    REFERENCES deals(account_id, id) ON DELETE CASCADE,
  CONSTRAINT admissions_account_contact_fk FOREIGN KEY (account_id, contact_id)
    REFERENCES contacts(account_id, id) ON DELETE RESTRICT,
  CONSTRAINT admissions_account_course_fk FOREIGN KEY (account_id, course_id)
    REFERENCES courses(account_id, id) ON DELETE RESTRICT,
  CONSTRAINT admissions_account_batch_fk FOREIGN KEY (account_id, batch_id)
    REFERENCES batches(account_id, id) ON DELETE SET NULL
);

-- FK-target unique key for the composite FK from student_profiles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_account_id
  ON admissions(account_id, id);

CREATE INDEX IF NOT EXISTS idx_admissions_account
  ON admissions(account_id);
CREATE INDEX IF NOT EXISTS idx_admissions_account_status
  ON admissions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_admissions_account_admission_date
  ON admissions(account_id, admission_date);
CREATE INDEX IF NOT EXISTS idx_admissions_account_course
  ON admissions(account_id, course_id);
CREATE INDEX IF NOT EXISTS idx_admissions_account_batch
  ON admissions(account_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admissions_deal
  ON admissions(deal_id);
CREATE INDEX IF NOT EXISTS idx_admissions_contact
  ON admissions(contact_id);

ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admissions_select ON admissions;
CREATE POLICY admissions_select ON admissions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS admissions_insert ON admissions;
CREATE POLICY admissions_insert ON admissions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS admissions_update ON admissions;
CREATE POLICY admissions_update ON admissions FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS admissions_delete ON admissions;
CREATE POLICY admissions_delete ON admissions FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON admissions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- STUDENT_PROFILES
--
-- Minimal post-admission student information. Intentionally NOT
-- a full student ERP — no attendance, exams, LMS, parent portal,
-- fee ledger, marks, documents, or student authentication.
-- ============================================================
CREATE TABLE IF NOT EXISTS student_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  admission_id     UUID NOT NULL,
  contact_id       UUID NOT NULL,
  guardian_name    TEXT,
  guardian_phone   TEXT,
  education        TEXT,
  graduation_year  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_profiles_account_admission_unique
    UNIQUE (account_id, admission_id),
  CONSTRAINT student_profiles_guardian_name_length
    CHECK (guardian_name IS NULL OR char_length(guardian_name) <= 200),
  CONSTRAINT student_profiles_guardian_phone_length
    CHECK (guardian_phone IS NULL OR char_length(guardian_phone) <= 50),
  CONSTRAINT student_profiles_education_length
    CHECK (education IS NULL OR char_length(education) <= 200),
  CONSTRAINT student_profiles_graduation_year_check
    CHECK (graduation_year IS NULL OR graduation_year BETWEEN 1950 AND 2100),
  CONSTRAINT student_profiles_account_admission_fk
    FOREIGN KEY (account_id, admission_id)
    REFERENCES admissions(account_id, id) ON DELETE CASCADE,
  CONSTRAINT student_profiles_account_contact_fk
    FOREIGN KEY (account_id, contact_id)
    REFERENCES contacts(account_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_account
  ON student_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_admission
  ON student_profiles(admission_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_contact
  ON student_profiles(contact_id);

ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_profiles_select ON student_profiles;
CREATE POLICY student_profiles_select ON student_profiles FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS student_profiles_insert ON student_profiles;
CREATE POLICY student_profiles_insert ON student_profiles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS student_profiles_update ON student_profiles;
CREATE POLICY student_profiles_update ON student_profiles FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS student_profiles_delete ON student_profiles;
CREATE POLICY student_profiles_delete ON student_profiles FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON student_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();