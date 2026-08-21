// ============================================================
// Deal qualification validation — pure, unit-testable, no I/O.
//
// Validates the coaching qualification fields added to `deals`
// by migration 042_coaching_admissions.sql:
//
//   exam_id / course_id / batch_id  (UUID references)
//   lead_source                     (8-value enum)
//   education / location            (optional text)
//   graduation_year                 (1950–2100 integer)
//   preparation_level               (3-value enum)
//   budget                          (non-negative number, INR)
//   preferred_mode                  (offline | online | hybrid)
//   parent_involvement              (boolean)
//
// Every validator returns `null` when the value is valid, or a
// human-readable error string — same convention as
// `src/lib/coaching/validation.ts`. The database CHECK
// constraints and composite FKs from migration 042 remain the
// final integrity boundary; this layer gives friendly errors
// before a write is attempted and is shared by the API routes
// (server-side) and the DealForm (client-side pre-flight).
// ============================================================

import { isCourseMode, validateText } from '../coaching/validation'

// ------------------------------------------------------------
// Enums — must mirror migration 042's CHECK constraints exactly.
// ------------------------------------------------------------

export const LEAD_SOURCES = [
  'whatsapp',
  'walk_in',
  'phone',
  'referral',
  'website',
  'facebook',
  'instagram',
  'other',
] as const;
export type LeadSourceValue = (typeof LEAD_SOURCES)[number];

export const PREPARATION_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
export type PreparationLevelValue = (typeof PREPARATION_LEVELS)[number];

export function isLeadSource(value: unknown): value is LeadSourceValue {
  return (
    typeof value === 'string' &&
    (LEAD_SOURCES as readonly string[]).includes(value)
  );
}

export function isPreparationLevel(
  value: unknown,
): value is PreparationLevelValue {
  return (
    typeof value === 'string' &&
    (PREPARATION_LEVELS as readonly string[]).includes(value)
  );
}

// ------------------------------------------------------------
// Field bounds
// ------------------------------------------------------------

export const GRADUATION_YEAR_MIN = 1950;
export const GRADUATION_YEAR_MAX = 2100;

const EDUCATION_MAX = 200;
const LOCATION_MAX = 200;

// ------------------------------------------------------------
// UUID helper
// ------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True iff `value` is a string shaped like a UUID (any version). */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateOptionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null; // optional
  if (!isValidUuid(value)) return `${field} must be a valid UUID`;
  return null;
}

// ------------------------------------------------------------
// Individual field validators
// ------------------------------------------------------------

export function validateLeadSource(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  if (!isLeadSource(value)) {
    return 'lead_source must be one of: whatsapp, walk_in, phone, referral, website, facebook, instagram, other';
  }
  return null;
}

export function validatePreparationLevel(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  if (!isPreparationLevel(value)) {
    return 'preparation_level must be beginner, intermediate, or advanced';
  }
  return null;
}

export function validatePreferredMode(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  if (!isCourseMode(value)) {
    return 'preferred_mode must be offline, online, or hybrid';
  }
  return null;
}

export function validateGraduationYear(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  const year = Number(value);
  if (typeof value !== 'number' || Number.isNaN(year)) {
    return 'graduation_year must be a number';
  }
  if (!Number.isInteger(year)) {
    return 'graduation_year must be a whole number';
  }
  if (year < GRADUATION_YEAR_MIN || year > GRADUATION_YEAR_MAX) {
    return `graduation_year must be between ${GRADUATION_YEAR_MIN} and ${GRADUATION_YEAR_MAX}`;
  }
  return null;
}

export function validateBudget(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  const budget = Number(value);
  if (typeof value !== 'number' || Number.isNaN(budget)) {
    return 'budget must be a number';
  }
  if (budget < 0) return 'budget must be zero or greater';
  return null;
}

export function validateEducation(value: unknown): string | null {
  return validateText(value, 'education', EDUCATION_MAX);
}

export function validateLocation(value: unknown): string | null {
  return validateText(value, 'location', LOCATION_MAX);
}

export function validateParentInvolvement(value: unknown): string | null {
  if (value == null) return null; // optional — defaults to false
  if (typeof value !== 'boolean') {
    return 'parent_involvement must be a boolean';
  }
  return null;
}

// ------------------------------------------------------------
// Qualification input shape + normalisation
// ------------------------------------------------------------

/**
 * Raw qualification fields as they arrive from an API body or the
 * form. Everything is optional and typed loosely on purpose — the
 * validators narrow it before anything is persisted.
 */
export interface DealQualificationInput {
  exam_id?: unknown;
  course_id?: unknown;
  batch_id?: unknown;
  lead_source?: unknown;
  education?: unknown;
  graduation_year?: unknown;
  location?: unknown;
  preparation_level?: unknown;
  budget?: unknown;
  preferred_mode?: unknown;
  parent_involvement?: unknown;
}

export interface NormalizedDealQualification {
  exam_id: string | null;
  course_id: string | null;
  batch_id: string | null;
  lead_source: LeadSourceValue | null;
  education: string | null;
  graduation_year: number | null;
  location: string | null;
  preparation_level: PreparationLevelValue | null;
  budget: number | null;
  preferred_mode: 'offline' | 'online' | 'hybrid' | null;
  parent_involvement: boolean;
}

function emptyToNull(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerce raw qualification input into the exact shape the database
 * expects: empty strings become NULL, numbers are parsed, and
 * parent_involvement defaults to false (the column's DB default).
 */
export function normalizeDealQualification(
  input: DealQualificationInput,
): NormalizedDealQualification {
  const year = emptyToNull(input.graduation_year);
  const budget = emptyToNull(input.budget);
  return {
    exam_id: emptyToNull(input.exam_id),
    course_id: emptyToNull(input.course_id),
    batch_id: emptyToNull(input.batch_id),
    lead_source: emptyToNull(input.lead_source) as LeadSourceValue | null,
    education: emptyToNull(input.education),
    graduation_year: year == null ? null : Number(year),
    location: emptyToNull(input.location),
    preparation_level: emptyToNull(
      input.preparation_level,
    ) as PreparationLevelValue | null,
    budget: budget == null ? null : Number(budget),
    preferred_mode: emptyToNull(input.preferred_mode) as
      | 'offline'
      | 'online'
      | 'hybrid'
      | null,
    parent_involvement:
      typeof input.parent_involvement === 'boolean'
        ? input.parent_involvement
        : false,
  };
}

// ------------------------------------------------------------
// Composite qualification validation — first error wins.
// ------------------------------------------------------------

export function validateDealQualification(
  input: DealQualificationInput,
): string | null {
  const examError = validateOptionalUuid(input.exam_id, 'exam_id');
  if (examError) return examError;
  const courseError = validateOptionalUuid(input.course_id, 'course_id');
  if (courseError) return courseError;
  const batchError = validateOptionalUuid(input.batch_id, 'batch_id');
  if (batchError) return batchError;

  const leadSourceError = validateLeadSource(input.lead_source);
  if (leadSourceError) return leadSourceError;

  const educationError = validateEducation(input.education);
  if (educationError) return educationError;

  const yearError = validateGraduationYear(input.graduation_year);
  if (yearError) return yearError;

  const locationError = validateLocation(input.location);
  if (locationError) return locationError;

  const preparationError = validatePreparationLevel(input.preparation_level);
  if (preparationError) return preparationError;

  const budgetError = validateBudget(input.budget);
  if (budgetError) return budgetError;

  const modeError = validatePreferredMode(input.preferred_mode);
  if (modeError) return modeError;

  const parentError = validateParentInvolvement(input.parent_involvement);
  if (parentError) return parentError;

  return null;
}