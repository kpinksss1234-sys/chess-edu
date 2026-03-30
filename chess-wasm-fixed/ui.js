// ===== UI FUNCTIONS =====
let game;

function init() {
  game = new ChessGame();
  setupKeyboard();
  initEngine();
  loadApiKey();
  setupCoachKeyboard();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    const tabs = ['analysis','pgn','settings'];
    b.classList.toggle('active', tabs[i]===tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'pgn') setTimeout(loadSavedGames, 150);
}

function loadPGN() {
  const pgn = document.getElementById('pgn-input').value.trim();
  if (!pgn) { showToast('PGN을 입력하세요'); return; }
  try {
    game.parsePGN(pgn);
    showToast('PGN 불러오기 완료');
    switchTab('analysis');

    // ── 내 색상 자동 감지 ─────────────────────────────────────────────
    // 로그인 유저 이름과 PGN 헤더의 White/Black 이름을 비교
    _autoDetectMyColor();

    // PGN 로드 후 전체 포지션 백그라운드 분석 시작
    setTimeout(() => startBgAnalysis(), 500);
  } catch(e) {
    showToast('PGN 파싱 오류: ' + e.message);
    console.error(e);
  }
}

function _autoDetectMyColor() {
  const sel = document.getElementById('my-color-select');
  if (!sel) return;
  const white = (document.getElementById('info-white')?.textContent || '').toLowerCase().trim();
  const black  = (document.getElementById('info-black')?.textContent  || '').toLowerCase().trim();
  if (!white && !black) return;
  // 로그인 유저 식별자
  const user = window._currentUser;
  if (!user) return;
  const displayName = (user.displayName || '').toLowerCase();
  const emailUser   = (user.email || '').split('@')[0].toLowerCase();
  const candidates  = [displayName, emailUser].filter(Boolean);
  const matchesWhite = candidates.some(n => white.includes(n) || n.includes(white));
  const matchesBlack = candidates.some(n => black.includes(n)  || n.includes(black));
  if (matchesWhite && !matchesBlack) { sel.value = 'w'; }
  else if (matchesBlack && !matchesWhite) { sel.value = 'b'; }
  // 둘 다 매치되거나 없으면 현재 값 유지
}

function exportPGN() {
  let moves = '';
  game.history.forEach((s,i) => {
    if (s.turn==='w') moves += `${s.fullMove}. `;
    moves += s.san + ' ';
  });
  document.getElementById('pgn-input').value = moves.trim();
  switchTab('pgn');
}

function copyPGN() {
  exportPGN();
  const pgn = document.getElementById('pgn-input').value;
  navigator.clipboard.writeText(pgn).then(()=>showToast('클립보드에 복사됨'));
}

async function savePGN() {
  if (!window._fbDb)        { showToast('Firebase 연결 필요'); return; }
  if (!window._currentUser) { showToast('로그인이 필요합니다'); return; }
  exportPGN();
  const pgn = document.getElementById('pgn-input').value.trim();
  if (!pgn) { showToast('저장할 게임이 없습니다'); return; }
  const white   = document.getElementById('info-white')?.textContent   || '-';
  const black   = document.getElementById('info-black')?.textContent   || '-';
  const date    = document.getElementById('info-date')?.textContent    || '-';
  const result  = document.getElementById('info-result')?.textContent  || '*';
  const opening = document.getElementById('info-opening')?.textContent || '-';

  // 내 색상: 선택된 값 또는 기본값 'w'
  const myColorSel = document.getElementById('my-color-select');
  const myColor = myColorSel ? myColorSel.value : 'w';

  const btn = document.getElementById('btn-save-pgn');
  if (btn) { btn.disabled=true; btn.textContent='저장 중...'; }
  try {
    const baseData = {
      uid: window._currentUser.uid,
      title: `${white} vs ${black}`,
      pgn, white, black, date, result, opening,
      moveCount: game.history.length,
      savedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    // ── 기존 saved_pgns 컬렉션 저장 (하위 호환) ─────────────────────
    await window._fbDb.collection('saved_pgns').add(baseData);

    // ── game_records 컬렉션에도 저장 → records.html에서 표시됨 ────────
    // PGN에서 날짜를 파싱해 playedAt 구성 (가능하면)
    let playedAtVal = firebase.firestore.FieldValue.serverTimestamp();
    if (date && date !== '-' && date !== '??') {
      const parsed = new Date(date.replace(/\./g, '-'));
      if (!isNaN(parsed.getTime())) playedAtVal = firebase.firestore.Timestamp.fromDate(parsed);
    }

    const myName = myColor === 'w' ? white : black;
    const oppName = myColor === 'w' ? black : white;

    await window._fbDb.collection('game_records').add({
      uid:         window._currentUser.uid,
      pgn,
      result,
      myColor,
      whiteName:   white,
      blackName:   black,
      opening,
      moveCount:   game.history.length,
      source:      'pgn_import',        // 어디서 저장됐는지 식별
      playedAt:    playedAtVal,
      savedAt:     firebase.firestore.FieldValue.serverTimestamp(),
    });

    showToast('✓ 게임이 저장되었습니다 (기보 기록에서 확인)');
    loadSavedGames();
  } catch(e) {
    showToast('저장 실패: ' + e.message);
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='저장'; }
  }
}

async function loadSavedGames() {
  const listEl = document.getElementById('saved-games-list');
  if (!listEl) return;
  if (!window._fbDb || !window._currentUser) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0;">로그인 후 이용 가능합니다</div>';
    return;
  }
  listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">불러오는 중...</div>';
  const render = (docs) => {
    if (!docs.length) { listEl.innerHTML='<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0;">저장된 게임이 없습니다</div>'; return; }
    listEl.innerHTML='';
    docs.forEach(doc => {
      const d=doc.data();
      const dateStr=d.savedAt?new Date(d.savedAt.seconds*1000).toLocaleDateString('ko-KR'):'—';
      const item=document.createElement('div');
      item.className='saved-game-item';
      item.innerHTML=`
        <div class="saved-game-title">${d.title||'제목 없음'}</div>
        <div class="saved-game-meta"><span>${d.result||'*'} · ${d.moveCount||0}수</span><span>${dateStr}</span></div>
        <div class="saved-game-actions">
          <button class="saved-game-btn" onclick="loadSavedPGN('${doc.id}')">불러오기</button>
          <button class="saved-game-btn del" onclick="deleteSavedPGN('${doc.id}',this)">삭제</button>
        </div>`;
      listEl.appendChild(item);
    });
  };
  try {
    const snap=await window._fbDb.collection('saved_pgns').where('uid','==',window._currentUser.uid).orderBy('savedAt','desc').limit(30).get();
    const docs=[]; snap.forEach(d=>docs.push(d)); render(docs);
  } catch(e) {
    try {
      const snap2=await window._fbDb.collection('saved_pgns').where('uid','==',window._currentUser.uid).limit(30).get();
      const docs2=[]; snap2.forEach(d=>docs2.push(d));
      docs2.sort((a,b)=>(b.data().savedAt?.seconds||0)-(a.data().savedAt?.seconds||0));
      render(docs2);
    } catch(e2) { listEl.innerHTML='<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">불러오기 실패</div>'; }
  }
}

async function loadSavedPGN(docId) {
  try {
    const doc=await window._fbDb.collection('saved_pgns').doc(docId).get();
    if(!doc.exists){showToast('게임을 찾을 수 없습니다');return;}
    document.getElementById('pgn-input').value=doc.data().pgn;
    loadPGN(); showToast('게임을 불러왔습니다');
  } catch(e){showToast('불러오기 실패');}
}

async function deleteSavedPGN(docId,btn) {
  try {
    await window._fbDb.collection('saved_pgns').doc(docId).delete();
    btn.closest('.saved-game-item')?.remove();
    showToast('삭제되었습니다');
    if(!document.querySelector('.saved-game-item'))
      document.getElementById('saved-games-list').innerHTML='<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0;">저장된 게임이 없습니다</div>';
  } catch(e){showToast('삭제 실패');}
}

function setTheme(name) {
  game.currentTheme = name;
  game.renderBoard();
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.theme===name);
  });
}

function setPieceStyle(style, btn) {
  currentPieceStyle = style;
  document.querySelectorAll('.piece-style-btn').forEach(b=>b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
  game.renderBoard();
  showToast(`기물 스타일: ${style}`);
}

function toggleCoords(el) {
  el.classList.toggle('on');
  game.showCoords = el.classList.contains('on');
  game.renderBoard();
}

function toggleHighlight(el) {
  el.classList.toggle('on');
  game.showHighlight = el.classList.contains('on');
  game.renderBoard();
}

function toggleEvalBar(el) {
  el.classList.toggle('on');
  const show = el.classList.contains('on');
  document.getElementById('eval-bar-wrap').style.display = show ? 'block' : 'none';
}

function toggleAutoAnalyze(el) {
  el.classList.toggle('on');
  autoAnalyze = el.classList.contains('on');
  if (autoAnalyze) { reanalyzeWithSettings(); }
}

function setMultiPV(val) {
  multiPV = parseInt(val);
  reanalyzeWithSettings();
}

function setAnalysisTime(val) {
  analysisTime = parseInt(val);
  reanalyzeWithSettings();
}

function setAnalysisDepth(val) {
  analysisDepth = parseInt(val);
  reanalyzeWithSettings();
}

function toggleColorMode() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-color-mode')==='dark';
  root.setAttribute('data-color-mode', isDark?'light':'dark');
  if (isDark) {
    document.documentElement.style.setProperty('--bg-primary','#f5f5f0');
    document.documentElement.style.setProperty('--bg-secondary','#e8e8e0');
    document.documentElement.style.setProperty('--bg-tertiary','#dcdcd4');
    document.documentElement.style.setProperty('--bg-card','#f0f0e8');
    document.documentElement.style.setProperty('--bg-hover','#d0d0c8');
    document.documentElement.style.setProperty('--border','#c0c0b8');
    document.documentElement.style.setProperty('--border-light','#b0b0a8');
    document.documentElement.style.setProperty('--text-primary','#1a1a1a');
    document.documentElement.style.setProperty('--text-secondary','#444444');
    document.documentElement.style.setProperty('--text-muted','#888888');
  } else {
    document.documentElement.style.setProperty('--bg-primary','#1a1a1a');
    document.documentElement.style.setProperty('--bg-secondary','#242424');
    document.documentElement.style.setProperty('--bg-tertiary','#2d2d2d');
    document.documentElement.style.setProperty('--bg-card','#1e1e1e');
    document.documentElement.style.setProperty('--bg-hover','#333333');
    document.documentElement.style.setProperty('--border','#3a3a3a');
    document.documentElement.style.setProperty('--border-light','#444444');
    document.documentElement.style.setProperty('--text-primary','#e8e8e8');
    document.documentElement.style.setProperty('--text-secondary','#a0a0a0');
    document.documentElement.style.setProperty('--text-muted','#666666');
  }
  showToast(isDark?'라이트 모드':'다크 모드');
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 착수 사운드 시스템 — mp3 파일 기반
// ═══════════════════════════════════════════════════════════

// 사운드: AudioContext + AudioBuffer 방식 (cloneNode 누수 방지)
const _soundFiles = {
  move:       'sound/chess_move.mp3',
  capture:    'sound/chess_capture.mp3',
  castle:     'sound/chess_castle.mp3',
  check:      'sound/chess_check.mp3',
  checkmate:  'sound/chess_checkmate.mp3',
  stalemate:  'sound/chess_stalemate.mp3',
};
const _audioCtx = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return null; }
})();
const _soundBuffers = {};  // AudioBuffer 캐시 (decode once, play many times)

// 페이지 로드 시 AudioBuffer로 미리 디코딩
(function preloadSounds() {
  if (!_audioCtx) return;
  for (const [key, src] of Object.entries(_soundFiles)) {
    fetch(src)
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
      .then(buf => _audioCtx.decodeAudioData(buf))
      .then(decoded => { _soundBuffers[key] = decoded; })
      .catch(() => {});
  }
})();

function _playSound(type) {
  if (_soundMuted) return;
  const ctx = _audioCtx;
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  if (type === 'nav') {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    const osc = ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 480;
    osc.connect(g); g.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.055);
    return;
  }

  const buf = _soundBuffers[type];
  if (!buf) return;
  // BufferSource는 일회용이지만 AudioBuffer 자체는 재사용 — cloneNode 불필요
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(now);
}

// move 객체와 착수 전 보드/턴을 받아 적절한 사운드 재생
// histState: history 레코드 (fenBefore/fenAfter/castling/captured 포함) — boardBefore null 시 FEN 복원
function playMoveSound(move, boardBefore, turn, histState) {
  if (_soundMuted || !move) return;

  // ── 1. boardBefore 복원 ──────────────────────────────────────
  let board = boardBefore;
  let castlingBefore = { wK:true, wQ:true, bK:true, bQ:true };
  let epBefore = null;
  if (!board && histState && histState.fenBefore) {
    const fp = histState.fenBefore.split(' ');
    board          = parseFenBoard(fp[0]);
    castlingBefore = parseFenCastling(fp[2] || '-');
    epBefore       = parseFenEP(fp[3] || '-');
  } else if (board && histState && histState.fenBefore) {
    // board는 있지만 castling/ep 정보도 fenBefore에서 보완
    const fp = histState.fenBefore.split(' ');
    castlingBefore = parseFenCastling(fp[2] || '-');
    epBefore       = parseFenEP(fp[3] || '-');
  }

  // ── 2. 캡처 여부 판단 ────────────────────────────────────────
  // 우선순위: move.enPassant > board[to] > histState.captured
  const isCapture = !!(
    move.enPassant ||
    (board && board[move.to[0]][move.to[1]]) ||
    (histState && histState.captured)
  );

  // ── 3. board가 있으면 정밀 판단 (check/checkmate/stalemate) ──
  if (board) {
    const boardAfter = applyMoveToBoard(board.map(r=>[...r]), move, turn);
    const enemy = turn === 'w' ? 'b' : 'w';
    const inCheck = isInCheck(boardAfter, enemy);

    const castAfter = { ...castlingBefore };
    if (board[move.from[0]][move.from[1]] === `${turn}K`) {
      if (turn === 'w') { castAfter.wK = false; castAfter.wQ = false; }
      else              { castAfter.bK = false; castAfter.bQ = false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castAfter.wK = false;
    if (move.from[0]===7&&move.from[1]===0) castAfter.wQ = false;
    if (move.from[0]===0&&move.from[1]===7) castAfter.bK = false;
    if (move.from[0]===0&&move.from[1]===0) castAfter.bQ = false;
    const epAfter = move.doublePush ? [move.to[0]-(turn==='w'?-1:1), move.to[1]] : null;
    const noMoves = getAllLegalMoves(boardAfter, enemy, castAfter, epAfter).length === 0;

    if      (inCheck && noMoves)  _playSound('checkmate');
    else if (!inCheck && noMoves) _playSound('stalemate');
    else if (inCheck)             _playSound('check');
    else if (move.castle)         _playSound('castle');
    else if (isCapture)           _playSound('capture');
    else                          _playSound('move');
    return;
  }

  // ── 4. board 복원 실패 → fenAfter로 check/checkmate/stalemate 판단 ──
  if (histState && histState.fenAfter) {
    const fp2 = histState.fenAfter.split(' ');
    const boardAfter2 = parseFenBoard(fp2[0]);
    const enemy = turn === 'w' ? 'b' : 'w';
    if (boardAfter2) {
      const inCheck2 = isInCheck(boardAfter2, enemy);
      const cast2 = parseFenCastling(fp2[2] || '-');
      const ep2   = parseFenEP(fp2[3] || '-');
      const noMoves2 = getAllLegalMoves(boardAfter2, enemy, cast2, ep2).length === 0;
      if      (inCheck2 && noMoves2)  { _playSound('checkmate'); return; }
      else if (!inCheck2 && noMoves2) { _playSound('stalemate'); return; }
      else if (inCheck2)              { _playSound('check');     return; }
    }
  }

  // ── 5. 최후 fallback ─────────────────────────────────────────
  _playSound(move.castle ? 'castle' : isCapture ? 'capture' : 'move');
}

function setupKeyboard() {
  // 보드 우클릭 컨텍스트 메뉴 방지
  document.getElementById('chessboard')?.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return;

    // ── 엔진라인 탐색 중: 방향키로 수 이동 ──
    if (game && game.enginePreview) {
      const ep = game.enginePreview;
      const lines = game.enginePreviews[ep.histIdx] || [];
      const line = lines.find(l => l.pvIdx === ep.pvIdx);
      if (!line) return;

      const totalMoves = line.moves.length;
      const extraMoves = line.extraMoves || [];
      const totalExtra = extraMoves.length;
      const activeIdx = ep.activeIdx ?? -1;
      const extraIdx  = ep.extraMoveIdx ?? -1;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (extraIdx >= 0) {
          if (extraIdx < totalExtra - 1) { game._applyEngineLineExtra(ep.histIdx, ep.pvIdx, extraIdx + 1); }
        } else if (activeIdx < totalMoves - 1) {
          game._applyEngineLine(ep.histIdx, ep.pvIdx, activeIdx + 1);
        } else if (totalExtra > 0 && activeIdx === totalMoves - 1) {
          game._applyEngineLineExtra(ep.histIdx, ep.pvIdx, 0);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (extraIdx >= 1) {
          game._applyEngineLineExtra(ep.histIdx, ep.pvIdx, extraIdx - 1);
        } else if (extraIdx === 0) {
          game._applyEngineLine(ep.histIdx, ep.pvIdx, totalMoves - 1);
        } else if (activeIdx > 0) {
          game._applyEngineLine(ep.histIdx, ep.pvIdx, activeIdx - 1);
        } else if (activeIdx === 0) {
          game.enginePreview = null;
          _engineLineAnalysisFen = null;
          game._applyHistState(ep.histIdx);
          game.historyIndex = ep.histIdx;
          game.renderBoard(); game.renderMoveList(); game.updateStatus(); analyzePosition(true);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        game.enginePreview = null;
        _engineLineAnalysisFen = null;
        game._applyHistState(ep.histIdx);
        game.historyIndex = ep.histIdx;
        game.renderBoard(); game.renderMoveList(); game.updateStatus(); analyzePosition(true);
        return;
      }
    }

    if (e.key==='ArrowLeft')  game.prevMove();
    if (e.key==='ArrowRight') game.nextMove();
    if (e.key==='ArrowUp')    game.goToEnd();
    if (e.key==='ArrowDown')  game.goToStart();
    if (e.key==='f'||e.key==='F') game.flipBoard();
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), 2500);
}

