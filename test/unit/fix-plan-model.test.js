import test from "node:test";
import assert from "node:assert/strict";
import {
  createFixPlan,
  formatFixPlanDueDate,
  getFixPlanDeadline,
  getQuickFixPlanDates,
  getFixPlanExportRecords,
  normalizeFixPlans,
  toLocalIsoDate,
  validateFixPlanInput,
} from "../../fix-plan-model.js";

const fixedToday = new Date(2026, 11, 2, 12, 0, 0);

test("새 계획은 요청한 고정 필드·중첩 위치·ISO 날짜로 생성된다", () => {
  const result = createFixPlan({
    bug: { bug_id: "BUG-1", title: "접촉 피해가 너무 큼" },
    candidates: [
      { file: "PlayerHealth.cs", function: "TakeDamage", line: "L20-L26" },
      { file: "PlayerHealth.cs", function: "OnCollisionStay2D", line: "L40-L45" },
    ],
    assignee: "  강승우  ",
    due_date: "2026-12-03",
    priority: "high",
    memo: "  피격 쿨타임 추가  ",
    now: fixedToday,
  });

  assert.deepEqual(Object.keys(result.plan), [
    "bug_id", "bug_title", "location", "assignee", "due_date", "priority", "memo", "status", "created_at", "updated_at",
  ]);
  assert.deepEqual(result.plan.location, {
    file: "PlayerHealth.cs",
    function: "TakeDamage + OnCollisionStay2D",
    lines: "L20-L26 + L40-L45",
  });
  assert.equal(result.plan.assignee, "강승우");
  assert.equal(result.plan.due_date, "2026-12-03");
  assert.equal(result.plan.priority, "high");
  assert.equal(result.plan.memo, "피격 쿨타임 추가");
  assert.equal(result.plan.status, "planned");
  assert.equal(result.plan.created_at, fixedToday.toISOString());
  assert.equal(result.plan.updated_at, fixedToday.toISOString());
});

test("README 후보로 만든 계획은 줄 번호를 만들지 않는다", () => {
  const { plan } = createFixPlan({
    bug: { bug_id: "BUG-2", title: "대각 이동 속도" },
    candidates: [{ script: "PlayerMovement.cs", function: "Move()" }],
    assignee: "tester",
    due_date: "2026-12-04",
    now: fixedToday,
  });
  assert.deepEqual(plan.location, { file: "PlayerMovement.cs", function: "Move()", lines: "" });
});

test("GitHub 확정 위치의 실제 줄 범위를 계획 location에 보존한다", () => {
  const { plan } = createFixPlan({
    bug: { bug_id: "BUG-GH", title: "접촉 피해" },
    candidates: [{ file: "PlayerHealth.cs", function: "TakeDamage", line_start: 20, line_end: 26 }],
    assignee: "dev",
    due_date: "2026-12-03",
    now: fixedToday,
  });
  assert.deepEqual(plan.location, {
    file: "PlayerHealth.cs",
    function: "TakeDamage",
    lines: "L20-L26",
  });
});

test("필수 담당자·마감일, 과거 날짜와 달력상 존재하지 않는 날짜를 거부한다", () => {
  assert.deepEqual(validateFixPlanInput({}, "2026-12-02"), {
    assignee: "담당자를 입력해 주세요.",
    due_date: "마감일을 선택해 주세요.",
  });
  assert.match(validateFixPlanInput({ assignee: "A", due_date: "2026-12-01" }, "2026-12-02").due_date, /오늘 이전/);
  assert.match(validateFixPlanInput({ assignee: "A", due_date: "2026-02-31" }, "2026-02-01").due_date, /올바른 날짜/);
  assert.match(validateFixPlanInput({ assignee: "A", due_date: "12/03/2026" }, "2026-12-02").due_date, /올바른 날짜/);
});

test("오늘·내일·이번 주 금요일·다음 주 빠른 날짜를 계산한다", () => {
  assert.deepEqual(getQuickFixPlanDates(fixedToday), {
    today: "2026-12-02",
    tomorrow: "2026-12-03",
    friday: "2026-12-04",
    nextWeek: "2026-12-07",
  });
  const friday = new Date(2026, 11, 4, 12, 0, 0);
  assert.equal(getQuickFixPlanDates(friday).friday, "2026-12-04");
});

test("마감일 표시가 3일·1~2일·당일·경과를 구분한다", () => {
  assert.deepEqual(getFixPlanDeadline("2026-12-05", "2026-12-02"), {
    days: 3, label: "D-3", kind: "upcoming", dateLabel: "12/5(토)",
  });
  assert.equal(getFixPlanDeadline("2026-12-03", "2026-12-02").kind, "soon");
  assert.equal(getFixPlanDeadline("2026-12-02", "2026-12-02").label, "D-day");
  assert.equal(getFixPlanDeadline("2026-12-01", "2026-12-02").label, "기한 지남 · D+1");
  assert.equal(formatFixPlanDueDate("2026-12-03"), "12/3(목)");
});

test("수정 계획 객체에는 세션 밖 Notion 페이지 참조나 저장 필드가 섞이지 않는다", () => {
  const { plan } = createFixPlan({
    bug: { bug_id: "BUG-SESSION", title: "세션 안에서만 유지" },
    candidates: [{ file: "PlayerHealth.cs", function: "TakeDamage", line: "L1-L2" }],
    assignee: "강승우",
    due_date: "2026-12-10",
    now: fixedToday,
  });
  assert.deepEqual(Object.keys(plan), ["bug_id", "bug_title", "location", "assignee", "due_date", "priority", "memo", "status", "created_at", "updated_at"]);
  assert.equal("notion_page_id" in plan, false);
});

test("담당자 자동완성 상태는 수정 계획 객체 바깥의 앱 세션에서만 다룬다", () => {
  assert.equal("assignee_suggestions" in createFixPlan({
    bug: { bug_id: "BUG-SESSION", title: "세션 계획" },
    candidates: [{ file: "PlayerHealth.cs", function: "TakeDamage", line: "L1-L2" }],
    assignee: "강승우",
    due_date: "2026-12-10",
    now: fixedToday,
  }).plan, false);
});

test("저장소에서 다시 읽은 계획과 JSON 내보내기는 지정 형식만 유지한다", () => {
  const { plan } = createFixPlan({
    bug: { bug_id: "BUG-3", title: "스킬 이펙트가 남음" },
    candidates: [{ file: "SkillEffect.cs", function: "Update()", line: "L8-L12" }],
    assignee: "민서",
    due_date: "2026-12-10",
    priority: "medium",
    memo: "효과 종료 처리",
    now: fixedToday,
  });
  const invalid = { ...plan, extra: "제거되어야 함" };
  const normalized = normalizeFixPlans([invalid, { ...plan, status: "unknown" }, plan]);
  assert.equal(normalized.length, 1);
  const exported = getFixPlanExportRecords(normalized);
  assert.deepEqual(Object.keys(exported[0]), Object.keys(plan));
  assert.equal("extra" in exported[0], false);
  assert.equal(exported[0].bug_id, "BUG-3");
  assert.equal(exported[0].status, "planned");
});

test("기존 계획을 수정해도 created_at은 유지하고 updated_at만 갱신한다", () => {
  const first = createFixPlan({
    bug: { bug_id: "BUG-4", title: "몬스터 추적" },
    candidates: [{ file: "MonsterChase.cs", function: "Update()" }],
    assignee: "민서",
    due_date: "2026-12-05",
    now: fixedToday,
  }).plan;
  const updatedAt = new Date(2026, 11, 3, 9, 0, 0);
  const second = createFixPlan({
    bug: { bug_id: "BUG-4", title: "몬스터 추적" },
    candidates: [{ file: "MonsterChase.cs", function: "Update()" }],
    assignee: "강승우",
    due_date: "2026-12-06",
    priority: "low",
    previous: { ...first, status: "on_hold" },
    now: updatedAt,
  }).plan;
  assert.equal(second.created_at, first.created_at);
  assert.equal(second.updated_at, updatedAt.toISOString());
  assert.equal(second.status, "planned");
  assert.equal(second.assignee, "강승우");
});
