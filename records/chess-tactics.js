/**
 * chess-tactics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 전술 감지 모듈 (포크 / 절대 핀 / 상대 핀)
 *
 * ── 설계 원칙 ──────────────────────────────────────────────────────────────
 *
 * 핀과 포크를 "카운트 증감 비교" 방식이 아닌,
 * 체스 정의에서 직접 출발하는 기하학적 방식으로 감지합니다.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [포크 정의]
 *   하나의 기물이 이동 후 상대 기물 2개 이상을 동시에 공격하며,
 *   그 공격이 실질적 위협인 상태.
 *
 * [포크 감지 조건 - 모두 충족해야 함]
 *   1. 이동 후 해당 기물이 실질적 위협 대상 ≥ 2개
 *   2. 체크포크가 아닌 경우: 이동 기물이 즉시 잡히지 않는 안전한 자리
 *   3. [핵심] 이동 전 출발지에서 이미 같은 대상들을 위협하지 않았어야 함
 *   4. [1수 전술] 이동 전 위치에서 이미 실질 위협 ≥ 2개였으면 제외
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [핀 종류 및 감지 방식]
 *
 * [절대 핀 Absolute Pin]
 *   공격자(B/R/Q) → 피핀 기물(N↑) → 적 킹 이 일직선.
 *   피핀 기물이 움직이면 킹이 체크에 노출 → 이동 불법.
 *
 * [상대 핀 Relative Pin]
 *   공격자(B/R/Q) → 피핀 기물(N↑) → 적 고가치 기물(R/Q) 이 일직선.
 *   shield 가치 > 피핀 가치 + RELATIVE_PIN_MARGIN.
 *   규칙상 움직일 수 있지만 실리적으로 불리.
 *
 * [핀 공통 조건]
 *   - 피핀 기물이 N 이상 가치여야 함 (폰 제외)
 *   - 이동 후 적 킹이 체크이면 제외 (체크가 주 전술)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [핀 놓침 판정 방식 - 엔진 3개 라인 비교]
 *
 * SF MultiPV=3 으로 분석한 3개 라인의 첫 수를 각각 핀 여부 검사.
 * 내가 선택한 수(actualUci)가 핀 수가 아닐 때:
 *   1. 엔진 3개 라인 중 핀 라인이 1개 이상 존재하는지 확인
 *   2. 핀 라인의 평가치 - 내 수의 평가치 ≥ PIN_PV_DIFF_THRESHOLD 이면 "놓침"
 *   3. 평가치 차이가 임계값 미만이면 카운트하지 않음
 *      → "어떤 수를 둬도 비슷한 결과"인 포지션에서의 오탐 방지
 *
 * classifyPvsByPin(pvs, prevState, color) 가 이 역할을 담당합니다.
 * 반환: { pinPvs: [{uci, cp, absolute, relative}], nonPinPvs: [...] }
 *
 * ── 수정 이력 ──────────────────────────────────────────────────────────────
 * [수정 1] 경로 B(발견 핀) 오탐 수정
 * [수정 2] 피핀 기물 폰 오탐 수정
 * [수정 3] 포크 1수 전술 필터
 * [수정 4] 상대 핀(Relative Pin) 감지 추가
 * [수정 5] 핀 놓침 판정: 기하학적 단독 판정 → 엔진 3개 라인 비교 방식으로 전환
 *          classifyPvsByPin() 함수 신규 추가.
 *          detectPinCreated() → { absolute, relative } 반환 유지 (found 판정용).
 *          doesBestMoveCreatePin() 제거 → analyzer에서 classifyPvsByPin() 사용.
 * [수정 6] 상대 핀 조건 수정: RELATIVE_PIN_MARGIN 제거 → shield >= pinned 로 완화
 *          기존: shield >= pinned + 150 → 동가치 기물 간 핀 미탐지
 *          수정: shield >= pinned → 피핀이 이동하면 shield가 공격에 노출되는 경우 인정
 *          예) bBe4 → wRc2(500) → wRb1(500): 동가치지만 실질 핀 → 탐지됨
 *          오탐 방지: shield < pinned (피핀>shield, 이동이 오히려 이득) → 여전히 제외
 *
 * [수정 7] 상대 핀 오탐 수정: 공격자-피핀 동일 기물 타입 제외 조건 추가
 *          기존: bB→wB→wQ 케이스가 핀으로 카운팅됨 (오탐)
 *          원인: 공격자(bB)가 피핀(wB)을 잡으면 교환(동가치)이 일어나고
 *                공격자도 사라지므로 shield(wQ)에 대한 압박이 소멸함.
 *                즉 "교환 후 위협 지속"이 없으므로 실질적 핀이 아님.
 *          수정: pt === firstPiece.piece[1] 이면 핀 인정 안 함
 *          예) bB→wB→wQ (B→B 동종): 오탐 제거 ✓
 *              bB→wN→wQ (B→N 이종): 정상 탐지 유지 ✓
 *              bQ→wN→wQ (Q→N 이종): 정상 탐지 유지 ✓
 *
 * 의존성: chess-engine.js (전역 함수들 사용)
 *
 * 외부에 노출하는 주요 함수:
 *   PIECE_VALUE
 *   isValidFork(board, color, toPos, prevBoard)
 *     → boolean
 *   detectPinCreated(prevBoard, nextBoard, move, color)
 *     → { absolute: boolean, relative: boolean }
 *   classifyPvsByPin(pvs, prevState, color)
 *     → { pinPvs: PvPinInfo[], nonPinPvs: PvPinInfo[] }
 *
 * PvPinInfo 형태:
 *   { uci: string, cp: number, mate: number|null, absolute: boolean, relative: boolean }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const PIECE_VALUE = { P:100, N:320, B:330, R:500, Q:900, K:20000 };

// 핀으로 인정하는 피핀 기물 최소 가치 (폰 제외, 나이트 이상)
const PIN_MIN_PINNED_VALUE = PIECE_VALUE['N']; // 320

// 상대 핀 shield로 인정하는 최소 기물 가치 (비숍 이상 인정)
// 나이트(320) 이하를 shield로 쓰는 라인은 상대 핀으로 보지 않음
// 예) R→N→B: 비숍(330)이 shield → 인정
//     R→N→N: 나이트(320)이 shield → 제외 (동가치 교환이라 실질 압박 없음)
const RELATIVE_PIN_SHIELD_MIN = PIECE_VALUE['B']; // 330

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function isSquareAttackedBy(board, r, c, attackerColor) {
  for (let ar = 0; ar < 8; ar++) for (let ac = 0; ac < 8; ac++) {
    const p = board[ar][ac];
    if (!p || p[0] !== attackerColor) continue;
    const ms = pseudoMoves(board, ar, ac, {wK:false,wQ:false,bK:false,bQ:false}, null);
    if (ms.some(m => m.to[0] === r && m.to[1] === c)) return true;
  }
  return false;
}

function getAttackers(board, r, c, attackerColor) {
  const result = [];
  for (let ar = 0; ar < 8; ar++) for (let ac = 0; ac < 8; ac++) {
    const p = board[ar][ac];
    if (!p || p[0] !== attackerColor) continue;
    const ms = pseudoMoves(board, ar, ac, {wK:false,wQ:false,bK:false,bQ:false}, null);
    if (ms.some(m => m.to[0] === r && m.to[1] === c))
      result.push({ r:ar, c:ac, piece:p });
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// 포크 판정
// ════════════════════════════════════════════════════════════════════════════

/**
 * 보드의 [r,c]에 있는 기물이 실질적으로 위협하는 적 기물 목록을 반환.
 */
function _getRealThreats(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || piece[0] !== color) return [];

  const enemy      = enemyColor(color);
  const movedValue = PIECE_VALUE[piece[1]];

  const ps = pseudoMoves(board, r, c, {wK:false,wQ:false,bK:false,bQ:false}, null);
  const threats = [];

  for (const m of ps) {
    const t = board[m.to[0]][m.to[1]];
    if (!t || t[0] !== enemy) continue;

    const tVal = PIECE_VALUE[t[1]];

    if (t[1] === 'K') {
      threats.push({ r:m.to[0], c:m.to[1], piece:t });
    } else if (tVal >= movedValue + 150) {
      threats.push({ r:m.to[0], c:m.to[1], piece:t });
    } else {
      const defenders = getAttackers(board, m.to[0], m.to[1], enemy)
        .filter(a => !(a.r === r && a.c === c));
      if (defenders.length === 0 && tVal >= movedValue) {
        threats.push({ r:m.to[0], c:m.to[1], piece:t });
      }
    }
  }

  return threats;
}

/**
 * 포크 유효성 검증
 * @param {Array}  board     - 이동 후 보드
 * @param {string} color     - 이동한 쪽 색상
 * @param {Array}  toPos     - 이동한 목적지 [r, c]
 * @param {Array}  prevBoard - 이동 전 보드
 * @returns {boolean}
 */
function isValidFork(board, color, toPos, prevBoard) {
  const [tr, tc] = toPos;
  if (!board[tr][tc]) return false;

  const threatsAfter = _getRealThreats(board, tr, tc, color);
  if (threatsAfter.length < 2) return false;

  const piece = board[tr][tc];
  const movedValue = PIECE_VALUE[piece[1]];
  const kingThreats = threatsAfter.filter(t => t.piece[1] === 'K');
  const nonKingThreats = threatsAfter.filter(t => t.piece[1] !== 'K');

  // 체크(킹 포함) 포크는 "실질적 이득"이 생길 때만 인정.
  // 킹+폰(또는 킹+저가치 기물)처럼 바로 정리되는 체크는 포크로 세지 않는다.
  // 기준: 킹을 포함한 경우, 동시에 위협하는 비킹 기물이 최소 나이트 이상이어야 함.
  if (kingThreats.length > 0) {
    const hasValuableNonKing = nonKingThreats.some(t => PIECE_VALUE[t.piece[1]] >= PIECE_VALUE['N']);
    if (!hasValuableNonKing) return false;
  }

  const isCheckFork = kingThreats.length > 0;

  if (!isCheckFork && isSquareAttackedBy(board, tr, tc, enemyColor(color))) return false;

  let prevR = -1, prevC = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r === tr && c === tc) continue;
    if (prevBoard[r][c] === piece && board[r][c] !== piece) { prevR = r; prevC = c; break; }
    if (prevR >= 0) break;
  }

  if (prevR >= 0) {
    const threatsBefore = _getRealThreats(prevBoard, prevR, prevC, color);
    const prevSet = new Set(threatsBefore.map(t => t.r + ',' + t.c));

    const newThreats = threatsAfter.filter(t => !prevSet.has(t.r + ',' + t.c));
    if (newThreats.length === 0) return false;

    if (threatsBefore.length >= 2) return false;
  }

  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 핀 판정 - 내부 기하학 함수
// ════════════════════════════════════════════════════════════════════════════

/**
 * [r,c]의 슬라이딩 기물(B/R/Q)이 적 킹을 향한 라인에 절대 핀을 만드는지 확인.
 * @param {Array}  board
 * @param {number} r
 * @param {number} c
 * @param {string} color - 슬라이딩 기물(공격자)의 색상
 * @returns {boolean}
 */
function _isAbsolutePinFromSquare(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || piece[0] !== color) return false;
  const pt = piece[1];
  if (!['B', 'R', 'Q'].includes(pt)) return false;

  const enemy = enemyColor(color);

  let kr = -1, kc = -1;
  for (let pr = 0; pr < 8; pr++) for (let pc = 0; pc < 8; pc++)
    if (board[pr][pc] === enemy + 'K') { kr = pr; kc = pc; }
  if (kr < 0) return false;

  const directions = [];
  if (pt === 'B' || pt === 'Q') directions.push([-1,-1],[-1,1],[1,-1],[1,1]);
  if (pt === 'R' || pt === 'Q') directions.push([-1,0],[1,0],[0,-1],[0,1]);

  for (const [dr, dc] of directions) {
    let nr = r + dr, nc = c + dc;
    let firstPiece = null;

    while (isInBounds(nr, nc)) {
      const sq = board[nr][nc];
      if (sq) {
        if (!firstPiece) {
          firstPiece = { r:nr, c:nc, piece:sq };
        } else {
          if (sq === enemy + 'K' && firstPiece.piece[0] === enemy) {
            if (PIECE_VALUE[firstPiece.piece[1]] < PIN_MIN_PINNED_VALUE) break;
            const test = board.map(row => [...row]);
            test[firstPiece.r][firstPiece.c] = null;
            if (isInCheck(test, enemy)) return true;
          }
          break;
        }
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

// 하위 호환 별칭
const _isPinningFromSquare = _isAbsolutePinFromSquare;

/**
 * [r,c]의 슬라이딩 기물(B/R/Q)이 라인 위에 상대 핀을 만드는지 확인.
 *
 * 구조: 공격자(B/R/Q) → 피핀(N↑, 적) → shield(R/Q, 적) 이 일직선
 *
 * [핀 인정 조건]
 *   1. 피핀 기물 가치 >= PIN_MIN_PINNED_VALUE (폰 제외)
 *   2. shield 기물 가치 >= RELATIVE_PIN_SHIELD_MIN (최소 룩 이상)
 *   3. shield 가치 >= 피핀 가치
 *      → 피핀이 이동하면 shield가 공격자에게 노출되어 손해가 되는 경우만 인정
 *      → 피핀 < shield: 피핀 잃어도 더 비싼 shield 노출 → 실질 핀
 *      → 피핀 = shield: 피핀 잃으면 동가치 shield 노출 → 실질 핀 (예: Be4↗Rc2↗Rb1)
 *      → 피핀 > shield: 피핀이 이동하는 것이 오히려 이득 → 핀 아님 (예: Q핀 on R-line)
 *
 * 예) bBe4 → wRc2(피핀 R=500) → wRb1(shield R=500): 500>=500 → 핀 ✓
 *     bBe4 → wNf5(피핀 N=320) → wRg6(shield R=500): 500>=320 → 핀 ✓
 *     bBe4 → wQf5(피핀 Q=900) → wRg6(shield R=500): 500>=900 → 핀 아님 ✓
 *
 * @param {Array}  board
 * @param {number} r
 * @param {number} c
 * @param {string} color - 슬라이딩 기물(공격자)의 색상
 * @returns {boolean}
 */
function _isRelativePinFromSquare(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || piece[0] !== color) return false;
  const pt = piece[1];
  if (!['B', 'R', 'Q'].includes(pt)) return false;

  const enemy = enemyColor(color);

  const directions = [];
  if (pt === 'B' || pt === 'Q') directions.push([-1,-1],[-1,1],[1,-1],[1,1]);
  if (pt === 'R' || pt === 'Q') directions.push([-1,0],[1,0],[0,-1],[0,1]);

  for (const [dr, dc] of directions) {
    let nr = r + dr, nc = c + dc;
    let firstPiece = null;

    while (isInBounds(nr, nc)) {
      const sq = board[nr][nc];
      if (sq) {
        if (!firstPiece) {
          // 첫 번째 기물: 적의 N 이상 가치 기물이어야 함 (폰 제외)
          if (sq[0] !== enemy) break;
          if (PIECE_VALUE[sq[1]] < PIN_MIN_PINNED_VALUE) break;
          firstPiece = { r:nr, c:nc, piece:sq };
        } else {
          // 두 번째 기물: 적의 shield
          if (sq[0] !== enemy) break;
          if (sq[1] === 'K') break; // 킹은 절대 핀이 담당

          const shieldVal = PIECE_VALUE[sq[1]];
          const pinnedVal = PIECE_VALUE[firstPiece.piece[1]];

          // shield가 최소 기준(룩 이상) 미만이면 무시
          if (shieldVal < RELATIVE_PIN_SHIELD_MIN) break;

          // [추가 조건] 공격자와 피핀이 동일 기물 타입이면 상대 핀으로 인정하지 않음.
          // 예) bB→wB→wQ: 비숍끼리 교환 후 우연히 뒤에 퀸이 있는 상황.
          //     이 경우 공격자가 피핀을 잡으면 교환(동가치)이 일어나고
          //     공격자도 사라지므로 shield에 대한 압박이 없어짐 → 핀 아님.
          // 예) bB→wN→wQ: 다른 타입 → 핀 인정.
          if (pt === firstPiece.piece[1]) break;

          // 핵심 조건: shield 가치 >= 피핀 가치
          if (shieldVal >= pinnedVal) return true;

          break;
        }
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

/**
 * 보드 전체에서 color가 만들고 있는 핀 현황을 스냅샷으로 수집.
 * { key: 'attacker_r,attacker_c → pinned_r,pinned_c', type: 'absolute'|'relative' }[]
 * @param {Array}  board
 * @param {string} color
 * @returns {Set<string>}
 */
function _collectPinKeys(board, color) {
  const keys = new Set();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p[0] !== color || !['B','R','Q'].includes(p[1])) continue;
    if (_isAbsolutePinFromSquare(board, r, c, color)) keys.add(`abs:${r},${c}`);
    if (_isRelativePinFromSquare(board, r, c, color)) keys.add(`rel:${r},${c}`);
  }
  return keys;
}

// ════════════════════════════════════════════════════════════════════════════
// detectPinCreated - found 판정용 (기하학적, 1수 전술 원칙 적용)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 이동으로 인해 새로운 핀(절대/상대)이 생성되었는지 판정.
 * "이 수 이전에 이미 같은 핀이 존재"했으면 제외 (1수 전술 원칙).
 *
 * [경로 A - 직접 핀]  이동한 기물이 B/R/Q이고 이동 후 새 핀 생성.
 * [경로 B - 발견 핀]  이동으로 라인이 열려 뒤의 아군 B/R/Q가 새로 핀 생성.
 * 공통: 이동 후 적 킹 체크 상태이면 제외.
 *
 * @param {Array}  prevBoard
 * @param {Array}  nextBoard
 * @param {Object} move  - {from:[r,c], to:[r,c], ...}
 * @param {string} color
 * @returns {{ absolute: boolean, relative: boolean }}
 */
function detectPinCreated(prevBoard, nextBoard, move, color) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const enemy     = enemyColor(color);

  const result = { absolute: false, relative: false };

  if (isInCheck(nextBoard, enemy)) return result;

  // 이동 전 핀 스냅샷 (키 형태로 보존)
  const prevPinKeys = _collectPinKeys(prevBoard, color);

  // ── 경로 A: 직접 핀 ──────────────────────────────────────────────────────
  const movedPiece = nextBoard[tr][tc];
  if (movedPiece && ['B','R','Q'].includes(movedPiece[1])) {
    // 절대 핀: 이동 후 새로 핀 생성 && 이동 전 출발지엔 없었음
    if (!result.absolute &&
        _isAbsolutePinFromSquare(nextBoard, tr, tc, color) &&
        !prevPinKeys.has(`abs:${fr},${fc}`)) {
      result.absolute = true;
    }
    // 상대 핀
    if (!result.relative &&
        _isRelativePinFromSquare(nextBoard, tr, tc, color) &&
        !prevPinKeys.has(`rel:${fr},${fc}`)) {
      result.relative = true;
    }
  }

  // ── 경로 B: 발견 핀 ──────────────────────────────────────────────────────
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r === tr && c === tc) continue; // 경로 A에서 처리
    const p = nextBoard[r][c];
    if (!p || p[0] !== color || !['B','R','Q'].includes(p[1])) continue;

    if (!result.absolute &&
        !prevPinKeys.has(`abs:${r},${c}`) &&
         _isAbsolutePinFromSquare(nextBoard, r, c, color)) {
      result.absolute = true;
    }
    if (!result.relative &&
        !prevPinKeys.has(`rel:${r},${c}`) &&
         _isRelativePinFromSquare(nextBoard, r, c, color)) {
      result.relative = true;
    }

    if (result.absolute && result.relative) break;
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// classifyPvsByPin - missed 판정용 (엔진 3개 라인 비교)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 엔진 PV 배열(최대 3개)의 각 첫 수에 대해 핀 수 여부를 분류합니다.
 *
 * 각 PV의 첫 수를 실제로 적용한 nextBoard에 대해
 * detectPinCreated()를 호출하여 절대 핀 / 상대 핀 여부를 판정합니다.
 * (이동 후 체크 상태인 경우 detectPinCreated가 내부에서 자동 제외)
 *
 * @param {Array}  pvs        - analyzePosition() 반환값의 pvs 배열 (최대 3개)
 * @param {Object} prevState  - { board, turn, castling, enPassant }
 * @param {string} color      - 이동하는 쪽 색상
 * @returns {{
 *   pinPvs:    Array<{ uci, cp, mate, absolute, relative }>,
 *   nonPinPvs: Array<{ uci, cp, mate, absolute, relative }>
 * }}
 */
function classifyPvsByPin(pvs, prevState, color) {
  const pinPvs    = [];
  const nonPinPvs = [];

  for (const pv of pvs) {
    const uci = pv.moves && pv.moves[0];
    if (!uci || uci === '(none)') continue;

    // UCI → Move 객체 변환
    const mov = uciToMoveObj(uci, prevState.board, prevState.turn,
                              prevState.castling, prevState.enPassant);
    if (!mov) continue;

    // 해당 수를 실제로 적용
    const nextBoard = applyMoveToBoard(prevState.board, mov, color);

    // 핀 생성 여부 판정 (1수 전술 원칙 포함)
    const pin = detectPinCreated(prevState.board, nextBoard, mov, color);

    const info = {
      uci,
      cp:       pv.cp,
      mate:     pv.mate,
      absolute: pin.absolute,
      relative: pin.relative
    };

    if (pin.absolute || pin.relative) pinPvs.push(info);
    else                              nonPinPvs.push(info);
  }

  return { pinPvs, nonPinPvs };
}