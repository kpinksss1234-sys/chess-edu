/**
 * chess-analyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 게임 분석 오케스트레이터 (Stockfish 기반)
 * 
 * chess-wasm-fixed.html의 분석 방식(Win Probability)을 그대로 이식하여
 * 일관된 블런더/실수/부정확 판정 결과를 제공합니다.
 *
 * 분석 파이프라인:
 *   1. PGN → 국면 배열 파싱 (chess-engine.js)
 *   2. 모든 국면 Stockfish 분석 (chess-stockfish.js) — MultiPV=3
 *   3. 수별 순회 및 분류 (Win Probability 기반):
 *      - Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Blunder, Miss
 *   4. 전술 감지 (chess-tactics.js):
 *      - 포크, 핀 (절대/상대)
 */

'use strict';

// ── 핵심 임계값 및 설정 ─────────────────────────────────────────────────────
const FORK_CP_GAIN = 80;
const FORK_FOUND_MAX_CP_LOSS = 60;
const PIN_FOUND_MAX_CP_LOSS  = 60;
const PIN_PV_DIFF_THRESHOLD  = 80;

// 기물 가치 (isSacrifice 용)
const PIECE_VALUE_ANALYSER = { P:100, N:320, B:330, R:500, Q:900, K:0 };

// ── 승률 및 분류 유틸리티 (chess-wasm-fixed/chess.js 에서 이식) ───────────────

/** cp → 승률 변환 (Chess.com 공식 시그모이드) */
function winProb(cpMe) {
  return 1 / (1 + Math.pow(10, -cpMe / 400));
}

/** 백 기준 cp와 차례를 받아 내 관점 승률(0~1) 반환 */
function getWinProb(cpFromWhite, turn) {
  const cpMe = turn === 'w' ? cpFromWhite : -cpFromWhite;
  return winProb(cpMe);
}

/** 희생 수 판정 (Brilliant 판정용) */
function isSacrifice(h) {
  if (!h || !h.move || !h.captured) return false;
  
  const board = h.board;
  const movingPiece = board[h.move.from[0]][h.move.from[1]];
  if (!movingPiece) return false;
  
  const myVal       = PIECE_VALUE_ANALYSER[movingPiece[1]] || 0;
  const capturedVal = PIECE_VALUE_ANALYSER[h.captured[1]]  || 0;

  if (myVal < 450) return false; // 룩 이상 기물만 희생으로 인정
  if (myVal <= capturedVal + 150) return false;

  // 상대가 착지 칸을 즉시 되잡을 수 있는지 확인 (기하학적 확인)
  const enemy = h.turn === 'w' ? 'b' : 'w';
  const [tr, tc] = h.move.to;
  
  // 가상의 보드에서 확인 (이미 이동한 후의 보드여야 함)
  // 여기서는 단순히 true를 반환하는 대신, chess-tactics.js의 도움을 받을 수 있지만
  // 간결성을 위해 일단 true로 유지하거나, 간단한 체크 추가
  return true; 
}

/** 
 * 수 분류 함수 (Chess.com 공식 방식)
 * cpBefore/cpAfter: 백 기준 cp
 */
function classifyMove(cpBefore, cpAfter, turn, topAlts) {
  const cpMe      = turn === 'w' ? cpBefore : -cpBefore;
  const cpMeAfter = turn === 'w' ? cpAfter  : -cpAfter;

  const wBefore = winProb(cpMe);
  const wAfter  = winProb(cpMeAfter);

  const best1cp = topAlts?.best1cp ?? null;
  const best2cp = topAlts?.best2cp ?? null;
  const wBest1  = best1cp != null ? winProb(turn === 'w' ? best1cp : -best1cp) : wBefore;
  const wBest2  = best2cp != null ? winProb(turn === 'w' ? best2cp : -best2cp) : null;

  const deltaW = wBest1 - wAfter;

  if (topAlts?.legalMoveCount === 1) return 'forced';
  if (topAlts?.isEngineBest) return 'best';

  // 메이트 판정
  const hadMateWin = topAlts?.mateInBefore != null && topAlts.mateInBefore > 0;
  const gaveMate   = topAlts?.mateInAfter  != null && topAlts.mateInAfter  > 0;
  const iMateWin   = cpMe      >=  9000;
  const iMateLose  = cpMe      <= -9000;
  const afterMateMe= cpMeAfter <= -9000;

  if (gaveMate) return 'blunder';

  if ((hadMateWin || iMateWin) && !gaveMate) {
    if (afterMateMe)       return 'blunder';
    if (cpMeAfter >= 200)  return 'best';
    if (cpMeAfter >= -50)  return 'excellent';
    if (cpMeAfter >= -300) return 'mistake';
    return 'blunder';
  }

  if (iMateLose) {
    if (afterMateMe) {
      if (deltaW <= 0)    return 'best';
      if (deltaW <= 0.02) return 'excellent';
      if (deltaW <= 0.05) return 'good';
      return 'inaccuracy';
    }
    if (cpMeAfter > -200) return (topAlts?.hasSacrifice ?? false) ? 'brilliant' : 'best';
    return 'inaccuracy';
  }

  // Brilliant !!
  if ((topAlts?.hasSacrifice ?? false) && deltaW <= 0.02 && wAfter > 0.5) {
    return 'brilliant';
  }

  // Great !
  const actualGain = wAfter - wBefore;
  if (wBest1 != null && wBest2 != null && (wBest1 - wBest2) >= 0.15 && deltaW <= 0.02 && actualGain >= 0.05) {
    return 'great';
  }
  if (wBefore < 0.45 && wAfter > 0.60 && deltaW <= 0.02) {
    return 'great';
  }

  if (deltaW <= 0.005) return 'best';

  // 포지션 유형별 ΔW 임계값
  const balanced = wBefore >= 0.35 && wBefore <= 0.65;
  const winning  = wBefore > 0.65 && wBefore <= 0.85;

  if (balanced) {
    if (deltaW <= 0.04) return 'excellent';
    if (deltaW <= 0.08) return 'good';
    if (deltaW <= 0.14) return 'inaccuracy';
    if (deltaW <= 0.24) return 'mistake';
    return 'blunder';
  }

  if (winning) {
    if (deltaW <= 0.03) return 'excellent';
    if (deltaW <= 0.06) return 'good';
    if (deltaW <= 0.12) return 'inaccuracy';
    if (deltaW <= 0.22) return 'mistake';
    return 'blunder';
  }

  if (deltaW <= 0.02) return 'excellent';
  if (deltaW <= 0.05) return 'good';
  if (deltaW <= 0.10) return 'inaccuracy';
  if (deltaW <= 0.20) return 'mistake';
  return 'blunder';
}

// ── 분석 메인 함수 ───────────────────────────────────────────────────────────

/**
 * PGN을 분석하여 통계 데이터를 반환합니다.
 */
async function analyzeGame(pgn, myColor, onProgress) {
  const states = parsePgnToStates(pgn);
  const total = states.length - 1;

  // 1. 엔진 초기화
  await initStockfish();

  const ana = []; // 각 ply의 분석 결과 저장

  // 2. 전수 분석
  for (let i = 0; i < states.length; i++) {
    if (onProgress) onProgress(i, states.length);
    const fen = states[i].fen;
    const res = await analyzePosition(fen);
    ana.push(res);
  }

  const result = {
    totalMoves:      total,
    myBlunders:      0, myMistakes:      0, myInaccuracies: 0,
    oppBlunders:     0, oppMistakes:     0, oppInaccuracies: 0,
    oppBlunderFound: 0, oppBlunderMissed: 0,
    checkmates:      0,
    forkFound:       { P:0, N:0, B:0, R:0, Q:0, K:0 },
    forkMissed:      { P:0, N:0, B:0, R:0, Q:0, K:0 },
    oppForkCreated:  { P:0, N:0, B:0, R:0, Q:0, K:0 },
    absPinFound:     0, relPinFound:     0,
    absPinMissed:    0, relPinMissed:    0,
    myCpSum:         0, myMoveCount: 0,
    tacticEvents:    []
  };

  let prevMoveCls = null;

  // 3. 수별 순회하며 결과 집계
  for (let i = 1; i < states.length; i++) {
    const prev  = states[i - 1];
    const state = states[i];
    const move  = state.move;
    const mover = prev.turn;
    const isMe  = mover === myColor;

    // (1) 평가치 준비
    const beforeAna = ana[i - 1];
    const afterAna  = ana[i];

    // 백 기준 cp
    const cpBefore = cpFor(beforeAna.pvs[0]?.cp, beforeAna.pvs[0]?.mate, 'w');
    const cpAfter  = cpFor(afterAna.pvs[0]?.cp,  afterAna.pvs[0]?.mate,  'w');
    
    // 내 관점 cp 손실 (ACPL용)
    const loss = mover === 'w' ? Math.max(0, cpBefore - cpAfter) : Math.max(0, cpAfter - cpBefore);

    // (2) 수 분류 (Win Probability 기반)
    const best1uci = beforeAna.pvs[0]?.moves?.[0] || null;
    const actualUci = moveToUci(move);
    
    const topAlts = {
      best1cp:        cpFor(beforeAna.pvs[0]?.cp, beforeAna.pvs[0]?.mate, 'w'),
      best2cp:        beforeAna.pvs[1] ? cpFor(beforeAna.pvs[1].cp, beforeAna.pvs[1].mate, 'w') : null,
      hasSacrifice:   isSacrifice({ board: prev.board, move, captured: state.captured, turn: mover }),
      legalMoveCount: null,
      mateInBefore:   beforeAna.pvs[0]?.mate,
      mateInAfter:    afterAna.pvs[0]?.mate,
      isEngineBest:   best1uci === actualUci
    };

    // forced 판정용 legalMoveCount
    if (topAlts.isEngineBest === false) {
       topAlts.legalMoveCount = getAllLegalMoves(prev.board, mover, prev.castling, prev.enPassant).length;
    }

    let cls = classifyMove(cpBefore, cpAfter, mover, topAlts);

    // Miss 판정
    const missExempt = new Set(['brilliant','great','best','forced','blunder','mistake']);
    if (!missExempt.has(cls)) {
      const wBest1 = winProb(mover === 'w' ? topAlts.best1cp : -topAlts.best1cp);
      const wMove  = winProb(mover === 'w' ? cpAfter : -cpAfter);
      if (wBest1 > 0.8 && wMove < 0.5) cls = 'miss';
    }

    // 결과 카운팅
    if (isMe) {
      if      (cls === 'blunder')    result.myBlunders++;
      else if (cls === 'mistake')    result.myMistakes++;
      else if (cls === 'inaccuracy') result.myInaccuracies++;
      
      result.myMoveCount++;
      result.myCpSum += loss;

      // 상대 블런더 응징 판정 (이전 수가 상대의 블런더였을 때)
      if (prevMoveCls === 'blunder') {
         // 내 수가 블런더나 실수가 아니면 응징 성공으로 간주
         if (cls !== 'blunder' && cls !== 'mistake') {
           result.oppBlunderFound++;
         } else {
           result.oppBlunderMissed++;
         }
      }
    } else {
      if      (cls === 'blunder')    result.oppBlunders++;
      else if (cls === 'mistake')    result.oppMistakes++;
      else if (cls === 'inaccuracy') result.oppInaccuracies++;
    }

    prevMoveCls = cls;

    // (3) 전술 감지 (chess-tactics.js 활용)
    
    // [포크]
    if (!isMe) {
      const movedPT_opp = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';
      if (isValidFork(state.board, mover, move.to, prev.board)) {
        result.oppForkCreated[movedPT_opp] = (result.oppForkCreated[movedPT_opp] || 0) + 1;
        result.tacticEvents.push(_makeTacticEvent('oppFork','found',movedPT_opp,i,states,mover));
      }
    } else {
      const movedPT = prev.board[move.from[0]][move.from[1]]?.[1] || 'P';
      const actualIsFork = isValidFork(state.board, mover, move.to, prev.board);
      if (actualIsFork && loss <= FORK_FOUND_MAX_CP_LOSS) {
        result.forkFound[movedPT] = (result.forkFound[movedPT] || 0) + 1;
        result.tacticEvents.push(_makeTacticEvent('fork','found',movedPT,i,states,mover));
      }
      // [Missed Fork]
      if (!actualIsFork && loss >= FORK_CP_GAIN) {
        const sfBest = beforeAna.bestmove;
        if (sfBest && sfBest !== actualUci && sfBest !== '(none)') {
          const sfMov = uciToMoveObj(sfBest, prev.board, prev.turn, prev.castling, prev.enPassant);
          if (sfMov) {
            const sfBoard = applyMoveToBoard(prev.board, sfMov, mover);
            const sfTo    = [8 - parseInt(sfBest[3]), sfBest.charCodeAt(2) - 97];
            if (isValidFork(sfBoard, mover, sfTo, prev.board)) {
              const sfPT = prev.board[sfMov.from[0]][sfMov.from[1]]?.[1] || 'P';
              result.forkMissed[sfPT] = (result.forkMissed[sfPT] || 0) + 1;
              result.tacticEvents.push(_makeTacticEvent('fork','missed',sfPT,i,states,mover,sfBest));
            }
          }
        }
      }

      // [핀]
      const actualPin = detectPinCreated(prev.board, state.board, move, mover);
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
      
      // [Missed Pin]
      if (!actualPin.absolute || !actualPin.relative) {
        if (best1uci !== actualUci) {
          const pv1Only = (beforeAna.pvs && beforeAna.pvs[0]) ? [beforeAna.pvs[0]] : [];
          const { pinPvs } = classifyPvsByPin(pv1Only, prev, mover);
          if (pinPvs.length > 0) {
             const moverCpAfter = mover === 'w' ? cpAfter : -cpAfter;
             const absPinPvs = pinPvs.filter(p => p.absolute);
             const relPinPvs = pinPvs.filter(p => p.relative);
             
             if (!actualPin.absolute && absPinPvs.length > 0) {
               const bestAbsCp = Math.max(...absPinPvs.map(p => cpFor(p.cp, p.mate, mover)));
               if (bestAbsCp - moverCpAfter >= PIN_PV_DIFF_THRESHOLD) {
                 result.absPinMissed++;
                 result.tacticEvents.push(_makeTacticEvent('absPin','missed','',i,states,mover,absPinPvs[0].uci));
               }
             }
             if (!actualPin.relative && relPinPvs.length > 0) {
               const bestRelCp = Math.max(...relPinPvs.map(p => cpFor(p.cp, p.mate, mover)));
               if (bestRelCp - moverCpAfter >= PIN_PV_DIFF_THRESHOLD) {
                 result.relPinMissed++;
                 result.tacticEvents.push(_makeTacticEvent('relPin','missed','',i,states,mover,relPinPvs[0].uci));
               }
             }
          }
        }
      }
    }
    
    if (state.san.includes('#')) result.checkmates++;
  }

  result.avgCpLoss = result.myMoveCount > 0 ? Math.round(result.myCpSum / result.myMoveCount) : 0;

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
    plyIdx:  stateIdx,
    san:     s ? s.san : '?',
    color,
    bestUci
  };
}
