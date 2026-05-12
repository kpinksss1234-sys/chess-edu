/**
 * chess-analyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 게임 분석 오케스트레이터
 *
 * 분석 파이프라인:
 *   1. PGN → 국면 배열 파싱 (chess-engine.js)
 *   2. 모든 국면 Stockfish 분석 (chess-stockfish.js) — MultiPV=3
 *   3. 수별 순회:
 *      a. 체크메이트 감지
 *      b. cp 손실 계산 → 블런더/실수/부정확 분류
 *      c. 상대 블런더 포착 여부 판정
 *      d. 포크 감지 (chess-tactics.js)
 *      e. 핀 감지 (chess-tactics.js) — 절대/상대 분리
 *
 * ── 포크/핀 카운팅 원칙 ────────────────────────────────────────────────────
 *
 * "1수 실행 가능한 전술 기회 포지션" 단위로 카운트합니다.
 * found와 missed는 한 포지션에서 동시에 집계하지 않습니다 (found 우선).
 *
 * ── 핀 놓침 판정 방식 ─────────────────────────────────────────────────────
 *
 * [기존] SF 최선수(1개) 가 핀 수인지 기하학적으로 확인
 * [변경] SF 3개 라인을 classifyPvsByPin()으로 핀/비핀 분류 후:
 *
 *   핀 놓침 인정 조건 (모두 충족):
 *     1. 내가 선택한 수가 핀 수가 아닌 상태
 *     2. 엔진 3개 라인 중 핀 라인이 1개 이상 존재
 *     3. (핀 라인 중 최고 cp) - (내 수의 실제 cp) ≥ PIN_PV_DIFF_THRESHOLD
 *        → 평가치 차이가 충분히 커야만 "의미 있는 놓침"으로 인정
 *        → 차이가 작으면 어떤 수를 둬도 비슷한 포지션이므로 카운트 안 함
 *
 *   절대 핀 missed / 상대 핀 missed 는 독립 카운트
 *   (같은 포지션에서 둘 다 해당하면 둘 다 올라감)
 *
 * ── 핀 집계 항목 ─────────────────────────────────────────────────────────────
 *   absPinFound   : 내가 실행한 절대 핀
 *   absPinMissed  : 놓친 절대 핀 (엔진 라인 비교 기준)
 *   relPinFound   : 내가 실행한 상대 핀
 *   relPinMissed  : 놓친 상대 핀 (엔진 라인 비교 기준)
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

const FORK_CP_GAIN = 80;            // 놓친 포크 인정 최소 cp 손실
const FORK_FOUND_MAX_CP_LOSS = 60;  // "찾은 포크" 인정 최대 cp 손실 (실익 없는 포크 모양 필터)
const PIN_FOUND_MAX_CP_LOSS  = 60;  // "찾은 핀" 인정 최대 cp 손실 (블런더 핀 모양 필터)

/**
 * 핀 놓침 인정 최소 cp 차이.
 * 엔진 핀 라인의 평가치 - 내 수의 실제 평가치 ≥ 이 값이어야 "놓침"으로 인정.
 *
 * [설정 기준]
 *   - 너무 낮으면: 어떤 수를 둬도 좋은 포지션에서 오탐 발생
 *   - 너무 높으면: 실제 핀 기회를 놓쳤어도 카운트 안 됨
 *   - 80cp ≈ "실수(Mistake)" 기준과 동일 → 핀을 쓰지 않아 실수급 손해를 본 경우만 인정
 */
const PIN_PV_DIFF_THRESHOLD = 80;

async function analyzeGame(pgn, myColor, onProgress) {
  const states = parsePgnToStates(pgn);

  const result = {
    totalMoves:      states.length - 1,
    myBlunders:      0, myMistakes:      0, myInaccuracies: 0,
    oppBlunders:     0, oppMistakes:     0, oppInaccuracies: 0,
    oppBlunderFound: 0, oppBlunderMissed: 0,
    checkmates:      0,
    forkFound:       { P:0, N:0, B:0, R:0, Q:0, K:0 },
    forkMissed:      { P:0, N:0, B:0, R:0, Q:0, K:0 },
    oppForkCreated:  { P:0, N:0, B:0, R:0, Q:0, K:0 },
    // ── 핀: 절대(absolute) / 상대(relative) 분리 ──────────────────────────
    absPinFound:     0,   // 내가 실행한 절대 핀
    absPinMissed:    0,   // 놓친 절대 핀 (엔진 라인 비교)
    relPinFound:     0,   // 내가 실행한 상대 핀
    relPinMissed:    0,   // 놓친 상대 핀 (엔진 라인 비교)
    myCpSum:         0, myMoveCount: 0,
    tacticEvents:    []
  };

  // ── Step 1: 전체 포지션 Stockfish 분석 (MultiPV=3) ──────────────────────
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
      if      (label === 'blunder')    result.oppBlunders++;
      else if (label === 'mistake')    result.oppMistakes++;
      else if (label === 'inaccuracy') result.oppInaccuracies++;
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

    // ── 이하 내 수 분석 ───────────────────────────────────────────────────
    const actualUci = moveToUci(move);
    const movedPT   = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';

    // ════════════════════════════════════════════════════════════════════
    // 포크
    // ════════════════════════════════════════════════════════════════════

    // [found]
    // 포크 모양이라도 엔진 기준으로 손실이 큰 수면 "전술적 실익"이 낮다고 보고 제외.
    const actualIsFork = isValidFork(state.board, mover, move.to, prev.board);
    if (actualIsFork && loss <= FORK_FOUND_MAX_CP_LOSS) {
      result.forkFound[movedPT] = (result.forkFound[movedPT] || 0) + 1;
      result.tacticEvents.push(_makeTacticEvent('fork','found',movedPT,i,states,mover));
    }

    // [missed] SF 최선수가 포크인데 내가 다른 수를 둔 경우
    if (!actualIsFork && loss >= FORK_CP_GAIN) {
      const sfBest = ana[i-1].bestmove;
      if (sfBest && sfBest !== actualUci && sfBest !== '(none)') {
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
    }

    // ════════════════════════════════════════════════════════════════════
    // 핀 (절대 + 상대) — 엔진 3개 라인 비교 방식
    // ════════════════════════════════════════════════════════════════════

    // [found] 내가 실제로 둔 수가 핀 생성인지 기하학적으로 판정
    const actualPin = detectPinCreated(prev.board, state.board, move, mover);

    // cp 손실이 너무 큰(블런더/심각한 실수급) 핀 수는
    // "전술적으로 잘 찾은 핀"으로 보지 않고 found 집계에서 제외한다.
    if (loss <= PIN_FOUND_MAX_CP_LOSS) {
      if (actualPin.absolute) {
        result.absPinFound++;
        result.tacticEvents.push(_makeTacticEvent('absPin','found','',i,states,mover));
      }
      if (actualPin.relative) {
        result.relPinFound++;
        result.tacticEvents.push(_makeTacticEvent('relPin','found','',i,states,mover));
      }
    }

    // ── [missed] 엔진 3개 라인 비교 ──────────────────────────────────────
    //
    // 내가 핀 수를 두지 않은 경우에만 진입.
    // 절대 핀 missed / 상대 핀 missed 는 독립적으로 판정.
    //
    // 판정 절차:
    //   1. ana[i-1].pvs (이동 전 포지션의 엔진 3개 라인) 를 classifyPvsByPin()으로 분류
    //   2. 핀 라인 중 best cp 를 구함
    //   3. 내가 실제로 둔 수 이후 포지션의 cp (afterCp) 와 비교
    //      → (핀 라인 best cp) - afterCp ≥ PIN_PV_DIFF_THRESHOLD 이면 "놓침"
    //
    // 주의: afterCp 는 이미 위에서 구한 "내 수 이후 상대 기준 역전된 cp"이므로
    //       핀 라인 cp 도 동일 기준(mover 기준)으로 변환하여 비교.
    // ─────────────────────────────────────────────────────────────────────

    const needAbsMissed = !actualPin.absolute;
    const needRelMissed = !actualPin.relative;

    // [안전장치] 엔진 PV1(최선수)이 실제 둔 수와 같은 경우에는
    // "핀을 놓쳤다"고 보지 않는다.
    // → chess.com 등 외부 분석에서 PV1 최선수인 경우와 직관을 맞추기 위함.
    const engineBestUci = ana[i-1].bestmove || '';
    if (engineBestUci === actualUci) {
      continue;
    }

    if (needAbsMissed || needRelMissed) {
      // 이동 전 포지션의 엔진 PV1만 핀 여부로 분류.
      // PV2/3의 분류 오차로 인한 미세 오탐을 줄이기 위함.
      const pv1Only = (ana[i-1].pvs && ana[i-1].pvs[0]) ? [ana[i-1].pvs[0]] : [];
      const { pinPvs } = classifyPvsByPin(pv1Only, prev, mover);

      if (pinPvs.length > 0) {
        // 내 수 이후 실제 평가치 (mover 기준 cp)
        // afterCp 는 이미 "내 수 이후 mover 기준"으로 계산되어 있음
        const myActualCp = afterCp;

        // 절대 핀 라인 중 mover 기준 최고 cp
        const absPinPvs = pinPvs.filter(p => p.absolute);
        const relPinPvs = pinPvs.filter(p => p.relative);

        if (needAbsMissed && absPinPvs.length > 0) {
          const bestAbsCp = Math.max(
            ...absPinPvs.map(p => cpFor(p.cp, p.mate, mover))
          );
          // 핀 라인이 내 수보다 PIN_PV_DIFF_THRESHOLD 이상 유리해야 "놓침"
          if (bestAbsCp - myActualCp >= PIN_PV_DIFF_THRESHOLD) {
            result.absPinMissed++;
            const bestAbsPv = absPinPvs.find(
              p => cpFor(p.cp, p.mate, mover) === bestAbsCp
            );
            result.tacticEvents.push(
              _makeTacticEvent('absPin','missed','',i,states,mover,
                               bestAbsPv ? bestAbsPv.uci : '')
            );
          }
        }

        if (needRelMissed && relPinPvs.length > 0) {
          const bestRelCp = Math.max(
            ...relPinPvs.map(p => cpFor(p.cp, p.mate, mover))
          );
          if (bestRelCp - myActualCp >= PIN_PV_DIFF_THRESHOLD) {
            result.relPinMissed++;
            const bestRelPv = relPinPvs.find(
              p => cpFor(p.cp, p.mate, mover) === bestRelCp
            );
            result.tacticEvents.push(
              _makeTacticEvent('relPin','missed','',i,states,mover,
                               bestRelPv ? bestRelPv.uci : '')
            );
          }
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
    plyIdx:  stateIdx, // plyIdx 추가
    san:     s ? s.san : '?',
    color,
    bestUci
  };
}
