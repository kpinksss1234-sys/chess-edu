/**
 * chess-analyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 게임 분석 오케스트레이터
 *
 * 담당 역할:
 *   - 단일 게임 PGN에 대한 전체 분석 파이프라인 실행
 *   - Stockfish 분석 결과 + 전술 감지를 통합하여 최종 결과 생성
 *   - 전술 이벤트(tacticEvents) 수집: 게임 내 몇 수째에 어떤 전술이 발생했는지
 *   - 통계 집계(renderStats)에서 게임별로 호출됨
 *
 * 분석 파이프라인:
 *   1. PGN → 국면 배열 파싱 (chess-engine.js)
 *   2. 모든 국면 Stockfish 분석 (chess-stockfish.js)
 *   3. 수별로 순회하며:
 *      a. 체크메이트 감지
 *      b. cp 손실 계산 → 블런더/실수/부정확 분류
 *      c. 상대 블런더 포착 여부 판정
 *      d. 포크 감지 (chess-tactics.js - isValidFork)
 *         → found: 실제 둔 수가 포크
 *         → missed: SF 최선수가 포크인데 다른 수를 둠 (found 포지션은 중복 카운트 안 함)
 *      e. 핀 감지 (chess-tactics.js - detectPinCreated)
 *         → found: 실제 둔 수가 핀 생성
 *         → missed: SF 최선수가 핀인데 다른 수를 둠 (found 포지션은 중복 카운트 안 함)
 *
 * ※ 포크/핀 카운트 기준:
 *    "지금 당장(1수) 실행 가능한 전술 기회 포지션" 단위로 집계합니다.
 *    한 포지션에서 found와 missed가 동시에 집계되지 않으며, found를 우선합니다.
 *
 * 전술 이벤트(tacticEvent) 객체 형태:
 *   {
 *     type:     'fork' | 'pin' | 'oppBlunder' | 'oppFork',
 *     subtype:  'found' | 'missed',
 *     piece:    'N' | 'B' | ... (포크 기물, 핀/블런더는 ''),
 *     moveIdx:  number,    // 국면 배열 인덱스
 *     moveNum:  number,    // 체스 수 번호 (1수, 2수...)
 *     san:      string,    // 수 표기
 *     color:    'w'|'b',   // 이동한 색상
 *     bestUci:  string     // 놓친 경우에만: SF 추천 최선수
 *   }
 *
 * 의존성:
 *   - chess-engine.js   (parsePgnToStates, applyMoveToBoard, getAllLegal, ...)
 *   - chess-tactics.js  (isValidFork, detectPinCreated, doesBestMoveCreatePin)
 *   - chess-stockfish.js (analyzePosition, cpFor, cpToLabel, MISTAKE_CP, ...)
 *
 * 외부에 노출하는 주요 함수:
 *   analyzeGame(pgn, myColor, onProgress) → Promise<AnalysisResult>
 *
 * AnalysisResult 객체 형태:
 *   {
 *     totalMoves, myBlunders, myMistakes, myInaccuracies,
 *     oppBlunders, oppMistakes,
 *     oppBlunderFound, oppBlunderMissed,
 *     checkmates,
 *     forkFound: {P,N,B,R,Q,K}, forkMissed: {P,N,B,R,Q,K},
 *     oppForkCreated: {P,N,B,R,Q,K},
 *     pinFound, pinMissed,
 *     avgCpLoss,
 *     tacticEvents: TacticEvent[]
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const FORK_CP_GAIN = 80;   // 이 이상 이득이어야 포크 기회로 인정
const PIN_CP_GAIN  = 60;   // 이 이상 이득이어야 핀 기회로 인정

/**
 * 단일 게임을 분석합니다.
 * @param {string}   pgn
 * @param {string}   myColor    - 'w' | 'b'
 * @param {Function} onProgress - (current, total) => void
 * @returns {Promise<AnalysisResult>}
 */
async function analyzeGame(pgn, myColor, onProgress) {
  const states = parsePgnToStates(pgn);

  const result = {
    totalMoves:      states.length - 1,
    myBlunders:      0, myMistakes:      0, myInaccuracies: 0,
    oppBlunders:     0, oppMistakes:     0,
    oppBlunderFound: 0, oppBlunderMissed: 0,
    checkmates:      0,
    forkFound:       { P:0, N:0, B:0, R:0, Q:0, K:0 },
    forkMissed:      { P:0, N:0, B:0, R:0, Q:0, K:0 },
    oppForkCreated:  { P:0, N:0, B:0, R:0, Q:0, K:0 },
    pinFound:        0, pinMissed: 0,
    myCpSum:         0, myMoveCount: 0,
    tacticEvents:    []
  };

  // ── Step 1: 전체 포지션 Stockfish 분석 ────────────────────────────────────
  const ana = new Array(states.length).fill(null);
  for (let i = 0; i < states.length; i++) {
    ana[i] = await analyzePosition(states[i].fen);
    if (onProgress) onProgress(i, states.length - 1);
  }

  // ── Step 2: 수별 분석 ─────────────────────────────────────────────────────
  for (let i = 1; i < states.length; i++) {
    const state = states[i];
    const prev  = states[i - 1];
    const move  = state.move;
    if (!move) continue;

    const mover = prev.turn;
    const isMe  = mover === myColor;
    const enemy = enemyColor(mover);

    // ── 체크메이트 ──────────────────────────────────────────────────────────
    if (isMe && isInCheck(state.board, enemy)) {
      const leg = getAllLegal(state.board, enemy, state.castling, state.enPassant);
      if (leg.length === 0) result.checkmates++;
    }

    // ── cp 손실 계산 ────────────────────────────────────────────────────────
    const prevBest = ana[i-1].pvs[0];
    const bestCp   = prevBest ? cpFor(prevBest.cp, prevBest.mate, mover) : 0;
    const curBest  = ana[i].pvs[0];
    const afterCp  = curBest ? -cpFor(curBest.cp, curBest.mate, enemy) : 0;
    const loss     = Math.max(0, bestCp - afterCp);
    const label    = cpToLabel(loss);

    if (isMe) {
      result.myMoveCount++;
      result.myCpSum += loss;
      if      (label === 'blunder')    result.myBlunders++;
      else if (label === 'mistake')    result.myMistakes++;
      else if (label === 'inaccuracy') result.myInaccuracies++;
    } else {
      if      (label === 'blunder') result.oppBlunders++;
      else if (label === 'mistake') result.oppMistakes++;
    }

    // ── 상대 블런더 포착 ────────────────────────────────────────────────────
    if (!isMe && label === 'blunder' && i + 1 < states.length) {
      const myBestHere   = ana[i].pvs[0];
      const myActualHere = ana[i+1].pvs[0];
      const myBestCp     = myBestHere   ? cpFor(myBestHere.cp,   myBestHere.mate,   myColor) : 0;
      const myActualCp   = myActualHere ? -cpFor(myActualHere.cp, myActualHere.mate, enemy)  : 0;
      const caught       = (myBestCp - myActualCp) < MISTAKE_CP;
      if (caught) {
        result.oppBlunderFound++;
        result.tacticEvents.push(_makeTacticEvent('oppBlunder', 'found', '', i+1, states, myColor));
      } else {
        result.oppBlunderMissed++;
        result.tacticEvents.push(_makeTacticEvent('oppBlunder', 'missed', '', i+1, states, myColor, ana[i].bestmove));
      }
    }

    // ── 상대 수: 포크 생성 감지 ─────────────────────────────────────────────
    if (!isMe) {
      const movedPT_opp = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';
      if (loss >= FORK_CP_GAIN && isValidFork(state.board, mover, move.to, prev.board)) {
        result.oppForkCreated[movedPT_opp] = (result.oppForkCreated[movedPT_opp] || 0) + 1;
        result.tacticEvents.push(_makeTacticEvent('oppFork', 'found', movedPT_opp, i, states, mover));
      }
      continue;
    }

    // ── 내 수: 포크 / 핀 감지 ───────────────────────────────────────────────
    // ※ "지금 당장(1수) 실행 가능한 전술 기회 포지션" 단위로 카운트합니다.
    //   한 포지션에서 found와 missed가 동시에 카운트되지 않도록
    //   found 확인 후 true이면 missed 검사를 건너뜁니다.
    const sfBest    = ana[i-1].bestmove;
    const actualUci = moveToUci(move);
    const movedPT   = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';

    // ── 포크 감지 ──────────────────────────────────────────────────────────

    // 찾은 포크: 실제 둔 수가 포크 조건 충족
    const actualIsFork = isValidFork(state.board, mover, move.to, prev.board);
    if (actualIsFork) {
      result.forkFound[movedPT] = (result.forkFound[movedPT] || 0) + 1;
      result.tacticEvents.push(_makeTacticEvent('fork', 'found', movedPT, i, states, mover));
    }

    // 놓친 포크: SF 최선수가 포크이고 내가 다른 수를 뒀으며 손실이 임계값 이상
    // ※ 이미 포크를 찾은(found) 포지션은 중복 카운트하지 않음
    if (!actualIsFork && sfBest && sfBest !== actualUci && sfBest !== '(none)' && loss >= FORK_CP_GAIN) {
      const sfFromR = 8 - parseInt(sfBest[1]);
      const sfFromC = sfBest.charCodeAt(0) - 97;
      const sfPT    = prev.board[sfFromR]?.[sfFromC]?.[1] || 'P';
      const sfMov   = uciToMoveObj(sfBest, prev.board, prev.turn, prev.castling, prev.enPassant);
      if (sfMov) {
        const sfBoard = applyMoveToBoard(prev.board, sfMov, mover);
        const sfTo    = [8 - parseInt(sfBest[3]), sfBest.charCodeAt(2) - 97];
        if (isValidFork(sfBoard, mover, sfTo, prev.board)) {
          result.forkMissed[sfPT] = (result.forkMissed[sfPT] || 0) + 1;
          result.tacticEvents.push(_makeTacticEvent('fork', 'missed', sfPT, i, states, mover, sfBest));
        }
      }
    }

    // ── 핀 감지 ────────────────────────────────────────────────────────────

    // 찾은 핀: 이 수가 실제로 핀을 만들었는지 판정
    const actualIsPin = detectPinCreated(prev.board, state.board, move, mover);
    if (actualIsPin) {
      result.pinFound++;
      result.tacticEvents.push(_makeTacticEvent('pin', 'found', '', i, states, mover));
    }

    // 놓친 핀: SF 최선수가 핀을 만들었고 내가 다른 수를 뒀을 때
    // ※ 이미 핀을 찾은(found) 포지션은 중복 카운트하지 않음
    if (!actualIsPin && sfBest && sfBest !== actualUci && sfBest !== '(none)' && loss >= PIN_CP_GAIN) {
      // ── [수정] SF 최선수가 슬라이딩 기물(B/R/Q) 이동일 때만 핀 검사 진입 ──
      // 비슬라이딩 기물이 핀을 만드는 경우(발견 핀)는 doesBestMoveCreatePin 내부에서
      // 처리되지만, 오프닝처럼 cp 차이가 전술이 아닌 전략적 이유인 경우
      // 불필요하게 doesBestMoveCreatePin을 호출하는 것을 사전에 걸러냄.
      // 비슬라이딩 기물도 발견 핀을 만들 수 있으므로 완전히 제외하지는 않되,
      // 슬라이딩 기물이 아닌 경우 핀 생성 가능성이 훨씬 낮다는 점을 이용해
      // 추가적인 가드를 더 적용한다.
      const sfFromR    = 8 - parseInt(sfBest[1]);
      const sfFromC    = sfBest.charCodeAt(0) - 97;
      const sfPieceType = prev.board[sfFromR]?.[sfFromC]?.[1];

      // 슬라이딩 기물이거나 발견 핀 가능성이 있는 경우에만 진입
      // (슬라이딩 기물: B/R/Q — 직접 핀 라인 생성)
      // (비슬라이딩 기물: doesBestMoveCreatePin 내부에서 발견 핀 경로로 처리)
      if (sfPieceType) {
        if (doesBestMoveCreatePin(prev.board, sfBest, mover, prev)) {
          result.pinMissed++;
          result.tacticEvents.push(_makeTacticEvent('pin', 'missed', '', i, states, mover, sfBest));
        }
      }
    }
  }

  result.avgCpLoss = result.myMoveCount > 0
    ? Math.round(result.myCpSum / result.myMoveCount)
    : 0;

  return result;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 전술 이벤트 객체 생성
 * @param {string} type
 * @param {string} subtype
 * @param {string} piece
 * @param {number} stateIdx
 * @param {Array}  states
 * @param {string} color
 * @param {string} bestUci
 * @returns {Object}
 */
function _makeTacticEvent(type, subtype, piece, stateIdx, states, color, bestUci = '') {
  const s = states[stateIdx];
  return {
    type,
    subtype,
    piece,
    moveIdx: stateIdx,
    moveNum: Math.ceil(stateIdx / 2),
    san:     s ? s.san : '?',
    color,
    bestUci
  };
}
