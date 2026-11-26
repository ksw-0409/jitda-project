import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { getReadmeLocationPresentation } from "../../analysis-view-model.js";
import {
  buildAmbiguousTestReport,
  loadSampleReadme,
  loadSampleReports,
  postJson,
  startBugPinTestEnvironment,
  viewModelFromAnalysis,
} from "../helpers/test-servers.js";

let environment;
let reports;
let readme;
let analysis;

before(async () => {
  environment = await startBugPinTestEnvironment();
  reports = [...await loadSampleReports(), buildAmbiguousTestReport()];
  readme = await loadSampleReadme();
});

after(async () => {
  await environment?.close();
});

test("샘플 제보를 /api/analyze에 보내면 그룹과 원본 제보 연결이 화면 모델까지 유지된다", async () => {
  const { response, body } = await postJson(environment.app.url, "/api/analyze", { reports });
  analysis = body;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(Object.keys(body).sort(), ["bugs", "not_bugs", "unclear"]);
  assert.equal(body.bugs.length, 5);
  assert.equal(body.not_bugs.length, 3);
  assert.deepEqual(body.unclear, ["RTEST-UNCLEAR"]);
  assert.ok(body.bugs.every((bug) => bug.title && bug.symptom && bug.report_ids.length > 0));

  const view = viewModelFromAnalysis(body, reports);
  const originalById = new Map(reports.map((report) => [report.report_id, report]));
  for (const bug of view.bugs) {
    assert.equal(bug.report_ids.length, new Set(bug.report_ids).size);
    assert.ok(bug.report_ids.every((id) => originalById.has(id)));
    assert.equal(typeof bug.title, "string");
    assert.equal(typeof bug.symptom, "string");
  }
  assert.deepEqual(view.not_bugs, ["R008", "R012", "R015"]);
  assert.deepEqual(view.unclear, ["RTEST-UNCLEAR"]);
  const allClassified = new Set([
    ...view.bugs.flatMap((bug) => bug.report_ids),
    ...view.not_bugs,
    ...view.unclear,
  ]);
  assert.equal(allClassified.size, reports.length);
  assert.ok(reports.every((report) => allClassified.has(report.report_id)));

  const providerRequests = environment.mock.requests.filter((request) => request.path === "/v1/chat/completions");
  assert.equal(providerRequests.at(-1).model, "jitda-chat");
  assert.equal(providerRequests.at(-1).authorization, "Bearer bugpin-test-only-key");
});

test("/api/locate 응답의 후보와 결과 없음 상태를 README 화면 표현까지 보존한다", async () => {
  const requestCount = environment.mock.requests.length;
  const { response, body } = await postJson(environment.app.url, "/api/locate", {
    bugs: analysis.bugs,
    readme,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.results.length, analysis.bugs.length);
  const first = body.results[0];
  assert.equal(first.bug_id, analysis.bugs[0].bug_id);
  assert.equal(first.suspects[0].script, "PlayerMovement.cs");
  assert.equal(first.suspects[0].function, "Update()");
  assert.match(first.suspects[0].reason, /이동/);
  const firstView = getReadmeLocationPresentation(first);
  assert.equal(firstView.status, "candidate");
  assert.equal(firstView.candidates[0].script, "PlayerMovement.cs");
  assert.equal(firstView.candidates[0].function, "Update()");
  assert.match(firstView.candidates[0].reason, /이동/);
  assert.equal(firstView.candidates[0].confidence, first.confidence);
  assert.equal("line_start" in firstView.candidates[0], false);
  assert.equal("line" in firstView.candidates[0], false);

  const noScriptResponse = await postJson(environment.app.url, "/api/locate", {
    bugs: [analysis.bugs[0]],
    readme: "# 개요\n기능 설명 문서입니다.",
  });
  assert.equal(noScriptResponse.response.status, 200);
  assert.deepEqual(noScriptResponse.body.results[0].suspects, []);
  const noScriptView = getReadmeLocationPresentation(noScriptResponse.body.results[0]);
  assert.equal(noScriptView.status, "unavailable");
  assert.match(noScriptView.note, /근거 확인 필요/);
  assert.doesNotMatch(noScriptView.note, /코드 누락/);
  assert.equal(environment.mock.requests.length, requestCount + 1);
});

test("요청 오류와 잘못된 LLM 응답은 HTTP 오류로 반환하고 두 번까지 재요청한다", async () => {
  const emptyReports = await postJson(environment.app.url, "/api/analyze", { reports: [] });
  assert.equal(emptyReports.response.status, 400);
  assert.match(emptyReports.body.error, /제보 CSV/);

  const emptyReadme = await postJson(environment.app.url, "/api/locate", {
    bugs: [analysis.bugs[0]],
    readme: "  ",
  });
  assert.equal(emptyReadme.response.status, 400);
  assert.match(emptyReadme.body.error, /README 파일이 비어/);

  environment.mock.setMode("invalid-json");
  let previousCallCount = environment.mock.requests.length;
  const malformedAnalysis = await postJson(environment.app.url, "/api/analyze", {
    reports: [{ report_id: "R-INVALID", reporter: "test", created_at: "2026-11-21", text: "분석 오류 시험" }],
  });
  assert.equal(malformedAnalysis.response.status, 502);
  assert.match(malformedAnalysis.body.error, /올바른 JSON 분석/);
  assert.equal(environment.mock.requests.length - previousCallCount, 3);

  previousCallCount = environment.mock.requests.length;
  const malformedLocation = await postJson(environment.app.url, "/api/locate", {
    bugs: [analysis.bugs[0]],
    readme,
  });
  assert.equal(malformedLocation.response.status, 502);
  assert.match(malformedLocation.body.error, /의심 위치 JSON/);
  assert.equal(environment.mock.requests.length - previousCallCount, 3);

  environment.mock.setMode("invalid-analysis-shape");
  previousCallCount = environment.mock.requests.length;
  const wrongShape = await postJson(environment.app.url, "/api/analyze", {
    reports: [{ report_id: "R-SHAPE", reporter: "test", created_at: "2026-11-21", text: "형식 오류 시험" }],
  });
  assert.equal(wrongShape.response.status, 502);
  assert.equal(environment.mock.requests.length - previousCallCount, 3);
  environment.mock.setMode("normal");
});

test("/api/locate-again에 버그 원문·README·제외 사유를 보내면 같은 후보를 걸러 다른 스크립트를 반환한다", async () => {
  const bug = analysis.bugs[0];
  const bugReports = reports.filter((report) => bug.report_ids.includes(report.report_id));
  const firstCandidate = { file: "PlayerMovement.cs", function: "Update()", source: "readme", round: 1 };
  const feedback = {
    file: firstCandidate.file,
    function: firstCandidate.function,
    reasons: ["이 함수는 관련 없음", "다른 스크립트일 것 같음"],
    free_text: "이동은 InputHandler에서 처리한다고 들었습니다.",
  };
  const { response, body } = await postJson(environment.app.url, "/api/locate-again", {
    bug,
    reports: bugReports,
    readme,
    seen_candidates: [firstCandidate],
    excluded: [{ ...firstCandidate, reasons: feedback.reasons, free_text: feedback.free_text }],
    feedback,
    round: 2,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.found, true);
  assert.ok(body.candidates.length >= 1 && body.candidates.length <= 3);
  assert.ok(body.candidates.every((candidate) => candidate.round === 2 && candidate.source === "readme"));
  assert.ok(body.candidates.every((candidate) => candidate.line === ""));
  assert.ok(body.candidates.every((candidate) => candidate.file !== firstCandidate.file));
  assert.ok(body.candidates.every((candidate) => candidate.why_different));

  const llmRequest = environment.mock.requests.at(-1);
  assert.equal(llmRequest.model, "jitda-chat");
  const userContent = llmRequest.messages.find((message) => message.role === "user").content;
  const prompt = JSON.parse(userContent);
  assert.deepEqual(prompt.bug.report_ids, bug.report_ids);
  assert.deepEqual(prompt.original_reports.map((report) => report.report_id), bugReports.map((report) => report.report_id));
  assert.equal(prompt.project_context.mode, "readme");
  assert.match(prompt.project_context.readme, /PlayerMovement\.cs/);
  assert.deepEqual(prompt.excluded_candidates_with_developer_reasons[0].reasons, feedback.reasons);
  assert.equal(prompt.excluded_candidates_with_developer_reasons[0].free_text, feedback.free_text);
  assert.deepEqual(prompt.current_feedback, feedback);
});

test("재탐색에서 후보 없음과 잘못된 피드백을 구분해 반환한다", async () => {
  const bug = analysis.bugs[0];
  const bugReports = reports.filter((report) => bug.report_ids.includes(report.report_id));
  const candidate = { file: "PlayerMovement.cs", function: "Update()" };
  const request = {
    bug,
    reports: bugReports,
    readme,
    seen_candidates: [candidate],
    excluded: [{ ...candidate, reasons: ["증상과 로직이 안 맞음"], free_text: "실제 입력은 별도 컴포넌트입니다." }],
    feedback: { ...candidate, reasons: ["증상과 로직이 안 맞음"], free_text: "실제 입력은 별도 컴포넌트입니다." },
    round: 2,
  };

  environment.mock.setMode("rerun-none");
  const noMatch = await postJson(environment.app.url, "/api/locate-again", request);
  assert.equal(noMatch.response.status, 200);
  assert.equal(noMatch.body.found, false);
  assert.deepEqual(noMatch.body.candidates, []);

  const invalidFeedback = await postJson(environment.app.url, "/api/locate-again", {
    ...request,
    feedback: { file: candidate.file, function: candidate.function, reasons: [], free_text: " " },
  });
  assert.equal(invalidFeedback.response.status, 400);
  assert.match(invalidFeedback.body.error, /빠른 선택 항목이나 다른 위치 힌트/);
  environment.mock.setMode("normal");
});
