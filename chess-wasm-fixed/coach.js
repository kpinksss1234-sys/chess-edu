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
  document.getElementById('coach-panel').classList.add('open');
  document.getElementById('coach-fab').classList.add('hidden');
  document.getElementById('board-area').classList.add('coach-open');
  updateCoachContext();
}

function closeCoach() {
  coachOpen = false;
  document.getElementById('coach-panel').classList.remove('open');
  document.getElementById('coach-fab').classList.remove('hidden');
  document.getElementById('board-area').classList.remove('coach-open');
}

function toggleCoach() {
  if (coachOpen) closeCoach(); else openCoach();
}

// 현재 포지션 컨텍스트 업데이트 (패널 상단 요약)
function updateCoachContext() {
  const ctx = document.getElementById('coach-context-display');
  if (!ctx) return;
  const context = buildChessContext();
  if (!context) { ctx.style.display = 'none'; return; }

  ctx.style.display = 'flex';
  ctx.innerHTML = `
    <span class="ctx-tag">차례: ${context.turn === 'w' ? '⬜백' : '⬛흑'}</span>
    ${context.bestMove ? `<span class="ctx-tag green">추천수: ${context.bestMove}</span>` : ''}
    ${context.evaluation ? `<span class="ctx-tag">평가: ${context.evaluation}</span>` : ''}
    ${context.lastMove ? `<span class="ctx-tag">마지막 수: ${context.lastMove}</span>` : ''}
    ${context.depth ? `<span class="ctx-tag">분석 깊이: d${context.depth}</span>` : ''}
  `;
}

// 체스 컨텍스트 데이터 빌드
function buildChessContext() {
  if (!game) return null;

  const turn = game.turn;
  const fen = boardToFen(game.board, game.turn, game.castling, game.enPassant, game.halfMove, game.fullMove);

  // 엔진 최선수 (pvData에서)
  const pv1 = pvData && pvData[1];
  const pv2 = pvData && pvData[2];
  const bestMove = pv1 && pv1.moves && pv1.moves[0] ? pv1.moves[0] : null;
  const bestLine = pv1 && pv1.moves ? pv1.moves.slice(0, 6).join(' ') : null;
  const altLine  = pv2 && pv2.moves ? pv2.moves.slice(0, 4).join(' ') : null;
  const evaluation = pv1 ? pv1.eval : null;
  const depth = pv1 ? pv1.depth : null;
  const cpFromWhite = pv1 ? pv1.cpFromWhite : null;

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

  // 이전 포지션의 엔진 최선수 (내가 둔 수와 비교)
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
          const prevTurn = prevFen.split(' ')[1] || 'w';
          const prevCast = parseFenCastling(prevFen.split(' ')[2] || '-');
          const prevEP = parseFenEP(prevFen.split(' ')[3] || '-');
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
  game.history.forEach((s, i) => {
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

  return {
    turn, fen, bestMove, bestLine, altLine, evaluation, depth, cpFromWhite,
    lastMove, lastMoveSan, lastMoveAnnotation,
    engineBestForPrevPos, engineLineForPrevPos,
    pgnMoves: pgnMoves.trim(),
    phase, moveCount, advantageDesc,
  };
}

// 빠른 질문 버튼
function askQuick(question) {
  document.getElementById('coach-input').value = question;
  askCoach();
}

// 엔터 키로 질문 제출
function setupCoachKeyboard() {
  const input = document.getElementById('coach-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askCoach();
    }
  });
}

// AI 코치 질문 실행
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

  const responseDiv = document.getElementById('coach-response');
  responseDiv.style.display = 'flex';
  responseDiv.className = 'loading';
  responseDiv.innerHTML = `<div class="coach-dots"><span></span><span></span><span></span></div> AI 코치가 분석 중입니다...`;

  updateCoachContext();

  try {
    const prompt = buildCoachPrompt(context, userQuestion);
    const answer = await callAnthropicAPI(prompt);
    responseDiv.className = '';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = formatCoachResponse(answer);
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

// 코치 컨텍스트 빌드
function buildCoachPrompt(ctx, question) {
  const lines = [];

  lines.push(`아래 체스 포지션 데이터를 바탕으로 질문에 한국어로 답변해 주세요.`);
  lines.push(``);
  lines.push(`[포지션 데이터]`);
  lines.push(`게임 단계: ${ctx.phase} | 진행 수: ${ctx.moveCount}수 | 차례: ${ctx.turn === 'w' ? '백(White)' : '흑(Black)'}`);

  if (ctx.lastMoveSan) {
    const ann = ctx.lastMoveAnnotation ? ` (${ctx.lastMoveAnnotation})` : '';
    lines.push(`방금 둔 수: ${ctx.lastMoveSan}${ann}`);
  }

  if (ctx.engineBestForPrevPos && ctx.lastMoveSan && ctx.engineBestForPrevPos !== ctx.lastMoveSan) {
    lines.push(`엔진 추천수: ${ctx.engineBestForPrevPos}${ctx.engineLineForPrevPos ? ' → ' + ctx.engineLineForPrevPos : ''}`);
    lines.push(`→ 실제 둔 수(${ctx.lastMoveSan})와 엔진 추천수(${ctx.engineBestForPrevPos})가 다릅니다. 반드시 이 두 수의 전략적 차이를 비교해 주세요.`);
  } else if (ctx.engineBestForPrevPos && ctx.lastMoveSan && ctx.engineBestForPrevPos === ctx.lastMoveSan) {
    lines.push(`엔진 추천수: ${ctx.engineBestForPrevPos} ✓ (실제 둔 수와 동일)`);
  }

  if (ctx.bestMove) {
    lines.push(`현재 포지션 최선수: ${ctx.bestMove}${ctx.bestLine ? ' → ' + ctx.bestLine : ''}`);
  }
  if (ctx.altLine) {
    lines.push(`2순위 대안: ${ctx.altLine}`);
  }
  if (ctx.pgnMoves) {
    lines.push(`전체 기보: ${ctx.pgnMoves}`);
  }

  lines.push(``);
  lines.push(`[사용자 질문]`);
  lines.push(question);
  lines.push(``);
  lines.push(`위 데이터를 참고하여, 반드시 **전략 / 계획 / 목표** 구조로 한국어 답변을 작성하세요.`);

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════
// 위협 분석 패널
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
    // 패널을 열 때 분석 실행
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
  if (fenKey === lastThreatFen) return; // 동일 포지션 방지

  const panel = document.getElementById('threat-panel');
  const contentEl = document.getElementById('threat-content');
  panel.style.display = 'block';
  contentEl.innerHTML = '<div class="threat-loading">⚡ 위협 분석 중...</div>';
  threatLoading = true;
  lastThreatFen = fenKey;

  try {
    const answer = await callThreatAPI(ctx);
    const cleaned = cleanKorean(answer);
    renderThreatPanel(cleaned);
  } catch(e) {
    document.getElementById('threat-content').innerHTML =
      `<div class="threat-loading" style="color:var(--accent-red)">분석 실패: ${e.message}</div>`;
    lastThreatFen = ''; // 오류 시 재시도 허용
  } finally {
    threatLoading = false;
  }
}

async function callThreatAPI(ctx) {
  const THREAT_SYSTEM = `You are a Korean chess analyst. Output ONLY in Korean (한국어).
Never use Japanese, Chinese characters, Arabic, or any non-Korean script.
Chess move notation (Nf3, e4, dxc4, O-O) stays in algebraic form.

Output format — use EXACTLY these three section headers:
**핵심 계획:** (백/흑의 주요 위협과 공격 아이디어 1~2문장)
**문제점:** (상대방이 대응할 수 있는 반격 또는 방어 수단 1~2문장)
**최선책:** (최선의 대응 수순 또는 해결책 1~2문장. 구체적인 수를 포함할 것)

Keep each section to 1-2 sentences. Total response under 300 characters.`;

  const userMsg = [
    `현재 포지션을 분석해주세요.`,
    `차례: ${ctx.turn === 'w' ? '백(White)' : '흑(Black)'}`,
    ctx.lastMoveSan ? `방금 둔 수: ${ctx.lastMoveSan}` : '',
    ctx.bestMove ? `엔진 최선수: ${ctx.bestMove}${ctx.bestLine ? ' → ' + ctx.bestLine : ''}` : '',
    ctx.pgnMoves ? `기보: ${ctx.pgnMoves}` : '',
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
        { role: 'user',   content: userMsg }
      ],
    })
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
    { key: '핵심 계획',  cls: 'idea',  icon: '💡', labelCls: 'threat-label-idea' },
    { key: '문제점',     cls: 'prob',  icon: '⚠️', labelCls: 'threat-label-prob' },
    { key: '최선책',     cls: 'sol',   icon: '✅', labelCls: 'threat-label-sol'  },
  ];

  // 섹션 파싱: **키:** 패턴으로 분리
  const parsed = {};
  // **핵심 계획:** ... **문제점:** ... **최선책:** ... 형태로 파싱
  const allKeys = ['핵심 계획', '문제점', '최선책'];
  let remaining = text;
  for (let ki = 0; ki < allKeys.length; ki++) {
    const key = allKeys[ki];
    const nextKey = allKeys[ki + 1];

    // 정규표현식 이스케이프 및 생성 (\\s로 수정)
    const keyPattern = new RegExp('\\*\\*' + key + '[:\\s：]*\\*\\*|\\*\\*' + key + '\\*\\*');
    const startIdx = remaining.search(keyPattern);
    if (startIdx < 0) continue;

    // 헤더가 끝나는 지점 찾기
    const headerMatch = remaining.slice(startIdx).match(keyPattern);
    const bodyFrom = startIdx + headerMatch[0].length;

    // 다음 키 위치를 찾아 본문의 끝(bodyEnd) 설정
    let bodyEnd = remaining.length;
    if (nextKey) {
        const nextKeyPattern = new RegExp('\\*\\*' + nextKey);
        const nextIdx = remaining.slice(bodyFrom).search(nextKeyPattern);
        if (nextIdx >= 0) {
            bodyEnd = bodyFrom + nextIdx;
        }
    }

    // 결과 저장 및 정돈
    parsed[key] = remaining.slice(bodyFrom, bodyEnd).trim().replace(/^[:：\s]+/, '').trim();
}

  if (Object.keys(parsed).length === 0) {
    // 파싱 실패 시 원문 표시
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
      // 체스 수 표기 강조
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

// ── 한국어 후처리: 비한국어 문자 제거 ────────────────────────
function cleanKorean(text) {
  if (!text) return text;
  return text
    // 일본어 히라가나/가타카나 제거
    .replace(/[\u3040-\u309F\u30A0-\u30FF]+/g, '')
    // CJK 한자 (한국어 한자 아닌 일본어/중국어식 표현 제거 — 완전 제거)
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]+/g, '')
    // 아랍어 제거
    .replace(/[\u0600-\u06FF]+/g, '')
    // 태국어, 힌디 등 기타 스크립트
    .replace(/[\u0E00-\u0E7F\u0900-\u097F]+/g, '')
    // 연속 공백 정리
    .replace(/  +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ══════════════════════════════════════════════════════
// 최선수 설명 패널 (Explaining the next best moves)
// ══════════════════════════════════════════════════════
let bestExplainLoading = false;
let lastBestExplainFen = '';
let bestExplainMoves = []; // 현재 표시 중인 수순
let bestExplainFocusIdx = 0; // 선택된 수 인덱스

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
  // pvData에서 최선 라인 가져오기
  const pv = pvData[1];
  if (!pv || !pv.moves || pv.moves.length === 0) return;

  const fenKey = ctx.fen;
  if (fenKey === lastBestExplainFen && focusIdx === undefined) return;

  bestExplainLoading = true;
  lastBestExplainFen = fenKey;
  bestExplainFocusIdx = focusIdx ?? 0;
  bestExplainMoves = pv.moves.slice(0, 6);

  const panel = document.getElementById('best-explain-panel');
  panel.style.display = 'block';

  // 수순 바 렌더 (로딩 중에도 표시)
  renderBestSeqBar(bestExplainMoves, bestExplainFocusIdx, ctx);

  document.getElementById('best-explain-content').innerHTML =
    '<div class="threat-loading">📖 최선수 분석 중...</div>';

  try {
    const focusMove = bestExplainMoves[bestExplainFocusIdx] || bestExplainMoves[0];
    const answer = await callBestExplainAPI(ctx, bestExplainMoves, bestExplainFocusIdx);
    const cleaned = cleanKorean(answer);
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

  let html = '';
  let moveNum = ctx.fullMove || 1;
  let turn = ctx.turn; // 'w' or 'b'

  moves.forEach((san, i) => {
    // 수번호 표시
    if (turn === 'w' || i === 0) {
      html += `<span class="best-seq-num">${moveNum}${turn === 'b' && i === 0 ? '...' : '.'}</span>`;
      if (turn === 'w') {}
    }
    // 기물 아이콘 추출
    let pieceCode = null;
    const color = turn;
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

The user wants to understand why a specific move is good.
Output format:
Line 1: "[수 표기]이/가 좋은 이유:" (예: "Qa1이 좋은 이유:")
Then list 3-4 bullet reasons, each starting with "• " followed by a short Korean sentence.
Each reason should be 1 sentence, about a chess concept (escape threat, control center, support piece, create threat, etc.)
Keep total response under 250 characters.`;

  const focusMove = moves[focusIdx] || moves[0];
  const seq = moves.slice(0, 5).join(' ');

  const userMsg = [
    `현재 포지션에서 엔진 최선 수순: ${seq}`,
    `그 중 ${focusIdx + 1}번째 수인 "${focusMove}"이/가 왜 좋은지 설명해주세요.`,
    `차례: ${ctx.turn === 'w' ? '백' : '흑'}`,
    ctx.lastMoveSan ? `직전 수: ${ctx.lastMoveSan}` : '',
    `FEN: ${ctx.fen}`,
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
        { role: 'user',   content: userMsg }
      ],
    })
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

  // 첫 줄 타이틀 추출
  const lines = escaped.split('\n').map(l => l.trim()).filter(Boolean);
  let titleLine = '';
  const reasonLines = [];

  for (const line of lines) {
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('·') || line.match(/^\d+\./)) {
      const txt = line.replace(/^[•\-·]\s*/, '').replace(/^\d+\.\s*/, '');
      reasonLines.push(txt);
    } else if (!titleLine) {
      titleLine = line;
    }
  }

  // 기물 아이콘
  const color = ctx.turn;
  let pieceCode = null;
  if (focusMove === 'O-O' || focusMove === 'O-O-O') pieceCode = color + 'K';
  else if (focusMove && 'NBRQK'.includes(focusMove[0])) pieceCode = color + focusMove[0];
  else pieceCode = color + 'P';
  const imgTag = `<img src="${pieceImg(pieceCode)}" style="width:16px;height:16px;vertical-align:middle;margin-right:2px;">`;

  // 이유 색상 순환
  const iconClasses = ['reason-positive','reason-neutral','reason-good','reason-warning'];

  let html = `<div class="best-explain-title"><span class="be-move">${imgTag}${focusMove}</span>이/가 좋은 이유:</div>`;
  html += '<div class="best-reason-list">';

  if (reasonLines.length > 0) {
    reasonLines.slice(0, 4).forEach((reason, i) => {
      const cls = iconClasses[i % iconClasses.length];
      html += `<div class="best-reason-item">
        <div class="best-reason-icon ${cls}"></div>
        <span>${reason.replace(/(O-O-O|O-O|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8][+#=]?)/g, '<strong>$1</strong>')}</span>
      </div>`;
    });
  } else {
    // 파싱 실패 시 전체 텍스트
    html += `<div class="best-reason-item"><div class="best-reason-icon reason-positive"></div><span>${escaped}</span></div>`;
  }

  html += '</div>';
  contentEl.innerHTML = html;
}

// Groq API 호출
async function callAnthropicAPI(userContent) {
  const SYSTEM_PROMPT = `You are a Korean-language chess coach. You must ALWAYS respond in Korean only.

LANGUAGE RULES (CRITICAL):
- Output language: Korean (한국어) ONLY. No Japanese, Chinese, Arabic, or any other language.
- Chess move notation (e.g. Nf3, e4, O-O, dxc4) stays in English/algebraic form.
- All other text must be in Korean. If a word mixes Japanese/Chinese characters, replace it with Korean.

ANSWER FORMAT — follow this exact structure for ALL questions:

**전략:** (1~2문장: 이 수/포지션의 전략적 의도를 체스 개념으로 설명)
**계획:** (2~3문장: 구체적인 후속 수순이나 기물 배치 계획. 수 표기 포함)
**목표:** (1~2문장: 이 전략이 달성하려는 최종 목표. 상대방의 위협 또는 기회도 언급)

CONTENT RULES:
1. 수치(cp, 평가 점수, 숫자)는 절대 사용하지 마세요. 대신 '중앙 장악', '기물 활동성', '왕의 안전', '폰 구조', '주도권', '공간적 우위' 같은 개념어를 사용하세요.
2. 엔진 추천수와 실제 둔 수가 다르면, 두 수의 전략적 차이를 **계획** 항목에서 비교하세요.
3. 이 수를 두지 않으면 상대에게 어떤 기회가 생기는지 반드시 **목표** 항목에 포함하세요.
4. 전체 답변은 250~400자 내외로 작성하세요.
5. 입문자도 이해할 수 있도록 쉽고 친근하게 설명하세요.

EXAMPLE OUTPUT (follow this format exactly):
**전략:** Nf3은 중앙의 통제를 강화하고 킹사이드 캐슬링을 준비하는 수입니다.
**계획:** 이후 e3, Bd3 순서로 비숍을 활성화하고, O-O로 왕의 안전을 확보합니다. 상대가 d5를 밀면 cxd5로 교환하여 폰 구조를 단순화할 수 있습니다.
**목표:** 중앙에서 안정적인 기물 활동성을 확보하는 것이 목표입니다. 이 수를 두지 않으면 상대가 e4를 선점하여 중앙 주도권을 가져갑니다.`;

  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 800,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent }
      ],
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '응답을 받지 못했습니다.';
  return cleanKorean(raw);
}

// 응답 텍스트 포맷팅: **전략/계획/목표** 구조를 카드 형태로 렌더링
function formatCoachResponse(text) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // **전략:**, **계획:**, **목표:** 섹션 감지 → 카드 렌더링
  const sectionRegex = /\*\*(전략|계획|목표|strategy|plan|goal)[:\s：]\*\*\s*/gi;
  if (sectionRegex.test(escaped)) {
    const ICONS = { '전략': '🎯', '계획': '📋', '목표': '🏆', 'strategy': '🎯', 'plan': '📋', 'goal': '🏆' };
    const sections = escaped.split(/(?=\*\*(전략|계획|목표)[:\s：]\*\*)/i);
    let html = '';
    for (const sec of sections) {
      const m = sec.match(/^\*\*(전략|계획|목표)[:\s：]\*\*\s*(.*)/is);
      if (m) {
        const label = m[1];
        const body  = m[2].trim()
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
        const icon  = ICONS[label] || '•';
        html += `<div class="coach-section">
          <div class="coach-section-label">${icon} ${label}</div>
          <div class="coach-section-body">${body}</div>
        </div>`;
      } else if (sec.trim()) {
        // 섹션 헤더 없는 일반 텍스트
        html += `<p class="coach-plain">${sec.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</p>`;
      }
    }
    return html || formatCoachPlain(escaped);
  }
  return formatCoachPlain(escaped);
}

function formatCoachPlain(escaped) {
  return escaped
    .replace(/\n\n/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

document.addEventListener('DOMContentLoaded', init);


function toggleMobilePanel(forceClose) {
  const panel    = document.getElementById('right-panel');
  const backdrop = document.getElementById('mobile-panel-backdrop');
  const iconOpen  = document.getElementById('mpanel-icon-open');
  const iconClose = document.getElementById('mpanel-icon-close');
  const isOpen = panel.classList.contains('mobile-open');
  const shouldOpen = forceClose === false ? false : !isOpen;
  panel.classList.toggle('mobile-open', shouldOpen);
  backdrop.classList.toggle('show', shouldOpen);
  iconOpen.style.display  = shouldOpen ? 'none'  : '';
  iconClose.style.display = shouldOpen ? ''       : 'none';
}
