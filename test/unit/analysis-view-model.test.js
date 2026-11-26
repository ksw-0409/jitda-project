import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getReadmeLocationPresentation,
  getSuspectStatusPresentation,
  normalizeAnalysisForView,
  parseCsvRecords,
  parseReports,
} from "../../analysis-view-model.js";

const reports = [
  { report_id: "R001", reporter: "tester01", created_at: "2026-11-20 14:02", text: "슬라임 잡았는데 회색으로 변하고 안 없어져요" },
  { report_id: "R002", reporter: "tester02", created_at: "2026-11-20 14:10", text: "대각선으로 가면 캐릭터가 더 빨라짐" },
  { report_id: "R003", reporter: "tester03", created_at: "2026-11-20 14:15", text: "몹 처치해도 시체가 계속 남아있음" },
  { report_id: "R004", reporter: "tester04", created_at: "2026-11-20 14:21", text: "좋은 게임이에요" },
  { report_id: "R005", reporter: "tester05", created_at: "2026-11-20 14:29", text: "가끔 이상해요" },
];

test("버그 제목·증상·제보 ID와 제보 건수를 화면용 결과에 유지한다", () => {
  const result = normalizeAnalysisForView({
    bugs: [
      { bug_id: "BUG-2", title: "작은 묶음", symptom: "한 건의 증상", report_ids: ["R003"] },
      { bug_id: "BUG-1", title: "큰 묶음", symptom: "두 건의 원래 증상", report_ids: ["R001", "R002"] },
    ],
    not_bugs: [],
    unclear: [],
  }, reports);

  assert.deepEqual(result.bugs.map((bug) => ({
    bug_id: bug.bug_id,
    title: bug.title,
    symptom: bug.symptom,
    report_ids: bug.report_ids,
    report_count: bug.report_ids.length,
  })), [
    { bug_id: "BUG-1", title: "큰 묶음", symptom: "두 건의 원래 증상", report_ids: ["R001", "R002"], report_count: 2 },
    { bug_id: "BUG-2", title: "작은 묶음", symptom: "한 건의 증상", report_ids: ["R003"], report_count: 1 },
  ]);
});

test("묶음 안 중복 제보 ID를 한 번만 세고 알 수 없는 ID를 제외한다", () => {
  const result = normalizeAnalysisForView({
    bugs: [{ bug_id: "BUG-1", title: "이동", symptom: "대각 이동", report_ids: ["R002", "R002", "MISSING", "R001"] }],
    not_bugs: ["R003", "R003", "MISSING"],
    unclear: ["R005", "R005", "MISSING"],
  }, reports);

  assert.deepEqual(result.bugs[0].report_ids, ["R002", "R001"]);
  assert.equal(result.bugs[0].report_ids.length, 2);
  assert.deepEqual(result.not_bugs, ["R003"]);
  assert.deepEqual(result.unclear, ["R005"]);
});

test("버그 아닌 의견은 버그 묶음과 분리해 원래 ID 순서로 유지한다", () => {
  const result = normalizeAnalysisForView({
    bugs: [{ bug_id: "BUG-1", title: "처치 후 잔류", symptom: "죽은 몬스터가 남음", report_ids: ["R001"] }],
    not_bugs: ["R004", "R004", "R002"],
    unclear: [],
  }, reports);

  assert.deepEqual(result.not_bugs, ["R004", "R002"]);
  assert.deepEqual(result.bugs[0].report_ids, ["R001"]);
});

test("확인 필요 제보를 의견이나 버그 묶음에 섞지 않는다", () => {
  const result = normalizeAnalysisForView({
    bugs: [{ bug_id: "BUG-1", title: "이동", symptom: "속도 증가", report_ids: ["R002"] }],
    not_bugs: ["R004"],
    unclear: ["R005", "R005", "R002", "MISSING"],
  }, reports);

  assert.deepEqual(result.unclear, ["R005"]);
  assert.deepEqual(result.not_bugs, ["R004"]);
});

test("모든 결과 배열이 비어 있으면 빈 화면용 결과를 반환한다", () => {
  assert.deepEqual(normalizeAnalysisForView({ bugs: [], not_bugs: [], unclear: [] }, reports), {
    bugs: [],
    not_bugs: [],
    unclear: [],
  });
});

test("실제 제보와 연결되지 않는 버그 묶음은 결과에서 제외한다", () => {
  const result = normalizeAnalysisForView({
    bugs: [{ bug_id: "BUG-X", title: "존재하지 않는 제보", symptom: "연결이 없습니다", report_ids: ["MISSING"] }],
    not_bugs: [],
    unclear: [],
  }, reports);

  assert.deepEqual(result.bugs, []);
});

test("누락된 분석 배열이나 제보 목록은 조용히 빈 화면으로 바꾸지 않고 거부한다", () => {
  assert.throws(() => normalizeAnalysisForView({ bugs: [], not_bugs: [] }, reports), /bugs, not_bugs, unclear/);
  assert.throws(() => normalizeAnalysisForView({ bugs: [], not_bugs: [], unclear: [] }, null), /제보 목록은 배열/);
});

test("의심 위치 상태가 미분석·후보 있음·위치 특정 불가로 구분된다", () => {
  assert.deepEqual(getSuspectStatusPresentation("unanalysed"), { label: "미분석", kind: "unanalysed" });
  assert.deepEqual(getSuspectStatusPresentation("candidate"), { label: "후보 있음", kind: "candidate" });
  assert.deepEqual(getSuspectStatusPresentation("unavailable"), { label: "위치 특정 불가", kind: "unavailable" });
  assert.equal(getSuspectStatusPresentation("unknown").label, "위치 특정 불가");
});

test("README 후보는 후보 상태와 설명만 제공하고 실제 코드 줄이나 확정 원인을 만들지 않는다", () => {
  const presentation = getReadmeLocationPresentation({
    suspects: [{
      script: "PlayerMovement.cs",
      function: "Update()",
      reason: "README에서 플레이어 이동을 담당한다고 설명합니다.",
    }],
    confidence: "높음",
  });

  assert.equal(presentation.status, "candidate");
  assert.equal(getSuspectStatusPresentation(presentation.status).label, "후보 있음");
  assert.equal(presentation.confidence, "README 분석 신뢰도: 높음");
  assert.deepEqual(presentation.candidates[0], {
    script: "PlayerMovement.cs",
    function: "Update()",
    reason: "README에서 플레이어 이동을 담당한다고 설명합니다.",
    label: "README 기반 의심 후보",
    reasonLabel: "의심 이유 (README 기능 설명 기반)",
  });
  assert.equal("line" in presentation.candidates[0], false);
  assert.equal("line_start" in presentation.candidates[0], false);
  assert.notEqual(presentation.status, "location_confirmed");
  assert.match(presentation.note, /실제 코드와 줄 번호의 근거가 아닙니다/);
  assert.match(presentation.note, /근거 확인 필요/);
});

test("README 후보가 없으면 위치 특정 불가로 보여 주며 코드 누락으로 단정하지 않는다", () => {
  const presentation = getReadmeLocationPresentation({ suspects: [], confidence: "낮음" });

  assert.equal(presentation.status, "unavailable");
  assert.equal(getSuspectStatusPresentation(presentation.status).label, "위치 특정 불가");
  assert.deepEqual(presentation.candidates, []);
  assert.match(presentation.note, /실제 코드와 줄 번호의 근거가 아닙니다/);
  assert.doesNotMatch(presentation.note, /코드 누락/);
});

test("임시 README 후보에는 실제 AI 분석이 아니라는 안내를 포함한다", () => {
  const presentation = getReadmeLocationPresentation({
    suspects: [{ script: "MonsterHealth.cs", function: "Die()", reason: "사망을 관리합니다." }],
  }, true);

  assert.equal(presentation.status, "candidate");
  assert.match(presentation.note, /실제 AI 분석이 아닙니다/);
  assert.equal("line_start" in presentation.candidates[0], false);
});

test("프로젝트 sample_reports.csv를 실제 UTF-8 CSV 파서로 20건 읽는다", async () => {
  const csv = await readFile(new URL("../../sample_reports.csv", import.meta.url), "utf8");
  const parsed = parseReports(csv);

  assert.equal(parsed.length, 20);
  assert.deepEqual(Object.keys(parsed[0]), ["report_id", "reporter", "created_at", "text"]);
  assert.equal(parsed[0].report_id, "R001");
  assert.match(parsed[5].text, /대각선 이동하면 속도가 확 빨라집니다/);
  assert.match(parsed[6].text, /\n/);
});

test("CSV 쉼표·줄바꿈·따옴표 이스케이프와 빈 줄을 처리한다", () => {
  const csv = "report_id,reporter,created_at,text\n\nR001,tester,now,\"첫 문장, 포함\n둘째 줄과 \"\"인용\"\"\"\n\n";
  const rows = parseReports(csv);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, '첫 문장, 포함\n둘째 줄과 "인용"');
  assert.deepEqual(parseCsvRecords("a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
});

test("빈 CSV·필수 열 누락·제보 행 누락을 구분한다", () => {
  assert.throws(() => parseReports("  \n"), { message: "empty-file" });
  assert.throws(() => parseReports("report_id,reporter,text\nR001,tester,문제"), /missing-columns:created_at/);
  assert.throws(() => parseReports("report_id,reporter,created_at,text\n"), { message: "no-reports" });
});

test("닫히지 않은 인용부호가 있는 CSV를 거부한다", () => {
  assert.throws(() => parseReports("report_id,reporter,created_at,text\nR001,tester,now,\"인용이 끝나지 않음"), { message: "unclosed-quote" });
});
