/**
 * 포지션 구조화 브리프 — AI 코치에 "검증된 사실"만 전달.
 * chess.js (parseFenBoard, getAllLegalMoves, applyMoveToBoard, moveToSAN, uciToMove) 필요.
 */
(function (global) {
  'use strict';

  const PIECE_KR = { P: '폰', N: '나이트', B: '비숍', R: '룩', Q: '퀸', K: '킹' };
  const PIECE_VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 99 };
  const COLOR_KR = { w: '백', b: '흑' };
  const INSIGHT_CATEGORY = {
    '집중 압박': 'threat', '이중 압박': 'threat', '수적 우세': 'threat',
    '킹 안전 위협': 'threat', '킹존 압박': 'threat', '포크': 'threat',
    '추크추방': 'threat', '디스커버드 어택': 'threat',
    '배터리': 'idea', '대각 배터리': 'idea', '열린 파일 독점': 'idea',
    '반열린 파일': 'idea', '아웃포스트': 'idea', '통과 폰': 'idea',
    '전장 판단': 'idea', '공격 방향': 'idea', '마이너리티 공격': 'idea',
    '예방 전진': 'idea', '주도권': 'idea',
    '고립 폰': 'weakness', '이중 폰': 'weakness', '뒤처진 폰': 'weakness',
    '기물 과부하': 'weakness', '기물 가치↓': 'weakness',
    '폰 사슬': 'strength', '폰 영역 우세': 'strength', '기물 가치↑': 'strength',
  };

  function parseFenState(fen) {
    const parts = (fen || '').trim().split(/\s+/);
    const board = global.parseFenBoard(parts[0]);
    if (!board) return null;
    return {
      board,
      turn: parts[1] || 'w',
      castling: global.parseFenCastling(parts[2] || '-'),
      enPassant: global.parseFenEP(parts[3] || '-'),
    };
  }

  function idxToSq(r, f) {
    return 'abcdefgh'[f] + (8 - r);
  }

  function isLightSquare(r, f) {
    return (r + f) % 2 === 0;
  }

  /** 칸을 공격하는 기물 (슬라이딩 경로 포함) */
  function getAttackersOnSquare(board, targetR, targetF) {
    const out = { w: [], b: [] };
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell) continue;
        const color = cell[0];
        const piece = cell[1];
        const dr = targetR - r;
        const df = targetF - f;

        if (piece === 'P') {
          const dir = color === 'w' ? -1 : 1;
          if (dr === dir && Math.abs(df) === 1) out[color].push({ sq: idxToSq(r, f), piece });
          continue;
        }
        if (piece === 'N') {
          if ((Math.abs(dr) === 2 && Math.abs(df) === 1) || (Math.abs(dr) === 1 && Math.abs(df) === 2))
            out[color].push({ sq: idxToSq(r, f), piece });
          continue;
        }
        if (piece === 'K') {
          if (Math.abs(dr) <= 1 && Math.abs(df) <= 1 && (dr || df))
            out[color].push({ sq: idxToSq(r, f), piece });
          continue;
        }
        const straight = dr === 0 || df === 0;
        const diagonal = Math.abs(dr) === Math.abs(df);
        if ((piece === 'R' && !straight) || (piece === 'B' && !diagonal) || (piece === 'Q' && !straight && !diagonal)) continue;
        const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
        const stepF = df === 0 ? 0 : df / Math.abs(df);
        let blocked = false;
        let cr = r + stepR, cf = f + stepF;
        while (cr !== targetR || cf !== targetF) {
          if (board[cr][cf]) { blocked = true; break; }
          cr += stepR; cf += stepF;
        }
        if (!blocked) out[color].push({ sq: idxToSq(r, f), piece });
      }
    }
    return out;
  }

  function cloneState(state) {
    return {
      board: state.board.map(r => [...r]),
      turn: state.turn,
      castling: { ...state.castling },
      enPassant: state.enPassant ? [...state.enPassant] : null,
    };
  }

  function applyMoveToState(state, move) {
    const { board, turn, castling, enPassant } = state;
    const legal = global.getAllLegalMoves(board, turn, castling, enPassant);
    const san = global.moveToSAN(board, move, turn, legal);
    const nb = global.applyMoveToBoard(board.map(r => [...r]), move, turn);
    const newCast = { ...castling };
    if (nb[move.to[0]][move.to[1]] === turn + 'K') {
      if (turn === 'w') { newCast.wK = false; newCast.wQ = false; }
      else { newCast.bK = false; newCast.bQ = false; }
    }
    if (move.from[0] === 7 && move.from[1] === 7) newCast.wK = false;
    if (move.from[0] === 7 && move.from[1] === 0) newCast.wQ = false;
    if (move.from[0] === 0 && move.from[1] === 7) newCast.bK = false;
    if (move.from[0] === 0 && move.from[1] === 0) newCast.bQ = false;
    const newEp = move.doublePush ? [move.to[0] - (turn === 'w' ? -1 : 1), move.to[1]] : null;
    return {
      state: {
        board: nb,
        turn: turn === 'w' ? 'b' : 'w',
        castling: newCast,
        enPassant: newEp,
      },
      san,
    };
  }

  function hasMateInOne(state) {
    return detectMateInOne(state).length > 0;
  }

  function detectMateInOne(state) {
    if (typeof global.getAllLegalMoves !== 'function' || typeof global.moveToSAN !== 'function') return [];
    const { board, turn, castling, enPassant } = state;
    const legal = global.getAllLegalMoves(board, turn, castling, enPassant);
    const mates = [];
    for (const move of legal) {
      const san = global.moveToSAN(board, move, turn, legal);
      if (san.endsWith('#')) {
        mates.push({
          mover: COLOR_KR[turn],
          san,
          detail: `${COLOR_KR[turn]}이 ${san}로 즉시 체크메이트 가능`,
        });
      }
    }
    return mates;
  }

  /**
   * N수 메이트: 첫 수 m1 후 상대 모든 합법 응수에 대해 (depth-1)수 메이트가 존재.
   */
  function detectForcedMate(state, depth, limits) {
    if (depth < 1) return [];
    if (depth === 1) {
      return detectMateInOne(state).map(m => ({
        plies: 1,
        mover: m.mover,
        keyMove: m.san,
        line: m.san,
        detail: m.detail,
      }));
    }

    const maxPatterns = limits.maxPatterns || 4;
    const maxMoves = limits.maxMoves || 22;
    const maxReplies = limits.maxReplies || 18;
    const attacker = state.turn;
    const patterns = [];
    const legal = global.getAllLegalMoves(state.board, state.turn, state.castling, state.enPassant);

    for (let i = 0; i < Math.min(legal.length, maxMoves) && patterns.length < maxPatterns; i++) {
      const m1 = legal[i];
      const { state: s1, san: san1 } = applyMoveToState(cloneState(state), m1);
      const replies = global.getAllLegalMoves(s1.board, s1.turn, s1.castling, s1.enPassant);
      if (replies.length === 0 || replies.length > maxReplies) continue;

      let allLinesForceMate = true;
      let sampleReplySan = null;
      let sampleFinishSan = null;

      for (const r of replies) {
        const { state: s2, san: san2 } = applyMoveToState(cloneState(s1), r);
        const sub = detectForcedMate(s2, depth - 1, { maxPatterns: 1, maxMoves: limits.subMoves || 14, maxReplies: limits.subReplies || 14 });
        if (sub.length === 0) {
          allLinesForceMate = false;
          break;
        }
        if (!sampleReplySan) {
          sampleReplySan = san2;
          sampleFinishSan = sub[0].line;
        }
      }

      if (allLinesForceMate) {
        const line = sampleReplySan
          ? `${san1} … ${sampleReplySan} … ${sampleFinishSan}`
          : san1;
        patterns.push({
          plies: depth,
          mover: COLOR_KR[attacker],
          keyMove: san1,
          line,
          detail: `${COLOR_KR[attacker]} ${san1} 후 모든 응수에 ${depth}수 안에 메이트 (예: ${line})`,
        });
      }
    }
    return patterns;
  }

  function detectMateInTwo(state, limits) {
    return detectForcedMate(state, 2, limits || {});
  }

  function detectMateInThree(state, limits) {
    return detectForcedMate(state, 3, { maxMoves: 16, maxReplies: 12, subMoves: 10, subReplies: 10, maxPatterns: 3, ...(limits || {}) });
  }

  function detectHangingPieces(state) {
    const { board } = state;
    const hanging = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell || cell[1] === 'K') continue;
        const color = cell[0];
        const opp = color === 'w' ? 'b' : 'w';
        const atks = getAttackersOnSquare(board, r, f);
        const oppAtks = atks[opp];
        const defAtks = atks[color].filter(a => a.sq !== idxToSq(r, f));
        if (oppAtks.length === 0) continue;
        const val = PIECE_VAL[cell[1]] || 0;
        if (val < 3) continue;
        if (defAtks.length === 0 || oppAtks.length > defAtks.length) {
          const atkDesc = oppAtks.map(a => `${PIECE_KR[a.piece]}(${a.sq})`).join('+');
          hanging.push({
            sq: idxToSq(r, f),
            piece: PIECE_KR[cell[1]],
            color: COLOR_KR[color],
            detail: defAtks.length === 0
              ? `${COLOR_KR[color]} ${PIECE_KR[cell[1]]}(${idxToSq(r, f)})가 수비 없이 ${atkDesc}에게 공격받음`
              : `${COLOR_KR[color]} ${PIECE_KR[cell[1]]}(${idxToSq(r, f)}) — 공격 ${oppAtks.length} vs 수비 ${defAtks.length} (${atkDesc})`,
          });
        }
      }
    }
    return hanging;
  }

  function detectSquareColorWeakness(state) {
    const { board } = state;
    const out = [];
    for (const color of ['w', 'b']) {
      const opp = color === 'w' ? 'b' : 'w';
      let lightBishop = false, darkBishop = false;
      let lightPawns = 0, darkPawns = 0;
      const kingZone = { light: 0, dark: 0 };

      let kingR = -1, kingF = -1;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (!c || c[0] !== color) continue;
          const light = isLightSquare(r, f);
          if (c[1] === 'B') {
            if (light) lightBishop = true; else darkBishop = true;
          }
          if (c[1] === 'P') {
            if (light) lightPawns++; else darkPawns++;
          }
          if (c[1] === 'K') { kingR = r; kingF = f; }
        }
      }

      if (kingR >= 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let df = -1; df <= 1; df++) {
            const nr = kingR + dr, nf = kingF + df;
            if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
            const c = board[nr][nf];
            if (!c || c[1] !== 'P' || c[0] !== color) {
              if (isLightSquare(nr, nf)) kingZone.light++;
              else kingZone.dark++;
            }
          }
        }
      }

      if (lightBishop && lightPawns >= 4) {
        out.push({
          color: COLOR_KR[color],
          type: 'light_squares',
          detail: `${COLOR_KR[color]} 밝은 칸 비숍인데 아군 폰 ${lightPawns}개가 밝은 칸에 있음 — 배드 비숍·밝은 칸 약화 가능`,
        });
      }
      if (darkBishop && darkPawns >= 4) {
        out.push({
          color: COLOR_KR[color],
          type: 'dark_squares',
          detail: `${COLOR_KR[color]} 어두운 칸 비숍인데 아군 폰 ${darkPawns}개가 어두운 칸에 있음 — 배드 비숍·어두운 칸 약화 가능`,
        });
      }

      let oppLightB = false, oppDarkB = false;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (c && c[0] === opp && c[1] === 'B') {
            if (isLightSquare(r, f)) oppLightB = true; else oppDarkB = true;
          }
        }
      }
      if (oppLightB && kingZone.light >= 2) {
        out.push({
          color: COLOR_KR[color],
          type: 'opponent_light_complex',
          detail: `${COLOR_KR[opp]} 밝은 칸 비숍이 있고 ${COLOR_KR[color]} 킹 주변 밝은 칸에 폰 방패 부족 — 장기적으로 밝은 칸 약점`,
        });
      }
      if (oppDarkB && kingZone.dark >= 2) {
        out.push({
          color: COLOR_KR[color],
          type: 'opponent_dark_complex',
          detail: `${COLOR_KR[opp]} 어두운 칸 비숍이 있고 ${COLOR_KR[color]} 킹 주변 어두운 칸에 폰 방패 부족 — 장기적으로 어두운 칸 약점`,
        });
      }
    }
    return out;
  }

  function forkAfterMove(boardAfter, move, moverColor) {
    const tr = move.to[0], tc = move.to[1];
    const piece = boardAfter[tr][tc];
    if (!piece) return null;
    const opp = moverColor === 'w' ? 'b' : 'w';
    const targets = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const t = boardAfter[r][f];
        if (!t || t[0] !== opp || t[1] === 'P' || t[1] === 'K') continue;
        const atks = getAttackersOnSquare(boardAfter, r, f);
        if (atks[moverColor].some(a => a.sq === idxToSq(tr, tc))) {
          targets.push({ sq: idxToSq(r, f), piece: PIECE_KR[t[1]] });
        }
      }
    }
    if (targets.length >= 2) {
      return `포크 — ${targets.map(t => `${t.piece}(${t.sq})`).join(', ')} 동시 공격`;
    }
    return null;
  }

  /** 엔진 PV를 따라가며 수마다 태그·설명 생성 */
  function annotateEngineLine(fen, uciMoves, maxPlies) {
    if (!uciMoves || !uciMoves.length || typeof global.uciToMove !== 'function') return [];
    const state = parseFenState(fen);
    if (!state) return [];

    let { board, turn, castling, enPassant } = state;
    const steps = [];
    const limit = Math.min(maxPlies || 8, uciMoves.length);

    for (let i = 0; i < limit; i++) {
      const uci = uciMoves[i];
      const legal = global.getAllLegalMoves(board, turn, castling, enPassant);
      const move = global.uciToMove(uci, board, turn, castling, enPassant);
      if (!move) break;

      const san = global.moveToSAN(board, move, turn, legal);
      const mover = COLOR_KR[turn];
      const tags = [];
      const captured = board[move.to[0]][move.to[1]];
      const epCap = move.enPassant ? (turn === 'w' ? 'bP' : 'wP') : null;

      if (captured || epCap) {
        const cap = captured || epCap;
        tags.push('capture');
      }
      if (san.includes('+')) tags.push('check');
      if (san.includes('#')) tags.push('mate');

      const boardAfter = global.applyMoveToBoard(board.map(r => [...r]), move, turn);
      const forkNote = forkAfterMove(boardAfter, move, turn);
      if (forkNote) tags.push('fork');

      let note = `${mover} ${san}`;
      if (tags.includes('mate')) {
        note += ' → 즉시 체크메이트';
      } else if (tags.includes('check')) {
        note += ' → 체크, 상대는 킹을 안전한 칸으로 피해야 함';
      } else if (tags.includes('capture')) {
        const capName = captured ? PIECE_KR[captured[1]] : '폰';
        note += ` → ${capName} 포획`;
      }
      if (forkNote) note += ` (${forkNote})`;

      steps.push({ ply: i + 1, san, mover, tags, note });

      if (boardAfter[move.to[0]][move.to[1]] === turn + 'K') {
        if (turn === 'w') { castling.wK = false; castling.wQ = false; }
        else { castling.bK = false; castling.bQ = false; }
      }
      if (move.from[0] === 7 && move.from[1] === 7) castling.wK = false;
      if (move.from[0] === 7 && move.from[1] === 0) castling.wQ = false;
      if (move.from[0] === 0 && move.from[1] === 7) castling.bK = false;
      if (move.from[0] === 0 && move.from[1] === 0) castling.bQ = false;
      enPassant = move.doublePush ? [move.to[0] - (turn === 'w' ? -1 : 1), move.to[1]] : null;
      turn = turn === 'w' ? 'b' : 'w';
      board = boardAfter;
    }
    return steps;
  }

  function classifyInsights(insights) {
    const buckets = { threats: [], ideas: [], weaknesses: [], strengths: [] };
    if (!insights || !insights.length) return buckets;

    for (const line of insights) {
      const m = line.match(/^\[([^\]]+)\]/);
      const tag = m ? m[1] : '';
      const cat = INSIGHT_CATEGORY[tag] || 'idea';
      const text = line.replace(/^\[[^\]]+\]\s*/, '').trim();
      const item = { tag, text, source: 'structure' };
      if (cat === 'threat') buckets.threats.push(item);
      else if (cat === 'weakness') buckets.weaknesses.push(item);
      else if (cat === 'strength') buckets.strengths.push(item);
      else buckets.ideas.push(item);
    }
    return buckets;
  }

  function pickTop(arr, n) {
    return arr.slice(0, n);
  }

  /**
   * @param {object} opts
   * @param {string} opts.fen
   * @param {string} opts.turn
   * @param {string[]} [opts.pv1Uci]
   * @param {string[]} [opts.pv2Uci]
   * @param {string[]} [opts.positionInsights]
   */
  function buildPositionBrief(opts) {
    const fen = opts.fen;
    const state = parseFenState(fen);
    const brief = {
      fen,
      turn: state ? state.turn : (fen.split(' ')[1] || 'w'),
      mateIn1: [],
      mateIn2: [],
      mateIn3: [],
      mateThreats: [],
      opponentMateIn2: [],
      opponentMateIn3: [],
      hanging: [],
      squareWeakness: [],
      engineLine: [],
      engineLine2: [],
      threats: [],
      ideas: [],
      weaknesses: [],
      strengths: [],
      verifiedFacts: [],
    };

    if (!state) return brief;

    brief.mateIn1 = detectMateInOne(state);
    brief.mateThreats = brief.mateIn1;
    brief.mateIn2 = detectMateInTwo(state);
    brief.mateIn3 = detectMateInThree(state);

    const opp = state.turn === 'w' ? 'b' : 'w';
    const oppState = cloneState(state);
    oppState.turn = opp;
    brief.opponentMateIn2 = detectMateInTwo(oppState, { maxPatterns: 2, maxMoves: 18 });
    brief.opponentMateIn3 = detectMateInThree(oppState, { maxPatterns: 1 });

    brief.hanging = detectHangingPieces(state);
    brief.squareWeakness = detectSquareColorWeakness(state);

    if (opts.pv1Uci && opts.pv1Uci.length) {
      brief.engineLine = annotateEngineLine(fen, opts.pv1Uci, 8);
    }
    if (opts.pv2Uci && opts.pv2Uci.length) {
      brief.engineLine2 = annotateEngineLine(fen, opts.pv2Uci, 5);
    }

    const classified = classifyInsights(opts.positionInsights || []);

    brief.threats = [
      ...brief.mateIn1.map(m => ({ tag: 'mate_in_1', text: m.detail, source: 'verified' })),
      ...brief.mateIn2.map(m => ({ tag: 'mate_in_2', text: m.detail, source: 'verified' })),
      ...brief.mateIn3.map(m => ({ tag: 'mate_in_3', text: m.detail, source: 'verified' })),
      ...brief.opponentMateIn2.map(m => ({ tag: 'opp_mate_in_2', text: `상대(차례 가정) ${m.detail}`, source: 'verified' })),
      ...brief.hanging.map(h => ({ tag: 'hanging', text: h.detail, source: 'verified' })),
      ...classified.threats,
    ];
    brief.ideas = [...classified.ideas];
    brief.weaknesses = [
      ...brief.squareWeakness.map(s => ({ tag: s.type, text: s.detail, source: 'verified' })),
      ...classified.weaknesses,
    ];
    brief.strengths = classified.strengths;

    brief.threats = pickTop(brief.threats, 8);
    brief.ideas = pickTop(brief.ideas, 5);
    brief.weaknesses = pickTop(brief.weaknesses, 5);
    brief.strengths = pickTop(brief.strengths, 4);

    for (const step of brief.engineLine) {
      brief.verifiedFacts.push(step.note);
    }
    brief.mateIn1.forEach(m => brief.verifiedFacts.push(m.detail));
    brief.mateIn2.forEach(m => brief.verifiedFacts.push(m.detail));
    brief.mateIn3.forEach(m => brief.verifiedFacts.push(m.detail));
    brief.opponentMateIn2.forEach(m => brief.verifiedFacts.push(m.detail));
    brief.hanging.forEach(h => brief.verifiedFacts.push(h.detail));
    [...brief.threats, ...brief.weaknesses, ...brief.ideas].forEach(x => {
      if (x.text) brief.verifiedFacts.push(x.text);
    });
    brief.verifiedFacts = [...new Set(brief.verifiedFacts)].slice(0, 20);

    return brief;
  }

  function formatPositionBriefForPrompt(brief, ctx) {
    const lines = [];
    lines.push('[검증된 분석 브리프 — 아래 사실만 해설에 사용. 브리프에 없는 위협·기물·수를 만들어내지 말 것]');

    if (brief.mateIn1.length) {
      lines.push('');
      lines.push('■ 1수 메이트');
      brief.mateIn1.forEach(m => lines.push(`  • ${m.detail}`));
    }
    if (brief.mateIn2.length) {
      lines.push('');
      lines.push('■ 2수 메이트 패턴 (모든 방어에 메이트)');
      brief.mateIn2.forEach(m => lines.push(`  • ${m.detail}`));
    }
    if (brief.mateIn3.length) {
      lines.push('');
      lines.push('■ 3수 메이트 패턴');
      brief.mateIn3.forEach(m => lines.push(`  • ${m.detail}`));
    }
    if (brief.opponentMateIn2.length || brief.opponentMateIn3.length) {
      lines.push('');
      lines.push('■ 상대 메이트 위협 (상대 차례였다면)');
      brief.opponentMateIn2.forEach(m => lines.push(`  • ${m.detail}`));
      brief.opponentMateIn3.forEach(m => lines.push(`  • ${m.detail}`));
    }

    if (brief.threats.length) {
      lines.push('');
      lines.push('■ 전술적 위협 (코드 검증)');
      brief.threats.forEach(t => lines.push(`  • ${t.text}`));
    }

    if (brief.weaknesses.length) {
      lines.push('');
      lines.push('■ 구조적 약점 (폰·칸색·장기)');
      brief.weaknesses.forEach(w => lines.push(`  • ${w.text}`));
    }

    if (brief.strengths.length) {
      lines.push('');
      lines.push('■ 강점');
      brief.strengths.forEach(s => lines.push(`  • ${s.text}`));
    }

    if (brief.ideas.length) {
      lines.push('');
      lines.push('■ 전략 아이디어');
      brief.ideas.forEach(i => lines.push(`  • ${i.text}`));
    }

    if (brief.engineLine.length) {
      lines.push('');
      lines.push('■ 엔진 1순위 수순 — 수마다 인과 (이 순서·이유만 사용)');
      brief.engineLine.forEach(step => lines.push(`  ${step.ply}. ${step.note}`));
      if (ctx && ctx.turn) {
        const first = ctx.turn === 'w' ? '백' : '흑';
        const second = ctx.turn === 'w' ? '흑' : '백';
        lines.push(`  (해석: 홀수 번째 수=${first}, 짝수 번째 수=${second})`);
      }
    }

    if (brief.engineLine2.length) {
      lines.push('');
      lines.push('■ 엔진 2순위 (대안/방어 참고)');
      brief.engineLine2.forEach(step => lines.push(`  ${step.ply}. ${step.note}`));
    }

    return lines.join('\n');
  }

  /** FEN(또는 현재 국면) 브리프를 콘솔에 JSON으로 출력 */
  function debugPositionBriefToConsole(fenOptional) {
    let fen = (fenOptional || '').trim();
    if (!fen && typeof global.game !== 'undefined' && global.game && typeof global.boardToFen === 'function') {
      fen = global.boardToFen(
        global.game.board,
        global.game.turn,
        global.game.castling,
        global.game.enPassant,
        global.game.halfMove,
        global.game.fullMove
      );
    }
    if (!fen) {
      console.warn('[PositionBrief] FEN이 없습니다. 입력란에 FEN을 넣거나 보드에 국면을 두세요.');
      return null;
    }

    const turn = fen.split(' ')[1] || 'w';
    let positionInsights = [];
    if (typeof global.extractPositionInsights === 'function') {
      positionInsights = global.extractPositionInsights(fen);
    }

    const pv1 = global.pvData && global.pvData[1];
    const pv2 = global.pvData && global.pvData[2];
    const pv1Uci = pv1 && (pv1.moves || pv1.pv) ? (pv1.moves || pv1.pv) : [];
    const pv2Uci = pv2 && (pv2.moves || pv2.pv) ? (pv2.moves || pv2.pv) : [];

    const brief = buildPositionBrief({
      fen,
      turn,
      pv1Uci,
      pv2Uci,
      positionInsights,
    });

    console.group('[Position Brief Debug]');
    console.log('FEN:', fen);
    console.log('Brief object:', brief);
    console.log('JSON:\n', JSON.stringify(brief, null, 2));
    if (typeof global.formatPositionBriefForPrompt === 'function') {
      console.log('Prompt block:\n', formatPositionBriefForPrompt(brief, { turn }));
    }
    console.groupEnd();
    return brief;
  }

  global.buildPositionBrief = buildPositionBrief;
  global.formatPositionBriefForPrompt = formatPositionBriefForPrompt;
  global.debugPositionBriefToConsole = debugPositionBriefToConsole;
})(typeof window !== 'undefined' ? window : globalThis);
