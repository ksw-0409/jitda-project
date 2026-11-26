import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { loadSampleReports, startBugPinTestEnvironment } from "../helpers/test-servers.js";

let environment;
let browserSession;

function browser(...args) {
  return execFileSync("agent-browser", args, {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, AGENT_BROWSER_SESSION: browserSession },
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

function evaluate(expression) {
  const output = browser("eval", `(${expression})`);
  return JSON.parse(output);
}

async function waitFor(predicate, description, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = evaluate(`(() => { ${predicate} })()`);
    if (value.done) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  assert.fail(`${description} 시간 초과. 마지막 브라우저 상태: ${JSON.stringify(value)}`);
}

before(async () => {
  environment = await startBugPinTestEnvironment();
  browserSession = `bugpin-e2e-${process.pid}`;
  browser("open", environment.app.url);
});

after(async () => {
  if (browserSession) {
    try {
      browser("close");
    } catch {
      // The browser may already have closed after a failed startup.
    }
  }
  await environment?.close();
});

test("브라우저에서 CSV→묶음·원문→README 위치 분석과 상태를 검증한다", async () => {
  const expectedReports = await loadSampleReports();

  const initial = evaluate(`({
    placeholder: document.querySelector("#panel-summary-list").textContent.trim(),
    analysisHidden: document.querySelector("#analysis-output").hidden,
    reportCount: window.bugPinReports.length
  })`);
  assert.equal(initial.placeholder, "분석을 시작하면 버그 목록이 여기에 표시됩니다");
  assert.equal(initial.analysisHidden, true);
  assert.equal(initial.reportCount, 0);

  browser("click", "#analyze-reports");
  assert.match(evaluate("document.querySelector('#analysis-status').textContent"), /먼저 제보 CSV/);

  environment.mock.setMode("normal");
  browser("click", "#load-sample");
  browser("wait", "250");
  const loaded = evaluate(`({
    reportCount: window.bugPinReports.length,
    previewCount: document.querySelector("#preview-count").textContent,
    previewRows: document.querySelectorAll("#preview-rows tr").length,
    ids: window.bugPinReports.map(report => report.report_id)
  })`);
  assert.equal(loaded.reportCount, 20);
  assert.equal(loaded.previewCount, "20건");
  assert.equal(loaded.previewRows, 10);
  assert.deepEqual(loaded.ids, expectedReports.map((report) => report.report_id));

  browser("click", "#analyze-reports");
  await waitFor(
    "const button = document.querySelector('#analyze-reports'); return { done: !document.querySelector('#analysis-output').hidden && button.textContent === '분석 다시 시작', status: document.querySelector('#analysis-status').textContent }",
    "샘플 제보 분석",
  );
  const analyzed = evaluate(`({
    summary: [...document.querySelectorAll(".analysis-summary-card")].map(card => ({
      label: card.querySelector(".analysis-summary-label").textContent,
      count: Number(card.querySelector(".analysis-summary-count").textContent)
    })),
    bugCards: [...document.querySelectorAll(".bug-card")].map(card => ({
      title: card.querySelector(".bug-card-title").textContent,
      count: Number(card.querySelector(".bug-card-count").textContent.match(/\\d+/)[0]),
      ids: [...card.querySelectorAll(".report-list strong")].map(node => node.textContent)
    })),
    temporaryWarningHidden: document.querySelector("#analysis-temp-warning").hidden,
    status: document.querySelector("#analysis-status").textContent
  })`);
  assert.deepEqual(analyzed.summary.map((item) => item.count), [5, 3, 0]);
  assert.equal(analyzed.bugCards.length, 5);
  assert.equal(analyzed.temporaryWarningHidden, true);
  assert.equal(analyzed.status, "AI 분석이 완료되었습니다.");
  assert.ok(analyzed.bugCards.every((card, index, cards) => index === 0 || cards[index - 1].count >= card.count));

  browser("scrollintoview", "#analysis-results .bug-card:nth-of-type(1) > summary");
  browser("click", "#analysis-results .bug-card:nth-of-type(1) > summary");
  const firstCardBeforeMore = evaluate(`(() => {
    const card = document.querySelector("#analysis-results .bug-card:nth-of-type(1)");
    const representative = card.querySelector(".bug-detail-section:nth-child(2) > .report-list");
    return {
      open: card.open,
      representativeIds: [...representative.querySelectorAll("li strong")].map(node => node.textContent),
      totalIdsInModel: window.bugPinAnalysis.bugs[0].report_ids,
      remainingOpen: card.querySelector(".more-reports")?.open ?? false,
      remainingCount: card.querySelector(".more-reports .report-list")?.children.length ?? 0
    };
  })()`);
  assert.equal(firstCardBeforeMore.open, true);
  assert.equal(firstCardBeforeMore.representativeIds.length, Math.min(2, firstCardBeforeMore.totalIdsInModel.length));
  assert.equal(firstCardBeforeMore.remainingOpen, false);
  assert.equal(firstCardBeforeMore.remainingCount, firstCardBeforeMore.totalIdsInModel.length - firstCardBeforeMore.representativeIds.length);

  browser("scrollintoview", "#analysis-results .bug-card:nth-of-type(1) .more-reports > summary");
  browser("click", "#analysis-results .bug-card:nth-of-type(1) .more-reports > summary");
  for (let index = 2; index <= analyzed.bugCards.length; index += 1) {
    const cardSummary = `#analysis-results .bug-card:nth-of-type(${index}) > summary`;
    const moreSummary = `#analysis-results .bug-card:nth-of-type(${index}) .more-reports > summary`;
    browser("scrollintoview", cardSummary);
    browser("click", cardSummary);
    browser("scrollintoview", moreSummary);
    browser("click", moreSummary);
  }
  browser("scrollintoview", "#analysis-results .not-bugs-card > summary");
  browser("click", "#analysis-results .not-bugs-card > summary");

  const openedReports = evaluate(`(() => {
    const rows = [...document.querySelectorAll(".bug-card .report-list li, .not-bugs-card .report-list li, .unclear-card .report-list li")];
    const entries = rows.map(row => ({
      id: row.querySelector(".report-meta strong").textContent,
      text: row.querySelector(".report-text").textContent
    }));
    const original = new Map(window.bugPinReports.map(report => [report.report_id, report.text]));
    return {
      entries,
      uniqueCount: new Set(entries.map(entry => entry.id)).size,
      allOriginalTextsMatch: entries.every(entry => original.get(entry.id) === entry.text),
      allBugCardsOpen: [...document.querySelectorAll(".bug-card")].every(card => card.open),
      allMoreSectionsOpen: [...document.querySelectorAll(".bug-card .more-reports")].every(details => details.open),
      opinionOpen: document.querySelector(".not-bugs-card").open,
      unclearEmptyMessage: document.querySelector(".analysis-group-unclear .analysis-group-empty")?.textContent || ""
    };
  })()`);
  assert.equal(openedReports.entries.length, 20);
  assert.equal(openedReports.uniqueCount, 20);
  assert.equal(openedReports.allOriginalTextsMatch, true);
  assert.equal(openedReports.allBugCardsOpen, true);
  assert.equal(openedReports.allMoreSectionsOpen, true);
  assert.equal(openedReports.opinionOpen, true);
  assert.match(openedReports.unclearEmptyMessage, /추가 확인이 필요한 제보가 없습니다/);
  for (const report of expectedReports) assert.ok(openedReports.entries.some((entry) => entry.id === report.report_id));

  browser("scrollintoview", "#load-sample-readme");
  browser("click", "#load-sample-readme");
  browser("wait", "200");
  assert.equal(evaluate("document.querySelector('#readme-file-name').textContent"), "sample_README.md");
  assert.equal(evaluate("!document.querySelector('#readme-ready-indicator').hidden"), true);

  environment.mock.setMode("normal");
  browser("scrollintoview", "#locate-suspects");
  browser("click", "#locate-suspects");
  const loadingState = evaluate(`({
    buttonText: document.querySelector("#locate-suspects").textContent,
    disabled: document.querySelector("#locate-suspects").disabled,
    feedbackKind: document.querySelector("#readme-feedback").dataset.kind,
    cardState: document.querySelector(".suspect-confidence").dataset.status
  })`);
  assert.equal(loadingState.buttonText, "README 후보 분석 중...");
  assert.equal(loadingState.disabled, true);
  assert.equal(loadingState.feedbackKind, "loading");
  assert.equal(loadingState.cardState, "analyzing");
  await waitFor(
    "const button = document.querySelector('#locate-suspects'); return { done: !button.disabled, feedback: document.querySelector('#readme-feedback').textContent }",
    "README 위치 분석",
  );

  const locations = evaluate(`({
    labels: [...document.querySelectorAll(".suspect-confidence")].map(node => node.textContent),
    candidates: [...document.querySelectorAll(".suspect-candidate-label")].map(node => node.textContent),
    scripts: [...document.querySelectorAll(".suspect-code-identity code")].map(node => node.textContent),
    reasons: [...document.querySelectorAll(".suspect-empty")].map(node => node.textContent),
    codeLines: document.querySelectorAll(".suspect-lines").length,
    codeBlocks: document.querySelectorAll(".suspect-code-source").length,
    feedback: document.querySelector("#readme-feedback").textContent
  })`);
  assert.equal(locations.labels.length, 5);
  assert.ok(locations.labels.every((label) => label === "후보 있음"));
  assert.equal(locations.candidates.length, 5);
  assert.ok(locations.candidates.every((label) => label.startsWith("README 기반 의심 후보")));
  assert.ok(locations.scripts.includes("PlayerMovement.cs"));
  assert.ok(locations.scripts.includes("Update()"));
  assert.equal(locations.codeLines, 0);
  assert.equal(locations.codeBlocks, 0);
  assert.match(locations.feedback, /실제 코드 근거와 줄 번호는 확인되지 않았습니다/);

  const firstBugId = evaluate("window.bugPinAnalysis.bugs[0].bug_id");
  const secondBugId = evaluate("window.bugPinAnalysis.bugs[1].bug_id");
  browser("scrollintoview", ".bug-card:nth-of-type(1) .suspect-card-action.is-reject");
  browser("click", ".bug-card:nth-of-type(1) .suspect-card-action.is-reject");
  assert.equal(evaluate("!document.querySelector('.bug-card:nth-of-type(1) .suspect-feedback-form').hidden"), true);
  browser("click", ".bug-card:nth-of-type(1) .suspect-feedback-chip:nth-of-type(1)");
  browser("click", ".bug-card:nth-of-type(1) .suspect-feedback-chip:nth-of-type(2)");
  browser("fill", ".bug-card:nth-of-type(1) .suspect-feedback-text", "실제 이동은 InputHandler에서 처리합니다.");
  const selectedFeedback = evaluate(`({
    selected: [...document.querySelectorAll(".bug-card:nth-of-type(1) .suspect-feedback-chip")].filter(button => button.getAttribute("aria-pressed") === "true").map(button => button.textContent),
    text: document.querySelector(".bug-card:nth-of-type(1) .suspect-feedback-text").value,
    submitEnabled: !document.querySelector(".bug-card:nth-of-type(1) .suspect-feedback-submit").disabled
  })`);
  assert.deepEqual(selectedFeedback.selected, ["이 함수는 관련 없음", "다른 스크립트일 것 같음"]);
  assert.equal(selectedFeedback.text, "실제 이동은 InputHandler에서 처리합니다.");
  assert.equal(selectedFeedback.submitEnabled, true);

  browser("click", ".bug-card:nth-of-type(1) .suspect-feedback-submit");
  const rerunLoading = evaluate(`({
    searching: window.bugPinLocationStates.get(window.bugPinAnalysis.bugs[0].bug_id).searching,
    buttonText: document.querySelector(".bug-card:nth-of-type(1) .suspect-card-action.is-reject")?.textContent || "",
    doubleClickBlocked: document.querySelector(".bug-card:nth-of-type(1) .suspect-card-action.is-reject")?.disabled || false
  })`);
  assert.equal(rerunLoading.searching, true);
  assert.match(rerunLoading.buttonText, /다시 찾는 중/);
  assert.equal(rerunLoading.doubleClickBlocked, true);
  await waitFor(
    `const state = window.bugPinLocationStates.get("${firstBugId}"); return { done: !state.searching && state.candidates.some(candidate => candidate.file === "PlayerHealth.cs") }`,
    "개발자 피드백을 반영한 2차 README 탐색",
  );

  const secondPass = evaluate(`(() => {
    const state = window.bugPinLocationStates.get("${firstBugId}");
    const card = document.querySelector(".bug-card:nth-of-type(1)");
    return {
      round: state.round,
      activeFiles: state.candidates.map(candidate => candidate.file),
      excludedCount: state.excluded.length,
      exclusionReasons: state.excluded[0]?.reasons,
      exclusionText: state.excluded[0]?.free_text,
      secondPassLabel: card.querySelector(".suspect-candidate-label")?.textContent,
      differentReason: card.querySelector(".suspect-rerun-message")?.textContent,
      hasActualLine: card.querySelectorAll(".suspect-lines").length > 0
    };
  })()`);
  assert.equal(secondPass.round, 2);
  assert.ok(secondPass.activeFiles.includes("PlayerHealth.cs"));
  assert.equal(secondPass.excludedCount, 1);
  assert.deepEqual(secondPass.exclusionReasons, selectedFeedback.selected);
  assert.equal(secondPass.exclusionText, selectedFeedback.text);
  assert.match(secondPass.secondPassLabel, /2차 탐색/);
  assert.match(secondPass.differentReason, /이전 후보와 다른 점/);
  assert.equal(secondPass.hasActualLine, false);

  browser("click", ".bug-card:nth-of-type(1) .suspect-excluded > summary");
  const struckExcluded = evaluate(`(() => {
    const excluded = document.querySelector(".bug-card:nth-of-type(1) .suspect-excluded");
    return {
      open: excluded.open,
      name: excluded.querySelector(".suspect-excluded-name").textContent,
      style: getComputedStyle(excluded.querySelector(".suspect-excluded-name")).textDecorationLine,
      reason: excluded.querySelector(".suspect-excluded-reason").textContent
    };
  })()`);
  assert.equal(struckExcluded.open, true);
  assert.match(struckExcluded.name, /PlayerMovement\.cs/);
  assert.match(struckExcluded.style, /line-through/);
  assert.match(struckExcluded.reason, /다른 스크립트일 것 같음/);
  assert.match(struckExcluded.reason, /InputHandler/);

  browser("click", ".bug-card:nth-of-type(1) .suspect-undo-button");
  const afterUndo = evaluate(`(() => {
    const state = window.bugPinLocationStates.get("${firstBugId}");
    return {
      excludedCount: state.excluded.length,
      restoredCandidate: state.candidates.some(candidate => candidate.file === "PlayerMovement.cs"),
      newCandidate: state.candidates.some(candidate => candidate.file === "PlayerHealth.cs")
    };
  })()`);
  assert.equal(afterUndo.excludedCount, 0);
  assert.equal(afterUndo.restoredCandidate, true);
  assert.equal(afterUndo.newCandidate, true);

  browser("scrollintoview", ".bug-card:nth-of-type(1) .suspect-list .suspect-item:nth-of-type(2) .suspect-card-action.is-confirm");
  browser("click", ".bug-card:nth-of-type(1) .suspect-item:nth-of-type(2) .suspect-card-action.is-confirm");
  const confirmed = evaluate(`(() => {
    const state = window.bugPinLocationStates.get("${firstBugId}");
    const card = document.querySelector(".bug-card:nth-of-type(1)");
    return {
      status: card.querySelector(".suspect-confidence").textContent,
      confirmedFile: state.confirmedLocation?.file,
      badge: card.querySelector(".suspect-confirmed-badge")?.textContent,
      stateRetained: state.candidates.some(candidate => candidate.file === "PlayerMovement.cs")
    };
  })()`);
  assert.equal(confirmed.status, "위치 확정");
  assert.equal(confirmed.confirmedFile, "PlayerHealth.cs");
  assert.equal(confirmed.badge, "확인됨");
  assert.equal(confirmed.stateRetained, true);

  environment.mock.setMode("rerun-none");
  browser("scrollintoview", ".bug-card:nth-of-type(2) .suspect-card-action.is-reject");
  browser("click", ".bug-card:nth-of-type(2) .suspect-card-action.is-reject");
  browser("click", ".bug-card:nth-of-type(2) .suspect-feedback-chip:nth-of-type(3)");
  browser("fill", ".bug-card:nth-of-type(2) .suspect-feedback-text", "다른 스크립트의 충돌 처리인지도 확인해 주세요.");
  browser("click", ".bug-card:nth-of-type(2) .suspect-feedback-submit");
  await waitFor(
    `const state = window.bugPinLocationStates.get("${secondBugId}"); return { done: !state.searching && state.showHintForm }`,
    "후보 없음 응답과 추가 힌트 입력 안내",
  );
  const exhausted = evaluate(`(() => {
    const state = window.bugPinLocationStates.get("${secondBugId}");
    const card = document.querySelector(".bug-card:nth-of-type(2)");
    return {
      message: card.querySelector(".suspect-rerun-message")?.textContent,
      hintVisible: !card.querySelector('[data-feedback-form="next-hint"]').hidden,
      inputFocused: document.activeElement === card.querySelector('[data-feedback-input="next-hint"]'),
      excludedCount: state.excluded.length,
      stateFirstBugUnchanged: window.bugPinLocationStates.get("${firstBugId}").confirmedLocation?.file === "PlayerHealth.cs"
    };
  })()`);
  assert.match(exhausted.message, /더 찾을 후보가 없어요/);
  assert.equal(exhausted.hintVisible, true);
  assert.equal(exhausted.inputFocused, true);
  assert.equal(exhausted.excludedCount, 1);
  assert.equal(exhausted.stateFirstBugUnchanged, true);

  environment.mock.setMode("delay");
  browser("scrollintoview", "#locate-suspects");
  browser("click", "#locate-suspects");
  const delayedLocationLoading = evaluate(`({
    feedbackKind: document.querySelector("#readme-feedback").dataset.kind,
    cardState: document.querySelector(".suspect-confidence").dataset.status
  })`);
  assert.equal(delayedLocationLoading.feedbackKind, "loading");
  assert.equal(delayedLocationLoading.cardState, "analyzing");
  await waitFor("return { done: !document.querySelector('#locate-suspects').disabled }", "지연된 README 분석");

  environment.mock.setMode("invalid-json");
  browser("scrollintoview", "#locate-suspects");
  browser("click", "#locate-suspects");
  await waitFor("return { done: document.querySelector('#readme-feedback').dataset.kind === 'error', text: document.querySelector('#readme-feedback').textContent }", "README API 오류 안내");
  const locationFailure = evaluate(`({
    feedback: document.querySelector("#readme-feedback").textContent,
    state: document.querySelector(".suspect-confidence").textContent,
    evidenceNote: document.querySelector(".suspect-code-note").textContent,
    retryEnabled: !document.querySelector("#locate-suspects").disabled
  })`);
  assert.match(locationFailure.feedback, /올바른 의심 위치 JSON/);
  assert.equal(locationFailure.state, "위치 특정 불가");
  assert.match(locationFailure.evidenceNote, /근거 확인 필요/);
  assert.equal(locationFailure.retryEnabled, true);

  environment.mock.setMode("empty-bugs");
  browser("click", "#analyze-reports");
  await waitFor(
    "const button = document.querySelector('#analyze-reports'); return { done: button.textContent === '분석 다시 시작' && !document.querySelector('#analysis-output').hidden }",
    "빈 버그 묶음 분석",
  );
  const emptyResult = evaluate(`({
    counts: [...document.querySelectorAll(".analysis-summary-count")].map(node => Number(node.textContent)),
    cards: document.querySelectorAll(".bug-card").length,
    emptyText: document.querySelector(".analysis-group:not(.analysis-group-opinions):not(.analysis-group-unclear) .analysis-group-empty")?.textContent || "",
    opinions: document.querySelector(".analysis-group-opinions .analysis-group-meta").textContent
  })`);
  assert.deepEqual(emptyResult.counts, [0, 20, 0]);
  assert.equal(emptyResult.cards, 0);
  assert.match(emptyResult.emptyText, /이번 분석에서 확인된 버그 묶음이 없습니다/);
  assert.equal(emptyResult.opinions, "20건");

  environment.mock.setMode("invalid-json");
  browser("eval", `window.bugPinReports.push({ report_id: "E2E-ERROR", reporter: "test-only", created_at: "2026-11-21", text: "통합 오류 상태 시험" }); true`);
  browser("click", "#analyze-reports");
  await waitFor(
    "return { done: document.querySelector('#analysis-status').dataset.kind === 'error' && !document.querySelector('#analysis-output-error').hidden, error: document.querySelector('#analysis-status').textContent }",
    "분석 API 오류 안내",
  );
  const analysisFailure = evaluate(`({
    kind: document.querySelector("#analysis-status").dataset.kind,
    message: document.querySelector("#analysis-output-error").textContent,
    loadedReports: window.bugPinReports.length,
    retryEnabled: !document.querySelector("#analyze-reports").disabled
  })`);
  assert.equal(analysisFailure.kind, "error");
  assert.match(analysisFailure.message, /분석을 완료하지 못했습니다/);
  assert.equal(analysisFailure.loadedReports, 21);
  assert.equal(analysisFailure.retryEnabled, true);

  browser("click", "#load-sample");
  browser("wait", "250");
  environment.mock.setMode("unauthorized");
  browser("click", "#analyze-reports");
  await waitFor(
    "const button = document.querySelector('#analyze-reports'); return { done: button.textContent === '분석 다시 시작' && !document.querySelector('#analysis-temp-warning').hidden }",
    "임시 데모 결과 안내",
  );
  const demoResult = evaluate(`({
    warning: document.querySelector("#analysis-temp-warning").textContent,
    warningVisible: !document.querySelector("#analysis-temp-warning").hidden,
    status: document.querySelector("#analysis-status").textContent,
    counts: [...document.querySelectorAll(".analysis-summary-count")].map(node => Number(node.textContent))
  })`);
  assert.match(demoResult.warning, /실제 AI 분석이 아닙니다/);
  assert.equal(demoResult.warningVisible, true);
  assert.match(demoResult.status, /임시 샘플 결과/);
  assert.deepEqual(demoResult.counts, [5, 3, 0]);

  browser("set", "viewport", "375", "812");
  const mobile = evaluate(`(() => {
    const title = document.querySelector(".bug-card-title");
    const count = document.querySelector(".bug-card-count");
    const titleBox = title.getBoundingClientRect();
    const countBox = count.getBoundingClientRect();
    const overlap = titleBox.left < countBox.right && titleBox.right > countBox.left && titleBox.top < countBox.bottom && titleBox.bottom > countBox.top;
    return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, overlap, summaryColumns: getComputedStyle(document.querySelector("#analysis-summary")).gridTemplateColumns };
  })()`);
  assert.equal(mobile.width, 375);
  assert.equal(mobile.pageWidth, 375);
  assert.equal(mobile.overlap, false);

  environment.mock.setMode("normal");
  browser("reload");
  await waitFor("return { done: document.querySelector('#panel-summary-list') !== null }", "페이지 재로드");
});
