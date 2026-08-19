-- ============================================================
-- 041_coaching_catalog.sql — Phase 2A coaching catalog
--
-- Adds the three catalog entities a coaching institute needs to
-- classify and package its admission opportunities:
--
--   exams    — competitive exams (APSC, SSC CGL, IBPS PO, …)
--   courses  — coaching programmes tied to an exam
--   batches  — concrete course instances (class timing, capacity)
--
-- Tenancy: every row is account-scoped via account_id and the
-- existing is_account_member() RLS helper (migration 017).
--
-- Cross-account integrity is enforced AT THE DATABASE LEVEL with
-- composite foreign keys:
--
--   courses(account_id, exam_id)  → exams(account_id, id)
--   batches(account_id, course_id) → courses(account_id, id)
--
-- A course can therefore never reference an exam from another
-- account, and a batch can never reference another account's
-- course, no matter what the client sends.
--
-- Idempotent — safe to run multiple times. Tables/indexes use
-- IF NOT EXISTS; policies are dropped before recreate (Postgres
-- has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- EXAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS exams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  category    TEXT CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 100),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exams_account_name_unique UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_exams_account ON exams(account_id);

-- FK-target unique key for the composite cross-account FK from
-- courses. `id` is already the PK; the (account_id, id) index is
-- required so courses can enforce "the exam must belong to the same
-- account as the course" at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_account_id ON exams(account_id, id);

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exams_select ON exams;
CREATE POLICY exams_select ON exams FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS exams_insert ON exams;
CREATE POLICY exams_insert ON exams FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS exams_update ON exams;
CREATE POLICY exams_update ON exams FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS exams_delete ON exams;
CREATE POLICY exams_delete ON exams FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON exams;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- COURSES
--
-- exam_id is nullable (a course may predate the exam catalog or
-- the exam may be deleted — ON DELETE SET NULL). The composite
-- FK (account_id, exam_id) → exams(account_id, id) guarantees a
-- non-null exam_id always belongs to the same account as the
-- course, while the plain column CHECK keeps the length bounds.
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exam_id         UUID,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
  duration_weeks  INTEGER CHECK (duration_weeks IS NULL OR duration_weeks > 0),
  fee             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  mode            TEXT NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline', 'online', 'hybrid')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courses_account_name_unique UNIQUE (account_id, name),
  CONSTRAINT courses_account_exam_fk FOREIGN KEY (account_id, exam_id)
    REFERENCES exams(account_id, id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_account ON courses(account_id);
CREATE INDEX IF NOT EXISTS idx_courses_exam ON courses(exam_id);

-- FK-target unique key for the composite cross-account FK from batches.
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_account_id ON courses(account_id, id);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courses_select ON courses;
CREATE POLICY courses_select ON courses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS courses_insert ON courses;
CREATE POLICY courses_insert ON courses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS courses_update ON courses;
CREATE POLICY courses_update ON courses FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS courses_delete ON courses;
CREATE POLICY courses_delete ON courses FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON courses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BATCHES
--
-- A batch belongs to exactly one course within its account. The
-- composite FK (account_id, course_id) → courses(account_id, id)
-- guarantees the referenced course is in the same account, and
-- cascades when the course is deleted (matching the spec's
-- course_id ON DELETE CASCADE).
-- ============================================================
CREATE TABLE IF NOT EXISTS batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  start_date     DATE,
  end_date       DATE,
  class_timing   TEXT CHECK (class_timing IS NULL OR char_length(class_timing) <= 200),
  mode           TEXT NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline', 'online', 'hybrid')),
  capacity       INTEGER,
  fee            NUMERIC(12,2),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'full')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT batches_account_course_name_unique UNIQUE (account_id, course_id, name),
  CONSTRAINT batches_capacity_non_negative CHECK (capacity IS NULL OR capacity >= 0),
  CONSTRAINT batches_fee_non_negative CHECK (fee IS NULL OR fee >= 0),
  CONSTRAINT batches_dates_order CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT batches_account_course_fk FOREIGN KEY (account_id, course_id)
    REFERENCES courses(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_batches_account ON batches(account_id);
CREATE INDEX IF NOT EXISTS idx_batches_course ON batches(course_id);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batches_select ON batches;
CREATE POLICY batches_select ON batches FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS batches_insert ON batches;
CREATE POLICY batches_insert ON batches FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS batches_update ON batches;
CREATE POLICY batches_update ON batches FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS batches_delete ON batches;
CREATE POLICY batches_delete ON batches FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON batches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();