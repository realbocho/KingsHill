# KingsHill — 배당금(Yield) 시스템 패치

슬롯 점유 시간에 비례해 **실제 TON**을 지급하고, 그 금액을 **보너스 없이 즉시 출금 가능**하게 만드는 패치입니다.

- 24시간 만점 = **1 TON** (초당 1/86400 TON, 선형 적립)
- 적립분은 `wallet` + `withdrawable_balance` 양쪽에 들어가 곧바로 출금 가능
- 유지시간 옵션은 **24시간까지**로 제한
- 플랫폼은 의도적으로 손해를 봄 → 운영자가 커스터디 지갑에 TON을 채워 지급을 커버

> ⚠️ 이 패치는 **additive-only** 입니다. 라이브 DB가 레포 마이그레이션보다 앞서 있어(GitHub에 없는 컬럼 · 손수 편집된 `place_bid`), 기존 함수(`place_bid`, `request_withdrawal`)는 절대 `create or replace` 하지 않습니다. 새 컬럼·테이블·함수·트리거만 추가합니다.

## 포함 파일

| 파일 | 상태 | 설명 |
|---|---|---|
| `supabase/migrations/009_yield_system.sql` | 신규 | 컬럼/트리거/함수/감사 테이블 + 기존 행 rebase |
| `src/app/api/yield/route.ts` | 신규 | 청구 가능액 조회 (GET) |
| `src/app/api/yield/claim/route.ts` | 신규 | 배당금 청구 (POST, rate-limit) |
| `src/app/api/bid/route.ts` | 수정 | 유지시간 서버 clamp 168h → 24h |
| `src/app/api/cron/cleanup/route.ts` | 수정 | 종료된 점유의 배당금 자동 정산 추가 |
| `src/components/BidModal.tsx` | 수정 | 유지시간 [1,6,12,24]h, 예상 배당금 + 안내 문구 |
| `src/components/WalletTab.tsx` | 수정 | 배당금 카드 + Claim 버튼 + `💧` 아이콘 |
| `src/types/database.ts` | 수정 | occupancy 배당금 필드 타입 추가 |

## 적용 방법

1. 위 파일들을 레포의 동일 경로에 덮어쓰기/추가한다.
2. **Supabase SQL Editor에서 `009_yield_system.sql`을 실행한다.** (실행 전까지는 기능이 꺼진 상태이며, 함수가 없어도 크론은 에러 로그만 남기고 죽지 않는다.)
3. 커스터디 지갑(`TON_WALLET_MNEMONIC`)에 배당금 지급을 커버할 TON을 넣어둔다.
4. 배포 후 확인: 슬롯을 점유하면 Wallet 탭 배당금 카드의 금액이 시간에 따라 증가하고, `Claim` → `Withdraw`가 정상 동작하는지 본다.

## 요율 조정

`009_yield_system.sql` 안의 `kh_yield_config()` 한 줄만 바꾸면 됩니다.

```sql
select 1.0::numeric, 86400::numeric;   -- max_ton = 1 TON, window = 24h(초)
```

- 예: 24시간에 0.5 TON → `select 0.5::numeric, 86400::numeric;`
- 예: 48시간에 1 TON → `select 1.0::numeric, 172800::numeric;` (이 경우 BidModal의 유지시간 상한도 함께 늘려야 함)

## 안전장치 요약

- **이중 지급 방지**: 점유별 `yield_claimed` high-water mark로 idempotent
- **소급 지급 방지**: 마이그레이션에서 기존 행을 현재 적립치로 rebase
- **정확한 종료 시점**: 트리거가 `is_active` false 전환 순간 `ended_at`을 찍어, displaced/만료 후 시간엔 적립 안 됨
- **앱을 닫아도 지급**: cleanup 크론이 종료된 점유를 자동 정산
