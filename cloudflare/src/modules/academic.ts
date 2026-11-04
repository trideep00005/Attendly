import type { Env, AttendanceStatus, SemesterRow, AttendanceRow, UserRow } from "../types";
import { HttpError, dateInTimeZone, dateRange, dayOfWeek, isDate, json, readJson, csvCell, validateOrigin } from "../lib/http";
import type { AuthContext } from "./auth";
import { hasFeature } from "./subscriptions";

const STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "HOLIDAY", "OTHER"];
const rows = <T>(result: D1Result<T>): T[] => result.results || [];
const number = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

async function getSemester(env: Env, id: number, userId: number): Promise<SemesterRow | null> {
  return env.DB.prepare("SELECT * FROM semesters WHERE id=? AND user_id=?")
    .bind(id, userId).first<SemesterRow>();
}

async function getTimetable(env: Env, semesterId: number): Promise<{ weekday: number; class_count: number }[]> {
  const result = await env.DB.prepare("SELECT weekday,class_count FROM timetable WHERE semester_id=? ORDER BY weekday")
    .bind(semesterId).all<{ weekday: number; class_count: number }>();
  return rows(result);
}

/**
 * Resolves the student's preferred Free-plan working semester. If no valid
 * preference exists (first login, first semester, or the selected semester was
 * deleted), the most recently created semester is selected automatically.
 */
async function getFreeActiveSemesterId(env: Env, userId: number): Promise<number | null> {
  const preference = await env.DB.prepare(`SELECT p.free_active_semester_id
    FROM user_semester_preferences p
    JOIN semesters s ON s.id=p.free_active_semester_id AND s.user_id=p.user_id
    WHERE p.user_id=? LIMIT 1`)
    .bind(userId).first<{ free_active_semester_id: number }>();
  if (preference) return Number(preference.free_active_semester_id);

  const fallback = await env.DB.prepare(`SELECT id FROM semesters WHERE user_id=?
    ORDER BY created_at DESC,id DESC LIMIT 1`)
    .bind(userId).first<{ id: number }>();
  const activeId = fallback ? Number(fallback.id) : null;
  await env.DB.prepare(`INSERT INTO user_semester_preferences(user_id,free_active_semester_id)
    VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET
      free_active_semester_id=excluded.free_active_semester_id,updated_at=CURRENT_TIMESTAMP`)
    .bind(userId, activeId).run();
  return activeId;
}

async function isMultiSemesterAllowed(env: Env, userId: number, role: UserRow['role']): Promise<boolean> {
  return role !== 'STUDENT' || await hasFeature(env, userId, 'multipleSemesters');
}

async function canEditSemester(env: Env, userId: number, role: UserRow['role'], semesterId: number): Promise<boolean> {
  if (await isMultiSemesterAllowed(env, userId, role)) return true;
  return (await getFreeActiveSemesterId(env, userId)) === semesterId;
}

async function requireWritableSemester(env: Env, userId: number, role: UserRow['role'], semesterId: number): Promise<Response | null> {
  if (await canEditSemester(env, userId, role, semesterId)) return null;
  return json({
    error: 'This semester is read-only on your Free plan. You can continue viewing its history. Choose it as your Free working semester from the Semesters page, or upgrade to Pro to edit all semesters.',
    code: 'SEMESTER_READ_ONLY',
  }, 403);
}

function countForDate(schedule: Map<number, number>, date: string): number {
  return schedule.get(dayOfWeek(date)) || 0;
}

/**
 * Maximum additional countable absences that keep attendance at or above
 * the required percentage. Standard holidays and Other categories mapped to Holiday are not included in the countable attendance total.
 * Returns null until at least one countable class has been recorded.
 */
function calculateSafeAbsences(present: number, total: number, targetPercent: number, percentage: number): number | null {
  if (total <= 0) return null;
  if (percentage + 1e-9 < targetPercent) return 0;
  const target = targetPercent / 100;
  if (target <= 0) return null;
  return Math.max(0, Math.floor((present / target) - total + 1e-9));
}

async function ensureDefaultOtherCategory(env: Env, semester: SemesterRow): Promise<number> {
  const existing = await env.DB.prepare(`SELECT id FROM attendance_categories
    WHERE user_id=? AND semester_id=? AND is_system=1 AND is_active=1 ORDER BY id LIMIT 1`)
    .bind(semester.user_id, semester.id).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await env.DB.prepare(`INSERT INTO attendance_categories
    (user_id,semester_id,name,description,attendance_effect,is_system,is_active)
    VALUES(?,?,'Other','Default category for attendance circumstances not covered by the standard statuses.', 'EXCLUDE',1,1)`)
    .bind(semester.user_id, semester.id).run();
  return number(created.meta.last_row_id);
}

type AttendanceBucket = "PRESENT" | "ABSENT" | "HOLIDAY";

/**
 * A linked category is authoritative even if an older record's raw status is
 * PRESENT or ABSENT. Internally, the legacy database value EXCLUDE means
 * "Count as Holiday": it is excluded from both the numerator and denominator.
 */
function effectiveAttendanceBucket(item: { status: string; category_id?: number | null; attendance_effect?: string | null }): AttendanceBucket {
  if (item.status === "HOLIDAY") return "HOLIDAY";
  if (item.category_id !== null && item.category_id !== undefined) {
    if (item.attendance_effect === "PRESENT") return "PRESENT";
    if (item.attendance_effect === "ABSENT") return "ABSENT";
    return "HOLIDAY";
  }
  if (item.status === "PRESENT") return "PRESENT";
  if (item.status === "ABSENT") return "ABSENT";
  if (item.status === "OTHER" || item.status === "MASS_BUNK") {
    if (item.attendance_effect === "PRESENT") return "PRESENT";
    if (item.attendance_effect === "ABSENT") return "ABSENT";
    return "HOLIDAY";
  }
  return "HOLIDAY";
}

async function calculateStats(env: Env, semester: SemesterRow) {
  const [attendanceResult, timetableResult] = await env.DB.batch([
    env.DB.prepare(`SELECT a.status,a.attendance_date,a.category_id,
        COALESCE(c.attendance_effect, CASE WHEN a.status='MASS_BUNK' AND s.mass_bunk_policy='ABSENT' THEN 'ABSENT' ELSE 'EXCLUDE' END) AS attendance_effect
      FROM attendance a JOIN semesters s ON s.id=a.semester_id
      LEFT JOIN attendance_categories c ON c.id=a.category_id
      WHERE a.semester_id=?`).bind(semester.id),
    env.DB.prepare("SELECT weekday,class_count FROM timetable WHERE semester_id=? ORDER BY weekday").bind(semester.id),
  ]);
  const allAttendance = rows(attendanceResult as D1Result<{ status: string; attendance_date: string; category_id: number | null; attendance_effect: string }>);
  const timetable = rows(timetableResult as D1Result<{ weekday: number; class_count: number }>);
  const schedule = new Map(timetable.map((item) => [item.weekday, item.class_count] as [number, number]));
  const today = dateInTimeZone(env.APP_TIME_ZONE || "Asia/Kolkata");
  const asOf = today < semester.end_date ? today : semester.end_date;
  const attendance = allAttendance.filter((item) => item.attendance_date >= semester.start_date && item.attendance_date <= asOf);

  let present = 0, absent = 0, missed = 0, holiday = 0, other = 0, excluded = 0, countable = 0;
  const dayMap = new Map<string, { present: number; holiday: number }>();
  for (const item of attendance) {
    const day = dayMap.get(item.attendance_date) || { present: 0, holiday: 0 };
    const bucket = effectiveAttendanceBucket(item);
    const isOtherEntry = item.status === "OTHER" || item.status === "MASS_BUNK" || item.category_id !== null;
    if (isOtherEntry) other++;
    if (bucket === "HOLIDAY") {
      holiday++;
      day.holiday++;
      if (isOtherEntry) excluded++;
    } else if (bucket === "PRESENT") { present++; countable++; day.present++; }
    else if (bucket === "ABSENT") { absent++; missed++; countable++; }
    dayMap.set(item.attendance_date, day);
  }

  const targetPercent = number(semester.target_percentage, 70);
  const target = targetPercent / 100;
  const percentage = countable ? present / countable * 100 : 0;
  const recoveryClasses = percentage >= targetPercent || countable === 0 ? 0 : target >= 1 ? null : Math.ceil(Math.max(0, (target * countable - present) / (1 - target)) - 1e-9);
  const safeAbsences = calculateSafeAbsences(present, countable, targetPercent, percentage);

  const remainingStart = today > semester.start_date ? today : semester.start_date;
  let futureScheduled = 0;
  for (const date of dateRange(remainingStart, semester.end_date)) futureScheduled += countForDate(schedule, date);
  const futureRows = allAttendance.filter((item) => item.attendance_date >= remainingStart && item.attendance_date <= semester.end_date);
  const futureRecorded = futureRows.length;
  let futurePresent = 0, futureAbsent = 0;
  for (const item of futureRows) {
    const bucket = effectiveAttendanceBucket(item);
    if (bucket === "PRESENT") futurePresent++;
    else if (bucket === "ABSENT") futureAbsent++;
  }
  const remaining = Math.max(0, futureScheduled - futureRecorded);
  const bestCase = (present + futurePresent + remaining) / Math.max(1, countable + futurePresent + futureAbsent + remaining) * 100;

  const yesterdayDate = new Date(`${today}T12:00:00.000Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const pastEnd = yesterday < semester.end_date ? yesterday : semester.end_date;
  let pastScheduled = 0;
  for (const date of dateRange(semester.start_date, pastEnd)) pastScheduled += countForDate(schedule, date);
  const pastRecorded = pastEnd >= semester.start_date
    ? allAttendance.filter((item) => item.attendance_date >= semester.start_date && item.attendance_date <= pastEnd).length
    : 0;
  const pendingPast = Math.max(0, pastScheduled - pastRecorded);
  const recordedDays = new Set(attendance.map((item) => item.attendance_date)).size;

  let collegeOpenDays = 0, presentDays = 0, scheduledHeldSlots = 0;
  for (const date of dateRange(semester.start_date, asOf)) {
    const scheduled = countForDate(schedule, date);
    if (!scheduled) continue;
    const day = dayMap.get(date);
    const holidaySlots = Math.min(scheduled, day?.holiday || 0);
    // A day whose every scheduled slot is marked Holiday is a full college closure.
    if (holidaySlots >= scheduled) continue;
    collegeOpenDays++;
    scheduledHeldSlots += scheduled - holidaySlots;
    if ((day?.present || 0) > 0) presentDays++;
  }
  // Other categories mapped to Holiday are already included in holidaySlots
  // and removed from totalClassesHeld. Pending therefore only subtracts the
  // countable Present/Absent records from the remaining held schedule.
  const pendingClasses = Math.max(0, scheduledHeldSlots - present - absent);
  // By definition, classes held/countable = Present + Absent (including any
  // Other category mapped to either bucket). Holiday-mapped entries are out.
  const totalClassesHeld = present + absent;

  return {
    present, absent, missed, holiday, other, excluded, pendingPast, pendingClasses,
    total: countable, totalClassesHeld,
    percentage: Number(percentage.toFixed(2)),
    target: targetPercent,
    recoveryClasses,
    safeAbsences,
    remainingScheduled: remaining,
    bestCase: Number(bestCase.toFixed(2)),
    recordedSlots: attendance.length,
    recordedDays,
    collegeOpenDays,
    presentDays,
  };
}

async function calculateSubjectStats(env: Env, semester: SemesterRow, includeRecovery: boolean, includePlanning: boolean) {
  const [subjectResult, attendanceResult, mappingResult] = await env.DB.batch([
    env.DB.prepare("SELECT id,semester_id,name,code,target_percentage FROM subjects WHERE semester_id=? ORDER BY name COLLATE NOCASE").bind(semester.id),
    env.DB.prepare(`SELECT a.subject_id,a.status,a.attendance_date,a.category_id,
        COALESCE(c.attendance_effect, CASE WHEN a.status='MASS_BUNK' AND s.mass_bunk_policy='ABSENT' THEN 'ABSENT' ELSE 'EXCLUDE' END) AS attendance_effect
      FROM attendance a JOIN semesters s ON s.id=a.semester_id
      LEFT JOIN attendance_categories c ON c.id=a.category_id
      WHERE a.semester_id=? AND a.subject_id IS NOT NULL`).bind(semester.id),
    env.DB.prepare("SELECT weekday,subject_id,COUNT(*) AS slots FROM timetable_subjects WHERE semester_id=? AND subject_id IS NOT NULL GROUP BY weekday,subject_id").bind(semester.id),
  ]);
  const subjects = rows(subjectResult as D1Result<{ id: number; semester_id: number; name: string; code: string | null; target_percentage: number | null }>);
  const attendanceBySubject = new Map<number, { status: string; attendance_date: string; category_id: number | null; attendance_effect: string }[]>();
  for (const item of rows(attendanceResult as D1Result<{ subject_id: number; status: string; attendance_date: string; category_id: number | null; attendance_effect: string }>)) {
    const list = attendanceBySubject.get(item.subject_id) || [];
    list.push(item);
    attendanceBySubject.set(item.subject_id, list);
  }
  const slotsBySubject = new Map<number, Map<number, number>>();
  for (const item of rows(mappingResult as D1Result<{ weekday: number; subject_id: number; slots: number }>)) {
    const map = slotsBySubject.get(item.subject_id) || new Map<number, number>();
    map.set(item.weekday, item.slots);
    slotsBySubject.set(item.subject_id, map);
  }
  const today = dateInTimeZone(env.APP_TIME_ZONE || "Asia/Kolkata");
  const asOf = today < semester.end_date ? today : semester.end_date;
  return subjects.map((subject) => {
    const allSubjectRows = attendanceBySubject.get(subject.id) || [];
    const subjectRows = allSubjectRows.filter((item) => item.attendance_date >= semester.start_date && item.attendance_date <= asOf);
    let present = 0, absent = 0, holiday = 0, other = 0, excluded = 0, total = 0;
    for (const item of subjectRows) {
      const bucket = effectiveAttendanceBucket(item);
      const isOtherEntry = item.status === "OTHER" || item.status === "MASS_BUNK" || item.category_id !== null;
      if (isOtherEntry) other++;
      if (bucket === "PRESENT") { present++; total++; }
      else if (bucket === "ABSENT") { absent++; total++; }
      else if (bucket === "HOLIDAY") { holiday++; if (isOtherEntry) excluded++; }
    }
    const targetPercentage = subject.target_percentage == null ? number(semester.target_percentage, 70) : number(subject.target_percentage);
    const target = targetPercentage / 100;
    const percentage = total ? present / total * 100 : 0;
    const recoveryClasses = percentage >= targetPercentage || total === 0 ? 0 : target >= 1 ? null : Math.ceil(Math.max(0, (target * total - present) / (1 - target)) - 1e-9);
    const safeAbsences = calculateSafeAbsences(present, total, targetPercentage, percentage);
    const schedule = slotsBySubject.get(subject.id) || new Map<number, number>();
    let remainingScheduled = 0;
    for (const date of dateRange(today > semester.start_date ? today : semester.start_date, semester.end_date)) {
      remainingScheduled += schedule.get(dayOfWeek(date)) || 0;
    }
    const firstRemainingDate = today > semester.start_date ? today : semester.start_date;
    const futureSubjectRows = allSubjectRows.filter((item) => item.attendance_date >= firstRemainingDate && item.attendance_date <= semester.end_date);
    let futurePresent = 0, futureAbsent = 0;
    for (const item of futureSubjectRows) {
      const bucket = effectiveAttendanceBucket(item);
      if (bucket === "PRESENT") futurePresent++;
      else if (bucket === "ABSENT") futureAbsent++;
    }
    remainingScheduled = Math.max(0, remainingScheduled - futureSubjectRows.length);
    const bestCase = (present + futurePresent + remainingScheduled) / Math.max(1, total + futurePresent + futureAbsent + remainingScheduled) * 100;
    return {
      ...subject, targetPercentage, present, absent, holiday, other, excluded, total,
      percentage: Number(percentage.toFixed(2)), recoveryClasses: includeRecovery ? recoveryClasses : null,
      safeAbsences: includeRecovery ? safeAbsences : null,
      remainingScheduled: includePlanning ? remainingScheduled : null,
      bestCase: includePlanning ? Number(bestCase.toFixed(2)) : null,
    };
  });
}

async function semesterWithStats(env: Env, semester: SemesterRow, userId: number) {
  const [stats, recoveryAllowed, planningAllowed, subjectAnalytics, customCategories, trendCharts] = await Promise.all([
    calculateStats(env, semester), hasFeature(env, userId, "recoveryCalculator"),
    hasFeature(env, userId, "attendancePlanning"), hasFeature(env, userId, "subjectAnalytics"),
    hasFeature(env, userId, "customCategories"), hasFeature(env, userId, "trendCharts"),
  ]);
  return {
    ...semester, ...stats,
    recoveryClasses: recoveryAllowed ? stats.recoveryClasses : null,
    safeAbsences: recoveryAllowed ? stats.safeAbsences : null,
    remainingScheduled: planningAllowed ? stats.remainingScheduled : null,
    bestCase: planningAllowed ? stats.bestCase : null,
    entitlements: { recoveryCalculator: recoveryAllowed, attendancePlanning: planningAllowed, subjectAnalytics, customCategories, trendCharts },
  };
}

export async function handleAcademic(request: Request, env: Env, auth: AuthContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const userId = auth.user.id;

  if (path === "/api/semesters/free-active" && method === "PUT") {
    const body = await readJson<{ semesterId?: unknown }>(request);
    const semesterId = Number(body.semesterId);
    if (!Number.isInteger(semesterId) || semesterId < 1) return json({ error: "Select a valid semester." }, 400);
    const selected = await getSemester(env, semesterId, userId);
    if (!selected) return json({ error: "Semester not found in your account." }, 404);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user_semester_preferences(user_id,free_active_semester_id)
        VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET
          free_active_semester_id=excluded.free_active_semester_id,updated_at=CURRENT_TIMESTAMP`)
        .bind(userId, semesterId),
      env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
        VALUES(?,'FREE_WORKING_SEMESTER_CHANGED','SEMESTER',?,'Student selected the semester to keep editable on the Free plan',?)`)
        .bind(userId, String(semesterId), JSON.stringify({ semesterName: selected.name })),
    ]);
    return json({ ok: true, freeActiveSemesterId: semesterId, message: `${selected.name} is now your Free working semester.` });
  }

  if (path === "/api/semesters" && method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM semesters WHERE user_id=? ORDER BY start_date DESC,created_at DESC,id DESC")
      .bind(userId).all<SemesterRow>();
    const semesterRows = rows(result);
    const [multiSemesterAllowed, freeActiveSemesterId] = await Promise.all([
      isMultiSemesterAllowed(env, userId, auth.user.role),
      getFreeActiveSemesterId(env, userId),
    ]);
    const semesterLimit = auth.user.role !== "STUDENT" ? null : (multiSemesterAllowed ? 3 : 1);
    const canCreateSemester = semesterLimit === null || semesterRows.length < semesterLimit;
    const enriched = await Promise.all(semesterRows.map(async (semester) => ({
      ...await semesterWithStats(env, semester, userId),
      canEdit: multiSemesterAllowed || semester.id === freeActiveSemesterId,
      isFreeActive: semester.id === freeActiveSemesterId,
      freeActiveSemesterId,
      accessMode: multiSemesterAllowed ? 'PRO' : 'FREE',
      canCreateSemester,
      semesterCount: semesterRows.length,
      semesterLimit,
    })));
    return json(enriched);
  }

  if (path === "/api/semesters" && method === "POST") {
    const multiSemesterAllowed = await isMultiSemesterAllowed(env, userId, auth.user.role);
    const semesterLimit = auth.user.role !== "STUDENT" ? 999999 : (multiSemesterAllowed ? 3 : 1);
    const body = await readJson<{ name?: unknown; startDate?: unknown; endDate?: unknown; targetPercentage?: unknown }>(request);
    const { name, startDate, endDate } = body;
    const targetPercentage = body.targetPercentage === undefined ? 70 : Number(body.targetPercentage);
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) return json({ error: "Enter a semester name (2–60 characters)." }, 400);
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) return json({ error: "Enter a valid semester date range." }, 400);
    if (!Number.isFinite(targetPercentage) || targetPercentage < 1 || targetPercentage > 100) return json({ error: "Target must be between 1 and 100." }, 400);
    // Enforce the plan cap in the INSERT statement itself so concurrent requests
    // cannot create a fourth Pro semester (or a second Free semester).
    const insert = await env.DB.prepare(`INSERT INTO semesters(user_id,name,start_date,end_date,target_percentage,mass_bunk_policy)
      SELECT ?,?,?,?,?,'EXCLUDE'
      WHERE (SELECT COUNT(*) FROM semesters WHERE user_id=?) < ?`)
      .bind(userId, name.trim(), startDate, endDate, targetPercentage, userId, semesterLimit).run();
    if (Number(insert.meta.changes || 0) !== 1) {
      return json({
        error: multiSemesterAllowed
          ? "Your Pro plan allows up to 3 semesters. Delete a previous semester and its associated data before creating another."
          : "The Free plan allows one semester. Your existing semesters remain available; upgrade to Pro for up to 3 semesters.",
        code: "SEMESTER_LIMIT_REACHED",
        semesterLimit: multiSemesterAllowed ? 3 : 1,
      }, 403);
    }
    const id = number(insert.meta.last_row_id);
    const statements = Array.from({ length: 7 }, (_, weekday) => env.DB.prepare("INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)")
      .bind(id, weekday, weekday === 0 || weekday === 6 ? 0 : 5));
    await env.DB.batch(statements);
    if (!multiSemesterAllowed) {
      await env.DB.prepare(`INSERT INTO user_semester_preferences(user_id,free_active_semester_id)
        VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET
          free_active_semester_id=CASE WHEN user_semester_preferences.free_active_semester_id IS NULL
            THEN excluded.free_active_semester_id ELSE user_semester_preferences.free_active_semester_id END,
          updated_at=CURRENT_TIMESTAMP`).bind(userId, id).run();
    } else {
      // Preserve a Free workspace preference even while Pro is active, so the
      // student has a sensible editable semester if Pro later expires.
      await getFreeActiveSemesterId(env, userId);
    }
    await ensureDefaultOtherCategory(env, { id, user_id: userId, name: name.trim(), start_date: startDate, end_date: endDate, target_percentage: targetPercentage, mass_bunk_policy: "EXCLUDE", created_at: new Date().toISOString() });
    const semester = await getSemester(env, id, userId);
    return json(semester ? await semesterWithStats(env, semester, userId) : { id }, 201);
  }

  let match = path.match(/^\/api\/semesters\/(\d+)$/);
  if (match && method === "PATCH") {
    const id = Number(match[1]);
    const semester = await getSemester(env, id, userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    const writeDenied = await requireWritableSemester(env, userId, auth.user.role, id);
    if (writeDenied) return writeDenied;
    const body = await readJson<Record<string, unknown>>(request);
    const name = body.name ?? semester.name;
    const startDate = body.startDate ?? semester.start_date;
    const endDate = body.endDate ?? semester.end_date;
    const target = body.targetPercentage === undefined ? number(semester.target_percentage) : Number(body.targetPercentage);
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60 || !isDate(startDate) || !isDate(endDate) || startDate > endDate || !Number.isFinite(target) || target < 1 || target > 100) return json({ error: "Please check the semester details. Semester names must be 2–60 characters." }, 400);
    await env.DB.prepare("UPDATE semesters SET name=?,start_date=?,end_date=?,target_percentage=? WHERE id=? AND user_id=?")
      .bind(name.trim(), startDate, endDate, target, id, userId).run();
    const updated = await getSemester(env, id, userId);
    return json(updated ? await semesterWithStats(env, updated, userId) : { ok: true });
  }
  if (match && method === "DELETE") {
    const id = Number(match[1]);
    if (!(await getSemester(env, id, userId))) return json({ error: "Semester not found." }, 404);
    const writeDenied = await requireWritableSemester(env, userId, auth.user.role, id);
    if (writeDenied) return writeDenied;
    // A semester is a complete data container. Delete all personal academic records
    // explicitly in one atomic D1 batch, then delete the parent semester.
    await env.DB.batch([
      // Remove semester-scoped audit entries as well as operational records so
      // deleting a semester does not leave its name/category IDs in user history.
      env.DB.prepare(`DELETE FROM audit_logs
        WHERE (target_type='SEMESTER' AND target_id=?)
           OR (target_type='ATTENDANCE_CATEGORY' AND CAST(target_id AS INTEGER) IN
               (SELECT id FROM attendance_categories WHERE semester_id=?))`).bind(String(id), id),
      env.DB.prepare("DELETE FROM attendance WHERE semester_id=?").bind(id),
      env.DB.prepare("DELETE FROM timetable_subjects WHERE semester_id=?").bind(id),
      env.DB.prepare("DELETE FROM timetable WHERE semester_id=?").bind(id),
      env.DB.prepare("DELETE FROM attendance_categories WHERE semester_id=?").bind(id),
      env.DB.prepare("DELETE FROM subjects WHERE semester_id=?").bind(id),
      env.DB.prepare("DELETE FROM semesters WHERE id=? AND user_id=?").bind(id, userId),
    ]);
    return json({ ok: true, message: "Semester and all associated attendance, subjects, timetable and category records were permanently deleted." });
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/timetable$/);
  if (match) {
    const id = Number(match[1]);
    if (!(await getSemester(env, id, userId))) return json({ error: "Semester not found." }, 404);
    if (method === "GET") return json(await getTimetable(env, id));
    if (method === "PUT") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, id);
      if (writeDenied) return writeDenied;
      const body = await readJson<{ days?: { weekday: number; classCount: number }[] }>(request);
      const days = body.days;
      if (!Array.isArray(days) || days.length !== 7 || days.some((day) => !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || !Number.isInteger(day.classCount) || day.classCount < 0 || day.classCount > 5) || new Set(days.map((day) => day.weekday)).size !== 7) return json({ error: "Provide a class count from 0 to 5 for each weekday." }, 400);
      const statements = days.map((day) => env.DB.prepare(`INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)
        ON CONFLICT(semester_id,weekday) DO UPDATE SET class_count=excluded.class_count`).bind(id, day.weekday, day.classCount));
      await env.DB.batch(statements);
      return json(await getTimetable(env, id));
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/categories$/);
  if (match) {
    const semesterId = Number(match[1]);
    const semester = await getSemester(env, semesterId, userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    await ensureDefaultOtherCategory(env, semester);
    if (method === "GET") {
      const [result, canManageCustom] = await Promise.all([
        env.DB.prepare(`SELECT id,name,description,attendance_effect,is_system,is_active,created_at,updated_at
          FROM attendance_categories WHERE user_id=? AND semester_id=? AND is_active=1 ORDER BY is_system DESC,name COLLATE NOCASE`)
          .bind(userId, semesterId).all(),
        hasFeature(env, userId, "customCategories"),
      ]);
      return json({ categories: rows(result), canManageCustom });
    }
    if (method === "POST") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
      if (writeDenied) return writeDenied;
      if (!(await hasFeature(env, userId, "customCategories"))) return json({ error: "Custom attendance categories are included in the Pro plan. Upgrade to create your own categories." }, 403);
      const body = await readJson<{ name?: unknown; description?: unknown; attendanceEffect?: unknown }>(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const effect = body.attendanceEffect;
      if (name.length < 2 || name.length > 32) return json({ error: "Category name must be 2–32 characters." }, 400);
      if (description.length > 180) return json({ error: "Description must be 180 characters or fewer." }, 400);
      if (!["PRESENT", "ABSENT", "EXCLUDE"].includes(String(effect))) return json({ error: "Choose whether this category counts as Present, Absent or Holiday." }, 400);
      if (["present", "absent", "holiday", "other"].includes(name.toLowerCase())) return json({ error: "This name is reserved for a standard attendance status." }, 400);
      const duplicate = await env.DB.prepare(`SELECT id,is_active FROM attendance_categories WHERE user_id=? AND semester_id=? AND lower(name)=lower(?) LIMIT 1`)
        .bind(userId, semesterId, name).first<{ id: number; is_active: number }>();
      if (duplicate) return json({ error: duplicate.is_active ? "A category with this name already exists in this semester." : "This category name is archived and cannot be reused, so historical records keep their meaning." }, 409);
      try {
        const result = await env.DB.prepare(`INSERT INTO attendance_categories(user_id,semester_id,name,description,attendance_effect,is_system,is_active)
          VALUES(?,?,?,?,?,0,1)`).bind(userId, semesterId, name, description || null, effect).run();
        await env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
          VALUES(?,'ATTENDANCE_CATEGORY_CREATED','ATTENDANCE_CATEGORY',?,'Student created a custom attendance category',?)`)
          .bind(userId, String(result.meta.last_row_id), JSON.stringify({ semesterId, name, attendanceEffect: effect })).run();
        return json({ id: number(result.meta.last_row_id), name, description: description || null, attendance_effect: effect, is_system: 0, is_active: 1 }, 201);
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) return json({ error: "A category with this name already exists in this semester." }, 409);
        throw error;
      }
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/categories\/(\d+)$/);
  if (match) {
    const semesterId = Number(match[1]), categoryId = Number(match[2]);
    if (!(await getSemester(env, semesterId, userId))) return json({ error: "Semester not found." }, 404);
    const current = await env.DB.prepare(`SELECT * FROM attendance_categories
      WHERE id=? AND user_id=? AND semester_id=? AND is_active=1`).bind(categoryId, userId, semesterId).first<Record<string, unknown>>();
    if (!current) return json({ error: "Category not found." }, 404);
    if (method === "PATCH" || method === "DELETE") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
      if (writeDenied) return writeDenied;
    }
    if (method === "PATCH") {
      if (Number(current.is_system) === 1) return json({ error: "The default Other category is managed by Attendly and cannot be renamed or remapped." }, 400);
      if (!(await hasFeature(env, userId, "customCategories"))) return json({ error: "Editing custom categories is a Pro feature." }, 403);
      const body = await readJson<{ name?: unknown; description?: unknown; attendanceEffect?: unknown }>(request);
      const name = body.name === undefined ? String(current.name) : typeof body.name === "string" ? body.name.trim() : "";
      const description = body.description === undefined ? String(current.description || "") : typeof body.description === "string" ? body.description.trim() : "";
      const effect = body.attendanceEffect === undefined ? String(current.attendance_effect) : body.attendanceEffect;
      if (name.length < 2 || name.length > 32 || description.length > 180 || !["PRESENT", "ABSENT", "EXCLUDE"].includes(String(effect))) return json({ error: "Check the category name, description and attendance effect." }, 400);
      if (["present", "absent", "holiday", "other"].includes(name.toLowerCase())) return json({ error: "This name is reserved for a standard attendance status." }, 400);
      const duplicate = await env.DB.prepare(`SELECT id FROM attendance_categories WHERE user_id=? AND semester_id=? AND lower(name)=lower(?) AND id<>? LIMIT 1`)
        .bind(userId, semesterId, name, categoryId).first<{ id: number }>();
      if (duplicate) return json({ error: "Another category in this semester already uses that name." }, 409);
      try {
        await env.DB.prepare(`UPDATE attendance_categories SET name=?,description=?,attendance_effect=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND user_id=? AND semester_id=?`).bind(name, description || null, effect, categoryId, userId, semesterId).run();
        await env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
          VALUES(?,'ATTENDANCE_CATEGORY_UPDATED','ATTENDANCE_CATEGORY',?,'Student updated a custom attendance category',?)`)
          .bind(userId, String(categoryId), JSON.stringify({ semesterId, name, attendanceEffect: effect })).run();
        return json({ ok: true });
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) return json({ error: "A category with this name already exists in this semester." }, 409);
        throw error;
      }
    }
    if (method === "DELETE") {
      if (!(await hasFeature(env, userId, "customCategories"))) return json({ error: "Managing custom categories is a Pro feature." }, 403);
      if (Number(current.is_system) === 1) return json({ error: "The default Other category cannot be deleted." }, 400);
      await env.DB.prepare(`UPDATE attendance_categories SET is_active=0,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=? AND semester_id=?`).bind(categoryId, userId, semesterId).run();
      await env.DB.prepare(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,reason,metadata_json)
        VALUES(?,'ATTENDANCE_CATEGORY_ARCHIVED','ATTENDANCE_CATEGORY',?,'Student archived a custom attendance category',?)`)
        .bind(userId, String(categoryId), JSON.stringify({ semesterId, name: current.name })).run();
      return json({ ok: true, message: "Category archived. Existing attendance records keep their historical category." });
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/subjects$/);
  if (match) {
    const semesterId = Number(match[1]);
    const semester = await getSemester(env, semesterId, userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    if (method === "GET") {
      const [unassigned, recoveryAllowed, planningAllowed, subjectAnalytics] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM attendance WHERE semester_id=? AND subject_id IS NULL").bind(semesterId).first<{ n: number }>(),
        hasFeature(env, userId, "recoveryCalculator"), hasFeature(env, userId, "attendancePlanning"), hasFeature(env, userId, "subjectAnalytics"),
      ]);
      return json({ subjects: await calculateSubjectStats(env, semester, recoveryAllowed, planningAllowed), unassignedEntries: number(unassigned?.n), entitlements: { recoveryCalculator: recoveryAllowed, attendancePlanning: planningAllowed, subjectAnalytics } });
    }
    if (method === "POST") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
      if (writeDenied) return writeDenied;
      const body = await readJson<{ name?: unknown; code?: unknown; targetPercentage?: unknown }>(request);
      const name = body.name;
      const code = body.code === undefined ? "" : body.code;
      const target = body.targetPercentage === undefined ? null : body.targetPercentage;
      if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) return json({ error: "Subject name must be 2–80 characters." }, 400);
      if (typeof code !== "string" || code.trim().length > 20) return json({ error: "Subject code must be 20 characters or fewer." }, 400);
      if (target !== null && (!Number.isFinite(target) || Number(target) < 1 || Number(target) > 100)) return json({ error: "Subject target must be between 1 and 100, or left blank to use the semester target." }, 400);
      try {
        const result = await env.DB.prepare("INSERT INTO subjects(semester_id,name,code,target_percentage) VALUES(?,?,?,?)")
          .bind(semesterId, name.trim(), code.trim() || null, target).run();
        return json({ id: number(result.meta.last_row_id), name: name.trim(), code: code.trim() || null, target_percentage: target }, 201);
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) return json({ error: "A subject with that name already exists in this semester." }, 409);
        throw error;
      }
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/subjects\/(\d+)$/);
  if (match) {
    const semesterId = Number(match[1]), subjectId = Number(match[2]);
    if (!(await getSemester(env, semesterId, userId))) return json({ error: "Semester not found." }, 404);
    const current = await env.DB.prepare("SELECT * FROM subjects WHERE id=? AND semester_id=?").bind(subjectId, semesterId).first<Record<string, unknown>>();
    if (!current) return json({ error: "Subject not found." }, 404);
    if (method === "PATCH" || method === "DELETE") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
      if (writeDenied) return writeDenied;
    }
    if (method === "PATCH") {
      const body = await readJson<{ name?: unknown; code?: unknown; targetPercentage?: unknown }>(request);
      const name = body.name ?? current.name;
      const code = body.code ?? current.code ?? "";
      const target = body.targetPercentage === undefined ? current.target_percentage : body.targetPercentage;
      if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80 || typeof code !== "string" || code.trim().length > 20) return json({ error: "Please check the subject name and code." }, 400);
      if (target !== null && (!Number.isFinite(Number(target)) || Number(target) < 1 || Number(target) > 100)) return json({ error: "Subject target must be between 1 and 100, or blank to use the semester target." }, 400);
      try {
        await env.DB.prepare("UPDATE subjects SET name=?,code=?,target_percentage=? WHERE id=? AND semester_id=?")
          .bind(name.trim(), code.trim() || null, target, subjectId, semesterId).run();
        return json({ ok: true });
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) return json({ error: "A subject with that name already exists in this semester." }, 409);
        throw error;
      }
    }
    if (method === "DELETE") {
      // Protect the weekly routine: a subject cannot be physically deleted while
      // one or more timetable slots still refer to it. The student must reassign
      // those slots first; this avoids ON DELETE SET NULL silently clearing them.
      const assigned = await env.DB.prepare(`SELECT COUNT(*) AS count
        FROM timetable_subjects WHERE semester_id=? AND subject_id=?`)
        .bind(semesterId, subjectId).first<{ count: number }>();
      const assignedCount = number(assigned?.count);
      if (assignedCount > 0) {
        return json({
          error: `Cannot delete this subject because it is assigned to ${assignedCount} weekly class slot(s). Reassign those slots in your weekly routine first. Your routine has not been changed.`,
          code: "SUBJECT_IN_USE_BY_TIMETABLE",
          assignedSlots: assignedCount,
        }, 409);
      }
      await env.DB.prepare("DELETE FROM subjects WHERE id=? AND semester_id=?").bind(subjectId, semesterId).run();
      return json({ ok: true });
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/subject-timetable$/);
  if (match) {
    const semesterId = Number(match[1]);
    if (!(await getSemester(env, semesterId, userId))) return json({ error: "Semester not found." }, 404);
    if (method === "GET") {
      const result = await env.DB.prepare(`SELECT weekday,class_number,subject_id FROM timetable_subjects
        WHERE semester_id=? AND subject_id IS NOT NULL ORDER BY weekday,class_number`).bind(semesterId).all();
      return json(rows(result));
    }
    if (method === "PUT") {
      const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
      if (writeDenied) return writeDenied;
      const body = await readJson<{ slots?: { weekday: number; classNumber: number; subjectId: number | null }[] }>(request);
      const slots = body.slots;
      if (!Array.isArray(slots) || slots.length > 35) return json({ error: "Provide a valid weekly subject timetable." }, 400);
      const seen = new Set<string>();
      const timetable = await getTimetable(env, semesterId);
      const selectedSubjectIds = new Set<number>();
      for (const slot of slots) {
        if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !Number.isInteger(slot.classNumber) || slot.classNumber < 1 || slot.classNumber > 5) return json({ error: "Invalid weekday or class number in subject timetable." }, 400);
        const key = `${slot.weekday}-${slot.classNumber}`;
        if (seen.has(key)) return json({ error: "Duplicate timetable slot." }, 400);
        seen.add(key);
        const classCount = timetable.find((day) => day.weekday === slot.weekday)?.class_count ?? 0;
        if (slot.classNumber > classCount) return json({ error: "A subject is assigned to a class slot that is not scheduled." }, 400);
        if (slot.subjectId !== null && slot.subjectId !== undefined) selectedSubjectIds.add(Number(slot.subjectId));
      }
      if (selectedSubjectIds.size) {
        const ids = [...selectedSubjectIds];
        const placeholders = ids.map(() => "?").join(",");
        const validSubjects = await env.DB.prepare(`SELECT id FROM subjects WHERE semester_id=? AND id IN (${placeholders})`)
          .bind(semesterId, ...ids).all<{ id: number }>();
        if (rows(validSubjects).length !== ids.length) return json({ error: "One of the selected subjects does not belong to this semester." }, 400);
      }
      const statements = [env.DB.prepare("DELETE FROM timetable_subjects WHERE semester_id=?").bind(semesterId)];
      for (const slot of slots) if (slot.subjectId !== null && slot.subjectId !== undefined) {
        statements.push(env.DB.prepare("INSERT INTO timetable_subjects(semester_id,weekday,class_number,subject_id) VALUES(?,?,?,?)")
          .bind(semesterId, slot.weekday, slot.classNumber, Number(slot.subjectId)));
      }
      await env.DB.batch(statements);
      return json({ ok: true, count: slots.filter((slot) => slot.subjectId !== null && slot.subjectId !== undefined).length });
    }
  }

  match = path.match(/^\/api\/semesters\/(\d+)\/subjects\/apply-timetable$/);
  if (match && method === "POST") {
    const semesterId = Number(match[1]);
    if (!(await getSemester(env, semesterId, userId))) return json({ error: "Semester not found." }, 404);
    const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semesterId);
    if (writeDenied) return writeDenied;
    const result = await env.DB.prepare(`UPDATE attendance AS a SET subject_id=(
        SELECT ts.subject_id FROM timetable_subjects ts WHERE ts.semester_id=a.semester_id
          AND ts.weekday=CAST(strftime('%w',a.attendance_date) AS INTEGER) AND ts.class_number=a.class_number
      ) WHERE a.semester_id=? AND a.subject_id IS NULL AND EXISTS(
        SELECT 1 FROM timetable_subjects ts WHERE ts.semester_id=a.semester_id
          AND ts.weekday=CAST(strftime('%w',a.attendance_date) AS INTEGER) AND ts.class_number=a.class_number AND ts.subject_id IS NOT NULL
      )`).bind(semesterId).run();
    return json({ ok: true, updated: number(result.meta.changes) });
  }

  match = path.match(/^\/api\/calendar\/(\d+)$/);
  if (match && method === "GET") {
    const semester = await getSemester(env, Number(match[1]), userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    const month = url.searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "Month must use YYYY-MM format." }, 400);
    const year = Number(month.slice(0, 4)), monthNo = Number(month.slice(5, 7));
    if (monthNo < 1 || monthNo > 12) return json({ error: "Invalid month." }, 400);
    const last = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
    const timetable = await getTimetable(env, semester.id);
    const schedule = new Map(timetable.map((day) => [day.weekday, day.class_count] as [number, number]));
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(last).padStart(2, "0")}`;
    const [entryResult, mappedResult] = await env.DB.batch([
      env.DB.prepare(`SELECT a.attendance_date,a.class_number,a.status,a.category_id,c.name AS category_name,c.attendance_effect
        FROM attendance a LEFT JOIN attendance_categories c ON c.id=a.category_id
        WHERE a.semester_id=? AND a.attendance_date>=? AND a.attendance_date<=?`).bind(semester.id, monthStart, monthEnd),
      env.DB.prepare(`SELECT a.attendance_date AS mapped_date,NULL AS weekday,a.class_number,s.id,s.name,s.code,1 AS priority
        FROM attendance a JOIN subjects s ON s.id=a.subject_id
        WHERE a.semester_id=? AND a.attendance_date>=? AND a.attendance_date<=?
        UNION ALL
        SELECT NULL AS mapped_date,ts.weekday,ts.class_number,s.id,s.name,s.code,2 AS priority
        FROM timetable_subjects ts JOIN subjects s ON s.id=ts.subject_id WHERE ts.semester_id=?
        ORDER BY priority`).bind(semester.id, monthStart, monthEnd, semester.id),
    ]);
    const entryByDate = new Map<string, { class_number: number; status: AttendanceStatus; category_id: number | null; category_name: string | null; attendance_effect: string | null }[]>();
    for (const item of rows(entryResult as D1Result<{ attendance_date: string; class_number: number; status: AttendanceStatus; category_id: number | null; category_name: string | null; attendance_effect: string | null }>)) {
      const list = entryByDate.get(item.attendance_date) || [];
      list.push(item);
      entryByDate.set(item.attendance_date, list);
    }
    const subjectByWeekday = new Map<number, Record<number, { id: number; name: string; code: string | null }>>();
    const subjectByDate = new Map<string, Record<number, { id: number; name: string; code: string | null }>>();
    for (const item of rows(mappedResult as D1Result<{ mapped_date: string | null; weekday: number | null; class_number: number; id: number; name: string; code: string | null; priority: number }>)) {
      const container = item.mapped_date ? subjectByDate : subjectByWeekday;
      const key = item.mapped_date || String(item.weekday);
      const map = container === subjectByDate ? (subjectByDate.get(key) || {}) : (subjectByWeekday.get(Number(key)) || {});
      if (!map[item.class_number]) map[item.class_number] = { id: item.id, name: item.name, code: item.code };
      if (container === subjectByDate) subjectByDate.set(key, map);
      else subjectByWeekday.set(Number(key), map);
    }
    const days = [];
    for (let day = 1; day <= last; day++) {
      const date = `${year}-${String(monthNo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const inSemester = date >= semester.start_date && date <= semester.end_date;
      const classCount = inSemester ? countForDate(schedule, date) : 0;
      const entries: Record<number, AttendanceStatus> = {};
      const categoryIds: Record<number, number | null> = {};
      const categoryNames: Record<number, string | null> = {};
      const categoryEffects: Record<number, string | null> = {};
      const dayEntries = entryByDate.get(date) || [];
      for (const item of dayEntries) {
        entries[item.class_number] = item.category_id !== null ? "OTHER" : item.status;
        categoryIds[item.class_number] = item.category_id;
        categoryNames[item.class_number] = item.category_name;
        categoryEffects[item.class_number] = item.attendance_effect;
      }
      const subjectByClass = inSemester
        ? { ...(subjectByWeekday.get(dayOfWeek(date)) || {}), ...(subjectByDate.get(date) || {}) }
        : {};
      days.push({ date, inSemester, classCount, entries, categoryIds, categoryNames, categoryEffects, subjectByClass, recorded: dayEntries.length });
    }
    return json({ semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date }, month, days });
  }

  match = path.match(/^\/api\/attendance\/(\d+)\/(\d{4}-\d{2}-\d{2})$/);
  if (match && method === "PUT") {
    const semester = await getSemester(env, Number(match[1]), userId);
    const date = match[2];
    if (!semester) return json({ error: "Semester not found." }, 404);
    const writeDenied = await requireWritableSemester(env, userId, auth.user.role, semester.id);
    if (writeDenied) return writeDenied;
    if (!isDate(date) || date < semester.start_date || date > semester.end_date) return json({ error: "Date must fall within the selected semester." }, 400);
    const timetable = await getTimetable(env, semester.id);
    const classCount = countForDate(new Map(timetable.map((day) => [day.weekday, day.class_count] as [number, number])), date);
    if (classCount === 0) return json({ error: "No classes are scheduled for this weekday. Update the timetable in Settings if needed." }, 400);
    const body = await readJson<{ entries?: { classNumber: number; status: AttendanceStatus | null; categoryId?: number | null }[] }>(request);
    const entries = body.entries;
    if (!Array.isArray(entries) || entries.some((entry) => !Number.isInteger(entry.classNumber) || entry.classNumber < 1 || entry.classNumber > classCount || !(entry.status === null || STATUSES.includes(entry.status)) || (entry.status === "OTHER" && entry.categoryId !== undefined && entry.categoryId !== null && (!Number.isInteger(entry.categoryId) || entry.categoryId < 1)))) return json({ error: "Invalid class attendance data." }, 400);
    if (new Set(entries.map((entry) => entry.classNumber)).size !== entries.length) return json({ error: "Duplicate class numbers are not allowed." }, 400);
    const weekday = dayOfWeek(date);
    const fallbackCategoryId = await ensureDefaultOtherCategory(env, semester);
    const statements = [] as D1PreparedStatement[];
    for (const entry of entries) {
      if (entry.status === null) {
        statements.push(env.DB.prepare("DELETE FROM attendance WHERE semester_id=? AND attendance_date=? AND class_number=?").bind(semester.id, date, entry.classNumber));
        continue;
      }
      let categoryId: number | null = null;
      if (entry.status === "OTHER") {
        categoryId = entry.categoryId ?? fallbackCategoryId;
        const validCategory = await env.DB.prepare(`SELECT id FROM attendance_categories
          WHERE id=? AND user_id=? AND semester_id=? AND is_active=1`).bind(categoryId, userId, semester.id).first<{ id: number }>();
        if (!validCategory) return json({ error: "Select an active attendance category belonging to this semester." }, 400);
      }
      statements.push(env.DB.prepare(`INSERT INTO attendance(semester_id,attendance_date,class_number,status,subject_id,category_id,updated_at)
          VALUES(?,?,?,?,(SELECT subject_id FROM timetable_subjects WHERE semester_id=? AND weekday=? AND class_number=?),?,CURRENT_TIMESTAMP)
          ON CONFLICT(semester_id,attendance_date,class_number) DO UPDATE SET status=excluded.status,
            category_id=excluded.category_id,subject_id=COALESCE(excluded.subject_id,attendance.subject_id),updated_at=CURRENT_TIMESTAMP`)
        .bind(semester.id, date, entry.classNumber, entry.status, semester.id, weekday, entry.classNumber, categoryId));
    }
    if (statements.length) await env.DB.batch(statements);
    const saved = await env.DB.prepare(`SELECT a.class_number,a.status,a.category_id,c.name AS category_name
      FROM attendance a LEFT JOIN attendance_categories c ON c.id=a.category_id
      WHERE a.semester_id=? AND a.attendance_date=? ORDER BY a.class_number`)
      .bind(semester.id, date).all();
    const [stats, recoveryAllowed, planningAllowed] = await Promise.all([
      calculateStats(env, semester), hasFeature(env, userId, "recoveryCalculator"), hasFeature(env, userId, "attendancePlanning"),
    ]);
    return json({ date, entries: rows(saved), analytics: { ...stats, recoveryClasses: recoveryAllowed ? stats.recoveryClasses : null, safeAbsences: recoveryAllowed ? stats.safeAbsences : null, remainingScheduled: planningAllowed ? stats.remainingScheduled : null, bestCase: planningAllowed ? stats.bestCase : null } });
  }

  match = path.match(/^\/api\/analytics\/(\d+)$/);
  if (match && method === "GET") {
    const semester = await getSemester(env, Number(match[1]), userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    const [trendChartsEnabled, recoveryAllowed, planningAllowed, subjectAnalyticsEnabled, customCategoriesEnabled] = await Promise.all([
      hasFeature(env, userId, "trendCharts"), hasFeature(env, userId, "recoveryCalculator"),
      hasFeature(env, userId, "attendancePlanning"), hasFeature(env, userId, "subjectAnalytics"),
      hasFeature(env, userId, "customCategories"),
    ]);
    const [stats, monthlyResult, subjects, unassigned] = await Promise.all([
      calculateStats(env, semester),
      env.DB.prepare(`WITH classified AS (
        SELECT substr(a.attendance_date,1,7) AS month,
          CASE
            WHEN a.status='HOLIDAY' THEN 'HOLIDAY'
            WHEN a.category_id IS NOT NULL THEN CASE COALESCE(c.attendance_effect,'EXCLUDE')
              WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            WHEN a.status='PRESENT' THEN 'PRESENT'
            WHEN a.status='ABSENT' THEN 'ABSENT'
            WHEN a.status IN ('OTHER','MASS_BUNK') THEN CASE COALESCE(c.attendance_effect,CASE WHEN a.status='MASS_BUNK' AND s.mass_bunk_policy='ABSENT' THEN 'ABSENT' ELSE 'EXCLUDE' END)
              WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            ELSE 'HOLIDAY'
          END AS effect,
          CASE WHEN a.category_id IS NOT NULL OR a.status IN ('OTHER','MASS_BUNK') THEN 1 ELSE 0 END AS other_entry
        FROM attendance a JOIN semesters s ON s.id=a.semester_id
        LEFT JOIN attendance_categories c ON c.id=a.category_id
        WHERE a.semester_id=? AND a.attendance_date<=?
      )
      SELECT month,
        SUM(CASE WHEN effect='PRESENT' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN effect='ABSENT' THEN 1 ELSE 0 END) AS absent,
        SUM(other_entry) AS other,
        SUM(CASE WHEN other_entry=1 AND effect='HOLIDAY' THEN 1 ELSE 0 END) AS excluded,
        SUM(CASE WHEN effect='HOLIDAY' THEN 1 ELSE 0 END) AS holiday,
        SUM(CASE WHEN effect IN ('PRESENT','ABSENT') THEN 1 ELSE 0 END) AS total
      FROM classified GROUP BY month ORDER BY month`)
        .bind(semester.id, dateInTimeZone(env.APP_TIME_ZONE || "Asia/Kolkata")).all<Record<string, number | string>>(),
      calculateSubjectStats(env, semester, recoveryAllowed, planningAllowed),
      env.DB.prepare("SELECT COUNT(*) AS n FROM attendance WHERE semester_id=? AND subject_id IS NULL").bind(semester.id).first<{ n: number }>(),
    ]);
    const monthly = trendChartsEnabled
      ? rows(monthlyResult).map((item) => ({ ...item, percentage: number(item.total) ? Number((number(item.present) / number(item.total) * 100).toFixed(2)) : 0 }))
      : [];
    return json({
      semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date },
      stats: { ...stats, recoveryClasses: recoveryAllowed ? stats.recoveryClasses : null, safeAbsences: recoveryAllowed ? stats.safeAbsences : null, remainingScheduled: planningAllowed ? stats.remainingScheduled : null, bestCase: planningAllowed ? stats.bestCase : null },
      monthly,
      subjects: subjectAnalyticsEnabled ? subjects : subjects.map((subject: any) => ({ ...subject, recoveryClasses: null, safeAbsences: null, remainingScheduled: null, bestCase: null })),
      unassignedEntries: number(unassigned?.n),
      entitlements: { trendCharts: trendChartsEnabled, recoveryCalculator: recoveryAllowed, attendancePlanning: planningAllowed, subjectAnalytics: subjectAnalyticsEnabled, customCategories: customCategoriesEnabled },
    });
  }

  match = path.match(/^\/api\/reports\/(\d+)\.(csv|json)$/);
  if (match && method === "GET") {
    const semester = await getSemester(env, Number(match[1]), userId);
    if (!semester) return json({ error: "Semester not found." }, 404);
    if (!(await hasFeature(env, userId, "pdfCsvExport"))) return json({ error: "PDF and CSV exports are included in the Pro plan. Upgrade to export your records." }, 403);
    if (match[2] === "csv") {
      const result = await env.DB.prepare(`SELECT a.attendance_date,a.class_number,
          CASE WHEN a.category_id IS NOT NULL THEN 'OTHER' ELSE a.status END AS status,
          COALESCE(c.name,CASE a.status WHEN 'PRESENT' THEN 'Present' WHEN 'ABSENT' THEN 'Absent' WHEN 'HOLIDAY' THEN 'Holiday' ELSE 'Other' END) AS category,
          COALESCE(s.name,'Unassigned') AS subject,
          CASE
            WHEN a.status='HOLIDAY' THEN 'HOLIDAY'
            WHEN a.category_id IS NOT NULL THEN CASE COALESCE(c.attendance_effect,'EXCLUDE') WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            WHEN a.status='PRESENT' THEN 'PRESENT'
            WHEN a.status='ABSENT' THEN 'ABSENT'
            WHEN a.status IN ('OTHER','MASS_BUNK') THEN CASE COALESCE(c.attendance_effect,CASE WHEN a.status='MASS_BUNK' AND s0.mass_bunk_policy='ABSENT' THEN 'ABSENT' ELSE 'EXCLUDE' END) WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            ELSE 'HOLIDAY'
          END AS calculation
        FROM attendance a JOIN semesters s0 ON s0.id=a.semester_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN attendance_categories c ON c.id=a.category_id
        WHERE a.semester_id=? ORDER BY a.attendance_date,a.class_number`)
        .bind(semester.id).all<Record<string, unknown>>();
      const content = ["Date,Class,Subject,Status,Category,Calculation", ...rows(result).map((item) => [item.attendance_date, item.class_number, item.subject, item.status, item.category, item.calculation].map(csvCell).join(","))].join("\r\n");
      return new Response(`\uFEFF${content}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="attendance-${semester.id}.csv"`, "cache-control": "no-store" } });
    }
    const [recoveryAllowed, planningAllowed] = await Promise.all([
      hasFeature(env, userId, "recoveryCalculator"), hasFeature(env, userId, "attendancePlanning"),
    ]);
    const [entryResult, stats, subjects] = await Promise.all([
      env.DB.prepare(`SELECT a.attendance_date,a.class_number,a.status,a.subject_id,s.name AS subject_name,s.code AS subject_code,
          COALESCE(c.name,CASE a.status WHEN 'PRESENT' THEN 'Present' WHEN 'ABSENT' THEN 'Absent' WHEN 'HOLIDAY' THEN 'Holiday' ELSE 'Other' END) AS category_name,
          CASE
            WHEN a.status='HOLIDAY' THEN 'HOLIDAY'
            WHEN a.category_id IS NOT NULL THEN CASE COALESCE(c.attendance_effect,'EXCLUDE') WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            WHEN a.status='PRESENT' THEN 'PRESENT'
            WHEN a.status='ABSENT' THEN 'ABSENT'
            WHEN a.status IN ('OTHER','MASS_BUNK') THEN CASE COALESCE(c.attendance_effect,CASE WHEN a.status='MASS_BUNK' AND s0.mass_bunk_policy='ABSENT' THEN 'ABSENT' ELSE 'EXCLUDE' END) WHEN 'PRESENT' THEN 'PRESENT' WHEN 'ABSENT' THEN 'ABSENT' ELSE 'HOLIDAY' END
            ELSE 'HOLIDAY'
          END AS attendance_effect
        FROM attendance a JOIN semesters s0 ON s0.id=a.semester_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN attendance_categories c ON c.id=a.category_id
        WHERE a.semester_id=? ORDER BY a.attendance_date,a.class_number`)
        .bind(semester.id).all(),
      calculateStats(env, semester),
      calculateSubjectStats(env, semester, recoveryAllowed, planningAllowed),
    ]);
    return json({ semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date, targetPercentage: semester.target_percentage }, stats: { ...stats, recoveryClasses: recoveryAllowed ? stats.recoveryClasses : null, safeAbsences: recoveryAllowed ? stats.safeAbsences : null, remainingScheduled: planningAllowed ? stats.remainingScheduled : null, bestCase: planningAllowed ? stats.bestCase : null }, subjects, entries: rows(entryResult) });
  }

  if (path === "/api/backup" && method === "GET") {
    const [semesters, timetable, subjects, subjectTimetable, categories, attendance] = await Promise.all([
      env.DB.prepare("SELECT * FROM semesters WHERE user_id=? ORDER BY id").bind(userId).all(),
      env.DB.prepare("SELECT t.* FROM timetable t JOIN semesters s ON s.id=t.semester_id WHERE s.user_id=? ORDER BY t.id").bind(userId).all(),
      env.DB.prepare("SELECT sub.* FROM subjects sub JOIN semesters s ON s.id=sub.semester_id WHERE s.user_id=? ORDER BY sub.id").bind(userId).all(),
      env.DB.prepare("SELECT ts.* FROM timetable_subjects ts JOIN semesters s ON s.id=ts.semester_id WHERE s.user_id=? ORDER BY ts.id").bind(userId).all(),
      env.DB.prepare("SELECT c.* FROM attendance_categories c WHERE c.user_id=? ORDER BY c.id").bind(userId).all(),
      env.DB.prepare("SELECT a.* FROM attendance a JOIN semesters s ON s.id=a.semester_id WHERE s.user_id=? ORDER BY a.attendance_date,a.class_number").bind(userId).all(),
    ]);
    return json({ version: 3, exportedAt: new Date().toISOString(), semesters: rows(semesters), timetable: rows(timetable), subjects: rows(subjects), subjectTimetable: rows(subjectTimetable), categories: rows(categories), attendance: rows(attendance) }, 200, { "content-disposition": "attachment; filename=\"attendance-backup.json\"" });
  }

  if (path === "/api/backup/restore" && method === "POST") {
    const data = await readJson<Record<string, any>>(request);
    if (!data || ![1, 2, 3].includes(data.version) || !Array.isArray(data.semesters) || !Array.isArray(data.timetable) || !Array.isArray(data.attendance)) return json({ error: "This backup file is not supported." }, 400);
    if (data.semesters.length > 100 || data.attendance.length > 10000 || data.timetable.length > 700 || (data.subjects?.length ?? 0) > 3000 || (data.subjectTimetable?.length ?? 0) > 3500) return json({ error: "Backup exceeds safe import limits (maximum 10,000 attendance entries)." }, 400);
    const multiSemesterAllowed = await isMultiSemesterAllowed(env, userId, auth.user.role);
    if (!multiSemesterAllowed) {
      const existingCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM semesters WHERE user_id=?").bind(userId).first<{ total: number }>();
      if (Number(existingCount?.total || 0) > 1 || data.semesters.length > 1) {
        return json({ error: "Restoring a backup that replaces multiple semesters requires Pro. Your existing semesters remain safe and unchanged." }, 403);
      }
      if (Number(existingCount?.total || 0) === 1) {
        const activeId = await getFreeActiveSemesterId(env, userId);
        const existingActive = await env.DB.prepare("SELECT id FROM semesters WHERE id=? AND user_id=?").bind(activeId, userId).first<{ id: number }>();
        if (!existingActive) return json({ error: "Select your Free working semester before restoring a backup." }, 409);
      }
    }
    const statements: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM semesters WHERE user_id=?").bind(userId)];
    const semesterIdMap = new Map<number, number>();
    const subjectIdMap = new Map<number, number>();
    const categoryIdMap = new Map<number, number>();
    let generatedId = -(Date.now() * 1000);
    for (const semester of data.semesters) {
      if (!Number.isInteger(semester.id) || !semester.id || typeof semester.name !== "string" || !isDate(semester.start_date) || !isDate(semester.end_date) || semester.start_date > semester.end_date || !Number.isFinite(semester.target_percentage) || semester.target_percentage < 1 || semester.target_percentage > 100 || !["ABSENT", "EXCLUDE"].includes(semester.mass_bunk_policy)) return json({ error: "Invalid semester data in backup." }, 400);
      const newId = generatedId--;
      semesterIdMap.set(semester.id, newId);
      statements.push(env.DB.prepare(`INSERT INTO semesters(id,user_id,name,start_date,end_date,target_percentage,mass_bunk_policy,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(newId, userId, semester.name, semester.start_date, semester.end_date, semester.target_percentage, semester.mass_bunk_policy, semester.created_at ?? new Date().toISOString()));
    }
    for (const item of data.timetable) {
      const newSemesterId = semesterIdMap.get(item.semester_id);
      if (!newSemesterId || !Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6 || !Number.isInteger(item.class_count) || item.class_count < 0 || item.class_count > 5) return json({ error: "Invalid timetable data in backup." }, 400);
      statements.push(env.DB.prepare("INSERT INTO timetable(semester_id,weekday,class_count) VALUES(?,?,?)").bind(newSemesterId, item.weekday, item.class_count));
    }
    for (const item of data.subjects || []) {
      const newSemesterId = semesterIdMap.get(item.semester_id);
      if (!newSemesterId || typeof item.name !== "string" || item.name.trim().length < 2 || (item.target_percentage !== null && item.target_percentage !== undefined && (!Number.isFinite(item.target_percentage) || item.target_percentage < 1 || item.target_percentage > 100))) return json({ error: "Invalid subject data in backup." }, 400);
      const newId = generatedId--;
      subjectIdMap.set(item.id, newId);
      statements.push(env.DB.prepare("INSERT INTO subjects(id,semester_id,name,code,target_percentage,created_at) VALUES(?,?,?,?,?,?)")
        .bind(newId, newSemesterId, item.name, item.code ?? null, item.target_percentage ?? null, item.created_at ?? new Date().toISOString()));
    }
    for (const item of data.categories || []) {
      const newSemesterId = semesterIdMap.get(item.semester_id);
      if (!newSemesterId || typeof item.name !== "string" || !["PRESENT", "ABSENT", "EXCLUDE"].includes(item.attendance_effect)) return json({ error: "Invalid attendance category data in backup." }, 400);
      const newId = generatedId--;
      categoryIdMap.set(item.id, newId);
      statements.push(env.DB.prepare(`INSERT INTO attendance_categories(id,user_id,semester_id,name,description,attendance_effect,is_system,is_active,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(newId, userId, newSemesterId, item.name, item.description ?? null, item.attendance_effect, item.is_system ? 1 : 0, item.is_active === 0 ? 0 : 1, item.created_at ?? new Date().toISOString(), item.updated_at ?? new Date().toISOString()));
    }
    for (const item of data.subjectTimetable || []) {
      const newSemesterId = semesterIdMap.get(item.semester_id), newSubjectId = subjectIdMap.get(item.subject_id);
      if (!newSemesterId || !newSubjectId || !Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6 || !Number.isInteger(item.class_number) || item.class_number < 1 || item.class_number > 5) return json({ error: "Invalid subject timetable data in backup." }, 400);
      statements.push(env.DB.prepare("INSERT INTO timetable_subjects(semester_id,weekday,class_number,subject_id) VALUES(?,?,?,?)")
        .bind(newSemesterId, item.weekday, item.class_number, newSubjectId));
    }
    for (const item of data.attendance) {
      const newSemesterId = semesterIdMap.get(item.semester_id);
      const newSubjectId = item.subject_id == null ? null : (subjectIdMap.get(item.subject_id) ?? null);
      const newCategoryId = item.category_id == null ? null : (categoryIdMap.get(item.category_id) ?? null);
      const status = item.status === "MASS_BUNK" ? "OTHER" : item.status;
      if (!newSemesterId || !isDate(item.attendance_date) || !Number.isInteger(item.class_number) || item.class_number < 1 || item.class_number > 5 || !STATUSES.includes(status)) return json({ error: "Invalid attendance data in backup." }, 400);
      statements.push(env.DB.prepare(`INSERT INTO attendance(semester_id,attendance_date,class_number,status,subject_id,category_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(newSemesterId, item.attendance_date, item.class_number, status, newSubjectId, newCategoryId, item.created_at ?? new Date().toISOString(), item.updated_at ?? new Date().toISOString()));
    }
    try {
      // Include the Free-workspace preference in the same D1 batch as the
      // restore, so the replacement semesters and selected workspace commit
      // atomically rather than leaving a partially successful restore.
      const restoredActiveId = data.semesters.length ? semesterIdMap.get(data.semesters[0].id) ?? null : null;
      statements.push(env.DB.prepare(`INSERT INTO user_semester_preferences(user_id,free_active_semester_id)
        VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET
          free_active_semester_id=excluded.free_active_semester_id,updated_at=CURRENT_TIMESTAMP`)
        .bind(userId, restoredActiveId));
      await env.DB.batch(statements);
      return json({ ok: true, message: "Your backup was restored successfully." });
    } catch (error) {
      return json({ error: `Restore failed; no changes were committed. ${String(error).slice(0, 240)}` }, 400);
    }
  }

  return null;
}
