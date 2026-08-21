"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import {
  LEAD_SOURCES,
  PREPARATION_LEVELS,
  validateDealQualification,
} from "@/lib/deals/validation";
import type {
  Batch,
  Contact,
  Conversation,
  Course,
  Deal,
  DealStatus,
  Exam,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  CalendarClock,
  X,
  Trash2,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

// Shared styling for the native selects — matches the existing form.
const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const tq = useTranslations("Pipelines.qualification");
  const supabase = createClient();
  const { defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  // Lead qualification (migration 042 fields). All optional — a
  // counsellor can save a basic deal without touching these.
  const [examId, setExamId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [education, setEducation] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [location, setLocation] = useState("");
  const [preparationLevel, setPreparationLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [preferredMode, setPreferredMode] = useState("");
  const [parentInvolvement, setParentInvolvement] = useState(false);

  // Dependent catalog options: Exam → Course → Batch. Loaded through
  // the account-scoped catalog APIs (/api/exams, /api/courses?exam_id,
  // /api/batches?course_id).
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [examsError, setExamsError] = useState(false);
  const [coursesError, setCoursesError] = useState(false);
  const [batchesError, setBatchesError] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
      // Qualification hydration. "" means "no selection"; the
      // dependent course/batch lists load via the effects below.
      setExamId(deal.exam_id ?? "");
      setCourseId(deal.course_id ?? "");
      setBatchId(deal.batch_id ?? "");
      setLeadSource(deal.lead_source ?? "");
      setEducation(deal.education ?? "");
      setGraduationYear(
        deal.graduation_year == null ? "" : String(deal.graduation_year),
      );
      setLocation(deal.location ?? "");
      setPreparationLevel(deal.preparation_level ?? "");
      setBudget(deal.budget == null ? "" : String(deal.budget));
      setPreferredMode(deal.preferred_mode ?? "");
      setParentInvolvement(deal.parent_involvement ?? false);
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
      setExamId("");
      setCourseId("");
      setBatchId("");
      setLeadSource("");
      setEducation("");
      setGraduationYear("");
      setLocation("");
      setPreparationLevel("");
      setBudget("");
      setPreferredMode("");
      setParentInvolvement(false);
    }
  }, [open, deal, defaultStageId, stages, defaultCurrency]);

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Load the account's exams for the Academic Goal selector.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingExams(true);
      setExamsError(false);
      try {
        const resp = await fetch("/api/exams");
        if (!resp.ok) throw new Error("Failed to load exams");
        const data = await resp.json();
        if (!cancelled) setExams(data.exams ?? []);
      } catch {
        if (!cancelled) setExamsError(true);
      } finally {
        if (!cancelled) setLoadingExams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Courses depend on the selected exam. Changing the exam clears the
  // course and batch selections so an inconsistent combination can
  // never be submitted.
  useEffect(() => {
    if (!open || !examId) {
      setCourses([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingCourses(true);
      setCoursesError(false);
      try {
        const resp = await fetch(
          `/api/courses?exam_id=${encodeURIComponent(examId)}`,
        );
        if (!resp.ok) throw new Error("Failed to load courses");
        const data = await resp.json();
        if (!cancelled) setCourses(data.courses ?? []);
      } catch {
        if (!cancelled) setCoursesError(true);
      } finally {
        if (!cancelled) setLoadingCourses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, examId]);

  // Batches depend on the selected course.
  useEffect(() => {
    if (!open || !courseId) {
      setBatches([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingBatches(true);
      setBatchesError(false);
      try {
        const resp = await fetch(
          `/api/batches?course_id=${encodeURIComponent(courseId)}`,
        );
        if (!resp.ok) throw new Error("Failed to load batches");
        const data = await resp.json();
        if (!cancelled) setBatches(data.batches ?? []);
      } catch {
        if (!cancelled) setBatchesError(true);
      } finally {
        if (!cancelled) setLoadingBatches(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  // Dependent-selection handlers — cascading clears guarantee the
  // Exam → Course → Batch chain stays consistent in the UI. The
  // server re-validates the pairings before persisting.
  function handleExamChange(next: string) {
    setExamId(next);
    setCourseId("");
    setBatchId("");
    setCourses([]);
    setBatches([]);
  }

  function handleCourseChange(next: string) {
    setCourseId(next);
    setBatchId("");
    setBatches([]);
  }

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
      // Qualification — empty strings become NULL so clearing a
      // field on edit actually clears it in the database.
      exam_id: examId || null,
      course_id: courseId || null,
      batch_id: batchId || null,
      lead_source: leadSource || null,
      education: education.trim() || null,
      graduation_year: graduationYear === "" ? null : Number(graduationYear),
      location: location.trim() || null,
      preparation_level: preparationLevel || null,
      budget: budget === "" ? null : Number(budget),
      preferred_mode: preferredMode || null,
      parent_involvement: parentInvolvement,
    };

    // Client-side pre-flight using the shared validators — the API
    // re-validates everything server-side before persisting.
    const qualificationError = validateDealQualification(payload);
    if (qualificationError) {
      toast.error(qualificationError);
      return;
    }

    setSaving(true);

    try {
      const resp = await fetch(
        deal ? `/api/deals/${deal.id}` : "/api/deals",
        {
          method: deal ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        toast.error(
          body?.error ??
            (deal ? t("toastFailedSave") : t("toastFailedCreate")),
        );
        return;
      }
      toast.success(deal ? t("toastUpdated") : t("toastCreated"));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(deal ? t("toastFailedSave") : t("toastFailedCreate"));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  // When editing, the deal's saved course/batch may fall outside the
  // freshly filtered option list (e.g. the course was moved to another
  // exam after the deal was saved). Render it anyway so the detail view
  // always shows a human-readable name instead of a blank or a UUID.
  const showSavedCourse =
    !!deal?.course_id &&
    !!deal.course &&
    !courses.some((c) => c.id === deal.course_id);
  const showSavedBatch =
    !!deal?.batch_id &&
    !!deal.batch &&
    !batches.some((b) => b.id === deal.batch_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("value")}</Label>
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("currency")}</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("expectedCloseDate")}</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {/* --------------------------------------------------
                Lead Qualification (migration 042). Entirely optional:
                progressive qualification is supported — create a basic
                deal now, complete qualification later via Edit.
                -------------------------------------------------- */}
            <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {tq("title")}
              </p>

              {/* Academic Goal — dependent Exam → Course → Batch */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-foreground">
                  {tq("academicGoal")}
                </p>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{tq("exam")}</Label>
                  <select
                    value={examId}
                    onChange={(e) => handleExamChange(e.target.value)}
                    disabled={loadingExams}
                    className={SELECT_CLASS}
                  >
                    <option value="">
                      {loadingExams ? tq("loadingOptions") : tq("selectExam")}
                    </option>
                    {exams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  {examsError && (
                    <p className="text-xs text-red-400">{tq("loadFailed")}</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{tq("course")}</Label>
                  <select
                    value={courseId}
                    onChange={(e) => handleCourseChange(e.target.value)}
                    disabled={!examId || loadingCourses}
                    className={SELECT_CLASS}
                  >
                    <option value="">
                      {!examId
                        ? tq("selectExamFirst")
                        : loadingCourses
                          ? tq("loadingOptions")
                          : tq("selectCourse")}
                    </option>
                    {showSavedCourse && (
                      <option value={deal!.course_id!}>
                        {deal!.course!.name}
                      </option>
                    )}
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {coursesError ? (
                    <p className="text-xs text-red-400">{tq("loadFailed")}</p>
                  ) : examId && !loadingCourses && courses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {tq("noCourses")}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{tq("batch")}</Label>
                  <select
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                    disabled={!courseId || loadingBatches}
                    className={SELECT_CLASS}
                  >
                    <option value="">
                      {!courseId
                        ? tq("selectCourseFirst")
                        : loadingBatches
                          ? tq("loadingOptions")
                          : tq("selectBatch")}
                    </option>
                    {showSavedBatch && (
                      <option value={deal!.batch_id!}>
                        {deal!.batch!.name}
                      </option>
                    )}
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {batchesError ? (
                    <p className="text-xs text-red-400">{tq("loadFailed")}</p>
                  ) : courseId && !loadingBatches && batches.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {tq("noBatches")}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Buyer / student qualification */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {tq("leadSource")}
                  </Label>
                  <select
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">{tq("selectLeadSource")}</option>
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {tq(`leadSource_${s}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {tq("preparationLevel")}
                  </Label>
                  <select
                    value={preparationLevel}
                    onChange={(e) => setPreparationLevel(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">{tq("selectPreparationLevel")}</option>
                    {PREPARATION_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {tq(lvl)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {tq("preferredMode")}
                  </Label>
                  <select
                    value={preferredMode}
                    onChange={(e) => setPreferredMode(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">{tq("selectPreferredMode")}</option>
                    <option value="offline">{tq("offline")}</option>
                    <option value="online">{tq("online")}</option>
                    <option value="hybrid">{tq("hybrid")}</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {tq("graduationYear")}
                  </Label>
                  <Input
                    type="number"
                    min={1950}
                    max={2100}
                    step={1}
                    value={graduationYear}
                    onChange={(e) => setGraduationYear(e.target.value)}
                    placeholder="2024"
                    className="border-border bg-muted text-foreground"
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{tq("budget")}</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      ₹
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="0"
                      className="border-border bg-muted pl-6 text-foreground"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {tq("education")}
                  </Label>
                  <Input
                    value={education}
                    onChange={(e) => setEducation(e.target.value)}
                    className="border-border bg-muted text-foreground"
                  />
                </div>

                <div className="grid gap-2 sm:col-span-2">
                  <Label className="text-muted-foreground">
                    {tq("location")}
                  </Label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="deal-parent-involvement"
                  checked={parentInvolvement}
                  onCheckedChange={(checked) =>
                    setParentInvolvement(checked === true)
                  }
                />
                <Label
                  htmlFor="deal-parent-involvement"
                  className="cursor-pointer text-sm text-muted-foreground"
                >
                  {tq("parentInvolvement")}
                </Label>
              </div>
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("status")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t("markAsWon")}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        {t("markAsLost")}
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    {t("reopenDeal")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            {deal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-3 w-full border-primary/30 text-primary hover:bg-primary/10"
                render={<Link href={`/follow-ups/new?deal_id=${deal.id}`} />}
              >
                <CalendarClock className="mr-2 h-4 w-4" />
                Schedule follow-up
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}