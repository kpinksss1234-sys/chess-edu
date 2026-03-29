/**
 * chess-tactics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 전술 감지 모듈 (포크 / 절대 핀)
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
 *      → "이 수 덕분에 새로 생긴 포크"만 카운트
 *   4. [1수 전술] 이동 전 위치에서 이미 실질 위협 ≥ 2개였으면 제외
 *      → 기존 포크 유지가 아닌, 이 수로 새로 생긴 포크만 인정
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [핀 정의]
 *   공격자(슬라이딩 기물 B/R/Q)의 공격 라인 위에 적 기물이 정확히 1개 있고,
 *   그 기물을 제거하면 적 킹이 공격에 노출되는 상태.
 *
 * [핀 감지 추가 조건]
 *   피핀 기물이 나이트(N) 이상 가치의 기물이어야 함.
 *   → 피핀 기물이 폰(P)인 경우 제외.
 *      "슬라이딩 기물이 킹 방향으로 이동 시 킹 앞 폰 공격"은
 *      매우 흔한 상황으로 전술적 핀으로 인정하지 않음.
 *
 * [핀 감지 경로 A - 직접 핀]
 *   이동한 기물이 B/R/Q이고,
 *   이동 후 해당 기물 → 적 기물(N↑) → 적 킹이 일직선으로 정렬되는 경우.
 *   단, 이동 전 출발지에서 이미 같은 핀이 있었으면 제외.
 *   단, 이동 후 체크 상태이면 제외.
 *
 * [핀 감지 경로 B - 발견 핀]
 *   이동한 기물이 자리를 비워 뒤에 있던 아군 B/R/Q의 라인이 열리며
 *   적 기물(N↑)이 새로 핀되는 경우.
 *   단, 이동 후 체크 상태이면 제외.
 *
 * ── 수정 이력 ──────────────────────────────────────────────────────────────
 * [수정 1] 경로 B(발견 핀) 오탐 수정
 *   기존: prevBoard 출발지만 비운 boardWithout으로 핀 검사 → 이동 목적지 미반영
 *   수정: nextBoard(실제 이동 완료 보드)로 핀 검사
 *
 * [수정 2] 피핀 기물 폰 오탐 수정
 *   기존: 피핀 기물이 폰이어도 핀으로 인정 → 킹 앞 폰 공격이 핀으로 오탐
 *   수정: _isPinningFromSquare에서 피핀 기물 가치 < N(320)이면 핀 불인정
 *
 * [수정 3] 포크 1수 전술 필터
 *   기존: 이동 전 위치에서 이미 위협 2개 이상이어도 포크로 카운트
 *   수정: 이동 전 위치의 실질 위협이 이미 2개 이상이면 포크 불인정
 *
 * 의존성: chess-engine.js (전역 함수들 사용)
 *
 * 외부에 노출하는 주요 함수:
 *   PIECE_VALUE
 *   isValidFork(board, color, toPos, prevBoard)               → boolean
 *   detectPinCreated(prevBoard, nextBoard, move, color)       → boolean
 *   doesBestMoveCreatePin(prevBoard, sfBestUci, color, prevState) → boolean
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const PIECE_VALUE = { P:100, N:320, B:330, R:500, Q:900, K:20000 };

// 핀으로 인정하는 피핀 기물 최소 가치 (폰 제외, 나이트 이상)
const PIN_MIN_PINNED_VALUE = PIECE_VALUE['N']; // 320

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
 *
 * "실질적 위협" 기준:
 *   - 킹이면 무조건
 *   - 이동 기물보다 150cp 이상 비싼 기물이면 무조건
 *   - 무방비(수비자 없음) + 이동 기물과 등가 이상이면 인정
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
      // 무방비 + 등가 이상
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
 *
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

  const isCheckFork = threatsAfter.some(t => t.piece[1] === 'K');

  // 체크포크가 아닌 경우: 이동 기물이 즉시 잡힐 수 있으면 불인정
  if (!isCheckFork && isSquareAttackedBy(board, tr, tc, enemyColor(color))) return false;

  // [핵심] 이동 전 출발지에서 이미 같은 대상들을 위협했는지 확인
  // → 이동 전 출발지 역추적
  const piece = board[tr][tc];
  let prevR = -1, prevC = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r === tr && c === tc) continue;
    if (prevBoard[r][c] === piece && board[r][c] !== piece) { prevR = r; prevC = c; break; }
    if (prevR >= 0) break;
  }

  if (prevR >= 0) {
    const threatsBefore = _getRealThreats(prevBoard, prevR, prevC, color);
    const prevSet = new Set(threatsBefore.map(t => t.r + ',' + t.c));

    // 이동 후 새로 위협받는 대상이 최소 1개 있어야 "새로운 포크"
    const newThreats = threatsAfter.filter(t => !prevSet.has(t.r + ',' + t.c));
    if (newThreats.length === 0) return false;

    // [1수 전술 필터] 이동 전 위치에서 이미 실질 위협 2개 이상이었으면
    // 이 수는 포크를 '새로 만든' 것이 아닌 기존 위협 이동으로 간주 → 불인정
    if (threatsBefore.length >= 2) return false;
  }

  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 핀 판정
// ════════════════════════════════════════════════════════════════════════════

/**
 * 보드에서 [r,c]의 슬라이딩 기물(B/R/Q)이 적 킹을 향한 라인 위에
 * 절대 핀을 만들고 있는지 직접 기하학적으로 확인.
 *
 * 조건:
 *   - [r,c]의 기물이 B/R/Q이어야 함
 *   - 기물 → 킹 방향이 기물 종류에 맞아야 함 (B: 대각선, R: 직선, Q: 둘 다)
 *   - 그 방향 라인 위에 적 기물이 정확히 1개 존재
 *   - 피핀 기물이 나이트(N) 이상 가치여야 함 (폰 제외)
 *   - 그 기물 제거 시 적 킹이 체크 상태
 *
 * @param {Array}  board
 * @param {number} r
 * @param {number} c
 * @param {string} color - 슬라이딩 기물의 색상
 * @returns {boolean}
 */
function _isPinningFromSquare(board, r, c, color) {
  const piece = board[r][c];
  if (!piece || piece[0] !== color) return false;
  const pt = piece[1];
  if (!['B', 'R', 'Q'].includes(pt)) return false;

  const enemy = enemyColor(color);

  // 적 킹 위치 탐색
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
          // 두 번째 기물이 적 킹이고 첫 번째가 적 기물이면 핀 후보
          if (sq === enemy + 'K' && firstPiece.piece[0] === enemy) {
            // [핵심 필터] 피핀 기물이 폰이면 전술적 핀으로 인정하지 않음
            // 킹 앞 폰이 슬라이딩 기물 라인에 걸리는 것은 매우 흔한 상황
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

/**
 * 이동으로 인해 새로운 절대 핀이 생성되었는지 판정.
 *
 * [경로 A - 직접 핀]
 *   이동한 기물이 B/R/Q이고 이동 후 핀을 만들면서,
 *   이동 전 출발지에서는 같은 핀이 없었던 경우.
 *
 * [경로 B - 발견 핀]
 *   이동한 기물이 자리를 비워 뒤의 아군 B/R/Q가 새로 핀을 만드는 경우.
 *   nextBoard(실제 이동 완료 보드)로 핀 검사하여 오탐 제거.
 *
 * 공통 제외: 이동 후 적 킹이 체크 상태이면 false (체크가 주목적인 수)
 *
 * @param {Array}  prevBoard
 * @param {Array}  nextBoard
 * @param {Object} move      - {from:[r,c], to:[r,c], ...}
 * @param {string} color     - 이동한 쪽 색상
 * @returns {boolean}
 */
function detectPinCreated(prevBoard, nextBoard, move, color) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const enemy     = enemyColor(color);

  // 이동 후 적 킹이 체크이면 핀 감지 제외
  if (isInCheck(nextBoard, enemy)) return false;

  // ── 경로 A: 직접 핀 ──────────────────────────────────────────────────────
  const movedPiece = nextBoard[tr][tc];
  if (movedPiece && ['B','R','Q'].includes(movedPiece[1])) {
    if (_isPinningFromSquare(nextBoard, tr, tc, color)) {
      // 이동 전 출발지에서 이미 같은 핀이 존재했으면 새 핀이 아님
      if (!_isPinningFromSquare(prevBoard, fr, fc, color)) {
        return true;
      }
    }
  }

  // ── 경로 B: 발견 핀 ──────────────────────────────────────────────────────
  // nextBoard(실제 이동 완료 보드)를 사용하여 발견 핀 검사
  // prevBoard vs nextBoard 비교로 이동 전후 상태를 정확히 반영
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    // 이동한 기물 자신(목적지)은 경로 A에서 이미 처리했으므로 제외
    if (r === tr && c === tc) continue;
    const p = nextBoard[r][c];
    if (!p || p[0] !== color || !['B','R','Q'].includes(p[1])) continue;
    // 이전 보드에서는 핀 없고, 이동 후 보드에서는 핀 있으면 발견 핀
    if (!_isPinningFromSquare(prevBoard, r, c, color) &&
         _isPinningFromSquare(nextBoard, r, c, color)) {
      return true;
    }
  }

  return false;
}

/**
 * SF 최선수가 핀을 만드는지 확인
 *
 * @param {Array}  prevBoard
 * @param {string} sfBestUci
 * @param {string} color
 * @param {Object} prevState - {board, turn, castling, enPassant}
 * @returns {boolean}
 */
function doesBestMoveCreatePin(prevBoard, sfBestUci, color, prevState) {
  const sfMov = uciToMoveObj(
    sfBestUci, prevState.board, prevState.turn, prevState.castling, prevState.enPassant
  );
  if (!sfMov) return false;

  const sfBoard = applyMoveToBoard(prevState.board, sfMov, color);

  // SF 최선수가 체크를 거는 수면 핀 생성 수로 보지 않음
  if (isInCheck(sfBoard, enemyColor(color))) return false;

  return detectPinCreated(prevState.board, sfBoard, sfMov, color);
}