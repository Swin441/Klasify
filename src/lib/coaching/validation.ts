// ============================================================
// Coaching catalog validation — pure, unit-testable, no I/O.
//
// Mirrors the field bounds and enums enforced at the database
// level by migration 041_coaching_catalog.sql, plus the rules
// that live only in the application layer (required names,
// date ordering, non-negative fee/capacity).
//
// Every validator returns `null` when the value is valid, or a
// human-readable error string. Composite validators return the
// first error encountered, matching the style used by
// `src/lib/follow-ups/validation.ts`.
// ============================================================

export const COURSE_MODES = ['offline', 'online', 'hybrid'] as const;
export type CourseMode = (typeof COURSE_MODES)[number];

export const COURSE_STATUSES = ['active', 'inactive'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const BATCH_STATUSES = ['active', 'inactive', 'full'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

// ------------------------------------------------------------
// Type guards
// ------------------------------------------------------------

export function isCourseMode(value: unknown): value is CourseMode {
  return (
    typeof value === 'string' &&
    (COURSE_MODES as readonly string[]).includes(value)
  );
}

export function isCourseStatus(value: unknown): value is CourseStatus {
  return (
    typeof value === 'string' &&
    (COURSE_STATUSES as readonly string[]).includes(value)
  );
}

export function isBatchStatus(value: unknown): value is BatchStatus {
  return (
    typeof value === 'string' &&
    (BATCH_STATUSES as readonly string[]).includes(value)
  );
}

// ------------------------------------------------------------
// Generic text helper — same semantics as follow-ups validateText.
// ------------------------------------------------------------

export function validateText(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | null {
  if (value == null || value === '') {
    return required ? `${field} is required` : null;
  }
  if (typeof value !== 'string') return `${field} must be text`;
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return `${field} is required`;
  if (trimmed.length > maxLength) {
    return `${field} must be ${maxLength} characters or fewer`;
  }
  return null;
}

// ------------------------------------------------------------
// Exam validators
// ------------------------------------------------------------

export function validateExamName(value: unknown): string | null {
  return validateText(value, 'name', 100, true);
}

export function validateExamCategory(value: unknown): string | null {
  return validateText(value, 'category', 100);
}

export function validateExamActive(value: unknown): string | null {
  if (typeof value !== 'boolean') return 'is_active must be a boolean';
  return null;
}

/** Composite exam validation — returns the first error, or null. */
export function validateExam(input: {
  name: unknown;
  category?: unknown;
  is_active?: unknown;
}): string | null {
  const nameError = validateExamName(input.name);
  if (nameError) return nameError;
  const categoryError = validateExamCategory(input.category);
  if (categoryError) return categoryError;
  if (input.is_active !== undefined) {
    const activeError = validateExamActive(input.is_active);
    if (activeError) return activeError;
  }
  return null;
}

// ------------------------------------------------------------
// Course validators
// ------------------------------------------------------------

const COURSE_NAME_MAX = 200;
const COURSE_DESCRIPTION_MAX = 5000;

export function validateCourseName(value: unknown): string | null {
  return validateText(value, 'name', COURSE_NAME_MAX, true);
}

export function validateCourseDescription(value: unknown): string | null {
  return validateText(value, 'description', COURSE_DESCRIPTION_MAX);
}

export function validateCourseFee(value: unknown): string | null {
  if (value == null) return 'fee is required';
  const fee = Number(value);
  if (typeof value !== 'number' || Number.isNaN(fee)) return 'fee must be a number';
  if (fee < 0) return 'fee must be zero or greater';
  return null;
}

export function validateDurationWeeks(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  const weeks = Number(value);
  if (typeof value !== 'number' || Number.isNaN(weeks)) {
    return 'duration_weeks must be a number';
  }
  if (!Number.isInteger(weeks) || weeks <= 0) {
    return 'duration_weeks must be a positive whole number';
  }
  return null;
}

export function validateCourseMode(value: unknown): string | null {
  if (!isCourseMode(value)) return 'mode must be offline, online, or hybrid';
  return null;
}

export function validateCourseStatus(value: unknown): string | null {
  if (!isCourseStatus(value)) return 'status must be active or inactive';
  return null;
}

/** Composite course validation — returns the first error, or null. */
export function validateCourse(input: {
  name: unknown;
  description?: unknown;
  duration_weeks?: unknown;
  fee?: unknown;
  mode?: unknown;
  status?: unknown;
}): string | null {
  const nameError = validateCourseName(input.name);
  if (nameError) return nameError;
  const descriptionError = validateCourseDescription(input.description);
  if (descriptionError) return descriptionError;
  const durationError = validateDurationWeeks(input.duration_weeks);
  if (durationError) return durationError;
  const feeError = validateCourseFee(input.fee);
  if (feeError) return feeError;
  const modeError = validateCourseMode(input.mode);
  if (modeError) return modeError;
  const statusError = validateCourseStatus(input.status);
  if (statusError) return statusError;
  return null;
}

// ------------------------------------------------------------
// Batch validators
// ------------------------------------------------------------

const BATCH_NAME_MAX = 200;
const CLASS_TIMING_MAX = 200;

export function validateBatchName(value: unknown): string | null {
  return validateText(value, 'name', BATCH_NAME_MAX, true);
}

export function validateClassTiming(value: unknown): string | null {
  return validateText(value, 'class_timing', CLASS_TIMING_MAX);
}

export function validateBatchCapacity(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  const capacity = Number(value);
  if (typeof value !== 'number' || Number.isNaN(capacity)) {
    return 'capacity must be a number';
  }
  if (!Number.isInteger(capacity) || capacity < 0) {
    return 'capacity must be a whole number of zero or greater';
  }
  return null;
}

export function validateBatchFee(value: unknown): string | null {
  if (value == null || value === '') return null; // optional
  const fee = Number(value);
  if (typeof value !== 'number' || Number.isNaN(fee)) return 'fee must be a number';
  if (fee < 0) return 'fee must be zero or greater';
  return null;
}

export function validateBatchMode(value: unknown): string | null {
  if (!isCourseMode(value)) return 'mode must be offline, online, or hybrid';
  return null;
}

export function validateBatchStatus(value: unknown): string | null {
  if (!isBatchStatus(value)) return 'status must be active, inactive, or full';
  return null;
}

export function validateBatchDates(
  startDate: unknown,
  endDate: unknown,
): string | null {
  // Optional fields — null/empty means "no constraint".
  if (startDate == null || startDate === '' || endDate == null || endDate === '') {
    return null;
  }
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    return 'start_date and end_date must be dates';
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'start_date and end_date must be valid dates';
  }
  if (end < start) return 'end_date must be on or after start_date';
  return null;
}

/** Composite batch validation — returns the first error, or null. */
export function validateBatch(input: {
  course_id?: unknown;
  name: unknown;
  start_date?: unknown;
  end_date?: unknown;
  class_timing?: unknown;
  mode?: unknown;
  capacity?: unknown;
  fee?: unknown;
  status?: unknown;
}): string | null {
  if (input.course_id == null || input.course_id === '') {
    return 'course_id is required';
  }
  const nameError = validateBatchName(input.name);
  if (nameError) return nameError;
  const datesError = validateBatchDates(input.start_date, input.end_date);
  if (datesError) return datesError;
  const timingError = validateClassTiming(input.class_timing);
  if (timingError) return timingError;
  const capacityError = validateBatchCapacity(input.capacity);
  if (capacityError) return capacityError;
  const feeError = validateBatchFee(input.fee);
  if (feeError) return feeError;
  const modeError = validateBatchMode(input.mode);
  if (modeError) return modeError;
  const statusError = validateBatchStatus(input.status);
  if (statusError) return statusError;
  return null;
}