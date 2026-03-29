/**
 * chess-tactics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 전술 감지 모듈 (포크 / 절대 핀 / 상대 블런더 포착)
 *
 * 담당 역할:
 *   - 포크(Fork) 감지: 나이트뿐 아니라 모든 기물에 대해 정교하게 판정
 *   - 절대 핀(Absolute Pin) 감지: 이동 원인으로 인한 핀만 인정
 *   - 상대 블런더 포착(Blunder Catch) 판정
 *
 * ── 포크 정교화 설명 ────────────────────────────────────────────────────────
 * 기존 문제: 기물이 이동 후 우연히 두 개를 바라보기만 해도 포크로 집계
 *
 * 개선된 기준 (모두 충족해야 포크):
 *   1. 이동한 기물이 상대 기물 2개 이상을 동시에 공격
 *   2. 공격받는 기물 중 최소 하나가 "실질적 위협" 상태여야 함
 *      - 공격받는 기물이 이동한 기물보다 가치가 높거나 (등가 교환 이상)
 *      - 또는 해당 기물이 보호받지 못하는 상태 (무방비)
 *   3. 이동한 기물 자체가 상대에게 즉시 잡히지 않아야 함
 *      (잡히더라도 교환 후 이득이면 허용 — SEE 방식 간략화)
 *   4. 체크 중에 발생한 포크는 별도 검증 없이 인정
 *      (체크포크는 명백한 전술)
 *
 * ── 핀 정교화 설명 ──────────────────────────────────────────────────────────
 * 기존 문제: 체크/기물 교환으로 우연히 핀 카운트가 늘어도 포착
 *
 * 개선된 기준:
 *   1. 수를 두기 전후로 핀 개수 비교 (기존과 동일)
 *   2. 단, 그 수가 '기물 교환(capture)' 이거나 '체크'를 건 수라면
 *      핀 카운트 증가분을 신뢰하지 않고 직접 원인 검증:
 *      → 이동한 기물의 공격 라인이 실제로 핀을 만들고 있는지 확인
 *   3. 핀 유효성 검증: 핀된 기물 제거 시 킹이 체크 상태이어야 핀 인정
 *
 * 의존성: chess-engine.js (전역 함수들 사용)
 *
 * 외부에 노출하는 주요 함수:
 *   PIECE_VALUE                             → {P:100, N:320, ...} 기물 가치표
 *   isValidFork(board, color, toPos, ...)   → boolean
 *   detectPinCreated(prevBoard, nextBoard, move, color) → boolean
 *   countAbsolutePins(board, color)         → number
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── 기물 가치표 (센티폰 기준) ─────────────────────────────────────────────
const PIECE_VALUE = { P:100, N:320, B:330, R:500, Q:900, K:20000 };

/**
 * 특정 칸이 해당 색 기물에게 공격받고 있는지 확인
 * @param {Array} board
 * @param {number} r
 * @param {number} c
 * @param {string} attackerColor - 공격자 색상 ('w'|'b')
 * @returns {boolean}
 */
function isSquareAttackedBy(board, r, c, attackerColor) {
  for (let ar = 0; ar < 8; ar++) for (let ac = 0; ac < 8; ac++) {
    const p = board[ar][ac];
    if (!p || p[0] !== attackerColor) continue;
    const ms = pseudoMoves(board, ar, ac, {wK:false,wQ:false,bK:false,bQ:false}, null);
    if (ms.some(m => m.to[0]===r && m.to[1]===c)) return true;
  }
  return false;
}

/**
 * 특정 칸을 공격하는 기물 목록 반환
 * @param {Array} board
 * @param {number} r
 * @param {number} c
 * @param {string} attackerColor
 * @returns {Array} [{r, c, piece}]
 */
function getAttackers(board, r, c, attackerColor) {
  const attackers = [];
  for (let ar = 0; ar < 8; ar++) for (let ac = 0; ac < 8; ac++) {
    const p = board[ar][ac];
    if (!p || p[0] !== attackerColor) continue;
    const ms = pseudoMoves(board, ar, ac, {wK:false,wQ:false,bK:false,bQ:false}, null);
    if (ms.some(m => m.to[0]===r && m.to[1]===c))
      attackers.push({ r:ar, c:ac, piece:p });
  }
  return attackers;
}

/**
 * 간략 정적 교환 평가 (SEE)
 * 해당 칸에서 교환이 일어날 때 공격자 color 입장에서의 이득/손해 추정
 * @param {Array} board
 * @param {number} r
 * @param {number} c           - 교환 발생 위치
 * @param {string} color       - 먼저 잡는 색상
 * @param {string} attackerPiece - 먼저 잡는 기물 (예: 'wN')
 * @returns {number} 양수 = 이득, 음수 = 손해
 */
function simpleSEE(board, r, c, color, attackerPiece) {
  const target = board[r][c];
  if (!target) return 0;
  const gain = PIECE_VALUE[target[1]];
  const myValue = PIECE_VALUE[attackerPiece[1]];
  // 잡은 후 상대가 되받아 칠 수 있는지
  const boardAfter = board.map(row => [...row]);
  // 공격자 위치 찾기 (단순화: 실제 SEE는 재귀이지만 1-depth로 충분)
  boardAfter[r][c] = attackerPiece;
  const enemy = enemyColor(color);
  const recapturers = getAttackers(boardAfter, r, c, enemy).filter(a => a.piece !== attackerPiece);
  if (recapturers.length === 0) return gain; // 되받아칠 수 없음 → 순이득
  // 가장 약한 기물로 되받아친다고 가정
  const minRecapturer = recapturers.reduce((a,b) =>
    PIECE_VALUE[a.piece[1]] < PIECE_VALUE[b.piece[1]] ? a : b
  );
  return gain - Math.max(0, PIECE_VALUE[minRecapturer.piece[1]] > myValue ? myValue : 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 포크 판정
// ════════════════════════════════════════════════════════════════════════════

/**
 * 포크 유효성 검증 (정교한 버전)
 *
 * 조건:
 *   1. 이동 기물이 상대 기물 2개 이상 동시 공격
 *   2. 공격받는 기물들 중 최소 하나가 "실질적 위협"
 *      a. 킹을 공격 중이면 무조건 인정 (체크포크)
 *      b. 공격받는 기물이 이동 기물보다 가치 높음 (등가 이상)
 *      c. 공격받는 기물이 무방비 (되받아칠 기물 없음)
 *   3. 이동 기물이 SEE 상 손해가 아니어야 함 (또는 체크포크면 예외)
 *
 * @param {Array}  board       - 이동 후 보드
 * @param {string} color       - 이동한 쪽 색상
 * @param {Array}  toPos       - 이동한 목적지 [r, c]
 * @param {Array}  prevBoard   - 이동 전 보드 (SEE용)
 * @returns {boolean}
 */
function isValidFork(board, color, toPos, prevBoard) {
  const [r, c] = toPos;
  const movedPiece = board[r][c];
  if (!movedPiece) return false;

  const enemy = enemyColor(color);
  const movedValue = PIECE_VALUE[movedPiece[1]];

  // 1. 이동 기물이 공격하는 상대 기물 목록 수집
  const ps = pseudoMoves(board, r, c, {wK:false,wQ:false,bK:false,bQ:false}, null);
  const threatened = [];
  for (const m of ps) {
    const t = board[m.to[0]][m.to[1]];
    if (t && t[0] === enemy) threatened.push({ r:m.to[0], c:m.to[1], piece:t });
  }

  if (threatened.length < 2) return false;

  // 2. 체크포크 판정 (킹이 공격 대상에 포함)
  const isCheckFork = threatened.some(t => t.piece[1] === 'K');

  // 3. 이동 기물이 즉시 잡히는지 확인 (SEE)
  const isSafeSquare = !isSquareAttackedBy(board, r, c, enemy);
  // 잡히더라도 이득이면 포크로 인정
  const seeGain = isSafeSquare ? Infinity :
    Math.min(...threatened.map(t => PIECE_VALUE[t.piece[1]])) - movedValue;

  // 체크포크는 즉시 잡혀도 유효 (체크 해소가 우선이므로)
  if (!isCheckFork && !isSafeSquare && seeGain < 0) return false;

  // 4. 위협받는 기물 중 하나라도 "실질적 위협"인지 확인
  const hasRealThreat = threatened.some(t => {
    if (t.piece[1] === 'K') return true; // 킹은 항상 위협
    if (PIECE_VALUE[t.piece[1]] > movedValue) return true; // 가치 높은 기물
    // 무방비 기물: 위협받는 기물(상대편)을 지켜주는 상대편 기물이 없는 경우
    // defenders = 상대편(enemy) 기물이 t 칸을 지키는 수 (이동한 나이트 제외)
    const defenders = getAttackers(board, t.r, t.c, enemy).filter(
      a => !(a.r === r && a.c === c) // 이동한 기물 자신은 방어자가 아님
    );
    return defenders.length === 0; // 방어자 없으면 무방비
  });

  return hasRealThreat;
}

// ════════════════════════════════════════════════════════════════════════════
// 핀 판정
// ════════════════════════════════════════════════════════════════════════════

/**
 * 절대 핀 개수 계산
 * 상대 기물이 킹 앞에 있어 움직이면 킹이 노출되는 경우만 카운트
 *
 * @param {Array}  board
 * @param {string} color - 핀을 건 쪽 색상 (상대 킹 기준)
 * @returns {number}
 */
function countAbsolutePins(board, color) {
  const enemy = enemyColor(color);
  let kr = -1, kc = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (board[r][c] === enemy + 'K') { kr = r; kc = c; }
  if (kr < 0) return 0;

  let pins = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p[0] !== enemy || p[1] === 'K') continue;
    // 이 기물을 제거했을 때 적 킹이 체크 상태면 핀
    const nb = board.map(row => [...row]);
    nb[r][c] = null;
    if (isInCheck(nb, enemy)) pins++;
  }
  return pins;
}

/**
 * 이동으로 인해 새로운 핀이 생성되었는지 판정 (정교한 버전)
 *
 * 기존 문제: 체크/교환 수에서 핀 카운트 증가를 단순히 신뢰
 *
 * 개선:
 *   1. 이동 전후 핀 개수 비교 (기존)
 *   2. 핀 증가가 있을 때, 그 원인이 실제로 이동한 기물인지 검증
 *      - 이동한 기물이 슬라이딩 기물(B/R/Q)이면 직접 핀 라인 생성 가능
 *      - 이동으로 X-ray 핀이 열렸는지 확인 (discovered pin)
 *   3. 체크를 동반한 수에서 핀 증가 → 이동 기물이 핀을 만든 경우만 인정
 *
 * @param {Array}  prevBoard  - 이동 전 보드
 * @param {Array}  nextBoard  - 이동 후 보드
 * @param {Object} move       - 이동 객체 {from, to, ...}
 * @param {string} color      - 이동한 쪽 색상
 * @returns {boolean} 이동으로 인해 새 핀이 생겼으면 true
 */
function detectPinCreated(prevBoard, nextBoard, move, color) {
  const enemy = enemyColor(color);
  const pinsBefore = countAbsolutePins(prevBoard, color);
  const pinsAfter = countAbsolutePins(nextBoard, color);

  if (pinsAfter <= pinsBefore) return false;

  // 핀이 증가했다면 → 이동한 기물이 원인인지 검증
  const [tr, tc] = move.to;
  const movedPiece = nextBoard[tr][tc];
  if (!movedPiece) return false;

  const pieceType = movedPiece[1];

  // 슬라이딩 기물(B/R/Q)이어야 직접 핀 라인 생성 가능
  const isSlidingPiece = ['B', 'R', 'Q'].includes(pieceType);

  // 킹 위치 탐색
  let kr = -1, kc = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (nextBoard[r][c] === enemy + 'K') { kr = r; kc = c; }
  if (kr < 0) return false;

  if (isSlidingPiece) {
    // 이동 기물과 킹 사이에 상대 기물이 정확히 하나 있는지 확인
    const dr = Math.sign(kr - tr), dc = Math.sign(kc - tc);
    if (dr === 0 && dc === 0) return false;

    // 비숍: 대각선 방향만, 룩: 직선만, 퀸: 모두
    const isDiagonal = dr !== 0 && dc !== 0;
    const isStraight = dr === 0 || dc === 0;
    if (pieceType === 'B' && !isDiagonal) return false;
    if (pieceType === 'R' && !isStraight) return false;

    let nr = tr + dr, nc = tc + dc;
    let piecesInBetween = 0;
    while (nr !== kr || nc !== kc) {
      if (!isInBounds(nr, nc)) break;
      if (nextBoard[nr][nc]) piecesInBetween++;
      nr += dr; nc += dc;
    }
    // 딱 하나의 상대 기물이 사이에 있으면 핀
    return piecesInBetween === 1;
  }

  // 슬라이딩 기물이 아닌 경우: 발견 핀(discovered pin) 가능성
  // 이동하기 전 위치가 핀 라인을 막고 있었는지 확인
  const [fr, fc] = move.from;
  // 이동 전 보드에서 이전 위치를 제거하면 핀이 생기는지
  const boardWithoutMover = prevBoard.map(row => [...row]);
  boardWithoutMover[fr][fc] = null;
  const pinsWithoutMover = countAbsolutePins(boardWithoutMover, color);

  return pinsWithoutMover > pinsBefore; // 발견 핀 발생
}

/**
 * Stockfish 베스트무브가 핀을 만드는지 확인
 * @param {Array}  prevBoard
 * @param {string} sfBestUci
 * @param {string} color
 * @param {Object} prevState  - {board, turn, castling, enPassant}
 * @returns {boolean}
 */
function doesBestMoveCreatePin(prevBoard, sfBestUci, color, prevState) {
  const sfMov = uciToMoveObj(sfBestUci, prevState.board, prevState.turn, prevState.castling, prevState.enPassant);
  if (!sfMov) return false;
  const sfBoard = applyMoveToBoard(prevState.board, sfMov, color);
  return detectPinCreated(prevState.board, sfBoard, sfMov, color);
}
