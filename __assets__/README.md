# Slime Hunt 코드 지도

QA 제보를 읽고 어느 스크립트와 함수를 확인해야 하는지 추정하기 위한 문서다. 프로젝트 구조, 오브젝트 구성, 스크립트별 기능, 스크립트 사이의 흐름, 증상 분류별 확인 대상을 정리한다.

- 기준 시점: 2026-11-21
- 엔진: Unity 6 (6000.3.24f1), C#, 2D 물리(Rigidbody2D), Input System(`Keyboard.current` 직접 읽기)
- 게임 스크립트: 11개, `Assets/Scripts/` 아래


## 1. 게임 개요

- 장르: 탑다운 2D 몬스터(슬라임) 사냥
- 코어 루프: 이동 -> 몬스터 접근 -> 스킬로 처치 -> 점수 획득 -> 체력 0이면 게임오버 -> 재시작
- 맵: 벽으로 둘러싼 직사각형 경기장 하나(`Assets/Scenes/Main.unity`)

| 조작 | 키 | 처리 스크립트 |
|---|---|---|
| 이동 | W A S D / 방향키 | `PlayerMovement` |
| 스킬 | Space | `PlayerSkill` |
| 재시작 (게임오버 후) | R | `GameManager` |


## 2. 폴더 구조

```
Assets/
  Scripts/
    Core/        GameManager.cs              점수, 게임오버, 재시작 (싱글톤)
    Player/      PlayerMovement.cs           플레이어 이동
                 PlayerHealth.cs             플레이어 체력, 접촉 피해, 사망
                 PlayerSkill.cs              스킬 입력, 쿨타임, 이펙트 생성
    Skill/       SkillEffect.cs              스킬 이펙트의 범위 피해
    Monster/     MonsterChase.cs             몬스터 추적 이동
                 MonsterHealth.cs            몬스터 체력, 피해, 사망
                 MonsterSpawner.cs           몬스터 주기 생성
    UI/          PlayerHealthUI.cs           체력바, 체력 숫자 표시
                 ScoreUI.cs                  점수 숫자 표시
    Animation/   CharacterWalkAnimation.cs   걷기/정지 애니메이션 전환 (플레이어, 슬라임 공용)
  Editor/        SlimeHuntSceneBuilder.cs    씬, 프리팹, 스프라이트, 애니메이션 생성 에디터 도구 (게임 실행 중에는 동작하지 않음)
  Prefabs/       Player.prefab, Slime.prefab, SkillEffect.prefab
  Scenes/        Main.unity
  Art/           Sprites/(도트 스프라이트), Animations/(Idle, Walk 클립과 컨트롤러)
```


## 3. 런타임 오브젝트 구성

| 오브젝트 | 위치 | 붙은 스크립트와 주요 컴포넌트 |
|---|---|---|
| Player | 씬 (Player 프리팹) | `PlayerMovement`, `PlayerHealth`, `PlayerSkill`, `CharacterWalkAnimation`, Rigidbody2D, Collider2D, SpriteRenderer, Animator |
| Slime | `MonsterSpawner`가 실행 중 생성 (Slime 프리팹) | `MonsterChase`, `MonsterHealth`, `CharacterWalkAnimation`, Rigidbody2D, Collider2D, SpriteRenderer, Animator |
| SkillEffect | `PlayerSkill`이 스킬 사용 시 생성 (SkillEffect 프리팹) | `SkillEffect`, SpriteRenderer (원형 링) |
| GameManager | 씬 | `GameManager` (플레이어 Transform, 게임오버 패널 참조) |
| MonsterSpawner | 씬 | `MonsterSpawner` (Slime 프리팹 참조) |
| Canvas | 씬 | `PlayerHealthUI`(왼쪽 위 체력 패널), `ScoreUI`(오른쪽 위 점수 패널), 게임오버 패널 |
| 벽, 바닥 | 씬 | 벽은 Collider2D를 가진 정적 오브젝트 |

몬스터 판별은 태그가 아니라 `MonsterHealth` 컴포넌트 유무로 한다.


## 4. 스크립트별 기능

### 4.1 GameManager
- 경로: `Assets/Scripts/Core/GameManager.cs`
- 책임: 점수 보관, 게임오버 처리, 재시작. 다른 스크립트는 `GameManager.Instance`로 접근한다.
- 필드: `playerTransform`(플레이어 위치 제공), `gameOverPanel`(게임오버 UI)
- 공개 속성: `Score`, `IsGameOver`, `PlayerTransform`
- 함수
  - `Awake()`: 싱글톤 등록, `Time.timeScale` 1로 초기화, 게임오버 패널 숨김
  - `OnDestroy()`: 싱글톤 해제
  - `Update()`: 게임오버 상태에서 R 키를 누르면 `RestartGame()` 호출
  - `AddScore(int amount)`: 점수 추가 (게임오버 후에는 무시)
  - `GameOver()`: 게임오버 상태 설정, `Time.timeScale` 0, 게임오버 패널 표시 (한 번만 실행)
  - `RestartGame()`: 시간 복구 후 현재 씬 다시 로드
- 호출하는 곳: `MonsterHealth`(점수), `PlayerHealth`(게임오버), 대부분의 스크립트(`IsGameOver` 확인)

### 4.2 PlayerMovement
- 경로: `Assets/Scripts/Player/PlayerMovement.cs`
- 책임: 키보드 입력으로 플레이어 이동
- 필드: `moveSpeed`(이동 속도)
- 함수
  - `Update()`: 매 프레임 `ReadInput()` 호출
  - `FixedUpdate()`: 매 물리 프레임 `Move()` 호출
  - `ReadInput()`: WASD/방향키를 읽어 가로, 세로 입력 값(-1, 0, 1) 저장. 게임오버면 입력 0
  - `Move()`: 입력 값과 `moveSpeed`로 Rigidbody2D `linearVelocity` 설정, 좌우 입력에 따라 스프라이트 flipX
- 관련: `CharacterWalkAnimation`(속도를 보고 애니메이션 전환), `GameManager`(게임오버 확인)

### 4.3 PlayerHealth
- 경로: `Assets/Scripts/Player/PlayerHealth.cs`
- 책임: 플레이어 체력, 몬스터 접촉 피해, 사망
- 필드: `maxHealth`(최대 체력), `contactDamage`(몬스터 접촉 피해량)
- 공개 속성: `CurrentHealth`, `MaxHealth`
- 함수
  - `Awake()`: 현재 체력을 최대 체력으로 초기화
  - `OnCollisionStay2D(Collision2D)`: 몬스터와 충돌해 있는 동안 물리 엔진이 호출. 상대가 몬스터면 `TakeDamage(contactDamage)` 호출
  - `TakeDamage(int damage)`: 체력 감소(0 아래로 내려가지 않음), 0이 되면 `Die()`
  - `Die()`: 사망 상태 설정 후 `GameManager.Instance.GameOver()` 호출
- 관련: `PlayerHealthUI`(체력 표시), `MonsterHealth`(몬스터 판별), `GameManager`

### 4.4 PlayerSkill
- 경로: `Assets/Scripts/Player/PlayerSkill.cs`
- 책임: 스킬 입력, 쿨타임, 스킬 이펙트 생성
- 필드: `skillEffectPrefab`(생성할 이펙트), `skillCooldown`(쿨타임 초)
- 공개 속성: `RemainingCooldown`
- 함수
  - `Update()`: 남은 쿨타임 감소, Space 입력과 쿨타임 종료를 확인해 `UseSkill()` 호출. 게임오버면 입력 무시
  - `UseSkill()`: 쿨타임 재설정, 플레이어 위치에 스킬 이펙트 프리팹 생성
- 관련: `SkillEffect`(생성된 이펙트의 동작), `GameManager`

### 4.5 SkillEffect
- 경로: `Assets/Scripts/Skill/SkillEffect.cs`
- 책임: 스킬 이펙트 오브젝트. 생성된 위치를 중심으로 범위 안 몬스터에게 피해
- 필드: `skillDamage`(피해량), `damageRadius`(피해 반경)
- 함수
  - `Start()`: 생성 시 `Physics2D.OverlapCircleAll`로 반경 안 콜라이더를 찾아, `MonsterHealth`가 있으면 `TakeDamage(skillDamage)` 호출
  - `OnDrawGizmosSelected()`: 에디터에서 피해 반경 표시 (게임 동작과 무관)
- 관련: `PlayerSkill`(생성 주체), `MonsterHealth`(피해 대상)

### 4.6 MonsterChase
- 경로: `Assets/Scripts/Monster/MonsterChase.cs`
- 책임: 몬스터가 플레이어를 쫓아 이동
- 필드: `chaseSpeed`(추적 속도)
- 함수
  - `Awake()`: Rigidbody2D, `MonsterHealth`, SpriteRenderer 참조
  - `Start()`: `GameManager.Instance.PlayerTransform`으로 플레이어 위치 참조
  - `FixedUpdate()`: 사망, 플레이어 없음, 게임오버면 속도 0. 아니면 `ChasePlayer()` 호출
  - `ChasePlayer()`: 몬스터와 플레이어 위치로 이동 방향을 계산해 `chaseSpeed`로 `linearVelocity` 설정, 이동 방향에 따라 스프라이트 flipX
- 관련: `MonsterHealth`(사망 여부), `GameManager`(플레이어 위치, 게임오버), `CharacterWalkAnimation`

### 4.7 MonsterHealth
- 경로: `Assets/Scripts/Monster/MonsterHealth.cs`
- 책임: 몬스터 체력, 피해, 사망 처리
- 필드: `maxHealth`(최대 체력), `scoreValue`(처치 점수), `deadColor`(사망 시 색)
- 공개 속성: `IsDead`
- 함수
  - `Awake()`: 체력 초기화, Rigidbody2D, SpriteRenderer, Collider2D 참조
  - `TakeDamage(int damage)`: 체력 감소, 0이 되면 `Die()`. 이미 죽었으면 무시
  - `Die()`: 몬스터 사망 처리(사망 상태 전환, 사망 표시, `GameManager.Instance.AddScore(scoreValue)` 호출). 한 번만 실행
- 관련: `SkillEffect`(피해 원인), `MonsterChase`(사망 시 이동 정지), `PlayerHealth`(접촉 판별), `GameManager`(점수)

### 4.8 MonsterSpawner
- 경로: `Assets/Scripts/Monster/MonsterSpawner.cs`
- 책임: 일정 간격으로 맵 가장자리에 몬스터 생성
- 필드: `monsterPrefab`, `spawnInterval`(생성 간격 초), `spawnAreaHalfWidth`, `spawnAreaHalfHeight`(생성 영역 반 너비, 반 높이)
- 함수
  - `Update()`: 게임오버가 아니면 타이머를 누적해 간격마다 `SpawnMonster()` 호출
  - `SpawnMonster()`: `GetRandomEdgePosition()` 위치에 몬스터 프리팹 생성
  - `GetRandomEdgePosition()`: 위, 아래, 왼쪽, 오른쪽 변 중 하나를 골라 그 변 위의 임의 지점 반환
- 관련: `GameManager`(게임오버 확인)

### 4.9 PlayerHealthUI
- 경로: `Assets/Scripts/UI/PlayerHealthUI.cs`
- 책임: 플레이어 체력을 체력바와 숫자로 표시
- 필드: `playerHealth`, `healthFillImage`(채움 바), `healthTrailImage`(잔상 바), `healthText`(숫자), `healthColorGradient`(체력 비율별 색), `trailFollowSpeed`(잔상 바 속도)
- 함수
  - `Update()`: 체력 비율로 채움 바 길이와 색, `현재 / 최대` 숫자 갱신. 잔상 바는 unscaled 시간으로 천천히 따라감
- 관련: `PlayerHealth`(값을 읽기만 함)

### 4.10 ScoreUI
- 경로: `Assets/Scripts/UI/ScoreUI.cs`
- 책임: 현재 점수 표시, 점수가 오르면 숫자를 잠깐 키웠다가 되돌림
- 필드: `scoreText`, `popScale`(커지는 배율), `popRecoverSpeed`(되돌아오는 속도)
- 함수
  - `Update()`: `GameManager.Instance.Score`가 바뀌면 텍스트 갱신과 확대, 매 프레임 크기를 1로 되돌림
- 관련: `GameManager`(점수를 읽기만 함)

### 4.11 CharacterWalkAnimation
- 경로: `Assets/Scripts/Animation/CharacterWalkAnimation.cs`
- 책임: Rigidbody2D 실제 속도를 보고 걷기/정지 애니메이션 전환 (플레이어, 슬라임 공용)
- 필드: `walkSpeedThreshold`(걷기로 판단하는 최소 속도)
- 함수
  - `Update()`: `UpdateWalkAnimation()` 호출
  - `UpdateWalkAnimation()`: 속도가 기준값보다 크면 Animator `IsWalking` 켬, 아니면 끔
- 관련: `PlayerMovement`, `MonsterChase`(속도를 정하는 쪽). 이 스크립트는 속도를 바꾸지 않는다.

## 5. 상호작용 흐름

```
[이동]   키 입력 -> PlayerMovement.ReadInput() -> PlayerMovement.Move() -> Rigidbody2D 속도
                                                                  -> CharacterWalkAnimation

[공격]   Space -> PlayerSkill.Update() -> PlayerSkill.UseSkill() -> SkillEffect 생성
         -> SkillEffect.Start() -> MonsterHealth.TakeDamage() -> MonsterHealth.Die()
         -> GameManager.AddScore() -> ScoreUI.Update()

[몬스터] MonsterSpawner.Update() -> SpawnMonster() -> Slime 생성
         -> MonsterChase.FixedUpdate() -> MonsterChase.ChasePlayer() -> Rigidbody2D 속도

[피격]   플레이어-몬스터 충돌 -> PlayerHealth.OnCollisionStay2D() -> PlayerHealth.TakeDamage()
         -> PlayerHealthUI.Update()
         -> 체력 0 -> PlayerHealth.Die() -> GameManager.GameOver() (시간 정지, 패널 표시)

[재시작] R -> GameManager.Update() -> GameManager.RestartGame() -> 씬 다시 로드
```

게임오버 중에는 `PlayerMovement`, `PlayerSkill`, `MonsterChase`, `MonsterSpawner`가 `GameManager.Instance.IsGameOver`를 보고 동작을 멈춘다.


## 6. 증상 분류별 확인 대상

제보에 나온 대상(누가)과 현상(무엇이)을 보고 아래 표에서 먼저 볼 스크립트를 고른다.

| 증상 분류 (제보 예시 표현) | 먼저 볼 스크립트 / 함수 | 함께 볼 스크립트 |
|---|---|---|
| 플레이어 이동 속도, 이동 방향, 키 반응, 캐릭터가 바라보는 방향 | `PlayerMovement` / `ReadInput()`, `Move()` | `CharacterWalkAnimation` |
| 플레이어가 피해를 받는 방식, 체력이 줄어드는 양이나 빈도 | `PlayerHealth` / `OnCollisionStay2D()`, `TakeDamage()` | `MonsterHealth` |
| 플레이어 사망, 게임오버 진입 | `PlayerHealth` / `Die()` | `GameManager` / `GameOver()` |
| 체력바, 체력 숫자 표시 | `PlayerHealthUI` / `Update()` | `PlayerHealth` |
| 스킬이 안 나감, 쿨타임, 연속 사용 | `PlayerSkill` / `Update()`, `UseSkill()` | `GameManager` |
| 스킬 이펙트 모양, 화면에 남는 방식, 범위, 피해량 | `SkillEffect` / `Start()` | `PlayerSkill`, `MonsterHealth` |
| 몬스터 이동, 추적, 이동 방향, 이동 속도 | `MonsterChase` / `FixedUpdate()`, `ChasePlayer()` | `GameManager` |
| 몬스터가 맞았을 때, 처치됐을 때, 처치 후의 모습 | `MonsterHealth` / `TakeDamage()`, `Die()` | `SkillEffect`, `MonsterChase` |
| 몬스터 생성 위치, 생성 간격, 생성 수 | `MonsterSpawner` / `Update()`, `GetRandomEdgePosition()` | `GameManager` |
| 점수가 오르지 않음, 점수가 잘못 오름 | `MonsterHealth` / `Die()` | `GameManager` / `AddScore()` |
| 점수 숫자 표시, 점수 연출 | `ScoreUI` / `Update()` | `GameManager` |
| 게임오버 후 화면, 시간 정지, R 재시작 | `GameManager` / `GameOver()`, `Update()`, `RestartGame()` | 각 스크립트의 `IsGameOver` 확인 |
| 걷기 애니메이션, 멈춰 있을 때의 모습 | `CharacterWalkAnimation` / `UpdateWalkAnimation()` | `PlayerMovement`, `MonsterChase` |
| 스프라이트 모양, 맵 배치, 벽, 프리팹 연결 | `SlimeHuntSceneBuilder` (에디터), 프리팹 | - |

판단 요령
- 속도, 방향처럼 "움직임"에 관한 제보는 해당 오브젝트의 이동 스크립트(`PlayerMovement`, `MonsterChase`)가 1순위다. 애니메이션 스크립트는 속도를 읽기만 한다.
- 화면에 보이는 값(체력, 점수)이 이상하면 UI 스크립트와 값을 바꾸는 스크립트를 둘 다 본다. UI 스크립트는 값을 읽기만 한다.
- 오브젝트가 생성되고 사라지는 시점에 관한 제보는 그 오브젝트를 생성하는 스크립트와 그 오브젝트 자신의 스크립트를 함께 본다. (스킬 이펙트: `PlayerSkill`, `SkillEffect` / 몬스터: `MonsterSpawner`, `MonsterHealth`)
