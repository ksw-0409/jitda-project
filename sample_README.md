# 탑다운 2D Unity 게임

## 스크립트 구성

- `PlayerMovement.cs` — 입력된 방향에 따라 플레이어의 이동과 바라보는 방향을 처리합니다.
- `PlayerHealth.cs` — 플레이어의 체력, 피해 적용, 회복 상태를 관리합니다.
- `PlayerSkill.cs` — 플레이어의 스킬 입력, 사용 조건, 재사용 대기 시간을 관리합니다.
- `SkillEffect.cs` — 스킬이 발동할 때 화면에 표시되는 시각 효과를 재생합니다.
- `MonsterChase.cs` — 주변의 플레이어를 감지하고 목표를 향해 이동하는 동작을 처리합니다.
- `MonsterHealth.cs` — 몬스터의 체력과 처치 상태를 관리합니다.
- `MonsterSpawner.cs` — 게임 진행에 맞춰 몬스터를 생성합니다.
- `GameManager.cs` — 게임 진행 상태와 일시 정지, 재시작 흐름을 관리합니다.
- `PlayerHealthUI.cs` — 플레이어의 현재 체력을 화면에 표시합니다.
- `ScoreUI.cs` — 플레이어가 얻은 점수를 화면에 표시합니다.
