/**
 * 전술 패턴 감지 (합법 수 기반) — records.html · 기타 분석용
 * chess.js: getAllLegalMoves, applyMoveToBoard, isInCheck, moveToSAN
 */
(function (global) {
  'use strict';

  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  const SLIDER = new Set(['B', 'R', 'Q']);
  const MIN_FORK_TARGET = 320;

  const DIRS = {
    diag: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    orth: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  };

  function enemy(c) { return c === 'w' ? 'b' : 'w'; }

  function cloneBoard(board) {
    return board.map(r => [...r]);
  }

  function snapshotFromState(st) {
    if (!st || !st.board) return null;
    return {
      board: cloneBoard(st.board),
      turn: st.turn,
      castling: { ...(st.castling || { wK: true, wQ: true, bK: true, bQ: true }) },
      enPassant: st.enPassant ? [...st.enPassant] : null,
    };
  }

  function applyMoveSnapshot(snap, move) {
    const { board, turn, castling, enPassant } = snap;
    const nb = global.applyMoveToBoard(cloneBoard(board), move, turn);
    const nc = { ...castling };
    if (nb[move.to[0]][move.to[1]] === turn + 'K') {
      if (turn === 'w') { nc.wK = false; nc.wQ = false; }
      else { nc.bK = false; nc.bQ = false; }
    }
    if (move.from[0] === 7 && move.from[1] === 7) nc.wK = false;
    if (move.from[0] === 7 && move.from[1] === 0) nc.wQ = false;
    if (move.from[0] === 0 && move.from[1] === 7) nc.bK = false;
    if (move.from[0] === 0 && move.from[1] === 0) nc.bQ = false;
    const nep = move.doublePush ? [move.to[0] - (turn === 'w' ? -1 : 1), move.to[1]] : null;
    return {
      board: nb,
      turn: enemy(turn),
      castling: nc,
      enPassant: nep,
    };
  }

  function isAttackedByColor(board, r, c, attacker, castling, enPassant) {
    if (typeof global.getAllLegalMoves !== 'function') return false;
    const legal = global.getAllLegalMoves(board, attacker, castling, enPassant);
    return legal.some(m => m.to[0] === r && m.to[1] === c);
  }

  /** 이동한 기물이 동시에 노리는 고가치 기물(또는 체크) = 포크 */
  function isFork(snap, move) {
    const { board, castling, enPassant } = snap;
    const mover = enemy(snap.turn);
    const tr = move.to[0], tc = move.to[1];
    const targets = new Map();

    const legal = global.getAllLegalMoves(board, mover, castling, enPassant);
    for (const m of legal) {
      if (m.from[0] !== tr || m.from[1] !== tc) continue;
      const cell = board[m.to[0]][m.to[1]];
      if (cell && cell[0] === enemy(mover)) {
        const v = VAL[cell[1]] || 0;
        if (cell[1] === 'K' || v >= MIN_FORK_TARGET) {
          targets.set(`${m.to[0]},${m.to[1]}`, cell[1]);
        }
      }
    }

    const opp = enemy(mover);
    if (global.isInCheck(board, opp)) {
      let kr, kc;
      outer: for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (board[r][c] === opp + 'K') { kr = r; kc = c; break outer; }
        }
      }
      if (kr !== undefined && isAttackedByColor(board, kr, kc, mover, castling, enPassant)) {
        targets.set(`${kr},${kc}`, 'K');
      }
    }

    return targets.size >= 2;
  }

  function rayPins(board, pinnedColor, pinningColor) {
    const abs = [];
    const rel = [];
    let kR, kC, qR, qC;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p || p[0] !== pinnedColor) continue;
        if (p[1] === 'K') { kR = r; kC = c; }
        if (p[1] === 'Q') { qR = r; qC = c; }
      }
    }
    if (kR === undefined) return { abs, rel };

    const scan = (dr, dc, backIsKing) => {
      let nr = kR + dr, nc = kC + dc;
      let blocker = null;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const cell = board[nr][nc];
        if (!cell) { nr += dr; nc += dc; continue; }
        if (!blocker) {
          if (cell[0] === pinnedColor && cell[1] !== 'K' && cell[1] !== 'P') {
            blocker = { r: nr, c: nc, piece: cell[1] };
          } else break;
        } else {
          if (cell[0] === pinningColor && SLIDER.has(cell[1])) {
            const backR = backIsKing ? kR : qR;
            const backC = backIsKing ? kC : qC;
            if (!backIsKing && (backR === undefined)) break;
            if (backIsKing || (backR !== undefined && onSameRay(blocker.r, blocker.c, backR, backC, dr, dc))) {
              const test = cloneBoard(board);
              test[blocker.r][blocker.c] = null;
              if (backIsKing && global.isInCheck(test, pinnedColor)) {
                abs.push(blocker);
              } else if (!backIsKing && cell[1] !== 'K' && VAL[board[blocker.r][blocker.c][1]] >= 320) {
                const backVal = VAL[board[backR][backC][1]] || 0;
                const pinVal = VAL[board[blocker.r][blocker.c][1]] || 0;
                if (backVal >= 330 && backVal > pinVal) rel.push(blocker);
              }
            }
          }
          break;
        }
        nr += dr; nc += dc;
      }
    };

    const allDirs = [...DIRS.diag, ...DIRS.orth];
    for (const [dr, dc] of allDirs) {
      scan(dr, dc, true);
      scan(dr, dc, false);
    }
    return { abs, rel };
  }

  function onSameRay(r1, c1, r2, c2, dr, dc) {
    if ((r2 - r1) * dc !== (c2 - c1) * dr) return false;
    if (dr !== 0 && Math.sign(r2 - r1) !== Math.sign(dr)) return false;
    if (dc !== 0 && Math.sign(c2 - c1) !== Math.sign(dc)) return false;
    return true;
  }

  function pinDelta(before, after, mover) {
    const opp = enemy(mover);
    const b = rayPins(before.board, opp, mover);
    const a = rayPins(after.board, opp, mover);
    const key = (p) => `${p.r},${p.c}`;
    const bAbs = new Set(b.abs.map(key));
    const aAbs = new Set(a.abs.map(key));
    const bRel = new Set(b.rel.map(key));
    const aRel = new Set(a.rel.map(key));
    let absPin = false, relPin = false;
    for (const k of aAbs) if (!bAbs.has(k)) absPin = true;
    for (const k of aRel) if (!bRel.has(k)) relPin = true;
    return { absPin, relPin };
  }

  function isDiscoveredAttack(before, after, move, mover) {
    const opp = enemy(mover);
    const tr = move.to[0], tc = move.to[1];

    const bClear = cloneBoard(after.board);
    bClear[tr][tc] = null;
    if (global.isInCheck(after.board, opp) && !global.isInCheck(bClear, opp)) return true;

    const highBefore = attackedHighValue(before.board, mover, opp, before.castling, before.enPassant, move.from);
    const highAfter = attackedHighValue(after.board, mover, opp, after.castling, after.enPassant, null);
    for (const sq of highAfter) {
      if (!highBefore.has(sq)) return true;
    }
    return false;
  }

  function attackedHighValue(board, attacker, defender, castling, enPassant, excludeFrom) {
    const set = new Set();
    const legal = global.getAllLegalMoves(board, attacker, castling, enPassant);
    for (const m of legal) {
      if (excludeFrom && m.from[0] === excludeFrom[0] && m.from[1] === excludeFrom[1]) continue;
      const t = board[m.to[0]][m.to[1]];
      if (t && t[0] === defender && (t[1] === 'Q' || t[1] === 'R' || t[1] === 'K')) {
        set.add(`${m.to[0]},${m.to[1]}`);
      }
    }
    return set;
  }

  function isCheckmateDelivered(after, mover) {
    const opp = enemy(mover);
    if (after.turn !== opp) return false;
    const legal = global.getAllLegalMoves(after.board, opp, after.castling, after.enPassant);
    return legal.length === 0 && global.isInCheck(after.board, opp);
  }

  /** 상대 기물이 공격받고 탈출 수가 없거나 모든 탈출이 기물 손실 */
  function isTrap(snap) {
    const { board, turn, castling, enPassant } = snap;
    const trapped = turn;
    const attacker = enemy(trapped);
    const legal = global.getAllLegalMoves(board, trapped, castling, enPassant);
    const byFrom = new Map();
    for (const m of legal) {
      const k = `${m.from[0]},${m.from[1]}`;
      if (!byFrom.has(k)) byFrom.set(k, []);
      byFrom.get(k).push(m);
    }

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p || p[0] !== trapped || p[1] === 'K' || p[1] === 'P') continue;
        if (!isAttackedByColor(board, r, c, attacker, castling, enPassant)) continue;
        const moves = byFrom.get(`${r},${c}`) || [];
        if (moves.length === 0) return true;
        if (moves.length > 3) continue;
        let allBad = true;
        for (const m of moves) {
          const after = applyMoveSnapshot(snap, m);
          const stillAttacked = isAttackedByColor(
            after.board, m.to[0], m.to[1], attacker, after.castling, after.enPassant
          );
          const cap = board[m.to[0]][m.to[1]];
          const gained = cap && cap[0] === attacker ? (VAL[cap[1]] || 0) : 0;
          const lost = VAL[p[1]] || 0;
          if (!stillAttacked || gained >= lost - 50) {
            allBad = false;
            break;
          }
        }
        if (allBad) return true;
      }
    }
    return false;
  }

  /** 방어 기물을 노려 다른 위협을 연다 (유인/미끼) */
  function isDecoy(before, after, move, mover) {
    const opp = enemy(mover);
    const tr = move.to[0], tc = move.to[1];
    const attackedPiece = before.board[tr][tc];
    if (!attackedPiece || attackedPiece[0] !== opp) return false;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = after.board[r][c];
        if (!p || p[0] !== opp || p[1] === 'K' || p[1] === 'P') continue;
        if (!isAttackedByColor(after.board, r, c, mover, after.castling, after.enPassant)) continue;
        if (r === tr && c === tc) continue;
        const defenders = countDefenders(before.board, r, c, opp, before.castling, before.enPassant);
        const defSq = findDefenderSquare(before.board, r, c, opp, before.castling, before.enPassant);
        if (defSq && defSq[0] === tr && defSq[1] === tc && defenders <= 1) {
          return true;
        }
      }
    }
    return false;
  }

  function countDefenders(board, r, c, color, castling, enPassant) {
    const legal = global.getAllLegalMoves(board, color, castling, enPassant);
    let n = 0;
    for (const m of legal) {
      if (m.to[0] === r && m.to[1] === c) n++;
    }
    return n;
  }

  function findDefenderSquare(board, r, c, color, castling, enPassant) {
    const legal = global.getAllLegalMoves(board, color, castling, enPassant);
    for (const m of legal) {
      if (m.to[0] === r && m.to[1] === c) return m.from;
    }
    return null;
  }

  function isSkewer(snap, move) {
    const { board, castling, enPassant } = snap;
    const mover = enemy(snap.turn);
    const tr = move.to[0], tc = move.to[1];
    const p = board[tr][tc];
    if (!p || p[0] !== mover || !SLIDER.has(p[1])) return false;
    const opp = enemy(mover);
    const dirs = p[1] === 'B' ? DIRS.diag : p[1] === 'R' ? DIRS.orth : [...DIRS.diag, ...DIRS.orth];
    for (const [dr, dc] of dirs) {
      let nr = tr + dr, nc = tc + dc;
      let first = null;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const cell = board[nr][nc];
        if (cell) {
          if (!first) {
            if (cell[0] !== opp || cell[1] === 'K') break;
            first = { v: VAL[cell[1]] || 0, r: nr, c: nc };
          } else {
            if (cell[0] === opp && cell[1] !== 'K') {
              const v2 = VAL[cell[1]] || 0;
              if (v2 > first.v && first.v >= 100) return true;
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
   * 한 수 직후 전술 (boardAfter = 수를 둔 뒤 스냅샷, mover = 방금 둔 색)
   */
  function detectAfterMove(boardBeforeSnap, boardAfterSnap, move, mover) {
    const empty = {
      fork: false, absPin: false, relPin: false, pin: false,
      discovered: false, checkmate: false, trap: false, decoy: false, skewer: false,
    };
    if (!boardBeforeSnap || !boardAfterSnap || !move) return empty;

    const pins = pinDelta(boardBeforeSnap, boardAfterSnap, mover);
    const fork = isFork(boardAfterSnap, move);
    const disc = isDiscoveredAttack(boardBeforeSnap, boardAfterSnap, move, mover);
    const mate = isCheckmateDelivered(boardAfterSnap, mover);
    const trap = isTrap(boardAfterSnap);
    const decoy = isDecoy(boardBeforeSnap, boardAfterSnap, move, mover);
    const skewer = !fork && isSkewer(boardAfterSnap, move);

    return {
      fork,
      absPin: pins.absPin,
      relPin: pins.relPin,
      pin: pins.absPin || pins.relPin,
      discovered: disc,
      checkmate: mate,
      trap,
      decoy,
      skewer,
    };
  }

  global.ChessTactics = {
    VAL,
    snapshotFromState,
    applyMoveSnapshot,
    detectAfterMove,
    isFork,
    isCheckmateDelivered,
  };
})(typeof window !== 'undefined' ? window : globalThis);
