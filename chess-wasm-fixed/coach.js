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
function buildChessContext() {
  if (!game) return null;

  const turn = game.turn;
  const fen = boardToFen(game.board, game.turn, game.castling, game.enPassant, game.halfMove, game.fullMove);

  // 엔진 라인 3개 (pvData에서)
  const pv1 = pvData && pvData[1];
  const pv2 = pvData && pvData[2];
  const pv3 = pvData && pvData[3];

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
  };
}

// ══════════════════════════════════════════════════════
// 핵심: 포지션 해설 자동 실행
// ══════════════════════════════════════════════════════

// 지연 함수 (Rate Limit 방지용)
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 스톡피시 라인이 충분한지 검사 (3개 라인 모두 있고, 각각 최소 4수 이상)
function hasEnoughLines(ctx) {
  const pv1 = pvData && pvData[1];
  const pv2 = pvData && pvData[2];
  const pv3 = pvData && pvData[3];
  const len1 = pv1 && pv1.moves ? pv1.moves.length : 0;
  const len2 = pv2 && pv2.moves ? pv2.moves.length : 0;
  const len3 = pv3 && pv3.moves ? pv3.moves.length : 0;
  return len1 >= 4 && len2 >= 3 && len3 >= 3;
}

// 스톡피시에 더 깊은 분석 요청 (엔진이 이미 실행 중이라고 가정)
// pvData가 업데이트될 때까지 최대 5초 대기
async function waitForDeepLines(ctx, maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (hasEnoughLines(ctx)) return true;
    await wait(300);
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
let commentaryDebounceTimer = null;
async function runPositionCommentary() {
  if (!coachApiKey) return;

  // 디바운스 처리: 500ms 이내에 다시 호출되면 이전 대기 취소
  if (commentaryDebounceTimer) clearTimeout(commentaryDebounceTimer);
  commentaryDebounceTimer = setTimeout(async () => {
    if (coachLoading) return;
    await _executePositionCommentary();
  }, 500);
}

async function _executePositionCommentary() {
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
        await wait(300);
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
        await wait(300);
      }
      freshCtx = buildChessContext();
    }

    // API 호출 간 간격 두기 (429 에러 방지)
    await wait(1000);

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

    // API 호출 간 간격 두기 (429 에러 방지)
    await wait(1200);

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

  const context = buildChessContext();
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

  // pvData에서 직접 최신 라인 읽기 (ctx의 캐시된 값 대신)
  const livePv1 = pvData && pvData[1];
  const livePv2 = pvData && pvData[2];
  const livePv3 = pvData && pvData[3];
  const liveBestLine = livePv1 && livePv1.moves ? livePv1.moves.slice(0, 8).join(' ') : ctx.bestLine;
  const liveLine2    = livePv2 && livePv2.moves ? livePv2.moves.slice(0, 6).join(' ') : ctx.line2;
  const liveLine3    = livePv3 && livePv3.moves ? livePv3.moves.slice(0, 6).join(' ') : ctx.line3;
  const liveBestMove = livePv1 && livePv1.moves && livePv1.moves[0] ? livePv1.moves[0] : ctx.bestMove;

  // FEN에서 주요 기물 위치를 파싱해서 모델에게 명시 (환각 방지용 내부 데이터)
  function parseFenToSquares(fen) {
    const pieceMap = {
      'K':'백 킹','Q':'백 퀸','R':'백 룩','B':'백 비숍','N':'백 나이트','P':'백 폰',
      'k':'흑 킹','q':'흑 퀸','r':'흑 룩','b':'흑 비숍','n':'흑 나이트','p':'흑 폰'
    };
    const board = fen.split(' ')[0];
    const rows = board.split('/');
    const result = [];
    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if ('12345678'.includes(ch)) { col += parseInt(ch); }
        else {
          const file = 'abcdefgh'[col];
          const rank = 8 - r;
          const name = pieceMap[ch];
          if (name) result.push(`${name}(${file}${rank})`);
          col++;
        }
      }
    }
    return result.join(', ');
  }

  const piecePositions = parseFenToSquares(ctx.fen);

  lines.push(`아래 체스 포지션을 보고, 체스인사이드 채널처럼 해설하세요.`);
  lines.push(``);
  lines.push(`[포지션 데이터]`);
  const moverKo = ctx.turn === 'w' ? '백(White)' : '흑(Black)';
  lines.push(`게임 단계: ${ctx.phase} | 진행 수: ${ctx.moveCount}수`);
  lines.push(`★ 지금 수를 둘 차례: ${moverKo} ← 최선수 분석은 반드시 이 쪽 기준으로`);
  lines.push(`현재 형세: ${ctx.advantageDesc}`);

  if (ctx.lastMoveSan) {
    const ann = ctx.lastMoveAnnotation ? ` (${ctx.lastMoveAnnotation})` : '';
    lines.push(`방금 둔 수: ${ctx.lastMoveSan}${ann} (이미 보드에 반영됨)`);
  }

  lines.push(`★ 현재 보드 위 기물 위치 (내부 참고용):`);
  lines.push(piecePositions);

  // 엔진 라인을 "수 번호 + 차례" 형태로 전개해서 백/흑 혼동 방지
  function expandLine(movesStr, startTurn, startFullMove) {
    if (!movesStr) return '';
    const moves = movesStr.split(' ').filter(Boolean);
    let turn = startTurn;
    let num  = startFullMove || 1;
    return moves.map(san => {
      const label = turn === 'w' ? `${num}.백:${san}` : `${num}...흑:${san}`;
      if (turn === 'b') num++;
      turn = turn === 'w' ? 'b' : 'w';
      return label;
    }).join(' ');
  }

  const startTurn = ctx.turn;
  const startNum  = ctx.fullMove || 1;
  if (liveBestLine) lines.push(`[엔진 최선 수순 — 반드시 이 수순만 사용, 백/흑 차례 주의]\n${expandLine(liveBestLine, startTurn, startNum)}`);
  if (liveLine2)    lines.push(`[엔진 2순위]\n${expandLine(liveLine2, startTurn, startNum)}`);
  if (liveLine3)    lines.push(`[엔진 3순위]\n${expandLine(liveLine3, startTurn, startNum)}`);

  // 사용자 화살표(후보수/수순) 포함
  if (ctx.candidateMoves && ctx.candidateMoves.length > 0) {
    lines.push(``);
    lines.push(`[사용자가 화살표로 표시한 후보수: ${ctx.candidateMoves.join(', ')}]`);
    lines.push(`※ 해설에서 이 후보수들이 엔진 추천과 어떻게 다른지 언급해 주세요.`);
  }
  if (ctx.sequenceMoves && ctx.sequenceMoves.length > 0) {
    lines.push(`[사용자가 Alt+화살표로 표시한 수순: ${ctx.sequenceMoves.join(' → ')}]`);
    lines.push(`※ 이 수순의 장단점을 간략히 언급해 주세요.`);
  }

  if (ctx.threatData) {
    lines.push(``);
    lines.push(`[위협 분석 — 해설에 녹여서 사용할 것]`);
    if (ctx.threatData.idea) lines.push(`아이디어: ${ctx.threatData.idea}`);
    if (ctx.threatData.prob) lines.push(`문제점: ${ctx.threatData.prob}`);
    if (ctx.threatData.sol)  lines.push(`해결책: ${ctx.threatData.sol}`);
  }

  if (ctx.bestExplainData) {
    lines.push(``);
    lines.push(`[최선수 이유 데이터 — 자연스러운 문장으로 녹여서 사용할 것]`);
    lines.push(`최선수: ${ctx.bestExplainData.move || liveBestMove}`);
    if (ctx.bestExplainData.reasons && ctx.bestExplainData.reasons.length > 0) {
      ctx.bestExplainData.reasons.forEach((r, i) => lines.push(`  ${i+1}. ${r}`));
    }
  }

  if (ctx.pgnMoves) lines.push(`전체 기보: ${ctx.pgnMoves}`);
  lines.push(`FEN: ${ctx.fen}`);

  lines.push(``);
  lines.push(`[작성 지시]`);
  lines.push(`- **포지션 상황** 으로 시작 (필수)`);
  lines.push(`- 이후는 상황에 맞는 섹션만: **약점 분석**, **강점 분석**, **위협 & 아이디어**, **최선수 분석**, **이후 수순**`);
  lines.push(`- **최선수 분석** 은 항상 포함. [엔진 최선 수순]의 수를 그대로 써서 설명할 것.`);
  lines.push(`- ★ 기물 위치는 반드시 [현재 보드 위 기물 위치]만 참고. 방금 둔 수가 이미 보드에 반영된 상태이므로, 이동 전 칸이 아닌 이동 후 칸 기준으로 서술.`);
  lines.push(`- 백/흑 주체를 항상 명시: 각 수마다 "백이 Nf3을", "흑이 cxd5로" 형태로. 주어 없이 수만 나열하지 말 것.`);
  lines.push(`- 각 섹션은 흐름으로: 수가 두어지면 → 어떤 일이 생기고 → 상대는 어떻게 대응할 수밖에 없는지.`);
  lines.push(`- 섹션 헤더는 **헤더명** 형태로 새 줄에서 시작.`);
  lines.push(`- 수 표기 필수(Nf3, cxd5 등). "이 수", "해당 수" 절대 금지.`);
  lines.push(`- 공허한 표현 금지: "기물의 발전을 돕는다", "중앙 장악", "승리의 기회를 높입니다"`);
  lines.push(`- 각 섹션 2~4문장, 전체 500~700자`);
  lines.push(`- cp/점수/승률 수치 절대 금지`);

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

  if (ctx.threatData) {
    lines.push(``);
    lines.push(`[위협 분석 데이터]`);
    if (ctx.threatData.idea) lines.push(`아이디어: ${ctx.threatData.idea}`);
    if (ctx.threatData.prob) lines.push(`문제점: ${ctx.threatData.prob}`);
    if (ctx.threatData.sol)  lines.push(`해결책: ${ctx.threatData.sol}`);
  }

  if (ctx.pgnMoves) lines.push(`전체 기보: ${ctx.pgnMoves}`);
  lines.push(`FEN: ${ctx.fen}`);
  lines.push(``);
  lines.push(`[중요 전술 체크]`);
  lines.push(`질문에 답변할 때 포지션의 전술적 요소(포크, 핀, 디스커버드 어택 등)를 면밀히 살펴보고 답변에 포함시키세요.`);
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
  const SYSTEM = `당신은 체스 전문 해설가 "체스인사이드"입니다. 국면의 본질적인 '구도'와 '전략', 그리고 '구조'를 해설하는 데 집중하세요.

───────────────────────────────
★ 전문가급 포지션 분석 지침
───────────────────────────────

1. [전장 파악] 주요 전장이 **킹사이드**, **퀸사이드**, 혹은 **중앙** 중 어디인지 명확히 설명하세요.

2. [기물 활동성] 말들의 '가치'가 아닌 '영향력'을 보세요. (예: 지배적인 룩, 갇힌 비숍 등)

3. [폰 구조 분석] 폰은 체스의 골격입니다. 아래 요소들을 반드시 체크하여 해설에 반영하세요:
   - **고립된 폰 (Isolated Pawn)**: 주변에 보호해줄 폰이 없어 공격의 타겟이 되는 폰.
   - **더블 폰 (Doubled Pawns)**: 같은 열에 겹쳐 있어 기동성이 떨어지는 폰.
   - **뒤처진 폰 (Backward Pawn)**: 전진하지 못하고 뒤에 처져서 약점이 된 폰.
   - **매달린 폰 (Hanging Pawns)**: 중앙에서 강력하지만 동시에 공격에 노출된 폰 쌍.
   - "이 폰 구조 때문에 나중에 엔드게임에서 불리해질 수 있거든요" 처럼 장기적 관점을 제시하세요.

4. [색깔 약점] 밝은색/어두운색 칸의 균형과 취약한 지점을 짚어주세요.

★ 출력 형식
**포지션 상황** (주요 전장과 전체적인 구도 요약)
**폰 구조 & 약점** (폰 구조의 특징과 그로 인한 취약점 서술)
**강점 분석** (활동성이 좋은 기물이나 공간 우위)
**위협 & 아이디어** / **최선수 분석** / **이후 수순**

최선수 분석은 반드시 엔진 1순위 라인의 의도를 전략적으로 해설하세요.`;

  const prompt = buildCommentaryPrompt(ctx);
  return callGroqAPIWithSystem(SYSTEM, prompt, 1100);
}

// 공통 Groq 호출 (system 없이 — 수동 질문용)
async function callGroqAPI(userContent) {
  const SYSTEM = `You are a Korean-language chess coach in the style of "ChessInside" YouTube channel.
Always respond ONLY in Korean (한국어). Chess move notation (e4, Nf3, O-O) stays in English/algebraic form.
Never output Japanese, Chinese, Arabic, or any non-Korean script.
Never output numerical evaluation scores. Never output placeholders like <<_0>>.
Mandatory: Identify and name tactical patterns (Fork, Pin, etc.) using Korean terms like "**포크**", "**핀**".`;

  return callGroqAPIWithSystem(SYSTEM, userContent, 800);
}

async function callGroqAPIWithSystem(systemPrompt, userContent, maxTokens = 800) {
  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: maxTokens,
      temperature: 0.3,
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
  console.log('[Groq API Response]', data);
  const raw  = data.choices?.[0]?.message?.content || '응답을 받지 못했습니다.';
  return cleanKorean(raw);
}

// ══════════════════════════════════════════════════════
// 응답 포맷팅: 4섹션 카드 렌더링
// ══════════════════════════════════════════════════════

function sanitizeAnswer(text, ctx) {
  if (!text) return '';
  let out = String(text);
  out = out.replace(/<<\s*_?\d+\s*>>/g, '');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // 20자 미만인 경우에만 플레이스홀더 표시 (정말로 응답이 비어있거나 너무 짧을 때)
  if (out.length < 5) {
    return `**포지션 상황:** 현재 분석 결과가 비어 있습니다. 잠시 후 다시 시도해 주세요.\n**약점 분석:** 스톡피시 라인을 확인해 주세요.\n**최선수 분석:** 엔진 추천수를 참고하세요.\n**이후 수순:** 다음 진행을 살펴보세요.`;
  }

  return cleanKorean(out);
}

function formatCommentary(text) {
  if (!text) return '<div class="threat-loading">해설을 생성할 수 없습니다.</div>';
  
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const SECTION_DEFS = [
    { key: '포지션 상황',    icon: '🔍', cls: 'section-pos'    },
    { key: '약점 분석',      icon: '⚠️', cls: 'section-weak'   },
    { key: '강점 분석',      icon: '💪', cls: 'section-strong' },
    { key: '위협 & 아이디어', icon: '⚡', cls: 'section-threat' },
    { key: '아이디어',      icon: '💡', cls: 'section-threat' },
    { key: '문제점',        icon: '⚠️', cls: 'section-weak'   },
    { key: '해결책',        icon: '✅', cls: 'section-best'   },
    { key: '최선수 분석',    icon: '♟️', cls: 'section-best'   },
    { key: '이후 수순',      icon: '🔮', cls: 'section-plan'   },
  ];

  const SECTION_KEYS = SECTION_DEFS.map(s => s.key);

  // ── 개선된 섹션 파싱 ──────────────────────────────────────────────────────
  // ** 없이도 섹션 헤더를 인식하도록 정규식 강화
  const allHeaderPat = new RegExp(
    '(?:\\*\\*|#|\\n|^)(' + SECTION_KEYS.map(k => k.replace(/&/g,'&amp;').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')[:\\s：]*(?:\\*\\*|)?',
    'g'
  );

  const found = []; 
  let m;
  while ((m = allHeaderPat.exec(escaped)) !== null) {
    found.push({ key: m[1], start: m.index, bodyStart: m.index + m[0].length });
  }

  const parsed = {};
  for (let fi = 0; fi < found.length; fi++) {
    const { key, bodyStart } = found[fi];
    const bodyEnd = fi + 1 < found.length ? found[fi + 1].start : escaped.length;
    let body = escaped.slice(bodyStart, bodyEnd).trim().replace(/^[:：\s]+/, '').trim();

    // 중복 제거 및 클리닝
    if (body) parsed[key] = body;
  }

  if (Object.keys(parsed).length === 0) {
    return formatPlain(escaped);
  }

  let html = '<div class="commentary-wrapper">';
  // 유니크한 섹션만 렌더링 (동의어 처리)
  const renderedKeys = new Set();
  for (const def of SECTION_DEFS) {
    const body = parsed[def.key];
    if (!body || renderedKeys.has(def.key)) continue;
    
    const formatted = body
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\b(O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#=]?|[a-h]x?[a-h][1-8][+#=]?|[a-h][1-8])\b/g,
               m => m.length >= 2 ? `<span class="chess-move">${m}</span>` : m)
      .replace(/\n/g, '<br>');
    
    html += `
      <div class="commentary-section ${def.cls}">
        <div class="commentary-label">${def.icon} ${def.key}</div>
        <div class="commentary-body">${formatted}</div>
      </div>`;
    renderedKeys.add(def.key);
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
    btn.style.borderColor = 'var(--border)';
  }
}

function toggleThreatCollapse() {
  const body = document.getElementById('threat-body');
  const btn  = document.getElementById('threat-collapse-btn');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▼' : '▲';
  btn.title = collapsed ? '펼치기' : '접기';
}

async function runThreatAnalysis() {
  if (!coachApiKey || threatLoading) return;
  const ctx = buildChessContext();
  if (!ctx) return;

  const fenKey = ctx.fen;
  if (fenKey === lastThreatFen) return;

  const panel     = document.getElementById('threat-panel');
  const contentEl = document.getElementById('threat-content');
  if (panel) panel.style.display = 'block';
  if (contentEl) contentEl.innerHTML = '<div class="threat-loading">🔍 최선수 분석 중...</div>';
  threatLoading   = true;
  lastThreatFen   = fenKey;

  try {
    const mover    = ctx.turn === 'w' ? '백' : '흑';
    const isMate   = ctx.bestMove && ctx.bestMove.includes('#');

    if (isMate) {
      const mateText = [
        `**아이디어:** ${mover}은 ${ctx.bestMove}로 즉각 체크메이트를 만들 수 있습니다.`,
        `**문제점:** 즉각적인 체크메이트가 있어 문제점 없음.`,
        `**해결책:** ${ctx.bestMove}를 바로 두어 게임을 끝내세요.`,
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

  const THREAT_SYSTEM = `당신은 체스 분석 전문가입니다. 한국어로만 답변하세요.
엔진 라인을 분석하여 세 가지 섹션(**아이디어**, **문제점**, **해결책**)을 작성하세요.

**아이디어:** ${mover}이 노리는 공격 계획을 설명하세요. (예: "백은 Nf3로 킹사이드를 압박하며 포크를 노린다")
**문제점:** ${opponent}의 최선 대응이나 방어 수단을 설명하세요.
**해결책:** ${mover}이 문제를 어떻게 해결하고 이득을 유지할지 엔진 1순위 수를 바탕으로 설명하세요.

수 표기(e4, Nf3 등)는 영문 그대로 쓰세요. 1~2문장으로 간결하게 작성하세요.`;

  const userMsg = [
    `차례: ${mover}`,
    ctx.bestLine  ? `엔진 1순위 라인: ${ctx.bestLine}` : '',
    ctx.line2     ? `엔진 2순위 라인: ${ctx.line2}` : '',
    ctx.line3     ? `엔진 3순위 라인: ${ctx.line3}` : '',
    `FEN: ${ctx.fen}`,
  ].join('\n');

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
    { key: '아이디어', cls: 'idea', icon: '💡', labelCls: 'threat-label-idea' },
    { key: '문제점',   cls: 'prob', icon: '⚠️', labelCls: 'threat-label-prob' },
    { key: '해결책',   cls: 'sol',  icon: '✅', labelCls: 'threat-label-sol'  },
    // 동의어 처리
    { key: '핵심 계획', cls: 'idea', icon: '💡', labelCls: 'threat-label-idea' },
    { key: '최선책',   cls: 'sol',  icon: '✅', labelCls: 'threat-label-sol'  },
  ];

  const SECTION_KEYS = SECTIONS.map(s => s.key);
  const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 강화된 섹션 파싱 (포맷 유연성 확보)
  const allHeaderPat = new RegExp(
    '(?:\\*\\*|#|\\n|^)(' + SECTION_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')[:\\s：]*(?:\\*\\*|)?',
    'g'
  );

  const found = []; 
  let m;
  while ((m = allHeaderPat.exec(escaped)) !== null) {
    found.push({ key: m[1], start: m.index, bodyStart: m.index + m[0].length });
  }

  const parsed = {};
  for (let fi = 0; fi < found.length; fi++) {
    const { key, bodyStart } = found[fi];
    const bodyEnd = fi + 1 < found.length ? found[fi + 1].start : escaped.length;
    let body = escaped.slice(bodyStart, bodyEnd).trim().replace(/^[:：\s]+/, '').trim();
    if (body) parsed[key] = body;
  }

  if (Object.keys(parsed).length === 0) {
    el.innerHTML = `<div class="threat-section"><div class="threat-section-body">${
      escaped.replace(/\n/g,'<br>')
    }</div></div>`;
    return;
  }

  let html = '';
  const renderedBaseKeys = new Set();
  for (const s of SECTIONS) {
    const body = parsed[s.key];
    if (!body || renderedBaseKeys.has(s.cls)) continue;

    const formattedBody = body
      .replace(/\b(O-O-O|O-O|[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#=]?|[a-h]x?[a-h][1-8][+#=]?|[a-h][1-8][+#]?)\b/g,
               (m) => m.length >= 2 ? '<span class="t-move">' + m + '</span>' : m)
      .replace(/\n/g,'<br>');
    
    html += `
      <div class="threat-section">
        <div class="threat-section-label ${s.labelCls}">${s.icon} ${s.key}</div>
        <div class="threat-section-body">${formattedBody}</div>
      </div>`;
    renderedBaseKeys.add(s.cls);
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
  const pv = pvData[1];
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
  const EXPLAIN_SYSTEM = `당신은 한국어로 체스 수를 해설하는 AI입니다. 한국어만 출력하고, 체스 수 표기는 영문(Nf3, e4, O-O)을 유지하세요.

★ 핵심 원칙: "이 수가 좋은 이유는 ~" 식의 나열 금지.
대신 수를 두면 어떤 일이 생기고 → 상대는 어떻게 대응할 수밖에 없는지 → 결국 어떤 결과가 나오는지를 따라가세요.

★ 전술이 있으면 반드시 이름으로: **포크**, **핀**, **스큐어**, **디스커버드 어택**. 구체적으로 설명하세요.
★ 금지 표현: "기물의 발전을 방해합니다", "중앙을 장악할 수 있습니다", "상대방을 약화시킵니다", "폰 구조를 강화합니다"

출력 형식:
1번째 줄: "[수 표기]이/가 나오면서:" (예: "Qa1이 나오면서:")
이후 3~4개 bullet, 각 "• " 로 시작, 한 문장씩.
전체 300자 이내.`;

  const focusMove = moves[focusIdx] || moves[0];
  const seq       = moves.slice(0, 5).join(' ');

  const userMsg = [
    `엔진 최선 수순: ${seq}`,
    `${focusIdx + 1}번째 수인 "${focusMove}"이/가 왜 좋은지 설명해주세요.`,
    `차례: ${ctx.turn === 'w' ? '백' : '흑'}`,
    `FEN: ${ctx.fen}`,
    `구체적인 위협명/칸/기물을 이용해 이유를 설명하세요.`,
  ].join('\n');

  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
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
  if (reasonLines.length === 0) {
    lines.forEach(l => { if (l) reasonLines.push(l); });
  }

  // 기물 아이콘 결정
  let turnForFocus = ctx.turn;
  for (let k = 0; k < activeIdx; k++) turnForFocus = turnForFocus === 'w' ? 'b' : 'w';
  const color = turnForFocus;
  let pieceCode;
  if (focusMove === 'O-O' || focusMove === 'O-O-O') pieceCode = color + 'K';
  else if (focusMove && 'NBRQK'.includes(focusMove[0])) pieceCode = color + focusMove[0];
  else pieceCode = color + 'P';
  const pieceImg_ = `<img src="${pieceImg(pieceCode)}" alt="${focusMove}">`;

  const iconCls = ['reason-positive','reason-neutral','reason-good','reason-warning'];

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

document.addEventListener('DOMContentLoaded', init);

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
