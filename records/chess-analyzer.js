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
 *      e. 핀 감지 (chess-tactics.js - detectPinCreated)
 *
 * 전술 이벤트(tacticEvent) 객체 형태:
 *   {
 *     type:     'fork' | 'pin' | 'oppBlunder',
 *     subtype:  'found' | 'missed',
 *     piece:    'N' | 'B' | ... (포크 기물, 핀/블런더는 ''),
 *     moveIdx:  number,    // 국면 배열 인덱스
 *     moveNum:  number,    // 체스 수 번호 (1수, 2수...)
 *     san:      string,    // 수 표기 (예: 'Nc6xd4')
 *     color:    'w'|'b',   // 이동한 색상
 *     bestUci:  string     // 놓친 경우에만: SF 추천 최선수
 *   }
 *
 * 의존성:
 *   - chess-engine.js   (parsePgnToStates, applyMoveToBoard, getAllLegal, ...)
 *   - chess-tactics.js  (isValidFork, detectPinCreated, doesBestMoveCreatePin)
 *   - chess-stockfish.js (analyzePosition, cpFor, cpToLabel, SF_MULTIPV, ...)
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
 *     pinFound, pinMissed,
 *     avgCpLoss,
 *     tacticEvents: TacticEvent[]
 *   }
 *
 * 설정 상수 (chess-stockfish.js에서 가져옴):
 *   FORK_CP_GAIN - 포크 기회 인정 최소 cp 이득
 *   PIN_CP_GAIN  - 핀 기회 인정 최소 cp 이득
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
    totalMoves:       states.length - 1,
    myBlunders:       0, myMistakes:   0, myInaccuracies: 0,
    oppBlunders:      0, oppMistakes:  0,
    oppBlunderFound:  0, oppBlunderMissed: 0,
    checkmates:       0,
    forkFound:        { P:0, N:0, B:0, R:0, Q:0, K:0 },
    forkMissed:       { P:0, N:0, B:0, R:0, Q:0, K:0 },
    oppForkCreated:   { P:0, N:0, B:0, R:0, Q:0, K:0 }, // 상대가 만든 포크
    pinFound:         0, pinMissed: 0,
    myCpSum:          0, myMoveCount: 0,
    tacticEvents:     []
  };

  // ── Step 1: 전체 포지션 Stockfish 분석 ────────────────────────────────────
  const ana = new Array(states.length).fill(null);
  for (let i = 0; i < states.length; i++) {
    ana[i] = await analyzePosition(states[i].fen);
    if (onProgress) onProgress(i, states.length - 1);
  }

  // ── Step 2: 수별 분석 ─────────────────────────────────────────────────────
  for (let i = 1; i < states.length; i++) {
    const state  = states[i];
    const prev   = states[i - 1];
    const move   = state.move;
    if (!move) continue;

    const mover  = prev.turn;
    const isMe   = mover === myColor;
    const enemy  = enemyColor(mover);

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

    // ── 상대 수: 포크 생성 감지 (상대가 포크를 뒀는지) ───────────────────────
    if (!isMe) {
      const movedPT_opp = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';
      // oppFork도 Stockfish 기준으로 실질적 이득이 있는 포크만 인정
      // loss = 이 수를 둔 후 mover(상대) 입장에서의 cp 이득
      // 상대가 FORK_CP_GAIN 이상 이득을 봤고 포크 조건도 충족할 때만 카운트
      if (loss >= FORK_CP_GAIN && isValidFork(state.board, mover, move.to, prev.board)) {
        result.oppForkCreated[movedPT_opp] = (result.oppForkCreated[movedPT_opp] || 0) + 1;
        result.tacticEvents.push(_makeTacticEvent('oppFork', 'found', movedPT_opp, i, states, mover));
      }
      continue;
    }

    // ── 포크 / 핀 (내 수일 때만) ────────────────────────────────────────────
    const sfBest   = ana[i-1].bestmove;
    const actualUci = moveToUci(move);
    const movedPT  = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';

    // ── 포크 감지 ──────────────────────────────────────────────────────────
    // 찾은 포크: 실제 둔 수가 정교한 포크 조건 충족
    if (isValidFork(state.board, mover, move.to, prev.board)) {
      result.forkFound[movedPT] = (result.forkFound[movedPT] || 0) + 1;
      result.tacticEvents.push(_makeTacticEvent('fork', 'found', movedPT, i, states, mover));
    }

    // 놓친 포크: SF 최선수가 포크이고 내가 다른 수를 뒀으며 손실이 임계값 이상
    if (sfBest && sfBest !== actualUci && sfBest !== '(none)' && loss >= FORK_CP_GAIN) {
      const sfPT  = prev.board[8 - parseInt(sfBest[1])][sfBest.charCodeAt(0) - 97]?.[1] || 'P';
      const sfMov = uciToMoveObj(sfBest, prev.board, prev.turn, prev.castling, prev.enPassant);
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
    // 찾은 핀: 이 수가 실제로 핀을 만들었는지 정교하게 판정
    if (detectPinCreated(prev.board, state.board, move, mover)) {
      result.pinFound++;
      result.tacticEvents.push(_makeTacticEvent('pin', 'found', '', i, states, mover));
    }

    // 놓친 핀: SF 최선수가 핀을 만들었고 내가 다른 수를 뒀을 때
    if (sfBest && sfBest !== actualUci && sfBest !== '(none)' && loss >= PIN_CP_GAIN) {
      if (doesBestMoveCreatePin(prev.board, sfBest, mover, prev)) {
        result.pinMissed++;
        result.tacticEvents.push(_makeTacticEvent('pin', 'missed', '', i, states, mover, sfBest));
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
