import { describe, expect, it } from 'vitest'
import {
  isBatchStatus,
  isCourseMode,
  isCourseStatus,
  validateBatch,
  validateBatchCapacity,
  validateBatchDates,
  validateBatchFee,
  validateBatchMode,
  validateBatchName,
  validateBatchStatus,
  validateClassTiming,
  validateCourse,
  validateCourseDescription,
  validateCourseFee,
  validateCourseMode,
  validateCourseName,
  validateCourseStatus,
  validateDurationWeeks,
  validateExam,
  validateExamCategory,
  validateExamName,
} from './validation'

describe('coaching validation', () => {
  // ----------------------------------------------------------
  // Type guards
  // ----------------------------------------------------------

  it('recognises valid enum values and rejects unknown ones', () => {
    expect(isCourseMode('offline')).toBe(true)
    expect(isCourseMode('online')).toBe(true)
    expect(isCourseMode('hybrid')).toBe(true)
    expect(isCourseMode('remote')).toBe(false)

    expect(isCourseStatus('active')).toBe(true)
    expect(isCourseStatus('inactive')).toBe(true)
    expect(isCourseStatus('suspended')).toBe(false)

    expect(isBatchStatus('active')).toBe(true)
    expect(isBatchStatus('inactive')).toBe(true)
    expect(isBatchStatus('full')).toBe(true)
    expect(isBatchStatus('closed')).toBe(false)
  })

  // ----------------------------------------------------------
  // Exam
  // ----------------------------------------------------------

  it('accepts a valid exam', () => {
    expect(validateExam({ name: 'APSC', category: 'State PSC', is_active: true })).toBeNull()
  })

  it('accepts an exam with optional fields omitted', () => {
    expect(validateExam({ name: 'SSC CGL' })).toBeNull()
  })

  it('rejects an exam without a name', () => {
    expect(validateExam({ name: '' })).toBe('name is required')
    expect(validateExam({ name: '   ' })).toBe('name is required')
    expect(validateExam({ name: undefined })).toBe('name is required')
  })

  it('rejects an exam name that is too long', () => {
    expect(validateExamName('x'.repeat(101))).toBe('name must be 100 characters or fewer')
  })

  it('rejects an exam category that is too long', () => {
    expect(validateExamCategory('x'.repeat(101))).toBe('category must be 100 characters or fewer')
  })

  it('rejects a non-boolean is_active', () => {
    expect(validateExam({ name: 'APSC', is_active: 'yes' })).toBe('is_active must be a boolean')
  })

  // ----------------------------------------------------------
  // Course
  // ----------------------------------------------------------

  it('accepts a valid course', () => {
    expect(
      validateCourse({
        name: 'APSC Foundation 2026',
        description: 'Complete APSC preparation',
        duration_weeks: 24,
        fee: 15000,
        mode: 'offline',
        status: 'active',
      }),
    ).toBeNull()
  })

  it('accepts a course with only the required fields', () => {
    expect(validateCourse({ name: 'Banking Batch', fee: 0, mode: 'online', status: 'active' })).toBeNull()
  })

  it('rejects a course without a name', () => {
    expect(validateCourse({ name: '', fee: 0, mode: 'offline', status: 'active' })).toBe('name is required')
  })

  it('rejects an over-long course name', () => {
    expect(validateCourseName('x'.repeat(201))).toBe('name must be 200 characters or fewer')
  })

  it('rejects an over-long description', () => {
    expect(validateCourseDescription('x'.repeat(5001))).toBe('description must be 5000 characters or fewer')
  })

  it('rejects a negative course fee', () => {
    expect(validateCourseFee(-1)).toBe('fee must be zero or greater')
  })

  it('accepts a zero fee', () => {
    expect(validateCourseFee(0)).toBeNull()
  })

  it('accepts a positive fee', () => {
    expect(validateCourseFee(25000)).toBeNull()
  })

  it('rejects a missing fee', () => {
    expect(validateCourse({ name: 'Course', mode: 'offline', status: 'active' })).toBe('fee is required')
  })

  it('rejects a non-numeric fee', () => {
    expect(validateCourseFee('fifteen')).toBe('fee must be a number')
  })

  it('validates duration_weeks', () => {
    expect(validateDurationWeeks(null)).toBeNull()
    expect(validateDurationWeeks('')).toBeNull()
    expect(validateDurationWeeks(16)).toBeNull()
    expect(validateDurationWeeks(0)).toBe('duration_weeks must be a positive whole number')
    expect(validateDurationWeeks(-2)).toBe('duration_weeks must be a positive whole number')
    expect(validateDurationWeeks(2.5)).toBe('duration_weeks must be a positive whole number')
    expect(validateDurationWeeks('abc')).toBe('duration_weeks must be a number')
  })

  it('rejects an invalid course mode', () => {
    expect(validateCourseMode('remote')).toBe('mode must be offline, online, or hybrid')
  })

  it('rejects an invalid course status', () => {
    expect(validateCourseStatus('suspended')).toBe('status must be active or inactive')
  })

  it('rejects a composite course with a bad mode', () => {
    expect(
      validateCourse({ name: 'Course', fee: 100, mode: 'remote', status: 'active' }),
    ).toBe('mode must be offline, online, or hybrid')
  })

  // ----------------------------------------------------------
  // Batch
  // ----------------------------------------------------------

  it('accepts a valid batch', () => {
    expect(
      validateBatch({
        course_id: 'course-1',
        name: 'Morning Batch A',
        start_date: '2026-09-01',
        end_date: '2027-03-31',
        class_timing: '6:00 AM - 8:00 AM',
        mode: 'offline',
        capacity: 40,
        fee: 18000,
        status: 'active',
      }),
    ).toBeNull()
  })

  it('accepts a batch with only required fields', () => {
    expect(validateBatch({ course_id: 'course-1', name: 'Evening Batch', mode: 'online', status: 'active' })).toBeNull()
  })

  it('rejects a batch without a course', () => {
    expect(validateBatch({ name: 'Batch', mode: 'offline', status: 'active' })).toBe('course_id is required')
  })

  it('rejects a batch without a name', () => {
    expect(
      validateBatch({ course_id: 'course-1', name: '', mode: 'offline', status: 'active' }),
    ).toBe('name is required')
  })

  it('rejects an over-long batch name', () => {
    expect(validateBatchName('x'.repeat(201))).toBe('name must be 200 characters or fewer')
  })

  it('rejects an over-long class timing', () => {
    expect(validateClassTiming('x'.repeat(201))).toBe('class_timing must be 200 characters or fewer')
  })

  it('rejects a negative capacity', () => {
    expect(validateBatchCapacity(-1)).toBe('capacity must be a whole number of zero or greater')
  })

  it('accepts a zero capacity', () => {
    expect(validateBatchCapacity(0)).toBeNull()
  })

  it('rejects a fractional capacity', () => {
    expect(validateBatchCapacity(10.5)).toBe('capacity must be a whole number of zero or greater')
  })

  it('rejects a non-numeric capacity', () => {
    expect(validateBatchCapacity('forty')).toBe('capacity must be a number')
  })

  it('accepts a null capacity', () => {
    expect(validateBatchCapacity(null)).toBeNull()
  })

  it('rejects a negative batch fee', () => {
    expect(validateBatchFee(-1)).toBe('fee must be zero or greater')
  })

  it('accepts a null batch fee', () => {
    expect(validateBatchFee(null)).toBeNull()
  })

  it('rejects an invalid date range', () => {
    expect(validateBatchDates('2026-09-01', '2026-08-01')).toBe('end_date must be on or after start_date')
  })

  it('accepts an equal date range', () => {
    expect(validateBatchDates('2026-09-01', '2026-09-01')).toBeNull()
  })

  it('accepts a valid date range', () => {
    expect(validateBatchDates('2026-09-01', '2027-03-31')).toBeNull()
  })

  it('ignores date validation when either date is missing', () => {
    expect(validateBatchDates(null, '2026-09-01')).toBeNull()
    expect(validateBatchDates('2026-09-01', null)).toBeNull()
    expect(validateBatchDates(undefined, undefined)).toBeNull()
    expect(validateBatchDates('', '')).toBeNull()
  })

  it('rejects malformed dates', () => {
    expect(validateBatchDates('not-a-date', '2026-09-01')).toBe('start_date and end_date must be valid dates')
  })

  it('rejects an invalid batch mode', () => {
    expect(validateBatchMode('remote')).toBe('mode must be offline, online, or hybrid')
  })

  it('rejects an invalid batch status', () => {
    expect(validateBatchStatus('closed')).toBe('status must be active, inactive, or full')
  })

  it('rejects a composite batch with an invalid date range', () => {
    expect(
      validateBatch({
        course_id: 'course-1',
        name: 'Batch',
        start_date: '2026-09-01',
        end_date: '2026-08-01',
        mode: 'offline',
        status: 'active',
      }),
    ).toBe('end_date must be on or after start_date')
  })
})