export const fixPlanStorageKey = "bugpin.fix-plans.v1";
export const fixPlanAssigneeStorageKey = "bugpin.fix-plan-assignees.v1";

const validPriorities = new Set(["high", "medium", "low"]);
const validStatuses = new Set(["planned", "on_hold", "done"]);

export function toLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getQuickFixPlanDates(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (count) => {
    const date = new Date(today);
    date.setDate(date.getDate() + count);
    return toLocalIsoDate(date);
  };
  const daysUntilFriday = (5 - today.getDay() + 7) % 7;
  const daysUntilNextMonday = ((8 - today.getDay()) % 7) || 7;
  return {
    today: toLocalIsoDate(today),
    tomorrow: addDays(1),
    friday: addDays(daysUntilFriday),
    nextWeek: addDays(daysUntilNextMonday),
  };
}

export function validateFixPlanInput(input, today = toLocalIsoDate()) {
  const errors = { assignee: "", due_date: "" };
  const assignee = typeof input?.assignee === "string" ? input.assignee.trim() : "";
  const dueDate = typeof input?.due_date === "string" ? input.due_date.trim() : "";
  if (!assignee) errors.assignee = "담당자를 입력해 주세요.";
  if (!dueDate) errors.due_date = "마감일을 선택해 주세요.";
  else if (!isValidIsoDate(dueDate)) {
    errors.due_date = "올바른 날짜를 선택해 주세요.";
  } else if (dueDate < today) {
    errors.due_date = "오늘 이전 날짜는 선택할 수 없습니다.";
  }
  return errors;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function candidateLocationValue(candidates, key, fallbackKey = key) {
  return [...new Set(candidates.map((candidate) => candidate?.[key] || candidate?.[fallbackKey] || "").filter(Boolean))].join(" + ");
}

export function createFixPlan({ bug, candidates, assignee, due_date, priority = "medium", memo = "", previous = null, now = new Date() }) {
  if (!bug || typeof bug.bug_id !== "string" || typeof bug.title !== "string") {
    throw new TypeError("수정 계획에 버그 ID와 제목이 필요합니다.");
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("수정 계획에는 확정된 위치가 하나 이상 필요합니다.");
  }
  const errors = validateFixPlanInput({ assignee, due_date }, toLocalIsoDate(now));
  if (errors.assignee || errors.due_date) return { plan: null, errors };
  if (!validPriorities.has(priority)) throw new TypeError("우선순위는 high, medium, low 중 하나여야 합니다.");

  const location = {
    file: candidateLocationValue(candidates, "file", "script"),
    function: candidateLocationValue(candidates, "function"),
    lines: [...new Set(candidates.map((candidate) => {
      if (candidate?.line) return candidate.line;
      if (Number.isInteger(candidate?.line_start) && Number.isInteger(candidate?.line_end)) {
        return candidate.line_start === candidate.line_end
          ? `L${candidate.line_start}`
          : `L${candidate.line_start}-L${candidate.line_end}`;
      }
      return "";
    }).filter(Boolean))].join(" + "),
  };
  const nowIso = now.toISOString();
  const plan = {
    bug_id: bug.bug_id,
    bug_title: bug.title,
    location,
    assignee: assignee.trim(),
    due_date,
    priority,
    memo: typeof memo === "string" ? memo.trim() : "",
    status: "planned",
    created_at: previous?.created_at || nowIso,
    updated_at: nowIso,
  };
  return { plan, errors };
}

export function normalizeFixPlans(value) {
  if (!Array.isArray(value)) return [];
  const plans = [];
  const seenBugIds = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      typeof item.bug_id !== "string" || !item.bug_id.trim() || seenBugIds.has(item.bug_id) ||
      typeof item.bug_title !== "string" || !item.bug_title.trim() ||
      !item.location || typeof item.location.file !== "string" ||
      typeof item.location.function !== "string" || typeof item.location.lines !== "string" ||
      typeof item.assignee !== "string" || !item.assignee.trim() ||
      typeof item.due_date !== "string" || !isValidIsoDate(item.due_date) ||
      !validPriorities.has(item.priority) || typeof item.memo !== "string" ||
      !validStatuses.has(item.status) || typeof item.created_at !== "string" || typeof item.updated_at !== "string" ||
      Number.isNaN(Date.parse(item.created_at)) || Number.isNaN(Date.parse(item.updated_at))) continue;
    seenBugIds.add(item.bug_id);
    plans.push({
      bug_id: item.bug_id,
      bug_title: item.bug_title,
      location: { file: item.location.file, function: item.location.function, lines: item.location.lines },
      assignee: item.assignee,
      due_date: item.due_date,
      priority: item.priority,
      memo: item.memo,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
    });
  }
  return plans;
}

export function formatFixPlanDueDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "")) return "날짜 미정";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  return `${month}/${day}(${weekday})`;
}

export function getFixPlanDeadline(isoDate, today = toLocalIsoDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { days: null, label: "기한 확인 필요", kind: "overdue", dateLabel: formatFixPlanDueDate(isoDate) };
  }
  const dateParts = isoDate.split("-").map(Number);
  const todayParts = today.split("-").map(Number);
  const dueUtc = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]);
  const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const days = Math.round((dueUtc - todayUtc) / 86_400_000);
  if (days < 0) return { days, label: `기한 지남 · D+${Math.abs(days)}`, kind: "overdue", dateLabel: formatFixPlanDueDate(isoDate) };
  if (days === 0) return { days, label: "D-day", kind: "today", dateLabel: formatFixPlanDueDate(isoDate) };
  return { days, label: `D-${days}`, kind: days <= 2 ? "soon" : "upcoming", dateLabel: formatFixPlanDueDate(isoDate) };
}

export function getFixPlanExportRecords(plans) {
  return normalizeFixPlans(plans);
}
