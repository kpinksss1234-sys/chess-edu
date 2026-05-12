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
  if (tab === 'pgn') { setTimeout(loadSavedGames, 150); setTimeout(loadGameRecords, 200); }
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

    // 로컬 백그라운드 분석 비활성화 — 수 분류는 Lichess API만 사용
    // (우측 패널 "Lichess로 분석" 버튼으로 수 분류 요청)
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

// move 객체와 착수 전 보드/턴을 받아 보드 상태를 처리
// histState: history 레코드 (fenBefore/fenAfter/castling/captured 포함) — boardBefore null 시 FEN 복원
function playMoveSound(move, boardBefore, turn, histState) {
  if (!move) return;

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

  // ── 3. board가 있으면 정밀 판단 ──
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

    return;
  }
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

// ═══════════════════════════════════════════════════════════
// 대국 기록 화살표 시스템
// ═══════════════════════════════════════════════════════════

// moveIndex(1-based) → [{fromCol,fromRow,toCol,toRow}, ...]
// play.html 저장 형식: {fc, fr, tc, tr}
let _recordArrows = {};

function _loadRecordArrows(arrows) {
  _recordArrows = {};
  if (!arrows) return;
  Object.entries(arrows).forEach(([k, arr]) => {
    if (!arr || !arr.length) return;
    _recordArrows[parseInt(k)] = arr.map(a => ({
      fromCol: a.fc, fromRow: a.fr, toCol: a.tc, toRow: a.tr
    }));
  });
}

// ChessGame.prototype.renderBoard를 한 번만 패치
// — 매 renderBoard 호출 끝에 화살표를 덧그림
function _installArrowPatch() {
  if (typeof ChessGame === 'undefined') { setTimeout(_installArrowPatch, 200); return; }
  if (ChessGame.prototype.renderBoard._arrowPatched) return;

  const _orig = ChessGame.prototype.renderBoard;
  ChessGame.prototype.renderBoard = function(...args) {
    const r = _orig.apply(this, args);
    _drawRecordArrows(this);
    return r;
  };
  ChessGame.prototype.renderBoard._arrowPatched = true;
}

function _drawRecordArrows(gameInst) {
  const g = document.getElementById('user-arrow-svg-arrows');
  if (!g) return;

  // 기존 대국기록 화살표만 제거 (class로 구분)
  g.querySelectorAll('.record-arrow').forEach(el => el.remove());

  if (!Object.keys(_recordArrows).length) return;

  // historyIndex: -1=시작 전, 0=1번 수 후
  // moveIndex = historyIndex + 1 (1번 수 = index 1)
  const moveIdx = (gameInst ? gameInst.historyIndex : -1) + 1;
  const arrows = _recordArrows[moveIdx];
  if (!arrows || !arrows.length) return;

  const ARROW_COLOR = 'rgba(255,165,0,0.92)';
  const SW = 14;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const flipped = gameInst && gameInst.flipped;

  // marker가 없으면 생성
  const svgEl = document.getElementById('board-svg-overlay') || g.closest('svg');
  if (svgEl && !svgEl.querySelector('#rec-arrow-head')) {
    let defs = svgEl.querySelector('defs');
    if (!defs) { defs = document.createElementNS(SVG_NS,'defs'); svgEl.prepend(defs); }
    const mk = document.createElementNS(SVG_NS,'marker');
    mk.setAttribute('id','rec-arrow-head');
    mk.setAttribute('markerUnits','strokeWidth');
    mk.setAttribute('markerWidth','4'); mk.setAttribute('markerHeight','4');
    mk.setAttribute('refX','2.5'); mk.setAttribute('refY','2');
    mk.setAttribute('orient','auto');
    const mp = document.createElementNS(SVG_NS,'path');
    mp.setAttribute('d','M0,0 L4,2 L0,4 L1,2 Z');
    mp.setAttribute('fill',ARROW_COLOR);
    mk.appendChild(mp); defs.appendChild(mk);
  }

  arrows.forEach(a => {
    const dc = flipped ? 7 - a.fromCol : a.fromCol;
    const dr = flipped ? 7 - a.fromRow : a.fromRow;
    const tc = flipped ? 7 - a.toCol   : a.toCol;
    const tr = flipped ? 7 - a.toRow   : a.toRow;

    const fx = dc*100+50, fy = dr*100+50;
    const tx = tc*100+50, ty = tr*100+50;
    const dx = tx-fx, dy = ty-fy;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 1) return;
    const ux = dx/len, uy = dy/len;
    const sx = fx+ux*SW*1.1, sy = fy+uy*SW*1.1;
    const ex = tx-ux*SW*2.4, ey = ty-uy*SW*2.4;
    if (Math.sqrt((ex-sx)**2+(ey-sy)**2) < 5) return;

    const line = document.createElementNS(SVG_NS,'line');
    line.classList.add('record-arrow');
    line.setAttribute('x1',sx.toFixed(2)); line.setAttribute('y1',sy.toFixed(2));
    line.setAttribute('x2',ex.toFixed(2)); line.setAttribute('y2',ey.toFixed(2));
    line.setAttribute('stroke',ARROW_COLOR);
    line.setAttribute('stroke-width',SW);
    line.setAttribute('stroke-linecap','round');
    line.setAttribute('marker-end','url(#rec-arrow-head)');
    g.appendChild(line);
  });
}

// 페이지 로드 시 즉시 패치 설치
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _installArrowPatch);
} else {
  _installArrowPatch();
}

// ═══════════════════════════════════════════════════════════
// 대국 기록 목록 로드 (game_records 컬렉션)
// ═══════════════════════════════════════════════════════════

async function loadGameRecords() {
  const listEl = document.getElementById('game-records-list');
  if (!listEl) return;
  if (!window._fbDb || !window._currentUser) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">로그인 후 이용 가능합니다</div>';
    return;
  }
  listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">불러오는 중...</div>';

  try {
    let snap;
    try {
      snap = await window._fbDb.collection('game_records')
        .where('uid','==',window._currentUser.uid)
        .orderBy('playedAt','desc').limit(30).get();
    } catch(e) {
      snap = await window._fbDb.collection('game_records')
        .where('uid','==',window._currentUser.uid).limit(30).get();
    }

    const docs = [];
    snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
    docs.sort((a,b) => (b.playedAt?.seconds||0)-(a.playedAt?.seconds||0));

    if (!docs.length) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px 0;">대국 기록이 없습니다</div>';
      return;
    }

    listEl.innerHTML = '';
    docs.forEach(doc => {
      const dateStr = doc.playedAt
        ? new Date(doc.playedAt.seconds*1000).toLocaleDateString('ko-KR',{month:'short',day:'numeric'})
        : '—';
      const myColor = doc.myColor || 'w';
      const result  = doc.result  || '*';
      let badge = '🤝', badgeCls = 'draw';
      if (result==='1-0') { badge=myColor==='w'?'W':'L'; badgeCls=myColor==='w'?'win':'lose'; }
      if (result==='0-1') { badge=myColor==='b'?'W':'L'; badgeCls=myColor==='b'?'win':'lose'; }

      const hasArrows = doc.arrows && Object.keys(doc.arrows).some(k=>doc.arrows[k]?.length>0);
      const arrowBadge = hasArrows ? ' <span title="화살표 포함" style="font-size:10px;opacity:0.7;">🏹</span>' : '';

      const item = document.createElement('div');
      item.className = 'saved-game-item';
      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;
            background:${badgeCls==='win'?'rgba(127,166,80,.2)':badgeCls==='lose'?'rgba(192,64,64,.15)':'rgba(160,160,160,.15)'};
            color:${badgeCls==='win'?'#a0c060':badgeCls==='lose'?'#e07070':'var(--text-secondary)'};">${badge}</span>
          <span class="saved-game-title" style="flex:1;">${doc.whiteName||'백'} vs ${doc.blackName||'흑'}${arrowBadge}</span>
        </div>
        <div class="saved-game-meta"><span>${result} · ${doc.moveCount||0}수</span><span>${dateStr}</span></div>
        <div class="saved-game-actions">
          <button class="saved-game-btn" onclick="loadGameRecord('${doc.id}')">분석 보드로</button>
        </div>`;
      listEl.appendChild(item);
    });
  } catch(e) {
    listEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">불러오기 실패: ${e.message}</div>`;
  }
}

// 특정 game_records 기록을 분석 보드로 로드
async function loadGameRecord(docId) {
  if (!window._fbDb) { showToast('Firebase 연결 필요'); return; }
  try {
    const snap = await window._fbDb.collection('game_records').doc(docId).get();
    if (!snap.exists) { showToast('기록을 찾을 수 없습니다'); return; }
    const doc = snap.data();
    if (!doc.pgn) { showToast('PGN 데이터가 없습니다'); return; }

    // 1) 화살표 먼저 로드
    _loadRecordArrows(doc.arrows || null);

    // 2) PGN 로드 (내부에서 switchTab('analysis') + goToEnd 호출됨)
    document.getElementById('pgn-input').value = doc.pgn;
    loadPGN();

    // 3) 내 색상 적용
    const sel = document.getElementById('my-color-select');
    if (sel && doc.myColor) sel.value = doc.myColor;

    // 4) PGN 로드 완료 후 화살표 재렌더 (goToEnd 이후 시점)
    setTimeout(() => {
      if (game) _drawRecordArrows(game);
    }, 400);

    const arrowCount = Object.values(_recordArrows).reduce((s,a)=>s+a.length,0);
    showToast(`✓ 기보 로드${arrowCount>0 ? ` (화살표 ${arrowCount}개)` : ''}`);
  } catch(e) {
    showToast('불러오기 실패: ' + e.message);
  }
}