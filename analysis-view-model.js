const suspectStatusViews = Object.freeze({
  unanalysed: { label: "미분석", kind: "unanalysed" },
  analyzing: { label: "분석 중", kind: "analyzing" },
  candidate: { label: "후보 있음", kind: "candidate" },
  unavailable: { label: "위치 특정 불가", kind: "unavailable" },
  location_confirmed: { label: "위치 확인", kind: "location_confirmed" },
  location_unavailable: { label: "위치 확인 불가", kind: "location_unavailable" },
  code_missing_suspected: { label: "코드 누락 의심", kind: "code_missing_suspected" },
});

export const requiredColumns = ["report_id", "reporter", "created_at", "text"];

export function parseCsvRecords(csv) {
  const records = [];
  let record = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (insideQuotes) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else if (character === "\r") {
        field += "\n";
        if (csv[index + 1] === "\n") index += 1;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      insideQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (insideQuotes) throw new Error("unclosed-quote");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((row) => row.some((value) => value.trim() !== ""));
}

export function parseReports(csv) {
  if (typeof csv !== "string" || !csv.trim()) throw new Error("empty-file");
  const records = parseCsvRecords(csv);
  if (records.length === 0) throw new Error("empty-file");

  const headers = records.shift().map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) throw new Error(`missing-columns:${missingColumns.join(",")}`);
  if (records.length === 0) throw new Error("no-reports");

  return records.map((row) => Object.fromEntries(requiredColumns.map((column) => {
    return [column, row[headers.indexOf(column)] ?? ""];
  })));
}

export function normalizeAnalysisForView(result, reports) {
  if (!result || !Array.isArray(result.bugs) || !Array.isArray(result.not_bugs) || !Array.isArray(result.unclear)) {
    throw new TypeError("분석 결과에 bugs, not_bugs, unclear 배열이 필요합니다.");
  }
  if (!Array.isArray(reports)) throw new TypeError("제보 목록은 배열이어야 합니다.");

  const reportIds = new Set(reports.map((report) => report.report_id));
  const bugs = result.bugs
    .map((bug) => ({ ...bug, report_ids: [...new Set(bug.report_ids.filter((id) => reportIds.has(id)))] }))
    .filter((bug) => bug.report_ids.length > 0)
    .sort((first, second) => second.report_ids.length - first.report_ids.length || first.title.localeCompare(second.title, "ko"));
  const bugReportIds = new Set(bugs.flatMap((bug) => bug.report_ids));
  const not_bugs = [...new Set(result.not_bugs.filter((id) => reportIds.has(id) && !bugReportIds.has(id)))];
  const notBugIds = new Set(not_bugs);
  const unclear = [...new Set(result.unclear.filter((id) => reportIds.has(id) && !bugReportIds.has(id) && !notBugIds.has(id)))];

  return { bugs, not_bugs, unclear };
}

export function getSuspectStatusPresentation(status) {
  return suspectStatusViews[status] || suspectStatusViews.unavailable;
}

export function getReadmeLocationPresentation(location, isTemporary = false) {
  const suspects = Array.isArray(location?.suspects) ? location.suspects : [];
  const hasCandidates = suspects.length > 0;
  return {
    status: hasCandidates ? "candidate" : "unavailable",
    confidence: location?.confidence || "",
    candidates: suspects.map((suspect) => ({
      script: suspect.script || "스크립트 미특정",
      function: suspect.function || "함수 미특정",
      reason: suspect.reason || "근거 확인 필요",
      confidence: suspect.confidence || location?.confidence || "",
      label: "README 기반 의심 후보",
      reasonLabel: "의심 이유 (README 기능 설명 기반)",
    })),
    note: isTemporary
      ? "임시 샘플 결과이며 실제 AI 분석이 아닙니다. README만으로 실제 코드와 줄 번호를 확인할 수 없어 근거 확인 필요."
      : "README는 기능 설명만 제공하므로 실제 코드와 줄 번호의 근거가 아닙니다. GitHub 연결 후 실제 코드를 확인해 주세요. 근거 확인 필요.",
  };
}
