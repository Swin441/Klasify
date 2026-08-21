import { describe, expect, it } from 'vitest'
import {
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  isLeadSource,
  isPreparationLevel,
  isValidUuid,
  normalizeDealQualification,
  validateBudget,
  validateDealQualification,
  validateGraduationYear,
  validateLeadSource,
  validatePreferredMode,
  validatePreparationLevel,
} from './validation'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

describe('deal qualification validation', () => {
  // ----------------------------------------------------------
  // 1. Valid qualification values accepted
  // ----------------------------------------------------------

  it('accepts a fully populated qualification payload', () => {
    expect(
      validateDealQualification({
        exam_id: UUID_A,
        course_id: UUID_B,
        batch_id: UUID_C,
        lead_source: 'whatsapp',
        education: 'Higher Secondary',
        graduation_year: 2024,
        location: 'Guwahati',
        preparation_level: 'beginner',
        budget: 50000,
        preferred_mode: 'offline',
        parent_involvement: true,
      }),
    ).toBeNull()
  })

  it('accepts every allowed enum value', () => {
    for (const source of [
      'whatsapp',
      'walk_in',
      'phone',
      'referral',
      'website',
      'facebook',
      'instagram',
      'other',
    ]) {
      expect(validateLeadSource(source)).toBeNull()
      expect(isLeadSource(source)).toBe(true)
    }
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      expect(validatePreparationLevel(level)).toBeNull()
      expect(isPreparationLevel(level)).toBe(true)
    }
    for (const mode of ['offline', 'online', 'hybrid']) {
      expect(validatePreferredMode(mode)).toBeNull()
    }
  })

  // ----------------------------------------------------------
  // 9. Nullable / optional fields accepted
  // ----------------------------------------------------------

  it('accepts an empty qualification payload (all fields optional)', () => {
    expect(validateDealQualification({})).toBeNull()
    expect(
      validateDealQualification({
        exam_id: null,
        course_id: '',
        batch_id: undefined,
        lead_source: null,
        education: '',
        graduation_year: null,
        location: '',
        preparation_level: '',
        budget: null,
        preferred_mode: '',
        parent_involvement: false,
      }),
    ).toBeNull()
  })

  it('normalises empty strings to null and defaults parent_involvement', () => {
    const normalized = normalizeDealQualification({
      exam_id: '',
      course_id: ' ',
      graduation_year: '',
      budget: '',
      parent_involvement: undefined,
    })
    expect(normalized.exam_id).toBeNull()
    expect(normalized.course_id).toBeNull()
    expect(normalized.graduation_year).toBeNull()
    expect(normalized.budget).toBeNull()
    expect(normalized.parent_involvement).toBe(false)
  })

  // ----------------------------------------------------------
  // 2. Invalid lead_source rejected
  // ----------------------------------------------------------

  it('rejects an invalid lead_source', () => {
    expect(validateLeadSource('cold_call')).toMatch(/lead_source must be/)
    expect(validateLeadSource('WHATSAPP')).toMatch(/lead_source must be/)
    expect(
      validateDealQualification({ lead_source: 'telegram' }),
    ).toMatch(/lead_source must be/)
  })

  // ----------------------------------------------------------
  // 3. Invalid preparation_level rejected
  // ----------------------------------------------------------

  it('rejects an invalid preparation_level', () => {
    expect(validatePreparationLevel('expert')).toMatch(
      /preparation_level must be/,
    )
    expect(
      validateDealQualification({ preparation_level: 'master' }),
    ).toMatch(/preparation_level must be/)
  })

  // ----------------------------------------------------------
  // 4. Invalid preferred_mode rejected
  // ----------------------------------------------------------

  it('rejects an invalid preferred_mode', () => {
    expect(validatePreferredMode('remote')).toMatch(/preferred_mode must be/)
    expect(
      validateDealQualification({ preferred_mode: 'in-person' }),
    ).toMatch(/preferred_mode must be/)
  })

  // ----------------------------------------------------------
  // 5/6. graduation_year bounds
  // ----------------------------------------------------------

  it('rejects a graduation_year below 1950', () => {
    expect(GRADUATION_YEAR_MIN).toBe(1950)
    expect(validateGraduationYear(1949)).toMatch(/between 1950 and 2100/)
    expect(validateDealQualification({ graduation_year: 1900 })).toMatch(
      /between 1950 and 2100/,
    )
  })

  it('rejects a graduation_year above 2100', () => {
    expect(GRADUATION_YEAR_MAX).toBe(2100)
    expect(validateGraduationYear(2101)).toMatch(/between 1950 and 2100/)
    expect(validateDealQualification({ graduation_year: 3000 })).toMatch(
      /between 1950 and 2100/,
    )
  })

  it('accepts boundary graduation years and rejects non-integers', () => {
    expect(validateGraduationYear(1950)).toBeNull()
    expect(validateGraduationYear(2100)).toBeNull()
    expect(validateGraduationYear(2024.5)).toMatch(/whole number/)
    expect(validateGraduationYear('twenty')).toMatch(/must be a number/)
  })

  // ----------------------------------------------------------
  // 7. Negative budget rejected
  // ----------------------------------------------------------

  it('rejects a negative budget', () => {
    expect(validateBudget(-1)).toMatch(/zero or greater/)
    expect(validateBudget(-0.01)).toMatch(/zero or greater/)
    expect(validateDealQualification({ budget: -500 })).toMatch(
      /zero or greater/,
    )
  })

  it('accepts zero and positive budgets', () => {
    expect(validateBudget(0)).toBeNull()
    expect(validateBudget(150000.5)).toBeNull()
  })

  // ----------------------------------------------------------
  // 8. Invalid UUID rejected
  // ----------------------------------------------------------

  it('rejects malformed UUIDs on the reference fields', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid(UUID_A)).toBe(true)
    expect(validateDealQualification({ exam_id: 'abc' })).toMatch(
      /exam_id must be a valid UUID/,
    )
    expect(validateDealQualification({ course_id: '12345' })).toMatch(
      /course_id must be a valid UUID/,
    )
    expect(validateDealQualification({ batch_id: 'xyz' })).toMatch(
      /batch_id must be a valid UUID/,
    )
  })

  // ----------------------------------------------------------
  // 10/11. Dependent reference consistency is enforced by the
  // service layer (src/lib/deals/service.ts assertReferences):
  //
  //   - course must belong to the selected exam
  //     ("Course does not belong to the selected exam")
  //   - batch must belong to the selected course
  //     ("Batch does not belong to the selected course")
  //   - batch requires a course ("A batch requires a course")
  //
  // Those checks need database access, so they are covered by the
  // opt-in live RLS suite (admissions-rls.integration.test.ts) at
  // the database level via composite FKs; the pure validators here
  // guarantee shape/domain validity before that layer runs.
  // ----------------------------------------------------------

  it('documents that exam/course and course/batch consistency is validated server-side', () => {
    // Shape-level validation passes for individually-valid UUIDs;
    // cross-reference consistency is the service + composite-FK
    // responsibility.
    expect(
      validateDealQualification({ exam_id: UUID_B, course_id: UUID_C }),
    ).toBeNull()
  })
})