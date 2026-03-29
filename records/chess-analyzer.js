/**
 * chess-analyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 게임 분석 오케스트레이터
 *
 * 분석 파이프라인:
 *   1. PGN → 국면 배열 파싱 (chess-engine.js)
 *   2. 모든 국면 Stockfish 분석 (chess-stockfish.js)
 *   3. 수별 순회:
 *      a. 체크메이트 감지
 *      b. cp 손실 계산 → 블런더/실수/부정확 분류
 *      c. 상대 블런더 포착 여부 판정
 *      d. 포크 감지 (chess-tactics.js)
 *      e. 절대 핀 / 상대 핀 감지 (chess-tactics.js)
 *
 * ── 포크/핀 카운팅 원칙 ────────────────────────────────────────────────────
 *
 * "1수 실행 가능한 전술 기회 포지션" 단위로 카운트합니다.
 *
 * [found] 내가 실제로 포크/핀을 실행한 경우
 * [missed] 내가 다른 수를 뒀는데 SF 최선수가 포크/핀이었고 cp 손실 ≥ 임계값인 경우
 *
 * 한 포지션에서 found와 missed는 동시에 집계되지 않습니다 (found 우선).
 * chess-tactics.js의 isValidFork / detectPinCreated가 이미 "이 수 덕분에 생긴
 * 전술인지" 여부를 판별하므로, 여기서는 단순히 그 결과를 집계합니다.
 *
 * ── 핀 집계 항목 ─────────────────────────────────────────────────────────────
 *   absPinFound   : 내가 실행한 절대 핀 (피핀 기물 뒤에 적 킹)
 *   absPinMissed  : 놓친 절대 핀 (SF 최선수가 절대 핀, cp 손실 ≥ 임계값)
 *   relPinFound   : 내가 실행한 상대 핀 (피핀 기물 뒤에 적 Q/R)
 *   relPinMissed  : 놓친 상대 핀 (SF 최선수가 상대 핀, cp 손실 ≥ 임계값)
 *
 * 의존성:
 *   - chess-engine.js
 *   - chess-tactics.js
 *   - chess-stockfish.js
 *
 * 외부에 노출하는 주요 함수:
 *   analyzeGame(pgn, myColor, onProgress) → Promise<AnalysisResult>
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const FORK_CP_GAIN = 80;   // 놓친 포크 인정 최소 cp 손실
const PIN_CP_GAIN  = 80;   // 놓친 핀 인정 최소 cp 손실 (오프닝 오탐 방지를 위해 80으로 상향)

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
    // ── 핀: 절대(absolute) / 상대(relative) 분리 ──────────────────────────
    absPinFound:     0,   // 내가 실행한 절대 핀 (피핀 뒤: 적 킹)
    absPinMissed:    0,   // 놓친 절대 핀
    relPinFound:     0,   // 내가 실행한 상대 핀 (피핀 뒤: 적 Q/R)
    relPinMissed:    0,   // 놓친 상대 핀
    myCpSum:         0, myMoveCount: 0,
    tacticEvents:    []
  };

  // ── Step 1: 전체 포지션 Stockfish 분석 ──────────────────────────────────
  const ana = new Array(states.length).fill(null);
  for (let i = 0; i < states.length; i++) {
    ana[i] = await analyzePosition(states[i].fen);
    if (onProgress) onProgress(i, states.length - 1);
  }

  // ── Step 2: 수별 분석 ───────────────────────────────────────────────────
  for (let i = 1; i < states.length; i++) {
    const state = states[i];
    const prev  = states[i - 1];
    const move  = state.move;
    if (!move) continue;

    const mover = prev.turn;
    const isMe  = mover === myColor;
    const enemy = enemyColor(mover);

    // ── 체크메이트 ────────────────────────────────────────────────────────
    if (isMe && isInCheck(state.board, enemy)) {
      const leg = getAllLegal(state.board, enemy, state.castling, state.enPassant);
      if (leg.length === 0) result.checkmates++;
    }

    // ── cp 손실 계산 ──────────────────────────────────────────────────────
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

    // ── 상대 블런더 포착 ──────────────────────────────────────────────────
    if (!isMe && label === 'blunder' && i + 1 < states.length) {
      const myBestHere   = ana[i].pvs[0];
      const myActualHere = ana[i+1].pvs[0];
      const myBestCp     = myBestHere   ? cpFor(myBestHere.cp,   myBestHere.mate,   myColor) : 0;
      const myActualCp   = myActualHere ? -cpFor(myActualHere.cp, myActualHere.mate, enemy)  : 0;
      const caught       = (myBestCp - myActualCp) < MISTAKE_CP;
      if (caught) {
        result.oppBlunderFound++;
        result.tacticEvents.push(_makeTacticEvent('oppBlunder','found','',i+1,states,myColor));
      } else {
        result.oppBlunderMissed++;
        result.tacticEvents.push(_makeTacticEvent('oppBlunder','missed','',i+1,states,myColor,ana[i].bestmove));
      }
    }

    // ── 상대 수: 포크 생성 감지 ───────────────────────────────────────────
    if (!isMe) {
      const movedPT_opp = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';
      if (isValidFork(state.board, mover, move.to, prev.board)) {
        result.oppForkCreated[movedPT_opp] = (result.oppForkCreated[movedPT_opp] || 0) + 1;
        result.tacticEvents.push(_makeTacticEvent('oppFork','found',movedPT_opp,i,states,mover));
      }
      continue;
    }

    // ── 내 수: 포크 / 핀 감지 ─────────────────────────────────────────────
    const sfBest    = ana[i-1].bestmove;
    const actualUci = moveToUci(move);
    const movedPT   = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';

    // ── 포크 ─────────────────────────────────────────────────────────────

    // [found] 내가 실제로 둔 수가 포크
    const actualIsFork = isValidFork(state.board, mover, move.to, prev.board);
    if (actualIsFork) {
      result.forkFound[movedPT] = (result.forkFound[movedPT] || 0) + 1;
      result.tacticEvents.push(_makeTacticEvent('fork','found',movedPT,i,states,mover));
    }

    // [missed] SF 최선수가 포크인데 내가 다른 수를 뒀고 cp 손실 ≥ 임계값
    // found 포지션은 중복 카운트하지 않음
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
          result.tacticEvents.push(_makeTacticEvent('fork','missed',sfPT,i,states,mover,sfBest));
        }
      }
    }

    // ── 핀 (절대 + 상대) ─────────────────────────────────────────────────

    // [found] 내가 실제로 둔 수가 핀 생성
    const actualPin = detectPinCreated(prev.board, state.board, move, mover);

    if (actualPin.absolute) {
      result.absPinFound++;
      result.tacticEvents.push(_makeTacticEvent('absPin','found','',i,states,mover));
    }
    if (actualPin.relative) {
      result.relPinFound++;
      result.tacticEvents.push(_makeTacticEvent('relPin','found','',i,states,mover));
    }

    // [missed] SF 최선수가 핀을 만들었는데 내가 다른 수를 뒀고 cp 손실 ≥ 임계값
    // found 포지션은 중복 카운트하지 않음
    const pinAlreadyFound = actualPin.absolute || actualPin.relative;

    if (!pinAlreadyFound && sfBest && sfBest !== actualUci && sfBest !== '(none)' && loss >= PIN_CP_GAIN) {
      const sfFromR     = 8 - parseInt(sfBest[1]);
      const sfFromC     = sfBest.charCodeAt(0) - 97;
      const sfPieceType = prev.board[sfFromR]?.[sfFromC]?.[1];

      if (sfPieceType) {
        const sfPin = doesBestMoveCreatePin(prev.board, sfBest, mover, prev);

        if (sfPin.absolute && !actualPin.absolute) {
          result.absPinMissed++;
          result.tacticEvents.push(_makeTacticEvent('absPin','missed','',i,states,mover,sfBest));
        }
        if (sfPin.relative && !actualPin.relative) {
          result.relPinMissed++;
          result.tacticEvents.push(_makeTacticEvent('relPin','missed','',i,states,mover,sfBest));
        }
      }
    }
  }

  result.avgCpLoss = result.myMoveCount > 0
    ? Math.round(result.myCpSum / result.myMoveCount)
    : 0;

  return result;
}

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
