/**
 * 리체스 lila CpAdvice / AccuracyPercent — records.html · chess-wasm-fixed.html 공통.
 * winningChances: scalachess eval.scala · 임계 0.1/0.2/0.3: lila Advice.scala
 */
(function (global) {
  'use strict';

  const LICHESS_SF_DEPTH = 18;
  const LICHESS_SF_MOVETIME = 900;
  const LICHESS_SF_MULTIPV = 1;
  const LICHESS_WC_MULT = -0.00368208;
  const LICHESS_CP_CEIL = 1000;

  function lichessCeiledWhiteCp(cp) {
    let v = Number(cp) || 0;
    if (Math.abs(v) >= 9000) v = Math.sign(v) * LICHESS_CP_CEIL;
    return Math.max(-LICHESS_CP_CEIL, Math.min(LICHESS_CP_CEIL, v));
  }

  function lichessWinningChancesWhitePov(cpWhite) {
    const x = lichessCeiledWhiteCp(cpWhite);
    const raw = 2 / (1 + Math.exp(LICHESS_WC_MULT * x)) - 1;
    return Math.max(-1, Math.min(1, raw));
  }

  function lichessWinPercentFromWhitePov(cpWhite) {
    return 50 + 50 * lichessWinningChancesWhitePov(cpWhite);
  }

  function lichessWinPercentForMover(cpWhite, mover) {
    const w = lichessWinPercentFromWhitePov(cpWhite);
    return mover === 'w' ? w : (100 - w);
  }

  /** @returns {'inaccuracy'|'mistake'|'blunder'|null} */
  function lichessCpAdviceJudgment(cpBeforeWhite, cpAfterWhite, mover) {
    const wcPrev = lichessWinningChancesWhitePov(cpBeforeWhite);
    const wcCur = lichessWinningChancesWhitePov(cpAfterWhite);
    const dRaw = wcCur - wcPrev;
    const delta = mover === 'w' ? -dRaw : dRaw;
    const tiers = [[0.3, 'blunder'], [0.2, 'mistake'], [0.1, 'inaccuracy']];
    for (let ti = 0; ti < tiers.length; ti++) {
      if (tiers[ti][0] <= delta) return tiers[ti][1];
    }
    return null;
  }

  function lichessMoveAccuracyPercent(wpBefore, wpAfter) {
    if (wpAfter >= wpBefore) return 100;
    const winDiff = wpBefore - wpAfter;
    const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411;
    return Math.max(0, Math.min(100, raw + 1));
  }

  function gameAccuracyFromEvals(evalRows, myColor) {
    let sumReciprocal = 0, count = 0;
    for (let ply = 1; ply < evalRows.length; ply++) {
      const isWhiteMove = ply % 2 === 1;
      const mover = isWhiteMove ? 'w' : 'b';
      const isMe = (isWhiteMove && myColor === 'w') || (!isWhiteMove && myColor === 'b');
      if (!isMe) continue;
      const cpB = evalRows[ply - 1].cpw, cpA = evalRows[ply].cpw;
      const wpB = lichessWinPercentForMover(cpB, mover);
      const wpA = lichessWinPercentForMover(cpA, mover);
      const acc = lichessMoveAccuracyPercent(wpB, wpA);
      if (acc > 0) { sumReciprocal += 1 / acc; count++; }
    }
    return count === 0 ? 0 : Math.round(count / sumReciprocal);
  }

  /** states[].fen 순서로 Stockfish 평가 (records analyzeGame 과 동일 파라미터). */
  async function stockfishEvalStates(states, options) {
    options = options || {};
    const depth = options.depth != null ? options.depth : LICHESS_SF_DEPTH;
    const movetime = options.movetime != null ? options.movetime : LICHESS_SF_MOVETIME;
    const multipv = options.multipv != null ? options.multipv : LICHESS_SF_MULTIPV;
    const onProgress = options.onProgress || function () {};
    const evalRows = [];

    if (typeof global.createStockfishWorker !== 'function' || typeof global.analyzeWithWorker !== 'function') {
      return { evalRows, workerTerminated: true };
    }
    if (!states || states.length < 1) return { evalRows, workerTerminated: true };

    let workerRaw = null;
    try {
      workerRaw = await global.createStockfishWorker(1, 64);
    } catch (e) {
      return { evalRows, error: e, workerTerminated: true };
    }

    const workerObj = { worker: workerRaw, busy: false };
    try {
      for (let si = 0; si < states.length; si++) {
        const fen = states[si].fen;
        let cpw = 0;
        let bestUci = null;
        if (fen) {
          const aw = await global.analyzeWithWorker(workerObj, fen, depth, movetime, multipv);
          if (aw && aw.pvs && aw.pvs[1]) {
            if (aw.pvs[1].cpFromWhite != null) cpw = aw.pvs[1].cpFromWhite;
            const pvArr = aw.pvs[1].pv;
            if (pvArr && pvArr.length && typeof pvArr[0] === 'string') {
              const head = pvArr[0].trim().split(/\s+/)[0];
              const um = head.match(/^([a-h][1-8][a-h][1-8][qrbn]?)/i);
              if (um) bestUci = um[1].toLowerCase();
            }
          }
        }
        evalRows.push({ cpw, bestUci });
        onProgress(si + 1, states.length);
      }
    } finally {
      try { workerRaw.terminate(); } catch (e) { /* ignore */ }
    }
    return { evalRows, workerTerminated: false };
  }

  /** CpAdvice 기준 수 분류 집계 (records / wasm 동일 루프). */
  function summarizeMoveJudgments(evalRows, states, myColor) {
    const out = {
      myBlunders: 0, myMistakes: 0, myInaccuracies: 0,
      oppBlunders: 0, oppMistakes: 0, oppInaccuracies: 0,
      moveJudgments: [],
      /** plyIndex 0 = 첫 수, cls = annotation 문자열 */
      byPly: [],
    };
    for (let i = 1; i < states.length; i++) {
      const mover = states[i - 1].turn;
      const isMe = mover === myColor;
      const cpBefore = evalRows[i - 1].cpw;
      const cpAfter = evalRows[i].cpw;
      const bad = lichessCpAdviceJudgment(cpBefore, cpAfter, mover);
      const judgmentTag = bad
        ? ((isMe ? 'my' : 'opp') + bad.charAt(0).toUpperCase() + bad.slice(1))
        : null;
      out.moveJudgments.push(judgmentTag);
      out.byPly.push({ plyIndex: i - 1, cls: bad, mover, isMe, judgmentTag });
      if (isMe) {
        if (bad === 'inaccuracy') out.myInaccuracies++;
        else if (bad === 'mistake') out.myMistakes++;
        else if (bad === 'blunder') out.myBlunders++;
      } else {
        if (bad === 'inaccuracy') out.oppInaccuracies++;
        else if (bad === 'mistake') out.oppMistakes++;
        else if (bad === 'blunder') out.oppBlunders++;
      }
    }
    return out;
  }

  global.LICHESS_SF_DEPTH = LICHESS_SF_DEPTH;
  global.LICHESS_SF_MOVETIME = LICHESS_SF_MOVETIME;
  global.LICHESS_SF_MULTIPV = LICHESS_SF_MULTIPV;
  global.lichessCeiledWhiteCp = lichessCeiledWhiteCp;
  global.lichessWinningChancesWhitePov = lichessWinningChancesWhitePov;
  global.lichessWinPercentFromWhitePov = lichessWinPercentFromWhitePov;
  global.lichessWinPercentForMover = lichessWinPercentForMover;
  global.lichessCpAdviceJudgment = lichessCpAdviceJudgment;
  global.lichessMoveAccuracyPercent = lichessMoveAccuracyPercent;
  global.gameAccuracyFromEvals = gameAccuracyFromEvals;
  global.stockfishEvalStates = stockfishEvalStates;
  global.summarizeMoveJudgments = summarizeMoveJudgments;
})(typeof window !== 'undefined' ? window : globalThis);
