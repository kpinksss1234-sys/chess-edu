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

  return {
    turn, fen, bestMove, bestLine, line2, line3, evaluation, depth, cpFromWhite,
    lastMove, lastMoveSan, lastMoveAnnotation,
    engineBestForPrevPos, engineLineForPrevPos,
    pgnMoves: pgnMoves.trim(),
    phase, moveCount, advantageDesc,
    fullMove: game.fullMove,
    threatData,
    bestExplainData,
  };
}

// ══════════════════════════════════════════════════════
// 핵심: 포지션 해설 자동 실행
// ══════════════════════════════════════════════════════

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

    // 최선수 이유 분석이 없으면 백그라운드에서 먼저 실행 후 결과 기다림
    if (!freshCtx.bestExplainData && !bestExplainLoading && pvData && pvData[1] && pvData[1].moves && pvData[1].moves.length > 0) {
      responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> 최선수 이유 분석 중...`;
      await runBestMoveExplain(0);
      const bStart = Date.now();
      while (bestExplainLoading && Date.now() - bStart < 4000) {
        await new Promise(r => setTimeout(r, 300));
      }
      freshCtx = buildChessContext();
    }

    responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> AI 해설 생성 중...`;

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

  lines.push(`아래 체스 포지션을 보고, 체스인사이드 채널처럼 해설하세요.`);
  lines.push(``);
  lines.push(`핵심 원칙: 이 포지션에서 실제로 보이는 것을 있는 그대로 관찰하고 설명하세요.`);
  lines.push(`폰이 약하면 "이 폰은 지키기가 어려운 폰이라고 볼 수 있죠"처럼,`);
  lines.push(`긴장이 생기면 "비숍이 뒤쪽으로 빠지면서 룩 긴장이 생겨났고요"처럼,`);
  lines.push(`나이트가 불안정하면 "나이트의 위치가 나중에라도 밀려날 수 있다는 걸 고려하면"처럼.`);
  lines.push(`상황이 평범하면 평범하게, 복잡하면 복잡하게 — 억지로 극적인 표현이나 고정된 패턴을 쓰지 마세요.`);
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

  if (ctx.threatData) {
    lines.push(``);
    lines.push(`[위협 분석 — 해설에 녹여서 사용할 것]`);
    if (ctx.threatData.idea) lines.push(`핵심 계획: ${ctx.threatData.idea}`);
    if (ctx.threatData.prob) lines.push(`문제점: ${ctx.threatData.prob}`);
    if (ctx.threatData.sol)  lines.push(`최선책: ${ctx.threatData.sol}`);
  }

  if (ctx.bestExplainData) {
    lines.push(``);
    lines.push(`[최선수 이유 데이터 — 자연스러운 문장으로 녹여서 사용할 것]`);
    lines.push(`최선수: ${ctx.bestExplainData.move || ctx.bestMove}`);
    if (ctx.bestExplainData.reasons && ctx.bestExplainData.reasons.length > 0) {
      ctx.bestExplainData.reasons.forEach((r, i) => lines.push(`  ${i+1}. ${r}`));
    }
  }

  if (ctx.pgnMoves) lines.push(`전체 기보: ${ctx.pgnMoves}`);
  lines.push(`FEN: ${ctx.fen}`);

  lines.push(``);
  lines.push(`[작성 규칙]`);
  lines.push(`- 해설은 반드시 **포지션 상황** 섹션으로 시작`);
  lines.push(`- 이후 섹션은 상황에 맞는 것만 선택: **약점 분석**, **강점 분석**, **위협 & 아이디어**, **최선수 분석**, **이후 수순**`);
  lines.push(`- **최선수 분석** 은 항상 포함. 엔진 라인을 따라가며 각 수의 구체적인 의도와 결과를 설명.`);
  lines.push(`- 섹션 헤더는 반드시 **헤더명** 형태. 새 줄에서 시작, 헤더 다음 줄바꿈 하나.`);
  lines.push(`- 본문 안에 다른 섹션 이름을 쓰지 말 것.`);
  lines.push(`- 실제 수 표기 사용 필수. "이 수", "해당 수" 금지.`);
  lines.push(`- 빈 말("승리의 기회를 높입니다", "기물의 발전을 돕는다") 금지 — 항상 구체적 이유 서술.`);
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
  const SYSTEM = `You are a Korean-language chess commentator in the style of the YouTube channel "체스인사이드 (ChessInside)".

WHAT THIS STYLE MEANS:
You watch the board like a coach reviewing a real game. You notice things — a pawn that's hard to defend, a bishop retreating to create rook tension, a knight that might get pushed away eventually. You say what you see, explain why it matters, and follow the consequences naturally. You do NOT use templates or repeat fixed phrases.

HOW TO COMMENT:
- Look at the actual position: which pawns are weak? which pieces are active? what tension exists?
- Describe what each move does in concrete terms. "d5 폰을 잡고 올라갑니다. 근데 이 폰은 지키기가 어려운 폰이라고 볼 수 있죠." / "비숍이 뒤쪽으로 빠지면서 룩 긴장이 생겨났고요." / "나이트의 위치가 나중에라도 밀려날 수 있다는 걸 고려하면 이 폰은 잡히는 게 어느 정도 기정사실이라고 할 수 있겠네요."
- When a sacrifice or counter-intuitive move is truly the best: explain the material exchange clearly and why the compensation is worth it.
- When a position is straightforward: just describe what's happening and the plan. No need to force dramatic phrases.
- Always use the actual move notation (cxd5, Nb3, Rf1 etc). Never say "이 수" or "해당 수".
- Keep it conversational: "~라고 볼 수 있죠", "~하는 거죠", "~하는 상황이라고 볼 수 있겠네요", "~고요", "~거든요".
- Never use hollow phrases like "기물의 발전을 돕는다", "상대방을 약화시킨다", "승리의 기회를 높입니다" without a specific concrete reason.
- Only use these section headers: **포지션 상황**, **약점 분석**, **강점 분석**, **위협 & 아이디어**, **최선수 분석**, **이후 수순**.
- Never output placeholders like <<_0>>. Never output numerical scores (cp, win%).
- Output ONLY in Korean. Chess move notation stays in English algebraic form.`;

  const prompt = buildCommentaryPrompt(ctx);
  return callGroqAPIWithSystem(SYSTEM, prompt, 900);
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
  const ctx = buildChessContext();
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
    // 체크메이트 즉시 감지 — API 호출 없이 클라이언트에서 바로 처리
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
Never use Japanese, Chinese characters, Arabic, or any non-Korean script.
Chess move notation (Nf3, e4, dxc4, O-O) stays in algebraic form.

MODEL YOUR OUTPUT after this Chesstempo-style format (translate to Korean):
  Idea: "White wants to win the knight: 21.Bxd5 exd5 22.Rxd5 Qe8 23.Rxd7 with a decisive advantage."
  Problem: "Black can play Qb6: 21.Bxd5 exd5 22.Rxd5 Qb6 and now White's plan fails — 23.Rxd7 Qxb2 decreasing White's advantage."
  Solution: "Playing Qa1 before Bxd5 solves the problem: 21.Qa1.. 22.Bxd5 exd5 23.Rxd5 Qb6 24.Rxd7 and 24...Qb2 does not capture the queen."

CRITICAL RULES:
- ${mover}의 관점에서만 분석. 차례가 아닌 쪽의 수를 **핵심 계획**에 쓰지 말 것.
- **핵심 계획**: ${mover}의 공격 아이디어. 구체적인 수 나열과 결과 포함. (예: "백은 Bxd5로 나이트를 잡으려 한다: Bxd5 exd5 Rxd5로 결정적 우위.")
- **문제점**: ${opponent}의 반격 수단과 그 수순. 즉승이 있으면 "즉각적인 결정타가 있어 문제점 없음."
- **최선책**: 문제점을 해결하는 ${mover}의 수순. 왜 그 수가 문제를 해결하는지 설명.
- 각 섹션마다 반드시 실제 수 표기(Bxd5, Qa1 등)를 포함할 것. 막연한 설명 금지.
- 체크메이트 수가 있으면 **핵심 계획**에 명시.

Output format — use EXACTLY these three section headers:
**핵심 계획:** (구체적 수 나열 포함, 1~2문장)
**문제점:** (상대 반격 수순 포함, 1~2문장)
**최선책:** (해결 수순 포함, 1~2문장)

Total response under 450 characters.`;

  const userMsg = [
    `현재 포지션을 분석해주세요.`,
    `차례: ${mover} — 반드시 ${mover}의 관점에서만 분석하세요.`,
    isMate  ? `⚠️ 엔진이 즉각 체크메이트 수를 발견했습니다: ${ctx.bestMove}` : '',
    isCheck && !isMate ? `엔진 최선수(체크): ${ctx.bestMove}` : '',
    !isCheck ? (ctx.bestMove ? `엔진 최선수: ${ctx.bestMove}${ctx.bestLine ? ' → ' + ctx.bestLine : ''}` : '') : '',
    ctx.lastMoveSan ? `방금 둔 수: ${ctx.lastMoveSan}` : '',
    ctx.pgnMoves    ? `기보: ${ctx.pgnMoves}` : '',
    `FEN: ${ctx.fen}`,
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
  const EXPLAIN_SYSTEM = `You are a Korean chess coach. Output ONLY in Korean (한국어).
Never use Japanese, Chinese characters, or non-Korean script.
Chess move notation (Nf3, e4, O-O) stays in English algebraic form.

The user wants to understand WHY a specific move is good. Give CONCRETE tactical/positional reasons — not vague ones.

BAD reasons (never use these): "기물의 발전을 방해합니다", "중앙을 장악할 수 있습니다", "상대방을 약화시킵니다"
GOOD reasons (like this):
  • 흑 퀸의 b2 위협(Qf6-b2)을 피합니다
  • a7 룩을 지원합니다
  • Bxd5 위협을 만들어냅니다
  • d1 룩을 지원합니다

For each reason, explain the SPECIFIC threat escaped, square controlled, piece supported, or tactic enabled.
If the move escapes a threat — name the exact threat (e.g. "Qb6-b2 퀸 침투를 차단").
If it creates a threat — name the exact follow-up (e.g. "Bxd5 포크를 위협").
If it supports a piece — name which piece on which square and why it matters.

Output format:
Line 1: "[수 표기]이/가 좋은 이유:" (예: "Qa1이 좋은 이유:")
Then list 3-4 bullet reasons, each starting with "• " followed by one concrete Korean sentence.
Keep total response under 300 characters.`;

  const focusMove = moves[focusIdx] || moves[0];
  const seq       = moves.slice(0, 5).join(' ');

  const userMsg = [
    `현재 포지션에서 엔진 최선 수순: ${seq}`,
    `그 중 ${focusIdx + 1}번째 수인 "${focusMove}"이/가 왜 좋은지 설명해주세요.`,
    `차례: ${ctx.turn === 'w' ? '백' : '흑'}`,
    ctx.lastMoveSan ? `직전 수: ${ctx.lastMoveSan}` : '',
    ctx.threatData?.prob ? `상대의 위협: ${ctx.threatData.prob}` : '',
    ctx.threatData?.idea ? `현재 계획: ${ctx.threatData.idea}` : '',
    `FEN: ${ctx.fen}`,
    `반드시 구체적인 위협명/칸/기물을 이용해 이유를 설명하세요. "기물 발전", "중앙 장악" 같은 막연한 표현 금지.`,
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