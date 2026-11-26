# 🐞📍 BugPin

> 흩어진 QA 제보를 버그 단위로 묶고, 해당 버그가 코드 어디에 있는지 살펴보는 AI 도구

BugPin은 게임 QA 제보 정리와 버그 위치 추적을 돕는 게임 QA 워크스페이스입니다.

1. 제보 CSV를 올리면 짓다 플랫폼의 `jitda-chat`이 중복 제보를 버그 묶음으로 정리합니다.
2. 프로젝트 README 또는 GitHub 저장소를 연결하면 버그마다 의심 스크립트와 함수를 제안합니다.
3. GitHub 코드 분석에서는 실제 코드 인용과 줄 번호를 확인하고, 후보가 맞지 않으면 개발자 피드백을 반영해 다른 위치를 다시 찾습니다.
4. 위치를 확정한 뒤 담당자·마감일·우선순위·메모가 있는 수정 계획을 저장하고 JSON으로 내보낼 수 있습니다.
5. 팀 전용 환경에서는 지정한 Notion 페이지의 Markdown 본문을 README로 불러와 같은 위치 분석 흐름에 사용할 수 있습니다.

AI 부트캠프 팀 프로젝트입니다. 짓다 플랫폼의 바이브 코딩 환경과 짓다 제공 LLM으로 만들었습니다.

## 목차

- [주요 기능](#주요-기능)
- [이용 흐름](#이용-흐름)
- [데모용 샘플 데이터](#데모용-샘플-데이터)
- [빠른 시작](#빠른-시작)
- [환경 변수](#환경-변수)
- [입력 파일 형식](#입력-파일-형식)
- [API](#api)
- [수정 계획 데이터와 저장](#수정-계획-데이터와-저장)
- [프로젝트 구조](#프로젝트-구조)
- [테스트](#테스트)
- [한계와 다음 계획](#한계와-다음-계획)
- [팀](#팀)

## 주요 기능

| 기능 | 설명 |
|---|---|
| 제보 CSV 불러오기 | CSV 업로드 또는 샘플 20건 불러오기를 지원합니다. 따옴표, 쉼표, 여러 줄 제보, 빈 줄과 UTF-8/엑셀 CP949 인코딩을 처리합니다. |
| 중복 제보 묶기 | AI가 같은 증상의 제보를 버그 제목·증상·제보 ID와 함께 묶습니다. 건의·감상은 `not_bugs`, 정보가 부족한 제보는 `unclear`로 분리합니다. |
| 원문 보기 | 버그 묶음에서 대표 제보를 먼저 보고 나머지 원문을 펼칠 수 있습니다. 제보 ID, 작성자, 작성 시각과 원문을 유지합니다. |
| README 기반 의심 위치 | README에 적힌 스크립트 기능 설명을 바탕으로 후보 스크립트·함수·이유를 추정합니다. README에는 실제 코드가 없으므로 실제 줄 번호나 코드 근거로 표시하지 않습니다. |
| Notion README 불러오기 | 서버에 지정된 Notion 페이지 한 개의 Markdown 본문을 가져와 업로드 README와 같은 분석 경로에 전달합니다. |
| GitHub 코드 기반 의심 위치 | 저장소의 C# 코드를 읽고 관련 코드 후보, 실제 파일·함수·줄, 코드 인용, 확인된 사실과 원인 추정을 구분해 표시합니다. GitHub 접근은 읽기 전용입니다. |
| 개발자 피드백 재탐색 | 후보별 또는 전체 후보에 “여기 아님” 사유와 힌트를 남기면, 이미 검토하거나 제외한 위치를 피해서 다시 탐색합니다. 새 후보는 `2차 탐색`, `3차 탐색`처럼 표시합니다. |
| 후보 선택·확정 | 후보가 여러 개면 신뢰도 높은 순으로 선택할 수 있습니다. 여러 위치를 함께 선택할 수도 있으며, 확정 위치를 버그 카드에 표시합니다. |
| 수정 계획 | 확정 위치마다 담당자·마감일·우선순위·메모를 저장합니다. 마감일 기준 D-day를 보여 주고 계획 JSON을 다운로드할 수 있습니다. |

## 이용 흐름

```text
제보 CSV 업로드
      ↓
분석 시작 · 중복 제보 그룹화
      ↓
README 업로드 또는 GitHub 저장소 연결
      ↓
의심 위치 분석
      ↓
후보 확인 ── 맞음 ──→ 위치 확정 → 수정 계획 입력
   │
   └── 여기 아님 → 이유·힌트 입력 → 다른 후보 재탐색
```

## 데모용 샘플 데이터

| 파일 | 용도 |
|---|---|
| `sample_reports.csv` | 화면의 “샘플 20건 불러오기”에 쓰이는 제보 CSV입니다. 중복 표현의 버그 제보와 기능 요청·감상이 함께 있습니다. |
| `sample_README.md` | 화면의 “샘플 README 불러오기”에 쓰이는 프로젝트 설명입니다. 버그 정답은 넣지 않고 스크립트 10개의 기능만 설명합니다. |
| `__assets__/sample_reports.csv` | 작업 공간에서 제공한 확장 검증 자료입니다. 약 100건의 제보가 있으며 저장소에 포함되거나 앱 런타임에서 사용되지는 않습니다. |
| `__assets__/README.md` | 작업 공간에서 제공한 Slime Hunt 상세 코드 지도입니다. 폴더·오브젝트·스크립트 흐름을 설명하는 로컬 참고 자료이며 저장소/배포 산출물에는 포함되지 않습니다. |

확장 시연 자료는 버그 5개를 심은 Unity 탑다운 2D 몬스터 사냥 게임 `Slime Hunt`와 더미 QA 제보를 설명합니다. 코드 지도에서 다루는 대표 증상 범주는 다음과 같습니다. 스크립트 표기는 시연용 참고 정보이지 실제 AI 결과를 보장하는 정답표가 아닙니다.

| 증상 예시 | 먼저 살펴볼 스크립트 예시 |
|---|---|
| 몬스터를 처치해도 화면에 남음 | `MonsterHealth.cs` |
| 스킬 이펙트가 사라지지 않음 | `SkillEffect.cs`, `PlayerSkill.cs` |
| 대각선 이동이 더 빠름 | `PlayerMovement.cs` |
| 접촉 피해로 체력이 급격히 감소함 | `PlayerHealth.cs` |
| 몬스터가 플레이어에게서 도망감 | `MonsterChase.cs` |

`sample_reports.csv`처럼 제공된 정확한 데모 자료를 분석할 때 LLM 호출이 인증·연결 오류로 실패하면 미리 준비된 예시 결과가 반환될 수 있습니다. 이 응답에는 `X-BugPin-Demo: temporary` 헤더가 붙고 화면에도 “실제 AI 분석이 아닙니다”라고 표시됩니다. 데모 응답은 실제 AI 추론이나 분류 정확도 검증으로 보면 안 됩니다.

## 빠른 시작

### 필요 환경

- Node.js 22.9 이상 권장 (`node --env-file-if-exists` 지원 버전)
- npm
- 별도 npm 패키지는 설치하지 않습니다. 브라우저 E2E 테스트에는 개발 환경의 `agent-browser`가 필요합니다.

### 실행

```sh
git clone https://github.com/ksw-0409/jitda-project.git
cd jitda-project
cp .env.example .env
# .env에 짓다 LLM 주소와 키를 설정합니다.
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 다음 순서로 확인할 수 있습니다.

```text
샘플 20건 불러오기 → 분석 시작 → 샘플 README 불러오기 → 의심 위치 찾기
```

개발 서버는 파일 변경을 자동 반영합니다. 일반 실행은 `npm start`를 사용합니다. `PORT`를 따로 주지 않으면 3000번 포트를 사용하고, 서버는 `0.0.0.0`에서 수신합니다.

## 환경 변수

`.env.example`에는 변수 이름만 있습니다. 실제 키는 `.env` 또는 실행 환경의 서버 환경 변수에 설정하고, `.env`는 저장소에 커밋하지 마세요.

| 변수 | 필수 여부 | 설명 |
|---|---|---|
| `LLM_API_KEY` | 실제 AI 분석에 필수 | 짓다 플랫폼 LLM API 키입니다. 서버에서만 읽으며 브라우저에 전달하지 않습니다. |
| `LLM_BASE_URL` | 실제 AI 분석에 필수 | 짓다 플랫폼의 Chat Completions 호환 기본 주소 또는 완성된 `/chat/completions` 주소입니다. 완성 경로가 없으면 서버가 붙입니다. 모델은 `jitda-chat`입니다. |
| `GITHUB_TOKEN` | 선택 | 비공개 저장소 접근이나 GitHub API 한도 확대에 사용합니다. 공개 저장소는 토큰 없이도 조회할 수 있습니다. 저장소 읽기 권한만 부여하세요. |
| `NOTION_TOKEN` | Notion 기능 사용 시 필수 | Notion internal integration 토큰입니다. 서버에서만 사용합니다. |
| `NOTION_PAGE_ID` | Notion 기능 사용 시 필수 | README 본문을 가져올 Notion 일반 페이지 한 개의 ID입니다. |
| `PORT` | 선택 | 서버 포트입니다. 기본값은 `3000`입니다. |

```dotenv
LLM_API_KEY=
LLM_BASE_URL=
GITHUB_TOKEN=
NOTION_TOKEN=
NOTION_PAGE_ID=
# PORT=3000
```

BugPin은 `OPENAI_API_KEY`를 사용하지 않습니다. LLM API 호출은 모델 `jitda-chat`을 사용하고 서버에서 수행합니다.

## 입력 파일 형식

### 제보 CSV

다음 열이 모두 필요하며 `report_id`는 중복될 수 없습니다.

```csv
report_id,reporter,created_at,text
R001,tester01,2026-11-20 14:02,슬라임 잡았는데 회색으로 변하고 안 없어져요
R002,tester02,2026-11-20 14:10,대각선으로 가면 캐릭터가 더 빨라짐
R003,tester03,2026-11-20 14:15,몹 처치해도 시체가 계속 남아있음
R004,tester04,2026-11-20 14:21,"쉼표나 줄바꿈이 들어간 문장은 큰따옴표로 감쌉니다.
두 번째 줄도 같은 제보의 원문입니다."
```

### 프로젝트 README (`.md`)

스크립트 경로 또는 이름과 기능 설명을 적습니다. README 분석은 적힌 스크립트 안에서만 후보를 반환하며, 함수명과 이유는 문서 설명을 바탕으로 한 추정입니다. 실제 코드 줄이나 확정 원인으로 취급하지 마세요.

```markdown
## 스크립트 구성
- `PlayerMovement.cs` — 입력 방향에 따라 플레이어를 이동합니다.
- `MonsterHealth.cs` — 몬스터 체력과 사망 상태를 관리합니다.
```

기본 제공 `sample_README.md`에는 다음 10개 스크립트의 기능 설명이 있습니다.

`PlayerMovement`, `PlayerHealth`, `PlayerSkill`, `SkillEffect`, `MonsterChase`, `MonsterHealth`, `MonsterSpawner`, `GameManager`, `PlayerHealthUI`, `ScoreUI`.

### Notion 일반 페이지

Notion README 불러오기는 서버 환경 변수로 지정한 일반 페이지 한 개의 Markdown 본문을 읽습니다. 페이지 제목만 가져오는 방식이 아닙니다.

1. [Notion integrations](https://www.notion.so/my-integrations)에서 internal integration을 만들고 콘텐츠 읽기 권한을 줍니다.
2. README가 있는 Notion 페이지의 `Share` 메뉴에서 해당 integration을 페이지에 초대합니다. integration에 공유되지 않은 페이지는 권한 오류가 납니다.
3. 페이지 URL에서 page ID를 확인하고, 짓다의 서버 측 환경 변수 설정에 `NOTION_TOKEN`과 `NOTION_PAGE_ID`를 입력합니다.
4. 서버를 다시 시작한 다음 화면의 `README 업로드` 탭에서 `노션 README 불러오기`를 누릅니다. 본문을 가져오면 README 업로드와 같은 `window.bugPinReadme` 상태에 저장되며, 기존 `의심 위치 찾기`가 같은 `/api/locate` 경로로 분석합니다.

짓다 배포의 서버 환경 변수 설정 화면에서 위 값을 등록하세요. 브라우저 코드, 요청 응답, 로그에 토큰을 직접 넣지 마세요. 저장된 `NOTION_TOKEN`은 서버가 Notion API를 호출할 때만 사용하고, `NOTION_PAGE_ID`는 가져올 페이지를 지정합니다.

`NOTION_TOKEN`과 `NOTION_PAGE_ID`를 서버 환경 변수에 설정하면 `/api/notion/readme`를 별도 기능 플래그 없이 바로 사용할 수 있습니다. 두 변수 중 하나라도 빠졌다면 API가 `503` 설정 안내를 반환합니다.

보안 주의: BugPin에는 로그인이 없으므로 서버에 Notion 토큰과 페이지 ID를 설정하면 `/api/notion/readme`에 접근할 수 있는 모든 사람이 연결된 페이지 본문을 읽을 수 있습니다. 비공개 프로젝트 README를 사용할 때는 앱 자체에 인증/접근 제한을 추가하거나 팀 전용 네트워크 뒤에서 실행하세요. Notion integration은 필요한 페이지에만 공유하고, 민감한 페이지를 연결하지 마세요.

Notion API 응답에 Markdown 본문이 비어 있으면 422, integration 인증이 잘못되면 401, 페이지 공유 권한이 없으면 403, 페이지 ID를 찾지 못하면 404로 안내합니다. 실패한 경우 화면에 이미 불러온 README 본문은 유지됩니다.

### GitHub 저장소

공개 저장소 또는 서버 토큰이 접근할 수 있는 비공개 저장소 주소를 입력합니다.

```text
https://github.com/<owner>/<repo>
https://github.com/<owner>/<repo>/tree/<branch>
```

기본 브랜치 또는 지정한 브랜치의 `.cs` 파일을 찾습니다. 연결 정보는 서버 메모리에 30분 보관됩니다. 코드 분석은 파일·요청 크기를 제한해 관련 파일을 선별하고, 변경·커밋·브랜치 작업은 하지 않습니다.

## API

분석·GitHub API는 같은 출처의 `POST` JSON 요청입니다. Notion 본문 API는 `GET`입니다. 실제 구현에는 CORS를 열어 두지 않았습니다.

| 엔드포인트 | 역할 | 주요 요청 필드 |
|---|---|---|
| `/api/analyze` | 제보 그룹화 | `reports` |
| `/api/locate` | README 기반 후보 찾기 | `bugs`, `readme` |
| `/api/github/connect` | GitHub 저장소·브랜치 연결 및 C# 파일 목록 조회 | `repoUrl` |
| `/api/github/file` | 연결된 저장소의 C# 파일 읽기 | `connectionId`, `path` |
| `/api/github/analyze-code` | 실제 GitHub 코드 기반 위치 분석 | `connectionId`, `bugs` |
| `/api/locate-again` | 개발자 피드백을 반영해 다른 후보 재탐색 | `bug`, `reports`, `feedback`, `excluded`, `seen_candidates`, `round`, `readme` 또는 `connectionId`; GitHub에서는 선택적으로 `seen_files` · `POST` |
| `/api/notion/readme` | 설정된 Notion 페이지의 Markdown 본문 가져오기 | 서버 환경 변수 `NOTION_TOKEN`, `NOTION_PAGE_ID` · `GET` |

### `/api/analyze`

요청의 `reports`는 CSV에서 파싱한 객체 배열입니다. 응답은 반드시 `bugs`, `not_bugs`, `unclear` 세 배열을 포함합니다.

```json
{
  "bugs": [
    {
      "bug_id": "BUG-1",
      "title": "대각선 이동 속도가 더 빠름",
      "symptom": "대각선 이동 시 직선보다 속도가 빨라집니다.",
      "report_ids": ["R002", "R006"],
      "related_to": null
    }
  ],
  "not_bugs": ["R008"],
  "unclear": ["R019"]
}
```

- `not_bugs`: 기능 요청·감상처럼 버그가 아닌 제보 ID
- `unclear`: 증상이 모호해 판단을 보류한 제보 ID
- `related_to`: 현재 버그가 다른 버그의 결과일 가능성이 있을 때 관련 `bug_id`, 아니면 `null`
- 한 제보에 서로 다른 버그가 직접 포함되면 해당 제보 ID가 여러 버그 묶음에 포함될 수 있습니다.
- LLM 응답은 서버에서 제보 ID와 JSON 구조를 검사합니다. 형식이 잘못되면 최초 요청 뒤 최대 2회 재요청합니다.

### `/api/locate`

README에 적힌 스크립트 이름만 허용합니다. 각 버그 결과는 `{ bug_id, suspects, confidence }`이며 `suspects` 항목은 `{ script, function, reason }`입니다. 일치하는 스크립트를 찾지 못하면 빈 `suspects`를 반환합니다.

### `/api/notion/readme`

이 경로는 `GET` 요청입니다. `NOTION_TOKEN`과 `NOTION_PAGE_ID`가 서버에 설정되어 있으면 별도 활성화 플래그 없이 서버가 아래 Notion API를 호출합니다. 설정이 누락되면 `503`을 반환합니다. 앱에는 로그인이 없으므로 비공개 페이지를 연결할 때는 배포 환경 자체를 보호하세요.

```text
GET https://api.notion.com/v1/pages/{NOTION_PAGE_ID}/markdown
Authorization: Bearer <NOTION_TOKEN>
Notion-Version: 2026-03-11
```

`NOTION_TOKEN` 또는 `NOTION_PAGE_ID`가 설정되지 않았으면 `503`을 반환합니다. Notion API의 `markdown` 본문 문자열을 `{ "markdown": "..." }` 형태로 반환하며 제목이나 요약만 반환하지 않습니다. `NOTION_TOKEN`은 서버에서만 사용하며 응답이나 로그에 기록하지 않습니다.

### `/api/github/connect`와 `/api/github/file`

연결 성공 시 `connectionId`, 저장소명, 브랜치, C# 파일 개수와 파일 목록을 돌려줍니다. 파일 내용 조회에는 이 연결 ID와 파일 경로가 필요합니다. `GITHUB_TOKEN`은 서버 내부의 GitHub API 요청에만 사용됩니다.

### `/api/github/analyze-code`

요청은 `{ connectionId, bugs }`입니다. 응답은 버그별 `status`, `candidates`, `reviewed_files`와 설명을 포함합니다. 후보 코드 인용이 GitHub 원본과 일치할 때만 서버가 실제 함수와 줄 범위를 계산합니다.

### `/api/locate-again`

버그 요약과 제보 원문, 이전 후보, 제외 후보와 개발자 사유를 짓다 LLM에 전달합니다. README 모드에서는 README와 스크립트 후보만 전달하며 `line`은 비워 둡니다. GitHub 모드에서는 이전에 검토하지 않은 실제 C# 파일을 가져와 인용과 줄 범위를 검증합니다.

```json
{
  "found": true,
  "candidates": [
    {
      "file": "PlayerMovement.cs",
      "function": "Move",
      "line": "",
      "confidence": "중간",
      "reason": "README의 기능 설명과 증상이 연결됩니다.",
      "why_different": "이전 후보와 다른 이동 처리 스크립트입니다."
    }
  ]
}
```

응답에는 검증된 후보의 `source`, `round`가 추가될 수 있으며, GitHub 모드에서는 실제 줄 범위와 코드도 포함됩니다. 후보를 찾지 못하면 `found: false`, 빈 `candidates`를 반환합니다.

## 수정 계획 데이터와 저장

계획은 서버나 외부 서비스로 전송하지 않습니다. 현재 브라우저의 `localStorage`에 다음 형태로 저장하고, 새로고침 후 같은 브라우저와 출처에서 다시 읽습니다.

```json
{
  "bug_id": "BUG-1",
  "bug_title": "접촉 피해가 너무 큼",
  "location": {
    "file": "PlayerHealth.cs",
    "function": "TakeDamage",
    "lines": "L20-L26"
  },
  "assignee": "강승우",
  "due_date": "2026-12-03",
  "priority": "high",
  "memo": "OnCollisionStay2D에 피격 쿨타임 추가",
  "status": "planned",
  "created_at": "2026-11-26T01:00:00.000Z",
  "updated_at": "2026-11-26T01:00:00.000Z"
}
```

- 우선순위 값: `high`, `medium`, `low`
- 상태 값: `planned`, `on_hold`, `done`. 현재 화면은 위치를 다시 선택하는 동안 `on_hold`를 사용합니다. `done` 값은 이후 상태 연동을 위한 스키마 값이며, 완료 처리 UI는 아직 없습니다.
- 저장 키: `bugpin.fix-plans.v1`; 담당자 자동완성 이름은 `bugpin.fix-plan-assignees.v1`에 별도로 저장합니다.
- 버그 카드의 마감일/우선순위 정렬은 계획이 있는 항목을 우선 표시하며, 계획이 없는 버그의 기존 제보 건수 순서는 유지합니다.
- “수정 계획 JSON 내보내기” 버튼은 저장된 계획 전체를 `bugpin-fix-plans.json`으로 다운로드합니다.
- 브라우저 저장 공간을 지우거나 다른 브라우저·기기에서 열면 계획이 공유되지 않습니다. 서버 백업이나 Notion 연동은 없습니다.

## 프로젝트 구조

```text
.
├── README.md
├── index.html                 # 업로드, 결과·후보·수정 계획 화면
├── server.js                  # 정적 파일/API 서버, 짓다 LLM·읽기 전용 GitHub 연동,
│                              # 팀 전용 Notion Markdown 본문 읽기
├── analysis-view-model.js     # CSV 파싱 및 화면용 분석 결과 정리
├── fix-plan-model.js          # 수정 계획 날짜·검증·마감일·JSON 모델
├── package.json               # dev/start 및 테스트 명령
├── .env.example               # 환경 변수 이름만 제공
├── sample_reports.csv         # 데모 제보 20건
├── sample_README.md           # 데모용 스크립트 설명 10개
└── test/
    ├── unit/                  # CSV·화면 데이터·수정 계획 단위 테스트
    ├── integration/           # 로컬 가짜 LLM을 이용한 API 테스트
    ├── e2e/                   # 실제 브라우저 전체 흐름 테스트
    └── helpers/               # 테스트용 서버와 가짜 LLM
```

작업 공간에서 추가로 제공된 `__assets__/` 자료는 로컬 참고/테스트용이며 저장소에 포함되지 않습니다. 앱은 이 경로를 런타임에서 참조하지 않습니다.

### 설계와 보안

- 외부 npm 런타임 의존성 없이 Node.js 내장 `node:http`와 브라우저 JavaScript를 사용합니다.
- 짓다 LLM은 서버에서 `LLM_API_KEY`, `LLM_BASE_URL`, `jitda-chat`으로 호출합니다. 키는 브라우저 응답에 포함되지 않습니다.
- GitHub는 `GET` API로만 읽습니다. 코드 수정, 커밋, 브랜치 변경을 하지 않습니다.
- 실제 코드 위치는 LLM의 추정만으로 확정하지 않습니다. 코드 인용이 원본과 일치하는지 검사하고, 일치할 때만 줄 번호를 계산합니다.
- GitHub 연결은 서버 메모리에서 30분 유지됩니다. C# 파일 목록은 최대 1,000개까지 표시하고, 한 파일 300KB 초과분은 열지 않습니다. 분석은 최대 버그 30개와 후보 C# 파일 20개로 제한합니다.
- 특정 정밀 스크립트/함수/라인은 정답으로 단정하지 말고 실제 게임 프로젝트 코드에서 다시 확인해야 합니다.

## 테스트

Node.js 내장 `node:test`를 사용하며 패키지 설치 없이 실행합니다.

```sh
npm run test:unit          # 단위 테스트
npm run test:integration   # API 통합 테스트 (로컬 가짜 LLM, 실제 API 키 불필요)
npm run test:e2e           # agent-browser 기반 실제 브라우저 E2E
npm test                   # 단위·통합·E2E 전체
```

E2E는 브라우저에서 CSV 불러오기, 분석, 버그/원문 펼치기, README 의심 위치, 개발자 피드백 재탐색, 후보 선택/확정, 수정 계획 입력·저장·보류, JSON 내보내기와 모바일 레이아웃을 검사합니다. 테스트용 LLM 응답은 앱 동작과 API 계약을 검증하기 위한 것이며 실제 AI 분류 정확도 측정은 아닙니다.

## 한계와 다음 계획

### 현재 한계

- 버그 그룹화와 원인 분석은 AI 보조입니다. 최종 버그 판정과 수정 책임은 개발자에게 있습니다.
- README 방식은 기능 설명에서 후보를 추정할 뿐 실제 코드 내용이나 줄 번호를 확인하지 않습니다.
- GitHub 코드 분석은 C# 파일 중심의 제한된 후보 검색입니다. 저장소 전체에서 모든 가능한 경로를 증명하는 정적 분석기는 아닙니다.
- 수정 계획은 브라우저 로컬 데이터이며 사용자 간 동기화·서버 백업이 없습니다.
- 데모 fallback은 제공된 정확한 샘플 데이터에만 대응하고, 화면에 임시 결과임을 표시합니다.

### 다음 계획

- [ ] 여러 사용자 간 수정 계획 공유를 위한 저장소/권한 설계
- [ ] 수정 완료 상태(`done`)를 설정하고 변경 이력을 남기는 UI
- [ ] 요청이 있을 때 Notion 또는 이슈 관리 도구로 계획을 내보내는 연동

현재 프로젝트에는 수정 계획을 Notion에 보내는 연동 버튼이나 외부 수정 API가 없습니다. Notion 기능은 README 본문을 읽어 오는 용도만 지원합니다.

## 팀

AI 부트캠프 팀 프로젝트 · 짓다 플랫폼 바이브 코딩과 짓다 제공 LLM으로 제작
