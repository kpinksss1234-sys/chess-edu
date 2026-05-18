let coachApiKey = '';
let coachOpen = false;
let coachLoading = false;

// API 키 저장/불러오기
function saveApiKey() {
  const input = document.getElementById('coach-api-input');
  const key = input.value.trim();
  if (!key) { showToast('API 키를 입력하세요'); return; }
  coachApiKey = key;
  try { sessionStorage.setItem('chess_groq_key', key); } catch(e) {}
  document.getElementById('coach-key-status').textContent = '✓ 저장됨';
  document.getElementById('coach-key-status').style.color = '#7fa650';
  showToast('API 키 저장 완료');
}

function loadApiKey() {
  // 서버 프록시 방식: 키는 Vercel 환경변수에 저장됨 (클라이언트에 노출 없음)
  coachApiKey = 'proxy'; // 프록시 사용 중임을 표시하는 플래그
  const inp = document.getElementById('coach-api-input');
  if (inp) { inp.value = '(서버에 안전하게 저장됨)'; inp.disabled = true; inp.style.opacity='0.5'; }
  const st = document.getElementById('coach-key-status');
  if (st) { st.textContent = '✓ 서버 연결'; st.style.color = '#7fa650'; }
  const btn = document.getElementById('coach-save-key-btn');
  if (btn) btn.style.display = 'none';
}

// 패널 열기/닫기
function openCoach() {
  coachOpen = true;
  const panel = document.getElementById('coach-inline');
  if (panel) panel.classList.add('visible');
  const btn = document.getElementById('coach-open-btn');
  if (btn) btn.classList.add('active');
  // 보드 왼쪽 정렬로 전환
  const boardArea = document.getElementById('board-area');
  if (boardArea) boardArea.classList.add('coach-open');
  // 패널을 열자마자 자동으로 포지션 해설 실행
  runPositionCommentary();
}

function closeCoach() {
  coachOpen = false;
  const panel = document.getElementById('coach-inline');
  if (panel) panel.classList.remove('visible');
  const btn = document.getElementById('coach-open-btn');
  if (btn) btn.classList.remove('active');
  // 보드 중앙 정렬 복원
  const boardArea = document.getElementById('board-area');
  if (boardArea) boardArea.classList.remove('coach-open');
}

function closeCoachInline() {
  closeCoach();
}

function toggleCoachPanel() {
  if (coachOpen) {
    closeCoach();
  } else {
    openCoach();
  }
}

// updateCoachContext: 상단 태그 표시는 제거 (빈 함수로 유지 — 다른 곳에서 호출될 수 있음)
function updateCoachContext() {
  const ctx = document.getElementById('coach-context-display');
  if (ctx) ctx.style.display = 'none';
}

// 체스 컨텍스트 데이터 빌드
async function buildChessContext() {
  if (!game) return null;

  const turn = game.turn;
  const fen = boardToFen(game.board, game.turn, game.castling, game.enPassant, game.halfMove, game.fullMove);

  // 추가: API에서 고급 컨텍스트 데이터 가져오기
  let advancedContext = { center_control: {}, king_safety: {} };
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: fen })
    });
    const data = await response.json();
    advancedContext = data.facts;
  } catch(e) {
    console.warn('[Coach] 고급 컨텍스트 분석 실패:', e);
  }

  // 엔진 라인 3개 (window.pvData에서)
  console.log('[Debug Coach] window.pvData access:', window.pvData);
  const pv1 = window.pvData && window.pvData[1];
  const pv2 = window.pvData && window.pvData[2];
  const pv3 = window.pvData && window.pvData[3];
  console.log('[Debug Coach] pv1:', pv1);

  const bestMove  = pv1 && pv1.moves && pv1.moves[0] ? pv1.moves[0] : null;
  const bestLine  = pv1 && pv1.moves ? pv1.moves.slice(0, 8).join(' ') : null;
  const line2     = pv2 && pv2.moves ? pv2.moves.slice(0, 6).join(' ') : null;
  const line3     = pv3 && pv3.moves ? pv3.moves.slice(0, 6).join(' ') : null;

  const evaluation   = pv1 ? pv1.eval : null;
  const depth        = pv1 ? pv1.depth : null;
  const cpFromWhite  = pv1 ? pv1.cpFromWhite : null;

  // 마지막으로 둔 수
  let lastMove = null;
  let lastMoveSan = null;
  let lastMoveAnnotation = null;
  if (game.historyIndex >= 0 && game.history[game.historyIndex]) {
    const h = game.history[game.historyIndex];
    lastMoveSan = h.san;
    lastMoveAnnotation = h.annotation;
    lastMove = h.san;
  }

  // 이전 포지션의 엔진 최선수
  let engineBestForPrevPos = null;
  let engineLineForPrevPos = null;
  if (game.historyIndex >= 0 && game.history[game.historyIndex]) {
    const h = game.history[game.historyIndex];
    const prevFen = h.fenBefore;
    if (prevFen) {
      const cached = evalCache[normFen(prevFen)];
      if (cached && cached.pvs) {
        const prevPv1 = cached.pvs[1];
        if (prevPv1) {
          const prevBoard = parseFenBoard(prevFen.split(' ')[0]);
          const prevTurn  = prevFen.split(' ')[1] || 'w';
          const prevCast  = parseFenCastling(prevFen.split(' ')[2] || '-');
          const prevEP    = parseFenEP(prevFen.split(' ')[3] || '-');
          if (prevBoard) {
            const sanList = uciMovesToSan(prevPv1.pv || [], prevBoard, prevTurn, prevCast, prevEP);
            engineBestForPrevPos = sanList[0] || null;
            engineLineForPrevPos = sanList.slice(0, 6).join(' ') || null;
          }
        }
      }
    }
  }

  // 게임 전체 PGN
  let pgnMoves = '';
  game.history.forEach((s) => {
    if (s.turn === 'w') pgnMoves += `${s.fullMove}. `;
    pgnMoves += s.san + ' ';
  });

  // 게임 단계 판단
  const moveCount = game.history.length;
  const phase = moveCount <= 10 ? '오프닝' : moveCount <= 30 ? '미들게임' : '엔드게임';

  // 평가 방향
  let advantageDesc = '균형';
  if (cpFromWhite !== null) {
    const v = cpFromWhite / 100;
    if (v > 3) advantageDesc = '백이 크게 우세';
    else if (v > 1) advantageDesc = '백이 약간 우세';
    else if (v < -3) advantageDesc = '흑이 크게 우세';
    else if (v < -1) advantageDesc = '흑이 약간 우세';
  }

  // 최선수 설명 패널 데이터 수집 (이미 분석된 경우)
  let bestExplainData = null;
  try {
    const beEl = document.getElementById('best-explain-content');
    if (beEl && lastBestExplainFen) {
      const reasonItems = beEl.querySelectorAll('.best-reason-item span');
      const reasons = Array.from(reasonItems).map(el => el.innerText.trim()).filter(Boolean);
      const titleEl = beEl.querySelector('.best-explain-title');
      const title   = titleEl ? titleEl.innerText.trim() : null;
      if (reasons.length > 0) {
        bestExplainData = { move: bestExplainMoves[0] || null, title, reasons };
      }
    }
  } catch(e) { /* 무시 */ }

  // 위협 패널에서 마지막으로 분석된 위협 데이터 포함
  let threatData = null;
  try {
    const tEl = document.getElementById('threat-content');
    if (tEl) {
      const ideaEl = tEl.querySelector('.threat-label-idea');
      const probEl = tEl.querySelector('.threat-label-prob');
      const solEl  = tEl.querySelector('.threat-label-sol');
      const getBody = (labelEl) => {
        if (!labelEl) return null;
        const section = labelEl.closest('.threat-section');
        const body = section && section.querySelector('.threat-section-body');
        return body ? body.innerText.trim() : null;
      };
      const idea = getBody(ideaEl);
      const prob = getBody(probEl);
      const sol  = getBody(solEl);
      if (idea || prob || sol) {
        threatData = { idea, prob, sol };
      }
    }
  } catch(e) { /* 무시 */ }

  // 사용자가 그린 화살표 (후보수 / 수순 구분)
  let candidateMoves = [];
  let sequenceMoves = [];
  try {
    // chess-wasm-fixed.html의 _userArrows 배열 읽기
    if (typeof window._userArrows !== 'undefined' && window._userArrows.length > 0) {
      const FILES = 'abcdefgh';
      window._userArrows.forEach(a => {
        const fromSq = FILES[a.fc] + (8 - a.fr);
        const toSq   = FILES[a.tc] + (8 - a.tr);
        if (a.seq) sequenceMoves.push(fromSq + '-' + toSq);
        else       candidateMoves.push(fromSq + '-' + toSq);
      });
    }
  } catch(e) { /* 무시 */ }

  // 포지션 구조 인사이트 추출 (FEN 기반 정제 분석)
  const positionInsights = extractPositionInsights(fen);

  return {
    turn, fen, bestMove, bestLine, line2, line3, evaluation, depth, cpFromWhite,
    lastMove, lastMoveSan, lastMoveAnnotation,
    engineBestForPrevPos, engineLineForPrevPos,
    pgnMoves: pgnMoves.trim(),
    phase, moveCount, advantageDesc,
    fullMove: game.fullMove,
    threatData,
    bestExplainData,
    candidateMoves,
    sequenceMoves,
    positionInsights,
    advancedContext // 병합된 고급 컨텍스트 추가
  };
}

// ══════════════════════════════════════════════════════
// 포지션 정제 분석 레이어 — AI에게 넘길 구조적 특징 추출
// ══════════════════════════════════════════════════════

/**
 * FEN 문자열로부터 8x8 보드 배열을 만든다.
 * board[rank][file] = { piece: 'P'|'p'|..., color: 'w'|'b' } | null
 * rank 0 = 8랭크(흑 홈), rank 7 = 1랭크(백 홈)
 */
function fenToMatrix(fen) {
  const ranks = fen.split(' ')[0].split('/');
  const board = [];
  for (const rank of ranks) {
    const row = [];
    for (const ch of rank) {
      if ('12345678'.includes(ch)) {
        for (let i = 0; i < parseInt(ch); i++) row.push(null);
      } else {
        row.push({ piece: ch.toUpperCase(), color: ch === ch.toUpperCase() ? 'w' : 'b', raw: ch });
      }
    }
    board.push(row);
  }
  return board; // board[0..7][0..7], board[0] = rank8
}

// 랭크/파일 인덱스 → 체스 칸 이름 (예: [0,0] → 'a8')
function idxToSq(r, f) {
  return 'abcdefgh'[f] + (8 - r);
}

// 체스 칸 이름 → [rank, file] (예: 'e4' → [4, 4])
function sqToIdx(sq) {
  return [8 - parseInt(sq[1]), 'abcdefgh'.indexOf(sq[0])];
}

/**
 * 특정 칸을 공격하는 기물 목록을 반환.
 * 슬라이딩 기물(R,B,Q)은 경로 차단 여부도 확인.
 * returns: [{ sq: 'e4', piece: 'R', color: 'w' }, ...]
 */
function getAttackers(board, targetR, targetF) {
  const attackers = [];

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const { piece, color } = cell;
      const dr = targetR - r;
      const df = targetF - f;

      // 폰 공격
      if (piece === 'P') {
        const dir = color === 'w' ? -1 : 1; // 백폰은 위로(rank 감소), 흑폰은 아래로
        if (dr === dir && Math.abs(df) === 1) attackers.push({ sq: idxToSq(r, f), piece, color });
        continue;
      }
      // 나이트
      if (piece === 'N') {
        if ((Math.abs(dr) === 2 && Math.abs(df) === 1) || (Math.abs(dr) === 1 && Math.abs(df) === 2))
          attackers.push({ sq: idxToSq(r, f), piece, color });
        continue;
      }
      // 킹
      if (piece === 'K') {
        if (Math.abs(dr) <= 1 && Math.abs(df) <= 1 && (dr !== 0 || df !== 0))
          attackers.push({ sq: idxToSq(r, f), piece, color });
        continue;
      }
      // 슬라이딩 기물 — 방향 및 경로 확인
      const isRook   = piece === 'R';
      const isBishop = piece === 'B';
      const isQueen  = piece === 'Q';
      const straight = dr === 0 || df === 0;
      const diagonal = Math.abs(dr) === Math.abs(df);

      if ((isRook && !straight) || (isBishop && !diagonal) || (isQueen && !straight && !diagonal)) continue;

      const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
      const stepF = df === 0 ? 0 : df / Math.abs(df);
      let blocked = false;
      let cr = r + stepR, cf = f + stepF;
      while (cr !== targetR || cf !== targetF) {
        if (board[cr][cf]) { blocked = true; break; }
        cr += stepR; cf += stepF;
      }
      if (!blocked) attackers.push({ sq: idxToSq(r, f), piece, color });
    }
  }
  return attackers;
}

/**
 * 포지션 구조 인사이트를 추출해 문자열 배열로 반환.
 * AI 프롬프트에 직접 삽입할 수 있는 한국어 문장들.
 */
function extractPositionInsights(fen) {
  const insights = [];
  try {
    const board = fenToMatrix(fen);
    const turn  = fen.split(' ')[1] || 'w';

    const PIECE_KR = { P: '폰', N: '나이트', B: '비숍', R: '룩', Q: '퀸', K: '킹' };
    const COLOR_KR = { w: '백', b: '흑' };
    const OPP = { w: 'b', b: 'w' };

    // ─── 1. 칸별 압박 집계 ──────────────────────────────
    // squareControl[r][f] = { w: attackers[], b: attackers[] }
    const squareControl = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => ({ w: [], b: [] }))
    );
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const atks = getAttackers(board, r, f);
        for (const a of atks) squareControl[r][f][a.color].push(a);
      }
    }

    // ─── 2. 집중 압박 칸 감지 (3+ 기물이 한 칸 공격) ──
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const ctrl = squareControl[r][f];
        const sq   = idxToSq(r, f);
        const cell = board[r][f];

        for (const color of ['w', 'b']) {
          const atks = ctrl[color];
          if (atks.length >= 3) {
            const pieces = atks.map(a => PIECE_KR[a.piece]).join(', ');
            insights.push(`[집중 압박] ${COLOR_KR[color]}이 ${sq} 칸을 ${atks.length}개 기물(${pieces})로 집중 공격 중`);
          } else if (atks.length === 2) {
            // 고가치 기물(Q,R)이 포함된 2중 압박은 언급
            const hasHeavy = atks.some(a => a.piece === 'Q' || a.piece === 'R');
            if (hasHeavy && cell && cell.color !== color) {
              const pieces = atks.map(a => PIECE_KR[a.piece]).join('+');
              const target = PIECE_KR[cell.piece];
              insights.push(`[이중 압박] ${COLOR_KR[color]} ${pieces}가 ${sq}의 ${COLOR_KR[cell.color]} ${target}을 동시에 위협`);
            }
          }
        }

        // 수비 과부하: 한 기물이 두 칸을 동시에 지키는지는 아래 오버로딩에서 처리
        // 공격 측 수 > 수비 측 수이며 상대 기물이 있는 칸
        if (cell) {
          const atkW = ctrl['w'].length, atkB = ctrl['b'].length;
          const [attColor, defColor] = cell.color === 'w' ? ['b', 'w'] : ['w', 'b'];
          const attackCount = cell.color === 'w' ? atkB : atkW;
          const defendCount = cell.color === 'w' ? atkW : atkB;
          if (attackCount > defendCount && attackCount >= 2) {
            const atkPieces = ctrl[attColor].map(a => PIECE_KR[a.piece]).join('+');
            insights.push(`[수적 우세] ${COLOR_KR[attColor]} ${atkPieces}가 ${sq}의 ${COLOR_KR[cell.color]} ${PIECE_KR[cell.piece]}를 공격, 수비 기물(${defendCount}개) 부족`);
          }
        }
      }
    }

    // ─── 3. 배터리 감지 (같은 열/대각선에 R+R, Q+R, Q+B) ──
    // 열(파일) 배터리: R+R 또는 Q+R
    for (let f = 0; f < 8; f++) {
      const heavies = { w: [], b: [] };
      for (let r = 0; r < 8; r++) {
        const cell = board[r][f];
        if (cell && (cell.piece === 'R' || cell.piece === 'Q')) {
          heavies[cell.color].push({ piece: cell.piece, sq: idxToSq(r, f) });
        }
      }
      for (const color of ['w', 'b']) {
        const h = heavies[color];
        if (h.length >= 2) {
          const types = h.map(x => PIECE_KR[x.piece]).join('+');
          const sqs   = h.map(x => x.sq).join(', ');
          insights.push(`[배터리] ${COLOR_KR[color]} ${types}가 ${f + 1}번 파일(${sqs})에 배터리 형성`);
        }
      }
    }

    // 랭크 배터리
    for (let r = 0; r < 8; r++) {
      const heavies = { w: [], b: [] };
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (cell && (cell.piece === 'R' || cell.piece === 'Q')) {
          heavies[cell.color].push({ piece: cell.piece, sq: idxToSq(r, f) });
        }
      }
      for (const color of ['w', 'b']) {
        const h = heavies[color];
        if (h.length >= 2) {
          const types = h.map(x => PIECE_KR[x.piece]).join('+');
          const sqs   = h.map(x => x.sq).join(', ');
          insights.push(`[배터리] ${COLOR_KR[color]} ${types}가 ${8 - r}랭크(${sqs})에 배터리 형성`);
        }
      }
    }

    // 대각선 배터리: Q+B
    const diagChecked = new Set();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell || (cell.piece !== 'Q' && cell.piece !== 'B')) continue;
        for (const [dr, df] of [[1,1],[1,-1]]) {
          const diagKey = `${r - dr * Math.min(r, f)}_${f - df * Math.min(r, f)}_${dr}_${df}`;
          if (diagChecked.has(diagKey)) continue;
          diagChecked.add(diagKey);
          // 대각선 전체 수집
          const diag = { w: [], b: [] };
          let cr = r, cf = f;
          while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
            const c = board[cr][cf];
            if (c && (c.piece === 'Q' || c.piece === 'B')) diag[c.color].push({ piece: c.piece, sq: idxToSq(cr, cf) });
            cr += dr; cf += df;
          }
          // 시작점도 포함되니 역방향도
          cr = r - dr; cf = f - df;
          while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
            const c = board[cr][cf];
            if (c && (c.piece === 'Q' || c.piece === 'B')) diag[c.color].push({ piece: c.piece, sq: idxToSq(cr, cf) });
            cr -= dr; cf -= df;
          }
          for (const color of ['w', 'b']) {
            const d = diag[color];
            if (d.length >= 2) {
              const types = d.map(x => PIECE_KR[x.piece]).join('+');
              const sqs   = d.map(x => x.sq).join(', ');
              insights.push(`[대각 배터리] ${COLOR_KR[color]} ${types}(${sqs})가 같은 대각선에 배치`);
            }
          }
        }
      }
    }

    // ─── 4. 열린 파일 독점 ──────────────────────────────
    for (let f = 0; f < 8; f++) {
      let hasWpawn = false, hasBpawn = false;
      const rooks = { w: [], b: [] };
      for (let r = 0; r < 8; r++) {
        const cell = board[r][f];
        if (!cell) continue;
        if (cell.piece === 'P') {
          if (cell.color === 'w') hasWpawn = true; else hasBpawn = true;
        }
        if (cell.piece === 'R' || cell.piece === 'Q') rooks[cell.color].push(PIECE_KR[cell.piece]);
      }
      const fileLetter = 'abcdefgh'[f];
      if (!hasWpawn && !hasBpawn) {
        // 완전 열린 파일
        if (rooks.w.length > 0 && rooks.b.length === 0)
          insights.push(`[열린 파일 독점] 백 ${rooks.w.join('+')}가 ${fileLetter}파일을 단독 지배 (상대 중기물 없음)`);
        else if (rooks.b.length > 0 && rooks.w.length === 0)
          insights.push(`[열린 파일 독점] 흑 ${rooks.b.join('+')}가 ${fileLetter}파일을 단독 지배 (상대 중기물 없음)`);
      } else if (!hasWpawn && rooks.b.length > 0) {
        // 반열린 파일 (백 폰 없음, 흑 룩 있음)
        insights.push(`[반열린 파일] 흑 ${rooks.b.join('+')}가 ${fileLetter}파일 반열린 파일 장악 (백 폰 부재)`);
      } else if (!hasBpawn && rooks.w.length > 0) {
        insights.push(`[반열린 파일] 백 ${rooks.w.join('+')}가 ${fileLetter}파일 반열린 파일 장악 (흑 폰 부재)`);
      }
    }

    // ─── 5. 아웃포스트 (상대 폰이 공격 못하는 중앙 나이트/비숍) ──
    const CENTER = [[2,2],[2,3],[2,4],[2,5],[3,2],[3,3],[3,4],[3,5],[4,2],[4,3],[4,4],[4,5],[5,2],[5,3],[5,4],[5,5]];
    for (const [r, f] of CENTER) {
      const cell = board[r][f];
      if (!cell || (cell.piece !== 'N' && cell.piece !== 'B')) continue;
      const { color } = cell;
      const opp = OPP[color];
      // 상대 폰이 이 칸을 공격할 수 있는지
      const oppPawnDir = opp === 'w' ? -1 : 1;
      const pawnAtk1 = board[r + oppPawnDir]?.[f - 1];
      const pawnAtk2 = board[r + oppPawnDir]?.[f + 1];
      const underPawnAttack =
        (pawnAtk1 && pawnAtk1.piece === 'P' && pawnAtk1.color === opp) ||
        (pawnAtk2 && pawnAtk2.piece === 'P' && pawnAtk2.color === opp);
      if (!underPawnAttack) {
        insights.push(`[아웃포스트] ${COLOR_KR[color]} ${PIECE_KR[cell.piece]}(${idxToSq(r, f)})가 상대 폰의 공격을 받지 않는 중앙 아웃포스트 장악`);
      }
    }

    // ─── 6. 킹 안전 ─────────────────────────────────────
    for (const color of ['w', 'b']) {
      let kingR = -1, kingF = -1;
      outer: for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (c && c.piece === 'K' && c.color === color) { kingR = r; kingF = f; break outer; }
        }
      }
      if (kingR < 0) continue;
      const opp = OPP[color];

      // 킹 주변 2×3 구역(킹사이드/퀸사이드 기준) 폰 방패 확인
      const shieldR = color === 'w' ? kingR - 1 : kingR + 1; // 폰이 있어야 할 랭크
      if (shieldR >= 0 && shieldR < 8) {
        let missingShields = 0;
        for (let sf = Math.max(0, kingF - 1); sf <= Math.min(7, kingF + 1); sf++) {
          const shield = board[shieldR][sf];
          if (!shield || shield.piece !== 'P' || shield.color !== color) missingShields++;
        }
        if (missingShields >= 2) {
          insights.push(`[킹 안전 위협] ${COLOR_KR[color]} 킹(${idxToSq(kingR, kingF)}) 앞 폰 방패 ${missingShields}개 부재 — 킹이 노출됨`);
        }
      }

      // 킹이 있는 파일 또는 인접 파일이 열려있고 상대 중기물이 있는지
      for (let df = -1; df <= 1; df++) {
        const cf = kingF + df;
        if (cf < 0 || cf > 7) continue;
        let friendlyPawn = false, enemyHeavy = false;
        for (let r = 0; r < 8; r++) {
          const c = board[r][cf];
          if (!c) continue;
          if (c.piece === 'P' && c.color === color) friendlyPawn = true;
          if ((c.piece === 'R' || c.piece === 'Q') && c.color === opp) enemyHeavy = true;
        }
        if (!friendlyPawn && enemyHeavy) {
          const fileLetter = 'abcdefgh'[cf];
          insights.push(`[킹 안전 위협] ${COLOR_KR[color]} 킹 인접 ${fileLetter}파일 열려있고 ${COLOR_KR[opp]} 중기물 존재 — 직접 공격 가능`);
        }
      }

      // 상대방 기물이 킹 주변 칸을 공격하는 수 집계
      let kingZoneAttacks = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let df = -2; df <= 2; df++) {
          const nr = kingR + dr, nf = kingF + df;
          if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
          const atks = squareControl[nr][nf][opp];
          if (atks.some(a => a.piece !== 'P')) kingZoneAttacks++;
        }
      }
      if (kingZoneAttacks >= 4) {
        insights.push(`[킹존 압박] ${COLOR_KR[opp]}이 ${COLOR_KR[color]} 킹 주변 ${kingZoneAttacks}개 칸을 공격 — 킹사이드 공격 위험`);
      }
    }

    // ─── 7. 폰 구조 ─────────────────────────────────────
    const pawns = { w: [], b: [] };
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const c = board[r][f];
        if (c && c.piece === 'P') pawns[c.color].push({ r, f, sq: idxToSq(r, f) });
      }
    }

    for (const color of ['w', 'b']) {
      const opp = OPP[color];
      const myPawns   = pawns[color];
      const oppPawns  = pawns[opp];

      // 고립 폰
      for (const p of myPawns) {
        const hasNeighbor = myPawns.some(q => q.f === p.f - 1 || q.f === p.f + 1);
        if (!hasNeighbor) {
          insights.push(`[고립 폰] ${COLOR_KR[color]} ${p.sq} 폰 고립 (인접 파일 아군 폰 없음) — 장기적 약점`);
        }
      }

      // 이중 폰
      const fileCount = {};
      for (const p of myPawns) fileCount[p.f] = (fileCount[p.f] || 0) + 1;
      for (const [f, cnt] of Object.entries(fileCount)) {
        if (cnt >= 2) {
          insights.push(`[이중 폰] ${COLOR_KR[color]} ${'abcdefgh'[f]}파일에 폰 ${cnt}개 중첩 — 구조적 약점`);
        }
      }

      // 통과 폰 (passed pawn)
      for (const p of myPawns) {
        const advDir = color === 'w' ? -1 : 1;
        const isBlocked = oppPawns.some(q =>
          (q.f === p.f || q.f === p.f - 1 || q.f === p.f + 1) &&
          (color === 'w' ? q.r < p.r : q.r > p.r)
        );
        if (!isBlocked) {
          const rankLabel = 8 - p.r;
          insights.push(`[통과 폰] ${COLOR_KR[color]} ${p.sq} 통과 폰 — 상대 폰이 막지 못함, 승진 가능성`);
        }
      }
    }

    // ─── 8. 기물 과부하 (한 기물이 2개 칸 동시 수비) ──
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const defender = board[r][f];
        if (!defender || defender.piece === 'K' || defender.piece === 'P') continue;
        const { color } = defender;
        const defSq = idxToSq(r, f);

        // 이 기물이 방어하는 아군 기물 칸 목록
        const guarding = [];
        for (let tr = 0; tr < 8; tr++) {
          for (let tf = 0; tf < 8; tf++) {
            if (tr === r && tf === f) continue;
            const target = board[tr][tf];
            if (!target || target.color !== color || target.piece === 'P') continue;
            // defender가 target 칸을 공격(=방어)하는지
            const atks = squareControl[tr][tf][color];
            if (atks.some(a => a.sq === defSq)) {
              // target이 상대에게 공격받고 있는지
              const underAttack = squareControl[tr][tf][OPP[color]].length > 0;
              if (underAttack) guarding.push({ sq: idxToSq(tr, tf), piece: target.piece });
            }
          }
        }
        if (guarding.length >= 2) {
          const guardList = guarding.map(g => `${PIECE_KR[g.piece]}(${g.sq})`).join(', ');
          insights.push(`[기물 과부하] ${COLOR_KR[color]} ${PIECE_KR[defender.piece]}(${defSq})가 ${guardList}를 동시에 수비 중 — 과부하 상태`);
        }
      }
    }

    // ─── 9. 주도권 (템포) — 공격 위협이 더 많은 쪽 ──
    let wThreats = 0, bThreats = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell) continue;
        if (cell.color === 'b') wThreats += squareControl[r][f]['w'].length;
        if (cell.color === 'w') bThreats += squareControl[r][f]['b'].length;
      }
    }
    if (wThreats > bThreats + 3)
      insights.push(`[주도권] 백이 흑 기물에 대해 공격 우세 (공격 ${wThreats} vs ${bThreats}) — 이니셔티브 보유`);
    else if (bThreats > wThreats + 3)
      insights.push(`[주도권] 흑이 백 기물에 대해 공격 우세 (공격 ${bThreats} vs ${wThreats}) — 이니셔티브 보유`);

    // ─── 10. 킹사이드/퀸사이드 전장 판단 ──────────────
    // 각 색의 기물(폰 제외)이 킹사이드(e~h파일)와 퀸사이드(a~d파일)에 몇 개 있는지 집계
    for (const color of ['w', 'b']) {
      let kingSidePieces = 0, queenSidePieces = 0;
      let kingSidePawns = 0, queenSidePawns = 0;
      let kingFile = -1;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (!c || c.color !== color) continue;
          if (c.piece === 'K') { kingFile = f; continue; }
          if (c.piece === 'P') {
            if (f >= 4) kingSidePawns++; else queenSidePawns++;
            continue;
          }
          if (f >= 4) kingSidePieces++; else queenSidePieces++;
        }
      }
      const opp = OPP[color];
      // 상대 킹 위치 파악
      let oppKingFile = -1;
      outer2: for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (c && c.piece === 'K' && c.color === opp) { oppKingFile = f; break outer2; }
        }
      }

      const ksDiff = kingSidePieces - queenSidePieces;
      const pawnDiff = kingSidePawns - queenSidePawns;

      if (ksDiff >= 2 || (ksDiff >= 1 && pawnDiff >= 2)) {
        insights.push(`[전장 판단] ${COLOR_KR[color]} 기물이 킹사이드(e~h파일)에 집중 — 킹사이드 공격 전개 중`);
      } else if (ksDiff <= -2 || (ksDiff <= -1 && pawnDiff <= -2)) {
        insights.push(`[전장 판단] ${COLOR_KR[color]} 기물이 퀸사이드(a~d파일)에 집중 — 퀸사이드 공격 전개 중`);
      }

      // 상대 킹이 한쪽에 있고 아군 기물이 그쪽에 집중돼 있으면 직접 언급
      if (oppKingFile >= 0) {
        const oppKingSide = oppKingFile >= 4 ? 'king' : 'queen';
        if (oppKingSide === 'king' && kingSidePieces >= 3) {
          insights.push(`[공격 방향] ${COLOR_KR[opp]} 킹이 킹사이드에 위치, ${COLOR_KR[color]} 기물 3개 이상이 킹사이드 집중 — 킹사이드 직접 공격 가능`);
        } else if (oppKingSide === 'queen' && queenSidePieces >= 3) {
          insights.push(`[공격 방향] ${COLOR_KR[opp]} 킹이 퀸사이드에 위치, ${COLOR_KR[color]} 기물 3개 이상이 퀸사이드 집중 — 퀸사이드 직접 공격 가능`);
        }
      }
    }

    // ─── 11. 전술 패턴 감지 ───────────────────────────

    // 포크 감지: 한 기물이 상대 기물 2개 이상을 동시에 공격
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const attacker = board[r][f];
        if (!attacker || attacker.piece === 'K') continue;
        const { color } = attacker;
        const opp = OPP[color];
        const attackerSq = idxToSq(r, f);
        // 이 기물이 공격하는 상대 기물 목록
        const forkedTargets = [];
        for (let tr = 0; tr < 8; tr++) {
          for (let tf = 0; tf < 8; tf++) {
            const target = board[tr][tf];
            if (!target || target.color !== opp) continue;
            if (target.piece === 'P') continue; // 폰은 포크 대상에서 제외(가치 낮음)
            const atks = squareControl[tr][tf][color];
            if (atks.some(a => a.sq === attackerSq)) {
              forkedTargets.push({ sq: idxToSq(tr, tf), piece: target.piece });
            }
          }
        }
        if (forkedTargets.length >= 2) {
          const targets = forkedTargets.map(t => `${PIECE_KR[t.piece]}(${t.sq})`).join(', ');
          insights.push(`[포크] ${COLOR_KR[color]} ${PIECE_KR[attacker.piece]}(${attackerSq})가 ${targets}를 동시에 공격 — 포크 상황`);
        }
      }
    }

    // 추크추방(Zwischenzug) 가능성: 상대가 반드시 응수해야 할 중간 위협이 있는지
    // 간이 감지: 상대 킹이 체크 위협을 받고 있으면서 동시에 다른 고가치 기물도 공격받는 경우
    for (const color of ['w', 'b']) {
      const opp = OPP[color];
      let oppKingR = -1, oppKingF = -1;
      outer3: for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const c = board[r][f];
          if (c && c.piece === 'K' && c.color === opp) { oppKingR = r; oppKingF = f; break outer3; }
        }
      }
      if (oppKingR < 0) continue;
      const kingAtks = squareControl[oppKingR][oppKingF][color];
      if (kingAtks.length > 0) {
        // 킹 위협 동시에 다른 고가치 기물도 공격받고 있으면 추크추방 환경
        for (let r = 0; r < 8; r++) {
          for (let f = 0; f < 8; f++) {
            const target = board[r][f];
            if (!target || target.color !== opp || (target.piece !== 'Q' && target.piece !== 'R')) continue;
            const targetAtks = squareControl[r][f][color];
            if (targetAtks.length > 0) {
              insights.push(`[추크추방] ${COLOR_KR[color]}이 ${COLOR_KR[opp]} 킹 체크 위협과 ${PIECE_KR[target.piece]}(${idxToSq(r,f)}) 공격을 동시에 보유 — 중간 수(추크추방) 가능성`);
            }
          }
        }
      }
    }

    // 디스커버드 어택(발견 공격) 감지: 슬라이딩 기물 앞에 아군 기물이 있고, 그 아군이 움직이면 뒤 슬라이더가 고가치 기물을 직격
    for (const color of ['w', 'b']) {
      const opp = OPP[color];
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const slider = board[r][f];
          if (!slider || slider.color !== color) continue;
          if (slider.piece !== 'R' && slider.piece !== 'B' && slider.piece !== 'Q') continue;

          const dirs = slider.piece === 'R' ? [[0,1],[0,-1],[1,0],[-1,0]]
                     : slider.piece === 'B' ? [[1,1],[1,-1],[-1,1],[-1,-1]]
                     : [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

          for (const [dr, df] of dirs) {
            let cr = r + dr, cf = f + df;
            let blocker = null;
            while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
              const c = board[cr][cf];
              if (c) {
                if (!blocker && c.color === color && c.piece !== 'K') {
                  blocker = { r: cr, f: cf, piece: c.piece, sq: idxToSq(cr, cf) };
                } else if (blocker && c.color === opp && (c.piece === 'Q' || c.piece === 'R' || c.piece === 'K')) {
                  insights.push(`[디스커버드 어택] ${COLOR_KR[color]} ${PIECE_KR[blocker.piece]}(${blocker.sq})가 움직이면 뒤 ${PIECE_KR[slider.piece]}(${idxToSq(r,f)})가 ${COLOR_KR[opp]} ${PIECE_KR[c.piece]}(${idxToSq(cr,cf)})를 발견 공격`);
                  break;
                } else {
                  break;
                }
              }
              cr += dr; cf += df;
            }
          }
        }
      }
    }

    // ─── 12. 폰 구조 상세 분석 ───────────────────────────
    // 뒤처진 폰(Backward Pawn)
    for (const color of ['w', 'b']) {
      const opp = OPP[color];
      const myPawns = pawns[color];
      const advDir = color === 'w' ? -1 : 1; // rank 감소 = 전진(백), rank 증가 = 전진(흑)

      for (const p of myPawns) {
        // 인접 파일에 아군 폰이 있는지
        const hasSideNeighbor = myPawns.some(q => (q.f === p.f - 1 || q.f === p.f + 1));
        if (!hasSideNeighbor) continue; // 고립 폰은 별도 처리

        // 뒤처진 폰: 인접 폰보다 뒤에 있고, 전진하면 상대 폰 공격을 받음
        const aheadR = p.r + advDir;
        if (aheadR < 0 || aheadR > 7) continue;
        const oppPawnLeft  = board[aheadR]?.[p.f - 1];
        const oppPawnRight = board[aheadR]?.[p.f + 1];
        const attackedIfAdvance =
          (oppPawnLeft  && oppPawnLeft.piece  === 'P' && oppPawnLeft.color  === opp) ||
          (oppPawnRight && oppPawnRight.piece === 'P' && oppPawnRight.color === opp);

        // 인접 아군 폰이 이미 더 앞에 있는지
        const neighborAhead = myPawns.some(q =>
          (q.f === p.f - 1 || q.f === p.f + 1) &&
          (color === 'w' ? q.r < p.r : q.r > p.r)
        );

        if (attackedIfAdvance && neighborAhead) {
          insights.push(`[뒤처진 폰] ${COLOR_KR[color]} ${p.sq} 폰은 전진하면 상대 폰 공격을 받고 인접 아군 폰 지원이 없음 — 장기적 약점`);
        }
      }

      // 폰 사슬(Pawn Chain) — 대각선으로 연결된 폰 3개 이상
      const sortedPawns = [...myPawns].sort((a, b) => color === 'w' ? b.r - a.r : a.r - b.r);
      let chainLen = 1;
      for (let i = 1; i < sortedPawns.length; i++) {
        const prev = sortedPawns[i - 1];
        const curr = sortedPawns[i];
        if (Math.abs(curr.f - prev.f) === 1 && Math.abs(curr.r - prev.r) === 1) {
          chainLen++;
        } else {
          if (chainLen >= 3) {
            insights.push(`[폰 사슬] ${COLOR_KR[color]} 폰이 대각선 사슬 ${chainLen}개 형성 — 공간 통제력 높음, 기물 교환 자제 권장`);
          }
          chainLen = 1;
        }
      }
      if (chainLen >= 3) {
        insights.push(`[폰 사슬] ${COLOR_KR[color]} 폰이 대각선 사슬 ${chainLen}개 형성 — 공간 통제력 높음, 기물 교환 자제 권장`);
      }

      // 폰 구조 기반 영역 우세 (킹사이드/퀸사이드 폰 수 우세)
      const myKS = myPawns.filter(p => p.f >= 4).length;
      const myQS = myPawns.filter(p => p.f < 4).length;
      const oppKS = pawns[opp].filter(p => p.f >= 4).length;
      const oppQS = pawns[opp].filter(p => p.f < 4).length;
      if (myKS > oppKS + 1) {
        insights.push(`[폰 영역 우세] ${COLOR_KR[color]}이 킹사이드 폰 수적 우세(${myKS} vs ${oppKS}) — 마이너리티 공격 또는 킹사이드 공세 가능`);
      }
      if (myQS > oppQS + 1) {
        insights.push(`[폰 영역 우세] ${COLOR_KR[color]}이 퀸사이드 폰 수적 우세(${myQS} vs ${oppQS}) — 마이너리티 공격 또는 퀸사이드 공세 가능`);
      }

      // 마이너리티 공격: 상대가 폰 수 우세인 쪽에 아군 폰이 더 적어 폰 교환으로 약점 생성 가능
      if (myKS < oppKS && myKS >= 1 && oppKS >= 2) {
        insights.push(`[마이너리티 공격] ${COLOR_KR[color]}이 킹사이드에 폰 소수(${myKS})로 ${COLOR_KR[opp]} 폰 다수(${oppKS}) 공격 — 마이너리티 공격으로 약점 생성 가능`);
      }
      if (myQS < oppQS && myQS >= 1 && oppQS >= 2) {
        insights.push(`[마이너리티 공격] ${COLOR_KR[color]}이 퀸사이드에 폰 소수(${myQS})로 ${COLOR_KR[opp]} 폰 다수(${oppQS}) 공격 — 마이너리티 공격으로 약점 생성 가능`);
      }

      // a3/a4, h3/h6 예방적 폰 전진 감지 (비숍 핀 예방 + 공간 확장)
      for (const p of myPawns) {
        const fileLetter = 'abcdefgh'[p.f];
        const rankNum = 8 - p.r;
        // 백: a3, a4, h3 / 흑: a6, a5, h6
        const isPreventivePush =
          (color === 'w' && ((p.f === 0 && (rankNum === 3 || rankNum === 4)) || (p.f === 7 && rankNum === 3))) ||
          (color === 'b' && ((p.f === 0 && (rankNum === 6 || rankNum === 5)) || (p.f === 7 && rankNum === 6)));
        if (isPreventivePush) {
          insights.push(`[예방 전진] ${COLOR_KR[color]} ${p.sq} 폰 — 오프닝 비숍 핀 예방 + 미들/엔드게임 측면 공간 확장(${p.f === 0 ? '퀸사이드' : '킹사이드'} 공격 발판) 가능`);
        }
      }
    }

    // ─── 13. 기물 동적 가치 평가 (위치 기반) ────────────
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell) continue;
        const { piece, color } = cell;
        const sq = idxToSq(r, f);
        const rankNum = 8 - r; // 백 기준 랭크 번호 (1=백홈, 8=흑홈)
        const opp = OPP[color];

        // 폰 7랭크 도달 — 승진 직전, 가치 최고조
        if (piece === 'P') {
          const promotionRank = color === 'w' ? 2 : 7; // rank index: 백7랭크=r1, 흑7랭크=r6
          const actualRank = color === 'w' ? rankNum : 9 - rankNum;
          if (actualRank === 7) {
            insights.push(`[기물 가치↑] ${COLOR_KR[color]} 폰(${sq})이 7랭크 도달 — 승진 위협으로 기물 가치 최고조, 상대는 즉각 저지 필요`);
          }
        }

        // 나이트: 7랭크 또는 중앙 아웃포스트
        if (piece === 'N') {
          const actualRank = color === 'w' ? rankNum : 9 - rankNum;
          if (actualRank >= 5) {
            const oppPawnDir = opp === 'w' ? -1 : 1;
            const pawnThreat1 = board[r + oppPawnDir]?.[f - 1];
            const pawnThreat2 = board[r + oppPawnDir]?.[f + 1];
            const safe = !(
              (pawnThreat1 && pawnThreat1.piece === 'P' && pawnThreat1.color === opp) ||
              (pawnThreat2 && pawnThreat2.piece === 'P' && pawnThreat2.color === opp)
            );
            if (safe) {
              insights.push(`[기물 가치↑] ${COLOR_KR[color]} 나이트(${sq})가 ${actualRank}랭크 안전 전진 — 상대 진영 깊숙이 침투, 공격 기여도 높음`);
            }
          }
          // 나이트 중앙 근접도
          const centerDist = Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5));
          if (centerDist < 1.5) {
            insights.push(`[기물 가치↑] ${COLOR_KR[color]} 나이트(${sq})가 중앙 근접 — 영향력 최대, 8개 이동 가능`);
          }
        }

        // 비숍: 오픈 대각선 또는 자기 폰과 다른 색 칸
        if (piece === 'B') {
          const bishopColorLight = (r + f) % 2 === 0; // 비숍이 밝은 칸에 있는지
          // 같은 색 폰이 비숍 길을 막고 있는지 계산
          let blockedCount = 0, openCount = 0;
          let myPawnCount = 0;
          const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
          for (const [dr, df] of dirs) {
            let cr = r + dr, cf = f + df;
            while (cr >= 0 && cr < 8 && cf >= 0 && cf < 8) {
              const c = board[cr][cf];
              if (c) {
                if (c.piece === 'P' && c.color === color) blockedCount++;
                else openCount++;
                break;
              }
              openCount++;
              cr += dr; cf += df;
            }
          }
          // 아군 폰이 비숍과 같은 색 칸에 있으면 bad bishop
          let samColorPawns = 0;
          for (const p of pawns[color]) {
            if ((p.r + p.f) % 2 === bishopColorLight % 2) samColorPawns++;
          }
          if (blockedCount === 0 && openCount >= 4) {
            insights.push(`[기물 가치↑] ${COLOR_KR[color]} 비숍(${sq})의 대각선이 완전히 열려있음 — 장거리 공격력 극대화`);
          } else if (samColorPawns >= 3) {
            insights.push(`[기물 가치↓] ${COLOR_KR[color]} 비숍(${sq})과 같은 색 칸에 아군 폰 ${samColorPawns}개 — 배드 비숍, 영향력 제한`);
          }
        }

        // 룩: 열린 파일 또는 7랭크
        if (piece === 'R') {
          const actualRank = color === 'w' ? rankNum : 9 - rankNum;
          // 7랭크 룩
          if (actualRank === 7) {
            insights.push(`[기물 가치↑] ${COLOR_KR[color]} 룩(${sq})이 7랭크 침투 — 상대 폰 위협 및 킹 압박, 강력한 위치`);
          }
          // 열린 파일 여부는 섹션 4에서 이미 처리, 여기서는 반열린 파일 가치만 추가
          let hasFriendlyPawn = false;
          for (let tr = 0; tr < 8; tr++) {
            const c = board[tr][f];
            if (c && c.piece === 'P' && c.color === color) { hasFriendlyPawn = true; break; }
          }
          if (!hasFriendlyPawn) {
            const fileLetter = 'abcdefgh'[f];
            insights.push(`[기물 가치↑] ${COLOR_KR[color]} 룩(${sq})이 반열린 ${fileLetter}파일 장악 — 상대 폰 직접 압박 가능`);
          }
        }
      }
    }

  } catch(e) {
    console.warn('[PositionInsights] 분석 오류:', e);
  }

  return insights;
}

// ══════════════════════════════════════════════════════
// 핵심: 포지션 해설 자동 실행
// ══════════════════════════════════════════════════════

// 스톡피시 라인이 충분한지 검사 (최소 1수 이상 있으면 시작)
function hasEnoughLines(ctx) {
  const pv1 = window.pvData && window.pvData[1];
  const len1 = pv1 && pv1.moves ? pv1.moves.length : 0;
  return len1 >= 1;
}

// 스톡피시에 더 깊은 분석 요청 (엔진이 이미 실행 중이라고 가정)
// pvData가 업데이트될 때까지 최대 5초 대기
async function waitForDeepLines(ctx, maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (hasEnoughLines(ctx)) return true;
    await new Promise(r => setTimeout(r, 300));
    // 컨텍스트 재빌드해서 최신 pvData 반영
    const newCtx = buildChessContext();
    if (newCtx) {
      ctx.bestLine = newCtx.bestLine;
      ctx.line2    = newCtx.line2;
      ctx.line3    = newCtx.line3;
    }
  }
  return false;
}

// 메인 해설 실행 함수 (패널을 열거나 수를 둘 때 호출)
async function runPositionCommentary() {
  if (coachLoading) return;
  if (!coachApiKey) return;

  // 인라인 패널 열기
  const inlinePanel = document.getElementById('coach-inline');
  if (inlinePanel) inlinePanel.classList.add('visible');
  const coachBtn = document.getElementById('coach-open-btn');
  if (coachBtn) coachBtn.classList.add('active');
  const boardAreaRpc = document.getElementById('board-area');
  if (boardAreaRpc) boardAreaRpc.classList.add('coach-open');
  coachOpen = true;

  const responseDiv = document.getElementById('coach-response');
  if (!responseDiv) return;

  const ctx = buildChessContext();
  if (!ctx) return;

  coachLoading = true;
  responseDiv.style.display = 'flex';
  responseDiv.className = 'loading';
  responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 스톡피시 라인 수집 중...`;

  try {
    // 스톡피시 라인이 부족하면 대기
    if (!hasEnoughLines(ctx)) {
      responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 스톡피시 깊은 분석 대기 중...`;
      await waitForDeepLines(ctx, 5000);
    }

    // 최신 컨텍스트 다시 빌드 (라인이 갱신됐을 수 있음)
    let freshCtx = buildChessContext();

    // 위협 패널이 아직 로딩 중이면 완료까지 대기 (최대 4초)
    if (threatLoading) {
      responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 위협 분석 완료 대기 중...`;
      const tStart = Date.now();
      while (threatLoading && Date.now() - tStart < 4000) {
        await new Promise(r => setTimeout(r, 300));
      }
      // 위협 데이터가 반영된 최신 컨텍스트로 재빌드
      freshCtx = buildChessContext();
    }

    // 위협 패널이 비어있으면 백그라운드에서 먼저 위협 분석 실행 후 결과 기다림
    if (!freshCtx.threatData && !threatLoading) {
      responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 위협 분석 중...`;
      await runThreatAnalysis();
      const tStart2 = Date.now();
      while (threatLoading && Date.now() - tStart2 < 4000) {
        await new Promise(r => setTimeout(r, 300));
      }
      freshCtx = buildChessContext();
    }

    // ── 최선수 이유: DOM/bestExplainLoading 의존 없이 직접 API 호출 ──
    // pvData에서 현재 최신 라인을 직접 읽어 독립적으로 분석
    let directBestExplainData = null;
    const livePv1ForExplain = pvData && pvData[1];
    if (livePv1ForExplain && livePv1ForExplain.moves && livePv1ForExplain.moves.length > 0) {
      responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 최선수 이유 분석 중...`;
      try {
        freshCtx = buildChessContext();
        const explainMoves = livePv1ForExplain.moves.slice(0, 6);
        const rawExplain = await callBestExplainAPI(freshCtx, explainMoves, 0);
        const cleanedExplain = cleanKorean(rawExplain);

        // 결과 파싱: 타이틀과 이유 목록 추출
        const explainLines = cleanedExplain.split('\n').map(l => l.trim()).filter(Boolean);
        const reasons = [];
        for (const line of explainLines) {
          if (line.startsWith('•') || line.startsWith('-') || line.startsWith('·') || line.match(/^\d+\./)) {
            const txt = line.replace(/^[•\-·]\s*/, '').replace(/^\d+\.\s*/, '').trim();
            if (txt) reasons.push(txt);
          }
        }
        if (reasons.length === 0) {
          explainLines.slice(1).forEach(l => { if (l) reasons.push(l); });
        }
        directBestExplainData = {
          move: explainMoves[0] || null,
          reasons,
        };
      } catch(e) {
        console.warn('[Coach] bestExplain 직접 호출 실패:', e);
      }
    }

    responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> AI 해설 생성 중...`;

    freshCtx = buildChessContext();
    // directBestExplainData를 freshCtx에 주입 (DOM 결과보다 우선)
    if (directBestExplainData) {
      freshCtx.bestExplainData = directBestExplainData;
    }

    const answer = await callCommentaryAPI(freshCtx);
    const cleaned = sanitizeAnswer(answer);

    responseDiv.className = '';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = formatCommentary(cleaned);

    renderCoachSidebar(cleaned);
  } catch (err) {
    responseDiv.className = '';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = `<span style="color:var(--accent-red)">⚠️ 오류: ${err.message}</span>`;
    console.error('[Coach] 해설 오류:', err);
  } finally {
    coachLoading = false;
  }
}

// 수동 질문 (사용자가 직접 입력한 질문) — 기존 UI 호환 유지
async function askCoach() {
  if (coachLoading) return;
  if (!coachApiKey) {
    showToast('⚠️ API 키를 먼저 입력하고 저장하세요');
    document.getElementById('coach-api-input').focus();
    return;
  }

  const userQuestion = document.getElementById('coach-input').value.trim();
  if (!userQuestion) {
    showToast('질문을 입력하세요');
    return;
  }

  const context = await buildChessContext();
  if (!context) {
    showToast('게임 데이터를 불러올 수 없습니다');
    return;
  }

  coachLoading = true;
  document.getElementById('coach-ask-btn').disabled = true;

  // 인라인 패널 열기
  const inlinePanel = document.getElementById('coach-inline');
  if (inlinePanel) inlinePanel.classList.add('visible');
  const coachBtn2 = document.getElementById('coach-open-btn');
  if (coachBtn2) coachBtn2.classList.add('active');
  const boardAreaAsk = document.getElementById('board-area');
  if (boardAreaAsk) boardAreaAsk.classList.add('coach-open');
  coachOpen = true;

  const responseDiv = document.getElementById('coach-response');
  responseDiv.style.display = 'flex';
  responseDiv.className = 'loading';
  responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> AI 코치가 분석 중입니다...`;

  try {
    // 라인이 부족하면 대기
    if (!hasEnoughLines(context)) {
      await waitForDeepLines(context, 5000);
    }
    const freshCtx = buildChessContext();
    const prompt = buildCoachPrompt(freshCtx, userQuestion);
    const answer = await callGroqAPI(prompt);
    const cleaned = sanitizeAnswer(answer, freshCtx);
    responseDiv.className = '';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = formatCommentary(cleaned);
    renderCoachSidebar(cleaned);
  } catch (err) {
    responseDiv.className = '';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = `<span style="color:var(--accent-red)">⚠️ 오류: ${err.message}</span>`;
    console.error('[Coach] API 오류:', err);
  } finally {
    coachLoading = false;
    document.getElementById('coach-ask-btn').disabled = false;
  }
}

// ══════════════════════════════════════════════════════
// 프롬프트 빌더 — 체스인사이드 스타일 해설 요청
// ══════════════════════════════════════════════════════

function buildCommentaryPrompt(ctx) {
  const lines = [];

  // pvData에서 직접 최신 라인 읽기 (ctx.pvData 우선, 없으면 window.pvData)
  const pvDataToUse = ctx.pvData || window.pvData;
  console.log('[Debug Prompt] Using pvData:', pvDataToUse);
  
  const livePv1 = pvDataToUse && pvDataToUse[1];
  const livePv2 = pvDataToUse && pvDataToUse[2];
  const livePv3 = pvDataToUse && pvDataToUse[3];

  const liveBestLine = livePv1 && livePv1.moves ? livePv1.moves.slice(0, 8).join(' ') : ctx.bestLine;
  console.log('[Debug Prompt] liveBestLine:', liveBestLine);
  
  if (!liveBestLine) {
    console.warn('[Debug Prompt] WARNING: No engine lines found for prompt!');
  }
  
  const liveLine2    = livePv2 && livePv2.moves ? livePv2.moves.slice(0, 6).join(' ') : ctx.line2;
  const liveLine3    = livePv3 && livePv3.moves ? livePv3.moves.slice(0, 6).join(' ') : ctx.line3;
  const liveBestMove = livePv1 && livePv1.moves && livePv1.moves[0] ? livePv1.moves[0] : ctx.bestMove;
  console.log('[Debug Prompt] liveBestMove:', liveBestMove);

  lines.push(`[포지션 데이터]`);
  lines.push(`게임 단계: ${ctx.phase} | 진행 수: ${ctx.moveCount}수 | 차례: ${ctx.turn === 'w' ? '백(White)' : '흑(Black)'}`);
  lines.push(`현재 형세: ${ctx.advantageDesc}`);

  if (ctx.lastMoveSan) {
    const ann = ctx.lastMoveAnnotation ? ` (${ctx.lastMoveAnnotation})` : '';
    lines.push(`방금 둔 수: ${ctx.lastMoveSan}${ann}`);
  }

  // 고급 컨텍스트 추가
  if (ctx.advancedContext) {
    lines.push(``);
    lines.push(`[고급 포지션 통계]`);
    const { center_control, king_safety } = ctx.advancedContext;
    lines.push(`중앙 통제: 백 ${center_control.white}점, 흑 ${center_control.black}점`);
    lines.push(`킹 안전 위협: 백 ${king_safety.white_in_check ? '체크됨' : '안전'}, 흑 ${king_safety.black_in_check ? '체크됨' : '안전'}`);
  }

  // 항상 최신 pvData 기반 라인 사용
  // 수순 해석 안내: 차례에 따라 홀/짝 번째 수 귀속을 명시
  const firstTurnLabel  = ctx.turn === 'w' ? '백' : '흑';
  const secondTurnLabel = ctx.turn === 'w' ? '흑' : '백';
  lines.push(`[수순 해석 주의] 현재 차례는 ${firstTurnLabel}이므로, 수순에서 1번째·3번째·5번째 수는 ${firstTurnLabel}이 두고, 2번째·4번째·6번째 수는 ${secondTurnLabel}이 둡니다. 해설 시 반드시 각 수마다 "백이 X를 두면" / "흑이 Y로 응수하면" 형태로 주어를 명시할 것.`);
  if (liveBestLine) lines.push(`엔진 1순위 수순: ${liveBestLine}`);
  if (liveLine2)    lines.push(`엔진 2순위 수순: ${liveLine2}`);
  if (liveLine3)    lines.push(`엔진 3순위 수순: ${liveLine3}`);

  if (ctx.candidateMoves && ctx.candidateMoves.length > 0) {
    lines.push(`사용자 후보수 (화살표): ${ctx.candidateMoves.join(', ')} — 엔진 추천과 비교해서 언급해주세요.`);
  }
  if (ctx.sequenceMoves && ctx.sequenceMoves.length > 0) {
    lines.push(`사용자 수순 (Alt+화살표): ${ctx.sequenceMoves.join(' → ')} — 장단점 간략히 언급해주세요.`);
  }

  // 포지션 구조 인사이트 (코드로 계산한 확실한 사실)
  if (ctx.positionInsights && ctx.positionInsights.length > 0) {
    lines.push(``);
    lines.push(`[포지션 구조 분석 — 코드로 정밀 계산된 사실, 해설에 반드시 활용할 것]`);
    ctx.positionInsights.forEach(ins => lines.push(`  • ${ins}`));
    lines.push(`※ 위 항목 중 핵심적인 것을 "~고요", "~거든요" 등 체스인사이드 말투로 자연스럽게 녹여서 쓸 것. 목록을 그대로 나열하지 말 것.`);
  }

  if (ctx.threatData) {
    lines.push(``);
    lines.push(`[위협 분석 데이터 — 해설에 자연스럽게 녹여서 쓸 것]`);
    if (ctx.threatData.idea) lines.push(`핵심 계획: ${ctx.threatData.idea}`);
    if (ctx.threatData.prob) lines.push(`문제점: ${ctx.threatData.prob}`);
    if (ctx.threatData.sol)  lines.push(`최선책: ${ctx.threatData.sol}`);
  }

  if (ctx.bestExplainData) {
    lines.push(``);
    lines.push(`[최선수 이유 — 아래 이유들을 "A를 두면 B가 되기 때문에 C가 됩니다" 형태의 인과 문장으로 자연스럽게 서술할 것]`);
    lines.push(`최선수: ${ctx.bestExplainData.move || liveBestMove}`);
    if (ctx.bestExplainData.reasons && ctx.bestExplainData.reasons.length > 0) {
      ctx.bestExplainData.reasons.forEach((r, i) => lines.push(`  ${i+1}. ${r}`));
    }
  }

  if (ctx.pgnMoves) lines.push(`전체 기보: ${ctx.pgnMoves}`);
  lines.push(`FEN: ${ctx.fen}`);

  lines.push(``);
  lines.push(`[작성 지침]`);
  lines.push(`- **포지션 상황** 으로 시작하고, **최선수 분석** 은 반드시 포함.`);
  lines.push(`- 나머지 섹션(**약점 분석**, **강점 분석**, **위협 & 아이디어**, **이후 수순**)은 포지션에 실제로 해당하는 것만 선택.`);
  lines.push(`- **최선수 분석**: 엔진 1순위 수순의 수를 직접 써서 "X를 두면 → Y가 되고 → 결과적으로 Z" 형태로 인과관계를 설명할 것. 수를 나열만 하지 말 것.`);
  lines.push(`- 섹션 헤더는 **헤더명** 형태로 단독 줄에 쓸 것. 본문 안에 다른 섹션 이름 쓰지 말 것.`);
  lines.push(`- 위 system prompt의 말투 예시를 그대로 따를 것.`);

  return lines.join('\n');
}

// 수동 질문용 프롬프트 빌더
function buildCoachPrompt(ctx, question) {
  const lines = [];

  lines.push(`아래 체스 포지션 데이터를 바탕으로 질문에 한국어로 답변해 주세요.`);
  lines.push(``);
  lines.push(`[포지션 데이터]`);
  lines.push(`게임 단계: ${ctx.phase} | 진행 수: ${ctx.moveCount}수 | 차례: ${ctx.turn === 'w' ? '백(White)' : '흑(Black)'}`);
  lines.push(`현재 형세: ${ctx.advantageDesc}`);

  if (ctx.lastMoveSan) {
    const ann = ctx.lastMoveAnnotation ? ` (${ctx.lastMoveAnnotation})` : '';
    lines.push(`방금 둔 수: ${ctx.lastMoveSan}${ann}`);
  }

  if (ctx.bestLine) lines.push(`[엔진 1순위 라인] ${ctx.bestLine}`);
  if (ctx.line2)    lines.push(`[엔진 2순위 라인] ${ctx.line2}`);
  if (ctx.line3)    lines.push(`[엔진 3순위 라인] ${ctx.line3}`);

  // 사용자 화살표 (후보수 / 수순) 포함
  if (ctx.candidateMoves && ctx.candidateMoves.length > 0) {
    lines.push(``);
    lines.push(`[사용자가 고려한 후보수 (화살표로 표시한 수): ${ctx.candidateMoves.join(', ')}]`);
    lines.push(`※ 이 후보수들이 왜 좋거나 나쁜지 질문에 연관시켜 설명해 주세요.`);
  }
  if (ctx.sequenceMoves && ctx.sequenceMoves.length > 0) {
    lines.push(`[사용자가 생각한 수순 (Alt+화살표): ${ctx.sequenceMoves.join(' → ')}]`);
    lines.push(`※ 이 수순이 올바른지 평가해 주세요.`);
  }

  if (ctx.positionInsights && ctx.positionInsights.length > 0) {
    lines.push(``);
    lines.push(`[포지션 구조 분석 — 코드로 정밀 계산된 사실]`);
    ctx.positionInsights.forEach(ins => lines.push(`  • ${ins}`));
  }

  if (ctx.threatData) {
    lines.push(``);
    lines.push(`[위협 분석 데이터]`);
    if (ctx.threatData.idea) lines.push(`핵심 계획(Idea): ${ctx.threatData.idea}`);
    if (ctx.threatData.prob) lines.push(`문제점(Problem): ${ctx.threatData.prob}`);
    if (ctx.threatData.sol)  lines.push(`최선책(Solution): ${ctx.threatData.sol}`);
  }

  if (ctx.pgnMoves) lines.push(`전체 기보: ${ctx.pgnMoves}`);
  lines.push(`FEN: ${ctx.fen}`);
  lines.push(``);
  lines.push(`[사용자 질문]`);
  lines.push(question);
  lines.push(``);
  lines.push(`체스인사이드 해설 스타일(관찰→이유→결과)로, 한국어로만 답변해주세요.`);
  lines.push(`수치(cp, 점수, 승률)는 쓰지 말고, 수 표기(e4, Nf3 등)는 영문 그대로 쓰세요.`);

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════
// Groq API 호출
// ══════════════════════════════════════════════════════

// 포지션 해설 전용 API 호출
async function callCommentaryAPI(ctx) {
  const SYSTEM = `당신은 유튜브 채널 "체스인사이드"의 해설자입니다. 아래 예시들이 정확한 말투와 구조입니다.

───────────────────────────────────────
【예시 A — 폰 약점이 있는 미들게임】
**포지션 상황**
방금 흑이 Nf6로 나이트를 전개했고요. 지금 백은 중앙에 e4-d4 폰 센터를 쥐고 있습니다. 이거는 나중에 d5 돌파를 위협할 수 있는 구조인데, 그러려면 일단 기물 전개가 좀 더 이루어져야 하겠죠.

**약점 분석**
흑 입장에서는 c6 폰이 조금 신경 쓰이는 부분이라고 볼 수 있겠어요. 지금 당장 위협은 아니지만, d5가 열리는 순간 이 폰이 고립될 가능성이 있거든요. 그렇다는 건 흑도 빠르게 대응을 해줘야 하는 상황이라는 거죠.

**최선수 분석**
컴퓨터는 여기서 Bd3를 추천하고 있는데요. 백이 Bd3를 두면 비숍을 능동적인 칸에 두면서 e4 폰을 지원하는 거라고 볼 수 있겠습니다. 이후 흑이 O-O를 두면, 백은 Re1을 두어 킹사이드 공격 준비를 자연스럽게 이어갈 수 있어요. Re1이 들어오면 e5 돌파 위협이 생기기 때문에 흑도 쉽게 구경만 하고 있을 수는 없는 상황이 되겠습니다.

**이후 수순**
백이 Bd3를 두고 흑이 O-O로 대응한다면, 백은 h3 정도로 대기하면서 흑의 반격을 견제할 수 있겠어요. 흑이 c5로 카운터를 치려 한다면 백은 d5 돌파로 즉각 응수할 준비를 해두는 게 적합할 것 같습니다.

───────────────────────────────────────
【예시 B — 희생이 최선인 포지션】
**포지션 상황**
백이 Rxf7을 둔 상황입니다. 얼핏 보면 기물을 그냥 내주는 것처럼 보이는데, 세상에 공짜는 없거든요. 여기서 룩 희생에는 꽤 깊은 계산이 깔려 있습니다.

**위협 & 아이디어**
백이 Rxf7을 두면 흑은 Kxf7을 강요받게 되고요. 이후 백은 Ng5+로 킹을 체크하면서 퀸 포크를 노리는 수순이 따라옵니다. 흑 킹이 e8로 피한다면 백은 Qxd8+로 퀸까지 잡히는 모습이 되거든요. 폰 하나 준 게 아니라 결국 기물 우위를 가져가는 구조라고 볼 수 있겠습니다.

**최선수 분석**
엔진 최선 수순은 백이 Rxf7을 두면 흑은 Kxf7으로 잡고, 백은 다시 Ng5+를 둡니다. 흑이 e8로 피하면 백은 Qxd8+를 두어 퀸까지 잡게 되고요. 흑 킹이 퀸을 잡지 않고 f8이나 g8로 피하더라도 백은 퀸 교환 이후 공격을 계속 이어갈 수 있습니다.

**이후 수순**
교환 이후에는 백이 남은 기물로 노출된 흑 킹을 계속 추적하는 플레이가 자연스럽게 이어집니다. 흑 킹이 안전한 칸을 찾기 어렵다는 게 지금 포지션의 핵심이라고 볼 수 있겠죠.

───────────────────────────────────────
【예시 C — 균형 잡힌 포지션】
**포지션 상황**
서로 캐슬링을 마쳤고 기물 전개도 어느 정도 완성된 모습입니다. 지금은 양쪽 다 뚜렷한 약점이 없고, 특별히 긴장이 발생하는 칸도 없어요. 조용한 미들게임이 시작되는 시점이라고 볼 수 있겠어요.

**강점 분석**
백은 나이트가 d4라는 중앙 좋은 칸을 잡고 있다는 게 긍정적입니다. 이 나이트는 쉽게 쫓겨나지 않거든요. 백이 c2나 f5로 향하면서 상대에게 지속적인 부담을 줄 수 있는 상황이겠습니다.

**최선수 분석**
컴퓨터 추천수는 f4인데요. 백이 f4를 두면 킹사이드 공간을 열면서 나이트와 연계해 공격을 준비하는 아이디어입니다. 이후 흑이 f5로 막는다면 백은 e4로 카운터치면서 중앙 싸움을 가져오는 수순이 이어질 수 있겠어요.

**이후 수순**
지금 당장 결정적인 전술이 있는 국면은 아니고, 양쪽 다 자원을 모으면서 적절한 타이밍을 재는 상황이라고 보면 되겠습니다. 백이 먼저 확실한 전략 방향을 정하는 게 중요하겠어요.

───────────────────────────────────────

【당신이 이미 알고 있는 체스 지식 — 해설에 자연스럽게 활용할 것】

■ 기물 동적 가치 (위치 기반)
- 폰이 7랭크에 위치하면 승진 직전 위협으로 가치 최고조. 상대는 즉각 저지해야 함.
- 나이트는 중앙에 가까울수록, 그리고 상대 진영 깊숙이(5~7랭크) 전진할수록 공격력이 높아짐. 변두리 나이트(a/h파일)는 가치가 낮음.
- 비숍은 대각선이 열려있을수록, 그리고 아군 폰이 비숍과 다른 색 칸에 배치될수록(good bishop) 가치가 높아짐. 아군 폰이 비숍과 같은 색 칸에 많으면 배드 비숍.
- 룩은 열린 파일(open file)이나 반열린 파일(semi-open file)에 위치할수록, 7랭크에 침투할수록 가치가 극대화됨.

■ 전술 패턴
- 포크(Fork): 한 기물이 상대 기물 2개 이상을 동시에 공격. 나이트 포크가 가장 흔함.
- 핀(Pin): 고가치 기물 앞 기물이 움직일 수 없는 상태. 절대 핀(킹 앞)과 상대 핀(퀸 앞)으로 구분.
- 디스커버드 어택(Discovered Attack / 발견 공격): 앞에 있는 기물이 움직이면서 뒤 슬라이딩 기물이 상대 기물을 직격.
- 추크추방(Zwischenzug / 중간 수): 상대가 반드시 응수해야 할 중간 위협을 끼워 넣어 흐름을 끊는 수.
- 배터리(Battery): 같은 파일/랭크/대각선에 룩+룩, 퀸+룩, 퀸+비숍 배치로 압력 극대화.
- 아웃포스트(Outpost): 상대 폰이 공격할 수 없는 안전한 중앙 칸에 기물 배치.
- 기물 과부하(Overloading): 한 기물이 두 곳을 동시에 수비해야 하는 상황, 어느 한쪽을 포기해야 함.

■ 폰 구조
- 고립 폰(Isolated Pawn): 인접 파일에 아군 폰이 없어 지원받지 못하는 약점 폰.
- 이중 폰(Doubled Pawn): 같은 파일에 폰 2개 중첩. 구조적 약점.
- 뒤처진 폰(Backward Pawn): 전진하면 상대 폰 공격을 받고 인접 폰 지원이 없는 폰.
- 통과 폰(Passed Pawn): 상대 폰이 막지 못하는 폰. 엔드게임에서 가치 매우 높음.
- 폰 사슬(Pawn Chain): 대각선으로 연결된 폰 구조. 공간 통제력이 높으나 기저 폰이 약점.
- 폰 구조로 영역 우세를 가진 쪽은 기물 교환을 자제하는 것이 유리함(공간이 줄어들면 폰 구조 이점도 희석됨).

■ 마이너리티 공격(Minority Attack)
상대보다 폰 수가 적은 쪽(소수)이 그 폰들을 밀어 상대의 폰 다수 쪽을 공격하여 약점(고립 폰, 이중 폰 등)을 만드는 전략.
예: 백이 퀸사이드에 폰 2개, 흑이 3개인 경우 백이 b4-b5로 밀어 흑의 퀸사이드 폰 구조를 무너뜨리는 것.

■ 킹사이드/퀸사이드 전장 판단
- 기물과 폰이 킹사이드(e~h파일)에 집중돼 있으면 킹사이드 공격을 준비하는 것이 자연스러움.
- 기물과 폰이 퀸사이드(a~d파일)에 집중돼 있으면 퀸사이드 공격이 주 전장.
- 상대 킹이 킹사이드에 캐슬링했고 아군 기물이 킹사이드에 집중돼 있으면 직접 킹 공격 가능.

■ 예방적 폰 전진 (a3/a4, h3/h6)
- 오프닝 초반: 상대 비숍이 Bg5, Bb5 등 핀을 거는 것을 방지하는 예방 목적.
- 미들/엔드게임: 킹사이드(h3/h6) 또는 퀸사이드(a3/a4) 공간 확장 발판으로 측면 공격이나 영역 확장에 활용 가능.

【절대 규칙】
1. 위 예시의 말투를 그대로 따를 것: "~고요", "~거든요", "~라고 볼 수 있겠습니다", "~는 거죠", "~인 모습이었고요", "~겠어요", "~라고 볼 수 있겠네요"
2. 섹션 헤더는 반드시 **포지션 상황**, **약점 분석**, **강점 분석**, **위협 & 아이디어**, **최선수 분석**, **이후 수순** 중에서만 쓸 것
3. **포지션 상황** 과 **최선수 분석** 은 반드시 포함
4. 나머지 섹션은 실제 포지션에 맞는 것만 선택 (억지로 다 쓰지 말 것)
5. **최선수 분석** 에서는 반드시 엔진 1순위 라인의 실제 수 표기를 써서 인과관계를 설명할 것 ("A 이후 B가 오면 C가 되기 때문에")
6. 포지션 인사이트에서 [전술 패턴], [폰 구조], [기물 가치], [전장 판단], [마이너리티 공격], [예방 전진] 등이 보이면 해당 내용을 해설에 자연스럽게 녹여서 쓸 것
7. "이 수", "해당 수", "기물의 발전을 돕는다", "상대를 약화시킨다", "승리의 기회를 높입니다" 금지
8. cp/점수/승률 수치 금지
9. 전체 500~700자, 각 섹션 2~4문장
10. 한국어로만 출력. 체스 수 표기(e4, Nf3 등)는 영문 그대로.
11. 【수 설명 주어 규칙 — 절대 위반 금지】 모든 수에 대해 **누가(백/흑)** 두는지 주어를 반드시 명시할 것. 엔진 수순을 설명할 때 "백이 A를 두면, 흑은 B로 응수하고, 백은 C를 두어..."와 같이 **모든 수에 대해 주어를 써야 한다**. 주어 생략 및 양쪽 수를 반대편이 두는 것처럼 서술하는 것은 엄격히 금지.
12. 【이후 수순 섹션 규칙】 수순에 등장하는 각 수에 대해 "누가(백/흑) 무엇을(수 표기) 두면, 왜(구체적 결과)"를 반드시 써야 한다. 수를 나열만 하거나 결과 없이 "X로 막는다", "Y를 노린다"처럼 막연하게 쓰는 것은 금지. 구체적으로 어떤 칸/기물/위협이 발생하는지 서술할 것.
13. 【킹 위협 서술 규칙】 특정 수가 킹을 위협한다고 쓰려면, 구체적으로 어떤 칸으로 침투하는지 또는 어떤 체크/메이트 위협이 생기는지 반드시 함께 써야 한다. "킹을 노린다"는 단독 표현은 금지.`;

  const prompt = buildCommentaryPrompt(ctx);
  return callGroqAPIWithSystemTemp(SYSTEM, prompt, 900, 0.45);
}

// 공통 Groq 호출 (system 없이 — 수동 질문용)
async function callGroqAPI(userContent) {
  const SYSTEM = `You are a Korean-language chess coach in the style of "ChessInside" YouTube channel.
Always respond ONLY in Korean (한국어). Chess move notation (e4, Nf3, O-O) stays in English/algebraic form.
Never output Japanese, Chinese, Arabic, or any non-Korean script.
Never output numerical evaluation scores. Never output placeholders like <<_0>>.`;

  return callGroqAPIWithSystem(SYSTEM, userContent, 800);
}

async function callGroqAPIWithSystem(systemPrompt, userContent, maxTokens = 800) {
  return callGroqAPIWithSystemTemp(systemPrompt, userContent, maxTokens, 0.3);
}

async function callGroqAPIWithSystemTemp(systemPrompt, userContent, maxTokens = 800, temperature = 0.3) {
  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: maxTokens,
      temperature: temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw  = data.choices?.[0]?.message?.content || '응답을 받지 못했습니다.';
  return cleanKorean(raw);
}

// ══════════════════════════════════════════════════════
// 응답 포맷팅: 4섹션 카드 렌더링
// ══════════════════════════════════════════════════════

function sanitizeAnswer(text, ctx) {
  if (!text) return text;
  let out = String(text);
  out = out.replace(/<<\s*_?\d+\s*>>/g, '');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (out.length < 20) {
    out = `**포지션 상황:** 현재 포지션을 분석 중입니다.\n**약점 분석:** 스톡피시 라인을 바탕으로 분석이 필요합니다.\n**최선수 분석:** 엔진 추천수를 확인해주세요.\n**이후 수순:** 다음 수순을 살펴보세요.`;
  }

  return cleanKorean(out);
}

function formatCommentary(text) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const SECTION_DEFS = [
    { key: '포지션 상황',    icon: '🔍', cls: 'section-pos'    },
    { key: '약점 분석',      icon: '⚠️', cls: 'section-weak'   },
    { key: '강점 분석',      icon: '💪', cls: 'section-strong' },
    { key: '위협 & 아이디어', icon: '⚡', cls: 'section-threat' },
    { key: '최선수 분석',    icon: '♟️', cls: 'section-best'   },
    { key: '이후 수순',      icon: '🔮', cls: 'section-plan'   },
  ];

  const SECTION_KEYS = SECTION_DEFS.map(s => s.key);

  // ── 개선된 섹션 파싱 ──────────────────────────────────────────────────────
  // 전략: 모든 **헤더** 위치를 먼저 찾아 정렬한 뒤, 각 헤더 사이 본문만 추출.
  // LLM이 본문 안에 "비공식 헤더(** 없이 평문)"를 쓸 경우 다음 ** 헤더 위치로
  // 잘라내기 때문에 중복이 발생하지 않음.

  // 1) 모든 알려진 헤더 위치 탐색
  const allHeaderPat = new RegExp(
    '\\*\\*(' + SECTION_KEYS.map(k => k.replace(/&/g,'&amp;').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')[:\\s：]*\\*\\*',
    'g'
  );

  const found = []; // { key, start, bodyStart }
  let m;
  while ((m = allHeaderPat.exec(escaped)) !== null) {
    found.push({ key: m[1], start: m.index, bodyStart: m.index + m[0].length });
  }

  const parsed = {};
  for (let fi = 0; fi < found.length; fi++) {
    const { key, bodyStart } = found[fi];
    const bodyEnd = fi + 1 < found.length ? found[fi + 1].start : escaped.length;
    let body = escaped.slice(bodyStart, bodyEnd).trim().replace(/^[:：\s]+/, '').trim();

    // 본문 안에 평문으로 다른 섹션 이름이 붙어있으면 그 앞까지만 사용
    // (예: "...공격을 준비합니다. 최선수 분석 백의 최선수는...")
    const inlineHeaderPat = new RegExp(
      '(?:^|\n)(' + SECTION_KEYS.map(k => k.replace(/&/g,'&amp;').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')(?:\s|$)',
      'i'
    );
    const inlineMatch = body.match(inlineHeaderPat);
    if (inlineMatch && inlineMatch.index > 0) {
      body = body.slice(0, inlineMatch.index).trim();
    }

    if (body) parsed[key] = body;
  }

  if (Object.keys(parsed).length === 0) {
    // 섹션 감지 실패 — 일반 텍스트로 표시
    return formatPlain(escaped);
  }

  let html = '<div class="commentary-wrapper">';
  for (const def of SECTION_DEFS) {
    const body = parsed[def.key];
    if (!body) continue;
    const formatted = body
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // 체스 수 표기 강조
      .replace(/\b(O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#=]?|[a-h]x?[a-h][1-8][+#=]?|[a-h][1-8])\b/g,
               m => m.length >= 2 ? `<span class="chess-move">${m}</span>` : m)
      .replace(/\n/g, '<br>');
    html += `
      <div class="commentary-section ${def.cls}">
        <div class="commentary-label">${def.icon} ${def.key}</div>
        <div class="commentary-body">${formatted}</div>
      </div>`;
  }
  html += '</div>';
  return html;
}

function formatPlain(escaped) {
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

// ══════════════════════════════════════════════════════
// 인라인 패널에 해설 렌더링
// ══════════════════════════════════════════════════════
function renderCoachSidebar(answerText) {
  const responseDiv = document.getElementById('coach-response');
  if (!responseDiv) return;
  responseDiv.style.display = 'block';
  responseDiv.className = '';
  responseDiv.innerHTML = formatCommentary(answerText);
}

// ══════════════════════════════════════════════════════
// 한국어 후처리
// ══════════════════════════════════════════════════════
function cleanKorean(text) {
  if (!text) return text;
  let out = text
    // 일본어 히라가나/가타카나 제거
    .replace(/[\u3040-\u309F\u30A0-\u30FF]+/g, '')
    // 일본어/중국어 한자 제거
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]+/g, '')
    // 아랍어, 태국어 등 제거
    .replace(/[\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F]+/g, '')
    // 공백/줄바꿈 정리
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // ★ 라틴 문자(영문) 제거는 하지 않음
  // 체스 수 표기(e4, Nf3, O-O 등)가 라틴 문자이므로 제거하면 수가 사라짐
  // 대신 LLM 프롬프트에서 한국어 외 출력을 금지하여 불필요한 영문 혼입을 방지

  return out;
}


// ══════════════════════════════════════════════════════
// 위협 분석 패널 (기존 유지)
// ══════════════════════════════════════════════════════
let threatLoading = false;
let lastThreatFen = '';

function toggleThreatPanel() {
  const panel = document.getElementById('threat-panel');
  const btn   = document.getElementById('threat-toggle');
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'block';
    btn.style.color = 'var(--accent-blue)';
    btn.style.borderColor = 'var(--accent-blue)';
    if (!lastThreatFen || lastThreatFen !== (buildChessContext()?.fen || '')) {
      runThreatAnalysis();
    }
  } else {
    panel.style.display = 'none';
    btn.style.color = 'var(--text-muted)';
    btn.style.borderColor = 'var(--border-color)';
  }
}

async function runThreatAnalysis() {
  if (!coachApiKey || threatLoading) return;
  
  // API 호출 직전 최신 컨텍스트 빌드
  const ctx = await buildChessContext();
  if (!ctx) return;

  const fenKey = ctx.fen;
  if (fenKey === lastThreatFen) return;

  const panel     = document.getElementById('threat-panel');
  const contentEl = document.getElementById('threat-content');
  if (panel) panel.style.display = 'block';
  if (contentEl) contentEl.innerHTML = '<div class="threat-loading">⚡ 위협 분석 중...</div>';
  threatLoading   = true;
  lastThreatFen   = fenKey;

  try {
    // 최신 컨텍스트 주입 (window.pvData 업데이트 반영)
    ctx.pvData = window.pvData;

    // 체크메이트 즉시 감지
    const mover    = ctx.turn === 'w' ? '백' : '흑';
    const isMate   = ctx.bestMove && ctx.bestMove.includes('#');

    if (isMate) {
      const mateText = [
        `**핵심 계획:** ${mover}은 ${ctx.bestMove}로 즉각 체크메이트를 만들 수 있습니다.`,
        `**문제점:** 즉각적인 체크메이트가 있어 문제점 없음.`,
        `**최선책:** ${ctx.bestMove}를 바로 두어 게임을 끝내세요.`,
      ].join('\n');
      renderThreatPanel(mateText);
      return;
    }

    const answer  = await callThreatAPI(ctx);
    const cleaned = cleanKorean(answer);
    renderThreatPanel(cleaned);
  } catch(e) {
    document.getElementById('threat-content').innerHTML =
      `<div class="threat-loading" style="color:var(--accent-red)">분석 실패: ${e.message}</div>`;
    lastThreatFen = '';
  } finally {
    threatLoading = false;
  }
}

async function callThreatAPI(ctx) {
  const mover     = ctx.turn === 'w' ? '백(White)' : '흑(Black)';
  const opponent  = ctx.turn === 'w' ? '흑(Black)' : '백(White)';

  // 체크메이트/즉승 여부 감지: 엔진 1순위 수에 # 포함 여부
  const isMate    = ctx.bestMove && ctx.bestMove.includes('#');
  // 엔진 1순위 수에 + 포함 (체크) 여부
  const isCheck   = ctx.bestMove && (ctx.bestMove.includes('+') || isMate);

  const THREAT_SYSTEM = `You are a Korean chess analyst. Output ONLY in Korean (한국어).
Chess move notation stays in algebraic form (Nf3, e4, dxc4, O-O).

CRITICAL: You will be given the actual engine lines and FEN for the current position. Use ONLY those moves. Never invent or hallucinate moves. Never copy from examples.

TACTICAL SCANNING:
Scan the provided engine lines for tactical themes and use the exact terms:
- 포크 (Fork), 핀 (Pin), 스큐어 (Skewer)
- 디스커버드 어택 (Discovered Attack), 더블 체크 (Double Check)
- 희생 (Sacrifice)
If a move creates a fork or a pin, you MUST state it explicitly. (e.g., "Nf3+는 킹과 퀸을 동시에 공격하는 **포크**입니다.")

Analyze the position using the provided engine data and write three sections:
**핵심 계획:** — What does ${mover} want to do? State the concrete threat using the ACTUAL moves from the engine line provided. Format: "${mover}은 [move]로 [goal]을 노린다: [line] → [result]."
**문제점:** — What can ${opponent} do to counter? If engine line 2 or 3 shows a defensive resource, describe it with exact moves. If there's immediate checkmate or no counter, write "즉각적인 결정타가 있어 문제점 없음."
**최선책:** — What is ${mover}'s best response to the problem? Use the engine 1st line moves. Explain why it solves the issue.

Rules:
- Use ONLY moves from the engine lines provided. Do not invent any move.
- Every section must contain actual algebraic move notation from the data.
- Always identify and name tactical patterns (Fork, Pin, etc.) if they exist.
- No vague phrases like "기물 발전", "중앙 장악", "상대를 약화".
- Keep each section 1~2 sentences. Total under 400 characters.`;

  const userMsg = [
    `[현재 포지션 분석 — 아래 데이터만 사용하고 수를 절대 만들어내지 마세요]`,
    `차례: ${mover}`,
    ctx.bestLine  ? `엔진 1순위 라인 (최선): ${ctx.bestLine}` : '',
    ctx.line2     ? `엔진 2순위 라인: ${ctx.line2}` : '',
    ctx.line3     ? `엔진 3순위 라인: ${ctx.line3}` : '',
    isMate        ? `⚠️ 즉각 체크메이트 가능: ${ctx.bestMove}` : '',
    isCheck && !isMate ? `엔진 최선수(체크): ${ctx.bestMove}` : '',
    ctx.lastMoveSan ? `방금 둔 수: ${ctx.lastMoveSan}` : '',
    ctx.pgnMoves  ? `기보: ${ctx.pgnMoves}` : '',
    `FEN: ${ctx.fen}`,
    ``,
    `위 엔진 라인의 실제 수만 사용해서 핵심 계획/문제점/최선책을 분석하세요.`,
    `엔진 라인에 없는 수(예시에서 본 수, 상상한 수)를 절대 쓰지 마세요.`,
  ].filter(Boolean).join('\n');

  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: 'system', content: THREAT_SYSTEM },
        { role: 'user',   content: userMsg },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function renderThreatPanel(text) {
  const el = document.getElementById('threat-content');
  if (!text) { el.innerHTML = '<div class="threat-loading">분석 결과 없음</div>'; return; }

  const SECTIONS = [
    { key: '핵심 계획', cls: 'idea', icon: '💡', labelCls: 'threat-label-idea' },
    { key: '문제점',    cls: 'prob', icon: '⚠️', labelCls: 'threat-label-prob' },
    { key: '최선책',    cls: 'sol',  icon: '✅', labelCls: 'threat-label-sol'  },
  ];

  const parsed  = {};
  const allKeys = ['핵심 계획', '문제점', '최선책'];
  let remaining = text;

  for (let ki = 0; ki < allKeys.length; ki++) {
    const key     = allKeys[ki];
    const nextKey = allKeys[ki + 1];
    const keyPat  = new RegExp('\\*\\*' + key + '[:\\s：]*\\*\\*|\\*\\*' + key + '\\*\\*');
    const startIdx = remaining.search(keyPat);
    if (startIdx < 0) continue;

    const headerMatch = remaining.slice(startIdx).match(keyPat);
    const bodyFrom    = startIdx + headerMatch[0].length;

    let bodyEnd = remaining.length;
    if (nextKey) {
      const nextPat = new RegExp('\\*\\*' + nextKey);
      const nextIdx = remaining.slice(bodyFrom).search(nextPat);
      if (nextIdx >= 0) bodyEnd = bodyFrom + nextIdx;
    }
    parsed[key] = remaining.slice(bodyFrom, bodyEnd).trim().replace(/^[:：\s]+/, '').trim();
  }

  if (Object.keys(parsed).length === 0) {
    el.innerHTML = `<div class="threat-section"><div class="threat-section-body">${
      text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
    }</div></div>`;
    return;
  }

  let html = '';
  for (const s of SECTIONS) {
    if (!parsed[s.key]) continue;
    const body = parsed[s.key]
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\b(O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#=]?|[a-h]x?[a-h][1-8][+#=]?|[a-h][1-8][+#]?)\b/g,
               (m) => m.length >= 2 ? '<span class="t-move">' + m + '</span>' : m)
      .replace(/\n/g,'<br>');
    html += `
      <div class="threat-section">
        <div class="threat-section-label ${s.labelCls}">${s.icon} ${s.key}</div>
        <div class="threat-section-body">${body}</div>
      </div>`;
  }
  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// 최선수 설명 패널 (기존 유지)
// ══════════════════════════════════════════════════════
let bestExplainLoading   = false;
let lastBestExplainFen   = '';
let bestExplainMoves     = [];
let bestExplainFocusIdx  = 0;

function toggleBestExplainPanel() {
  const panel = document.getElementById('best-explain-panel');
  const btn   = document.getElementById('best-explain-toggle');
  const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
  if (!isOpen) {
    panel.style.display = 'block';
    btn.style.color = 'var(--accent-blue)';
    btn.style.borderColor = 'var(--accent-blue)';
    if (!lastBestExplainFen || lastBestExplainFen !== (buildChessContext()?.fen || '')) {
      runBestMoveExplain();
    }
  } else {
    panel.style.display = 'none';
    btn.style.color = 'var(--text-muted)';
    btn.style.borderColor = 'var(--border-color)';
  }
}

async function runBestMoveExplain(focusIdx) {
  if (!coachApiKey || bestExplainLoading) return;
  const ctx = buildChessContext();
  if (!ctx) return;
  const pv = window.pvData[1];
  if (!pv || !pv.moves || pv.moves.length === 0) return;

  const fenKey = ctx.fen;
  if (fenKey === lastBestExplainFen && focusIdx === undefined) return;

  bestExplainLoading  = true;
  lastBestExplainFen  = fenKey;
  bestExplainFocusIdx = focusIdx ?? 0;
  bestExplainMoves    = pv.moves.slice(0, 6);

  const panel = document.getElementById('best-explain-panel');
  panel.style.display = 'block';

  renderBestSeqBar(bestExplainMoves, bestExplainFocusIdx, ctx);

  document.getElementById('best-explain-content').innerHTML =
    '<div class="threat-loading">📖 최선수 분석 중...</div>';

  try {
    const focusMove = bestExplainMoves[bestExplainFocusIdx] || bestExplainMoves[0];
    const answer    = await callBestExplainAPI(ctx, bestExplainMoves, bestExplainFocusIdx);
    const cleaned   = cleanKorean(answer);
    renderBestExplain(cleaned, focusMove, bestExplainMoves, bestExplainFocusIdx, ctx);
  } catch(e) {
    document.getElementById('best-explain-content').innerHTML =
      `<div class="threat-loading" style="color:var(--accent-red)">분석 실패: ${e.message}</div>`;
    lastBestExplainFen = '';
  } finally {
    bestExplainLoading = false;
  }
}

function renderBestSeqBar(moves, activeIdx, ctx) {
  const bar = document.getElementById('best-explain-seq');
  if (!bar || !moves.length) return;

  let html    = '';
  let moveNum = ctx.fullMove || 1;
  let turn    = ctx.turn;

  moves.forEach((san, i) => {
    // 수 번호: 백 차례마다, 또는 첫 수가 흑일 때
    if (turn === 'w') {
      html += `<span class="best-seq-num">${moveNum}.</span>`;
    } else if (i === 0) {
      html += `<span class="best-seq-num">${moveNum}...</span>`;
    }

    const color = turn;
    let pieceCode;
    if (san === 'O-O' || san === 'O-O-O') pieceCode = color + 'K';
    else if (san && 'NBRQK'.includes(san[0])) pieceCode = color + san[0];
    else pieceCode = color + 'P';
    const imgTag = `<img src="${pieceImg(pieceCode)}" alt="">`;

    html += `<span class="best-seq-move${i === activeIdx ? ' active' : ''}"
      onclick="runBestMoveExplain(${i})" title="${san}">${imgTag}${san}</span>`;

    if (turn === 'b') moveNum++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  bar.innerHTML = html;
}

async function callBestExplainAPI(ctx, moves, focusIdx) {
  const EXPLAIN_SYSTEM = `You are a Korean chess coach. Output ONLY in Korean (한국어).
Chess move notation (Nf3, e4, O-O) stays in English algebraic form.

CRITICAL: Use ONLY the moves provided in the engine line. Never invent or hallucinate moves.

The user wants to understand WHY a specific move is good. Give CONCRETE reasons based on what actually happens in this position — not generic chess advice.

【주어 규칙 — 절대 위반 금지】엔진 수순은 백과 흑이 번갈아 둔다. 사용자 데이터에 "차례(turn)"가 명시되어 있으면, 수순의 1·3·5번째 수는 그 차례의 색이 두고, 2·4·6번째 수는 상대가 둔다. 설명할 때 반드시 "백이 X를 두면" / "흑이 Y로 응수하면" 형태로 주어를 밝힐 것. 한 쪽 수를 반대편이 두는 것처럼 쓰는 것은 엄격히 금지.

For each reason, answer one of these questions using actual moves from the data:
- What specific threat does this move escape? (예: "Qb2 침투 위협을 피합니다")
- What specific threat does this move create? (예: "Bxd5 포크를 위협합니다")
- What piece/square does it support and why does that matter? (예: "a7 룩이 d7 침투를 준비할 수 있게 됩니다")
- What tactical idea does it enable? (예: "흑 퀸이 b2를 잡으려 해도 이제 룩으로 막을 수 있습니다")

BANNED phrases (never use): "기물의 발전을 방해합니다", "중앙을 장악할 수 있습니다", "상대방을 약화시킵니다", "기물 교환으로 물량을 줄입니다", "폰 구조를 강화합니다", "킹을 노린다(구체적 칸/위협 없이)", "킹의 안전을 위협한다(구체적 설명 없이)"

Output format:
Line 1: "[수 표기]이/가 좋은 이유:" (예: "Qa1이 좋은 이유:")
Then 3-4 bullets, each starting with "• ", one concrete sentence each.
Total under 300 characters.`;

  const focusMove = moves[focusIdx] || moves[0];
  const seq       = moves.slice(0, 5).join(' ');

  const firstTurnKr  = ctx.turn === 'w' ? '백' : '흑';
  const secondTurnKr = ctx.turn === 'w' ? '흑' : '백';
  const userMsg = [
    `현재 차례: ${firstTurnKr}. 수순에서 1·3·5번째 수는 ${firstTurnKr}이 두고, 2·4·6번째 수는 ${secondTurnKr}이 둡니다.`,
    `엔진 최선 수순: ${seq}`,
    `그 중 ${focusIdx + 1}번째 수인 "${focusMove}"이/가 왜 좋은지 설명해주세요.`,
    ctx.lastMoveSan ? `직전 수: ${ctx.lastMoveSan}` : '',
    ctx.threatData?.prob ? `상대의 위협: ${ctx.threatData.prob}` : '',
    ctx.threatData?.idea ? `현재 계획: ${ctx.threatData.idea}` : '',
    `FEN: ${ctx.fen}`,
    `반드시 구체적인 위협명/칸/기물을 이용해 이유를 설명하세요. "기물 발전", "중앙 장악", "킹을 노린다(구체적 설명 없이)" 같은 막연한 표현 금지.`,
  ].filter(Boolean).join('\n');

  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 400,
      temperature: 0.25,
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user',   content: userMsg },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function renderBestExplain(text, focusMove, moves, activeIdx, ctx) {
  const contentEl = document.getElementById('best-explain-content');
  if (!text) { contentEl.innerHTML = '<div class="threat-loading">결과 없음</div>'; return; }

  const escaped = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 이유 줄 파싱 (• / - / 숫자. 로 시작하는 줄)
  const lines = escaped.split('\n').map(l => l.trim()).filter(Boolean);
  const reasonLines = [];
  for (const line of lines) {
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('·') || line.match(/^\d+\./)) {
      const txt = line.replace(/^[•\-·]\s*/, '').replace(/^\d+\.\s*/, '');
      if (txt) reasonLines.push(txt);
    }
  }
  // 이유가 없으면 모든 줄을 이유로
  if (reasonLines.length === 0) {
    lines.forEach(l => { if (l) reasonLines.push(l); });
  }

  // 기물 아이콘 결정 (focusIdx 기준 차례 계산)
  let turnForFocus = ctx.turn;
  for (let k = 0; k < activeIdx; k++) turnForFocus = turnForFocus === 'w' ? 'b' : 'w';
  const color = turnForFocus;
  let pieceCode;
  if (focusMove === 'O-O' || focusMove === 'O-O-O') pieceCode = color + 'K';
  else if (focusMove && 'NBRQK'.includes(focusMove[0])) pieceCode = color + focusMove[0];
  else pieceCode = color + 'P';
  const pieceImg_ = `<img src="${pieceImg(pieceCode)}" alt="${focusMove}">`;

  // 아이콘 색상 순서: 파랑 → 반투명파랑 → 초록 → 노랑
  const iconCls = ['reason-positive','reason-neutral','reason-good','reason-warning'];

  // 타이틀: "[기물아이콘 Qa1]이/가 좋은 이유:"
  let html = `
    <div class="best-explain-title">
      <span class="be-move-chip">${pieceImg_}${focusMove}</span>이/가 좋은 이유:
    </div>
    <div class="best-reason-list">`;

  const highlight = s => s.replace(
    /(O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#=]?|[a-h]x?[a-h][1-8][+#=]?|[a-h][1-8][+#]?)/g,
    m => m.length >= 2 ? `<strong>${m}</strong>` : m
  );

  reasonLines.slice(0, 4).forEach((reason, i) => {
    const cls = iconCls[i % iconCls.length];
    html += `
      <div class="best-reason-item">
        <div class="best-reason-icon ${cls}"></div>
        <span>${highlight(reason)}<span class="best-reason-plus">+</span></span>
      </div>`;
  });

  html += `</div>`;
  contentEl.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// 초기화 및 모바일 패널
// ══════════════════════════════════════════════════════

// 엔터 키로 질문 제출
function setupCoachKeyboard() {
  const input = document.getElementById('coach-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askCoach();
    }
  });
}

// 페이지 부트는 ui.js 의 bootstrapUi() 가 담당 (중복 init 호출 방지)

function toggleMobilePanel(forceClose) {
  const panel     = document.getElementById('right-panel');
  const backdrop  = document.getElementById('mobile-panel-backdrop');
  const iconOpen  = document.getElementById('mpanel-icon-open');
  const iconClose = document.getElementById('mpanel-icon-close');
  const isOpen    = panel.classList.contains('mobile-open');
  const shouldOpen = forceClose === false ? false : !isOpen;
  panel.classList.toggle('mobile-open', shouldOpen);
  backdrop.classList.toggle('show', shouldOpen);
  iconOpen.style.display  = shouldOpen ? 'none' : '';
  iconClose.style.display = shouldOpen ? ''      : 'none';
}