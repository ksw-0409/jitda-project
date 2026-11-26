import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { getReadmeLocationPresentation } from "../../analysis-view-model.js";
import {
  buildAmbiguousTestReport,
  loadSampleReadme,
  loadSampleReports,
  postJson,
  startBugPinServer,
  startBugPinTestEnvironment,
  startMockNotion,
  viewModelFromAnalysis,
} from "../helpers/test-servers.js";

let environment;
let reports;
let readme;
let analysis;
let notionMock;
let notionConfiguredApp;
let notionTokenOnlyApp;
let notionPlanTestApp;
let notionPlanRateApp;
let notionWriteFailApp;
let notionSchemaMismatchApp;
const notionTestToken = "notion-test-only-secret-value";
const notionTestPageId = "11111111-2222-4333-8444-555555555555";
const notionPlanDatabaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notionMarkdown = "# Full Notion README body\n\n## Scripts\n- `PlayerMovement.cs` — Controls player movement.\n\nNotion body marker: NOTION_FULL_BODY_7f29.";
function getNotionReadme(baseUrl) {
  return fetch(`${baseUrl}/api/notion/readme`);
}

function planSyncPayload(overrides = {}) {
  const plan = {
    bug_id: "BUG-NOTION-1",
    bug_title: "접촉 피해가 너무 큼",
    location: { file: "PlayerHealth.cs", function: "TakeDamage", lines: "L20-L26" },
    assignee: "강승우",
    due_date: "2026-12-03",
    priority: "high",
    memo: "피격 쿨타임을 추가합니다.",
    status: "planned",
    created_at: "2026-11-26T01:00:00.000Z",
    updated_at: "2026-11-26T01:00:00.000Z",
    ...overrides.plan,
  };
  return {
    plan,
    cause_hypothesis: overrides.cause_hypothesis ?? "인용 코드에서 접촉 피해가 매 프레임 적용될 수 있는 경로를 확인했습니다.",
    code_candidates: overrides.code_candidates ?? [{
      file: "PlayerHealth.cs",
      function: "TakeDamage",
      lines: "L20-L26",
      code: "public void TakeDamage(int amount)\n{\n    health -= amount;\n}",
    }],
    reports: overrides.reports ?? [
      { report_id: "R001", reporter: "tester01", created_at: "2026-11-20 14:02", text: "몬스터와 닿자마자 체력이 0이 됩니다." },
      { report_id: "R002", reporter: "tester02", created_at: "2026-11-20 14:10", text: "살짝 스쳤는데 바로 죽었습니다." },
    ],
    ...(overrides.notion_page_id ? { notion_page_id: overrides.notion_page_id } : {}),
  };
}

function plainNotionText(property) {
  return (property?.rich_text || property?.title || []).map((item) => item.text?.content || item.plain_text || "").join("");
}

function notionBlockText(block) {
  return (block?.[block?.type]?.rich_text || []).map((item) => item.text?.content || item.plain_text || "").join("");
}

before(async () => {
  environment = await startBugPinTestEnvironment();
  reports = [...await loadSampleReports(), buildAmbiguousTestReport()];
  readme = await loadSampleReadme();
  notionMock = await startMockNotion();
  notionMock.setMarkdown(notionMarkdown);
  notionConfiguredApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPageId: notionTestPageId,
    notionPlanDatabaseId: notionMock.databaseId,
    notionApiBaseUrl: notionMock.url,
  });
  notionTokenOnlyApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionApiBaseUrl: notionMock.url,
  });
  notionPlanTestApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPlanDatabaseId: notionMock.databaseId,
    notionApiBaseUrl: notionMock.url,
  });
  notionWriteFailApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPlanDatabaseId: notionMock.databaseId,
    notionApiBaseUrl: notionMock.url,
  });
});

after(async () => {
  await notionSchemaMismatchApp?.close();
  await notionPlanRateApp?.close();
  await notionWriteFailApp?.close();
  await notionPlanTestApp?.close();
  await notionTokenOnlyApp?.close();
  await notionConfiguredApp?.close();
  await notionMock?.close();
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
  assert.equal(providerRequests.at(-1).hasAuthorizationHeader, true);
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

test("Notion 경로는 기능 플래그 없이 열리고 토큰 누락을 503으로 안내한다", async () => {
  const response = await fetch(`${environment.app.url}/api/notion/readme`);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /NOTION_TOKEN/);
  assert.doesNotMatch(body.error, /팀 접근 제한이 적용된 전용 환경/);
});

test("Notion 토큰만 있고 페이지 ID가 없으면 설정 오류를 503으로 안내한다", async () => {
  const requestCountBefore = notionMock.requests.length;
  const response = await getNotionReadme(notionTokenOnlyApp.url);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /NOTION_PAGE_ID/);
  assert.doesNotMatch(body.error, /팀 접근 제한이 적용된 전용 환경/);
  assert.equal(notionMock.requests.length, requestCountBefore);
});

test("NOTION_PAGE_ID는 하이픈 유무와 Notion 페이지 링크에서 정규화된다", async () => {
  const rawId = notionTestPageId.replace(/-/g, "");
  const inputs = [
    notionTestPageId,
    rawId,
    `https://www.notion.so/bugpin-workspace/Project-README-${rawId}?pvs=4`,
    `https://notion.so/${notionTestPageId}`,
  ];

  for (const pageId of inputs) {
    const app = await startBugPinServer(environment.mock.url, {
      notionToken: notionTestToken,
      notionPageId: pageId,
      notionApiBaseUrl: notionMock.url,
    });
    try {
      const response = await getNotionReadme(app.url);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.markdown, notionMarkdown);
      assert.equal(notionMock.requests.at(-1).path, `/v1/pages/${notionTestPageId}/markdown`);
    } finally {
      await app.close();
    }
  }
});

test("NOTION_PLAN_DATABASE_ID도 하이픈 없는 ID와 Notion DB 링크를 data source 조회에 사용한다", async () => {
  const rawId = notionMock.databaseId.replace(/-/g, "");
  const databaseInputs = [
    rawId,
    `https://www.notion.so/bugpin-team/QA-Fix-Plans-${rawId}?v=cccccccccccc4ccc8ccccccccccccccc`,
  ];
  for (const value of databaseInputs) {
    const requestStart = notionMock.requests.length;
    const app = await startBugPinServer(environment.mock.url, {
      notionToken: notionTestToken,
      notionPlanDatabaseId: value,
      notionApiBaseUrl: notionMock.url,
    });
    try {
      const startupRequests = notionMock.requests.slice(requestStart);
      const databaseRequest = startupRequests.find((request) => request.path === `/v1/databases/${notionMock.databaseId}`);
      const sourceRequest = startupRequests.find((request) => request.path === `/v1/data_sources/${notionMock.dataSourceId}`);
      assert.ok(databaseRequest);
      assert.ok(sourceRequest);
      assert.equal(databaseRequest.hasAuthorizationHeader, true);
      assert.equal(sourceRequest.hasAuthorizationHeader, true);
    } finally {
      await app.close();
    }
  }
});

test("Notion 링크에서 유효한 페이지 ID를 찾지 못하면 설정 오류로 처리한다", async () => {
  const app = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPageId: "https://www.notion.so/bugpin-workspace/readme-without-page-id?pvs=4",
    notionApiBaseUrl: notionMock.url,
  });
  const requestCountBefore = notionMock.requests.length;
  try {
    const response = await getNotionReadme(app.url);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /32자리 페이지 ID 또는 Notion 페이지 링크/);
    assert.equal(notionMock.requests.length, requestCountBefore);
  } finally {
    await app.close();
  }
});

test("Notion Markdown 본문을 서버에서 읽고 기존 /api/locate 요청에 그대로 전달한다", async () => {
  const response = await getNotionReadme(notionConfiguredApp.url);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.markdown, notionMarkdown);
  assert.match(result.markdown, /NOTION_FULL_BODY_7f29/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(notionTestToken));

  const notionRequest = notionMock.requests.at(-1);
  assert.equal(notionRequest.method, "GET");
  assert.equal(notionRequest.path, `/v1/pages/${notionTestPageId}/markdown`);
  assert.equal(notionRequest.hasAuthorizationHeader, true);
  assert.equal(notionRequest.notionVersion, "2026-03-11");

  const { response: locateResponse, body: locateBody } = await postJson(notionConfiguredApp.url, "/api/locate", {
    bugs: [analysis.bugs[0]],
    readme: result.markdown,
  });
  assert.equal(locateResponse.status, 200);
  assert.equal(locateBody.results[0].bug_id, analysis.bugs[0].bug_id);
  const locateLlmRequest = environment.mock.requests.at(-1);
  const locatePrompt = locateLlmRequest.messages.find((message) => message.role === "user").content;
  assert.ok(locatePrompt.includes(notionMarkdown));
  assert.ok(locatePrompt.includes("NOTION_FULL_BODY_7f29"));
  assert.doesNotMatch(locatePrompt, new RegExp(notionTestToken));
});

test("빈 Notion Markdown과 페이지 권한 오류는 구분해 안내한다", async () => {
  notionMock.setMode("empty");
  const emptyResponse = await getNotionReadme(notionConfiguredApp.url);
  const emptyBody = await emptyResponse.json();
  assert.equal(emptyResponse.status, 422);
  assert.match(emptyBody.error, /Markdown 본문이 비어 있습니다/);

  notionMock.setMode("permission-denied");
  const permissionResponse = await getNotionReadme(notionConfiguredApp.url);
  const permissionBody = await permissionResponse.json();
  assert.equal(permissionResponse.status, 403);
  assert.match(permissionBody.error, /페이지 접근 권한이 없습니다/);
  assert.match(permissionBody.error, /integration과 공유/);
  assert.doesNotMatch(JSON.stringify(permissionBody), new RegExp(notionTestToken));

  notionMock.setMode("unauthorized");
  const authResponse = await getNotionReadme(notionConfiguredApp.url);
  const authBody = await authResponse.json();
  assert.equal(authResponse.status, 401);
  assert.match(authBody.error, /NOTION_TOKEN/);
  assert.doesNotMatch(JSON.stringify(authBody), new RegExp(notionTestToken));
  notionMock.setMode("normal");
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

test("Notion token과 page ID가 설정되면 별도 배포 트리거 없이 페이지를 읽는다", async () => {
  const requestCountBefore = notionMock.requests.length;
  const response = await getNotionReadme(notionConfiguredApp.url);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.markdown, notionMarkdown);
  assert.equal(notionMock.requests.length, requestCountBefore + 1);
  assert.equal(notionMock.requests.at(-1).hasAuthorizationHeader, true);
});

test("Notion 수정계획 저장은 요청 필드를 검증하고 정확한 속성·카드 본문으로 생성한다", async () => {
  const response = await postJson(notionPlanTestApp.url, "/api/notion/plan", planSyncPayload());
  assert.equal(response.response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body, {
    success: true,
    action: "created",
    notion_page_id: response.body.notion_page_id,
    url: response.body.url,
  });
  const page = notionMock.pages.get(response.body.notion_page_id);
  assert.ok(page);
  assert.equal(page.parent.data_source_id, notionMock.dataSourceId);
  assert.equal(plainNotionText(page.properties["버그"]), "🔴 접촉 피해가 너무 큼");
  assert.equal(page.properties["담당자"].select.name, "강승우");
  assert.equal(page.properties["마감일"].date.start, "2026-12-03");
  assert.equal(page.properties["등록일"].date.start, "2026-11-26");
  assert.equal(page.properties["우선순위"].select.name, "높음");
  assert.equal(page.properties["상태"].select.name, "계획됨");
  assert.equal(plainNotionText(page.properties["위치"]), "PlayerHealth.cs · TakeDamage · L20-L26");
  assert.equal(plainNotionText(page.properties["파일"]), "PlayerHealth.cs");
  assert.equal(plainNotionText(page.properties["함수"]), "TakeDamage");
  assert.equal(plainNotionText(page.properties["줄"]), "L20-L26");
  assert.equal(plainNotionText(page.properties["메모"]), "피격 쿨타임을 추가합니다.");
  assert.equal(plainNotionText(page.properties["버그 ID"]), "BUG-NOTION-1");

  const activeBlocks = page.children.filter((block) => !block.in_trash);
  assert.ok(activeBlocks.some((block) => block.type === "heading_2" && notionBlockText(block) === "원인 추정"));
  assert.ok(activeBlocks.some((block) => block.type === "paragraph" && notionBlockText(block).includes("접촉 피해가 매 프레임")));
  assert.ok(activeBlocks.some((block) => block.type === "heading_2" && notionBlockText(block) === "코드"));
  assert.ok(activeBlocks.some((block) => block.type === "code" && block.code.language === "csharp" && block.code.rich_text.map((part) => part.text.content).join("").includes("health -= amount")));
  assert.ok(activeBlocks.some((block) => block.type === "heading_2" && notionBlockText(block) === "제보 원문"));
  assert.ok(activeBlocks.filter((block) => block.type === "paragraph" && notionBlockText(block).includes("[R00")).length >= 2);
  const notionRequest = notionMock.requests.findLast((request) => request.path === "/v1/pages" && request.method === "POST");
  assert.equal(notionRequest.hasAuthorizationHeader, true);
  assert.doesNotMatch(JSON.stringify(notionRequest), new RegExp(notionTestToken));
});

test("같은 bug_id의 카드가 있으면 저장된 페이지 ID나 Bug ID 검색으로 본문을 덮어쓴다", async () => {
  const initialPageCount = notionMock.pages.size;
  const first = await postJson(notionPlanTestApp.url, "/api/notion/plan", planSyncPayload({ plan: { bug_id: "BUG-PAGE-UPDATE" } }));
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const pageId = first.body.notion_page_id;
  const page = notionMock.pages.get(pageId);
  const previousBlocks = page.children.filter((block) => !block.in_trash);
  const updatePayload = planSyncPayload({
    plan: { bug_id: "BUG-PAGE-UPDATE", bug_title: "접촉 피해 재검토", assignee: "민서", priority: "low", memo: "무적 시간 확인" },
    cause_hypothesis: "반복 충돌 콜백에서 피해를 적용할 수 있습니다.",
    code_candidates: [{ file: "PlayerHealth.cs", function: "OnCollisionStay2D", lines: "L30-L35", code: "void OnCollisionStay2D()\n{\n    TakeDamage(10);\n}" }],
    reports: [{ report_id: "R003", reporter: "tester03", created_at: "2026-11-20 14:30", text: "접촉 피해가 반복됩니다." }],
    notion_page_id: pageId,
  });
  const updated = await postJson(notionPlanTestApp.url, "/api/notion/plan", updatePayload);
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.action, "updated");
  assert.equal(updated.body.notion_page_id, pageId);
  assert.equal(notionMock.pages.size, initialPageCount + 1);
  assert.equal(plainNotionText(page.properties["버그"]), "🟢 접촉 피해 재검토");
  assert.equal(page.properties["담당자"].select.name, "민서");
  assert.equal(page.properties["우선순위"].select.name, "낮음");
  assert.equal(page.properties["상태"].select.name, "계획됨");
  const activeAfterPageIdUpdate = page.children.filter((block) => !block.in_trash);
  assert.ok(activeAfterPageIdUpdate.some((block) => block.type === "paragraph" && notionBlockText(block).includes("반복 충돌 콜백")));
  assert.ok(activeAfterPageIdUpdate.every((block) => !notionBlockText(block).includes("접촉 피해가 매 프레임")));
  assert.ok(previousBlocks.every((block) => block.in_trash));

  const queryUpdated = await postJson(notionPlanTestApp.url, "/api/notion/plan", {
    ...updatePayload,
    notion_page_id: "",
    plan: { ...updatePayload.plan, bug_title: "Bug ID로 찾아 갱신" },
  });
  assert.equal(queryUpdated.response.status, 200, JSON.stringify(queryUpdated.body));
  assert.equal(queryUpdated.body.action, "updated");
  assert.equal(queryUpdated.body.notion_page_id, pageId);
  assert.equal(notionMock.pages.size, initialPageCount + 1);
});

test("수정 계획 필드 검증과 Notion 생성·수정 오류는 민감한 응답 전문 없이 반환한다", async () => {
  const missingAssignee = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { assignee: " " } }));
  assert.equal(missingAssignee.response.status, 400);
  assert.match(missingAssignee.body.error, /담당자/);
  const invalidDate = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { due_date: "2026-02-31" } }));
  assert.equal(invalidDate.response.status, 400);
  assert.match(invalidDate.body.error, /YYYY-MM-DD/);
  const invalidPriority = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { priority: "urgent" } }));
  assert.equal(invalidPriority.response.status, 400);
  const oversizedMemo = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { memo: "x".repeat(2001) } }));
  assert.equal(oversizedMemo.response.status, 400);

  notionMock.setMode("create-fail");
  const createFailure = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { bug_id: "BUG-FAIL-CREATE" } }));
  assert.equal(createFailure.response.status, 403);
  assert.match(createFailure.body.error, /Notion 데이터베이스\/페이지 접근 권한/);
  assert.doesNotMatch(JSON.stringify(createFailure.body), /mock write denied|notion-test-only-secret-value/);

  notionMock.setMode("normal");
  const existing = await postJson(notionWriteFailApp.url, "/api/notion/plan", planSyncPayload({ plan: { bug_id: "BUG-FAIL-UPDATE" } }));
  assert.equal(existing.response.status, 200);
  const oldBlockCount = notionMock.pages.get(existing.body.notion_page_id).children.filter((block) => !block.in_trash).length;
  notionMock.setMode("update-fail");
  const updateFailure = await postJson(notionWriteFailApp.url, "/api/notion/plan", {
    ...planSyncPayload({ plan: { bug_id: "BUG-FAIL-UPDATE", memo: "변경할 메모" } }),
    notion_page_id: existing.body.notion_page_id,
  });
  assert.equal(updateFailure.response.status, 502);
  assert.match(updateFailure.body.error, /일시적인 오류/);
  assert.doesNotMatch(JSON.stringify(updateFailure.body), /private mock failure|notion-test-only-secret-value/);
  assert.equal(notionMock.pages.get(existing.body.notion_page_id).children.filter((block) => !block.in_trash).length, oldBlockCount);
  notionMock.setMode("normal");
});

test("Notion 계획 등록 IP rate limit은 1분 10회까지 허용하고 11회째를 차단한다", async () => {
  notionPlanRateApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPlanDatabaseId: notionMock.databaseId,
    notionApiBaseUrl: notionMock.url,
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await postJson(notionPlanRateApp.url, "/api/notion/plan", { plan: {} });
    assert.equal(response.response.status, 400);
  }
  const limited = await postJson(notionPlanRateApp.url, "/api/notion/plan", { plan: {} });
  assert.equal(limited.response.status, 429);
  assert.match(limited.body.error, /요청이 많습니다/);
});

test("서버 시작 시 계획 DB와 data source를 읽고 정확한 schema를 검증한다", async () => {
  const startupRequests = notionMock.requests.filter((request) => {
    return request.path === `/v1/databases/${notionMock.databaseId}` || request.path === `/v1/data_sources/${notionMock.dataSourceId}`;
  });
  assert.ok(startupRequests.some((request) => request.method === "GET" && request.path === `/v1/databases/${notionMock.databaseId}`));
  assert.ok(startupRequests.some((request) => request.method === "GET" && request.path === `/v1/data_sources/${notionMock.dataSourceId}`));
  assert.ok(startupRequests.every((request) => request.hasAuthorizationHeader));

  notionMock.setMode("bad-schema");
  notionSchemaMismatchApp = await startBugPinServer(environment.mock.url, {
    notionToken: notionTestToken,
    notionPlanDatabaseId: notionMock.databaseId,
    notionApiBaseUrl: notionMock.url,
  });
  notionMock.setMode("normal");
  const { response, body } = await postJson(notionSchemaMismatchApp.url, "/api/notion/plan", planSyncPayload());
  assert.equal(response.status, 422);
  assert.match(body.error, /Notion 수정계획 DB 스키마 오류/);
  assert.match(body.error, /버그: title 형식/);
});
