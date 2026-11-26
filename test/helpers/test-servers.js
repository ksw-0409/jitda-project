import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { normalizeAnalysisForView, parseReports } from "../../analysis-view-model.js";

export const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function loadSampleReports() {
  const csv = await readFile(new URL("../../sample_reports.csv", import.meta.url), "utf8");
  return parseReports(csv);
}

export async function loadSampleReadme() {
  return readFile(new URL("../../sample_README.md", import.meta.url), "utf8");
}

function sampleGroups(reports) {
  const groups = [
    {
      bug_id: "BUG-1",
      title: "대각선 이동 속도가 더 빠름",
      symptom: "대각선 이동 시 직선보다 속도가 빨라집니다.",
      ids: ["R002", "R006", "R013", "R019"],
    },
    {
      bug_id: "BUG-2",
      title: "처치한 몬스터가 사라지지 않음",
      symptom: "처치된 몬스터가 화면에 남습니다.",
      ids: ["R001", "R003", "R010", "R018"],
    },
    {
      bug_id: "BUG-3",
      title: "몬스터 접촉 피해가 과도함",
      symptom: "몬스터와 접촉하면 체력이 급격히 감소합니다.",
      ids: ["R005", "R009", "R016"],
    },
    {
      bug_id: "BUG-4",
      title: "몬스터가 플레이어에게서 도망감",
      symptom: "몬스터가 플레이어를 쫓지 않고 반대 방향으로 움직입니다.",
      ids: ["R011", "R017", "R020"],
    },
    {
      bug_id: "BUG-5",
      title: "스킬 이펙트가 사라지지 않음",
      symptom: "스킬 이펙트가 사용 후에도 화면에 남습니다.",
      ids: ["R004", "R007", "R014"],
    },
  ];
  const knownIds = new Set(reports.map((report) => report.report_id));
  const bugs = groups.map(({ ids, ...bug }) => ({
    ...bug,
    report_ids: ids.filter((id) => knownIds.has(id)),
    related_to: null,
  })).filter((bug) => bug.report_ids.length > 0);
  const bugReportIds = new Set(bugs.flatMap((bug) => bug.report_ids));
  const not_bugs = ["R008", "R012", "R015"].filter((id) => knownIds.has(id));
  const classified = new Set([...bugReportIds, ...not_bugs]);
  const unclear = reports.map((report) => report.report_id).filter((id) => !classified.has(id));
  return { bugs, not_bugs, unclear };
}

function parseAnalysisPrompt(content) {
  const dataStart = content.indexOf("\n[");
  if (dataStart < 0) throw new Error("분석 요청의 제보 JSON을 찾지 못했습니다.");
  return JSON.parse(content.slice(dataStart + 1));
}

function parseLocationPrompt(content) {
  const bugStart = content.indexOf("버그 묶음:\n");
  const readmeStart = content.indexOf("\n\nREADME:\n", bugStart);
  if (bugStart < 0 || readmeStart < 0) throw new Error("README 분석 요청의 버그 묶음을 찾지 못했습니다.");
  return JSON.parse(content.slice(bugStart + "버그 묶음:\n".length, readmeStart));
}

function fakeLocations(bugs, multipleCandidates = false) {
  const guesses = [
    { script: "PlayerMovement.cs", function: "Update()", reason: "이동 입력과 방향을 처리하는 기능입니다." },
    { script: "MonsterHealth.cs", function: "Die()", reason: "몬스터의 사망 상태를 관리하는 기능입니다." },
    { script: "PlayerHealth.cs", function: "TakeDamage()", reason: "플레이어 피해 적용을 관리하는 기능입니다." },
    { script: "MonsterChase.cs", function: "Update()", reason: "몬스터의 목표 추적을 관리하는 기능입니다." },
    { script: "SkillEffect.cs", function: "Update()", reason: "스킬 시각 효과를 관리하는 기능입니다." },
  ];
  const byBugId = new Map(guesses.map((suspect, index) => [`BUG-${index + 1}`, suspect]));
  return {
    results: bugs.map((bug, index) => {
      const suspect = byBugId.get(bug.bug_id);
      const suspects = suspect ? [suspect] : [];
      if (multipleCandidates && index === 0 && suspect) {
        suspects[0] = { ...suspect, confidence: "낮음" };
        suspects.push({
          script: "GameManager.cs",
          function: "Update()",
          reason: "게임 진행 상태와 입력 흐름을 갱신해 이동 입력 전달 경로를 함께 확인할 수 있습니다.",
          confidence: "높음",
        });
      }
      return {
        bug_id: bug.bug_id,
        suspects,
        confidence: suspect ? "보통" : "낮음",
      };
    }),
  };
}

function fakeProviderPayload(mode, requestBody) {
  const userMessages = requestBody.messages.filter((message) => message.role === "user").map((message) => message.content);
  const analysisPrompt = userMessages.find((content) => content.includes("다음 게임 QA 제보"));
  const locationPrompt = userMessages.find((content) => content.includes("버그 묶음:\n"));
  const rerunPrompt = userMessages.find((content) => content.includes("exploration_round"));
  if (mode === "invalid-json") {
    return { status: 200, body: { choices: [{ message: { content: "not a JSON response" } }] } };
  }
  if (mode === "invalid-analysis-shape" && analysisPrompt) {
    return {
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ bugs: [], not_bugs: [] }) } }] },
    };
  }

  if (rerunPrompt) {
    const data = JSON.parse(rerunPrompt);
    if (mode === "rerun-none" || data.project_context.mode !== "readme") {
      return { status: 200, body: { choices: [{ message: { content: JSON.stringify({ found: false, candidates: [] }) } }] } };
    }
    const project = data.project_context || {};
    const candidates = project.mode === "readme"
      ? (project.allowedScripts || [])
        .filter((file) => !data.previously_seen_candidates.some((candidate) => candidate.file === file && candidate.function === "Update()"))
        .filter((file) => !data.excluded_candidates_with_developer_reasons.some((candidate) => candidate.file === file && candidate.function === "Update()"))
        .slice(0, 2)
        .map((file) => ({
          file,
          function: "Update()",
          line: "",
          confidence: "중간",
          reason: "README에서 해당 스크립트의 기능을 확인했습니다.",
          why_different: "제외 후보와 다른 스크립트의 기능을 검토했습니다.",
        }))
      : [];
    return {
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ found: candidates.length > 0, candidates }) } }] },
    };
  }

  if (analysisPrompt) {
    const reports = parseAnalysisPrompt(analysisPrompt);
    const result = mode === "empty-bugs"
      ? { bugs: [], not_bugs: reports.map((report) => report.report_id), unclear: [] }
      : sampleGroups(reports);
    return { status: 200, body: { choices: [{ message: { content: JSON.stringify(result) } }] } };
  }

  const bugs = parseLocationPrompt(locationPrompt || "");
  const result = fakeLocations(bugs, mode === "multi-candidate");
  return { status: 200, body: { choices: [{ message: { content: JSON.stringify(result) } }] } };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

export async function startMockLlm() {
  let mode = "normal";
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid request" }));
      return;
    }

    requests.push({
      method: request.method,
      path: request.url,
      hasAuthorizationHeader: Boolean(request.headers.authorization),
      model: body.model,
      mode,
      messages: body.messages,
    });
    if (mode === "unauthorized") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "test provider unauthorized" } }));
      return;
    }
    if (mode === "delay") await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));

    try {
      const result = fakeProviderPayload(mode, body);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });

  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    setMode(nextMode) { mode = nextMode; },
    close() { return new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())); },
  };
}

async function waitForApp(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`BugPin 서버가 조기에 종료됐습니다 (code ${child.exitCode}).`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`BugPin 서버 준비 시간 초과: ${lastError?.message || "HTTP 응답이 없습니다."}`);
}

export async function startMockNotion() {
  let mode = "normal";
  let markdown = "# Notion README body\n\n- `PlayerMovement.cs` — Moves the player.\n\nThis is the full page body, not only its title.";
  const requests = [];
  const pages = new Map();
  const databaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const dataSourceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let nextPageId = 1;
  let nextBlockId = 1;
  const schema = {
    "버그": { type: "title", title: {} },
    "담당자": { type: "rich_text", rich_text: {} },
    "마감일": { type: "date", date: {} },
    "등록일": { type: "date", date: {} },
    "우선순위": { type: "select", select: { options: ["높음", "보통", "낮음"].map((name) => ({ name })) } },
    "상태": { type: "select", select: { options: ["계획됨", "보류", "완료"].map((name) => ({ name })) } },
    "위치": { type: "rich_text", rich_text: {} },
    "파일": { type: "rich_text", rich_text: {} },
    "함수": { type: "rich_text", rich_text: {} },
    "줄": { type: "rich_text", rich_text: {} },
    "메모": { type: "rich_text", rich_text: {} },
    "버그 ID": { type: "rich_text", rich_text: {} },
  };
  const server = createServer(async (request, response) => {
    const requestMode = mode;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = null;
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
    }
    requests.push({
      method: request.method,
      path: request.url,
      hasAuthorizationHeader: Boolean(request.headers.authorization),
      notionVersion: request.headers["notion-version"],
      body,
    });

    const send = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;

    if (mode === "permission-denied") {
      send(403, { object: "error", code: "restricted_resource", message: "test page is not shared" });
      return;
    }
    if (mode === "unauthorized") {
      send(401, { object: "error", code: "unauthorized", message: "test token invalid" });
      return;
    }
    if (mode === "not-found") {
      send(404, { object: "error", code: "object_not_found", message: "test page missing" });
      return;
    }
    if (requestMode === "delay") await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));

    if (path === "/v1/pages/11111111-2222-4333-8444-555555555555/markdown" && request.method === "GET") {
      send(200, { markdown: requestMode === "empty" ? "  \n  " : markdown });
      return;
    }
    if (path === `/v1/databases/${databaseId}` && request.method === "GET") {
      send(200, { object: "database", id: databaseId, data_sources: [{ id: dataSourceId, name: "BugPin plans" }] });
      return;
    }
    if (path === `/v1/data_sources/${dataSourceId}` && request.method === "GET") {
      const resultSchema = requestMode === "bad-schema"
        ? {
          ...schema,
          "버그": { type: "rich_text", rich_text: {} },
          "담당자": { type: "select", select: { options: [] } },
        }
        : schema;
      send(200, { object: "data_source", id: dataSourceId, properties: resultSchema });
      return;
    }
    if (path === `/v1/data_sources/${dataSourceId}/query` && request.method === "POST") {
      const requestedBugId = body?.filter?.rich_text?.equals || "";
      const matching = [...pages.values()].filter((page) => {
        const property = page.properties?.["버그 ID"];
        const value = (property?.rich_text || []).map((part) => part.text?.content || part.plain_text || "").join("");
        return !page.archived && value === requestedBugId;
      });
      send(200, { object: "list", results: matching.map((page) => ({ ...page, object: "page" })), has_more: false, next_cursor: null });
      return;
    }
    if (path === "/v1/pages" && request.method === "POST") {
      if (requestMode === "validation-fail") {
        const submittedAssignee = body?.properties?.["담당자"]?.rich_text
          ?.map((part) => part.text?.content || "").join("") || "";
        const submittedCode = body?.children?.find((block) => block.type === "code")?.code?.rich_text
          ?.map((part) => part.text?.content || "").join("") || "";
        send(400, {
          object: "error",
          code: "validation_error",
          message: `body.children[4].code.language should be c#; body.properties.담당자.rich_text[0].text.content rejected (${submittedAssignee}; ${submittedCode})`,
        });
        return;
      }
      if (requestMode === "create-fail") {
        send(403, { object: "error", code: "restricted_resource", message: "mock write denied" });
        return;
      }
      const id = `cccccccc-cccc-4ccc-8ccc-${String(nextPageId++).padStart(12, "0")}`;
      const page = {
        id,
        url: `https://www.notion.so/${id.replace(/-/g, "")}`,
        parent: { type: "data_source_id", data_source_id: body?.parent?.data_source_id },
        properties: body?.properties || {},
        children: (body?.children || []).map((child) => ({ id: `block-${nextBlockId++}`, ...child, in_trash: false })),
        archived: false,
      };
      pages.set(id, page);
      send(200, { object: "page", id, url: page.url, parent: page.parent, properties: page.properties });
      return;
    }
    const pageMatch = path.match(/^\/v1\/pages\/([0-9a-f-]+)$/i);
    if (pageMatch && request.method === "GET") {
      const page = pages.get(pageMatch[1]);
      if (!page) {
        send(404, { object: "error", code: "object_not_found" });
        return;
      }
      send(200, { ...page, object: "page" });
      return;
    }
    if (pageMatch && request.method === "PATCH") {
      if (requestMode === "update-fail") {
        send(500, { object: "error", code: "mock_update_failed", message: "mock failure detail must stay private" });
        return;
      }
      const page = pages.get(pageMatch[1]);
      if (!page) {
        send(404, { object: "error", code: "object_not_found" });
        return;
      }
      page.properties = { ...page.properties, ...(body?.properties || {}) };
      send(200, { ...page, object: "page" });
      return;
    }
    const blockChildrenMatch = path.match(/^\/v1\/blocks\/([0-9a-f-]+)\/children$/i);
    if (blockChildrenMatch && request.method === "GET") {
      const page = pages.get(blockChildrenMatch[1]);
      if (!page) {
        send(404, { object: "error", code: "object_not_found" });
        return;
      }
      send(200, { object: "list", results: page.children.filter((child) => !child.in_trash), has_more: false, next_cursor: null });
      return;
    }
    if (blockChildrenMatch && request.method === "PATCH") {
      const page = pages.get(blockChildrenMatch[1]);
      if (!page) {
        send(404, { object: "error", code: "object_not_found" });
        return;
      }
      const added = (body?.children || []).map((child) => ({ id: `block-${nextBlockId++}`, ...child, in_trash: false }));
      page.children.push(...added);
      send(200, { object: "list", results: added, has_more: false, next_cursor: null });
      return;
    }
    const blockMatch = path.match(/^\/v1\/blocks\/(block-[0-9]+)$/);
    if (blockMatch && request.method === "PATCH") {
      const blockId = blockMatch[1];
      const block = [...pages.values()].flatMap((page) => page.children).find((child) => child.id === blockId);
      if (!block) {
        send(404, { object: "error", code: "object_not_found" });
        return;
      }
      if (body?.in_trash === true || body?.archived === true) block.in_trash = true;
      send(200, { ...block, object: "block" });
      return;
    }

    send(404, { object: "error", code: "object_not_found", message: "unhandled mock endpoint" });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    pages,
    databaseId,
    dataSourceId,
    setMode(nextMode) { mode = nextMode; },
    setMarkdown(nextMarkdown) { markdown = nextMarkdown; },
    close() { return new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())); },
  };
}

export async function startBugPinServer(mockUrl, options = {}) {
  const portServer = createServer();
  const port = await listen(portServer);
  await new Promise((resolveClose, rejectClose) => portServer.close((error) => error ? rejectClose(error) : resolveClose()));

  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: process.env.HOME || "/tmp",
      NODE_ENV: "test",
      PORT: String(port),
      LLM_API_KEY: "bugpin-test-only-key",
      LLM_BASE_URL: mockUrl,
      NOTION_TOKEN: options.notionToken || "",
      NOTION_PAGE_ID: options.notionPageId || "",
      NOTION_PLAN_DATABASE_ID: options.notionPlanDatabaseId || "",
      NOTION_API_BASE_URL: options.notionApiBaseUrl || "",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk.slice(0, 4000); });

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForApp(url, child);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}${stderr ? `\n${stderr}` : ""}`);
  }

  return {
    url,
    process: child,
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

export async function startBugPinTestEnvironment(options = {}) {
  const mock = await startMockLlm();
  let notion = null;
  try {
    if (options.notionConfigured) notion = await startMockNotion();
    const app = await startBugPinServer(mock.url, {
      notionToken: options.notionConfigured ? "notion-test-only-token" : "",
      notionPageId: options.notionConfigured ? "11111111-2222-4333-8444-555555555555" : "",
      notionPlanDatabaseId: options.notionConfigured ? notion?.databaseId : "",
      notionApiBaseUrl: notion?.url,
    });
    return {
      app,
      mock,
      notion,
      async close() {
        await app.close();
        await mock.close();
        if (notion) await notion.close();
      },
    };
  } catch (error) {
    await mock.close();
    if (notion) await notion.close();
    throw error;
  }
}

export async function postJson(baseUrl, pathname, value) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

export function viewModelFromAnalysis(result, reports) {
  return normalizeAnalysisForView(result, reports);
}

export function buildAmbiguousTestReport() {
  return {
    report_id: "RTEST-UNCLEAR",
    reporter: "test-only",
    created_at: "2026-11-21 12:00",
    text: "가끔 이상해요",
  };
}
