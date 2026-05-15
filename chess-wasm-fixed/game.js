// ===== GAME CLASS =====
class ChessGame {
  constructor() {
    this.reset();
    this.flipped = false;
    this.showCoords = true;
    this.showHighlight = true;
    this.showEvalBar = true;
    this.boardThemes = {
      classic: { light: '#f0d9b5', dark: '#b58863' },
      green:   { light: '#eeeed2', dark: '#769656' },
      blue:    { light: '#dee3e6', dark: '#8ca2ad' },
      purple:  { light: '#e0d0f0', dark: '#9060b0' },
      dark:    { light: '#4d4d4d', dark: '#1a1a1a' },
    };
    this.currentTheme = 'classic';
    this.selectedSq = null;
    this.possibleMoves = [];
    this.history = [];
    this.historyIndex = -1;
    this.variations = [];
    this.currentVariation = null;
    this.enginePreview = null;  // 현재 보드에 반영된 엔진라인 상태
    this.enginePreviews = {};   // histIdx → [ {pvIdx, moves, eval, depth} ] 영구 맵
    this.pendingPromo = null;
    this.halfMove = 0;
    this.fullMove = 1;
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
  }

  reset() {
    this.board = INIT_BOARD.map(r => [...r]);
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;
    this.halfMove = 0;
    this.fullMove = 1;
    this.history = [];
    this.historyIndex = -1;
    this.selectedSq = null;
    this.possibleMoves = [];
    this.lastMove = null;
    // 변화수 트리: { afterIndex: number, moves: state[] }[]
    // afterIndex = 이 변화수가 분기되는 메인라인 historyIndex
    this.variations = [];
    // 현재 보고 있는 변화수 (null = 메인라인)
    this.currentVariation = null; // { varIdx, moveIdx }
    // 엔진 라인 미리보기 상태
    this.enginePreview = null; // { histIdx, pvIdx, activeIdx, moves, states }
    this.enginePreviews = {};  // histIdx → [{pvIdx, moves, eval, depth}]
  }

  cloneBoard(b) { return b.map(r => [...r]); }

  makeMove(move, promoPiece) {
    if (move.promo && !promoPiece) {
      this.pendingPromo = move;
      this.showPromoModal();
      return false;
    }
    if (promoPiece) move.promoPiece = promoPiece;

    // variation 모드에서 makeMove 호출 시 → _addToVariation으로 라우팅
    if (this.currentVariation) {
      return this._addToVariation(move);
    }

    // 엔진라인 탐색 중에 수를 두면 → 엔진라인 뒤에 extraMoves로 이어붙임
    if (this.enginePreview) {
      return this._addToEngineLineExtra(move);
    }

    const allMoves = getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant);
    const san = moveToSAN(this.board, move, this.turn, allMoves);

    // 기보 중간에서 다른 수를 두면 → variation으로 저장 (메인라인 보존)
    if (this.historyIndex < this.history.length - 1) {
      const nextMain = this.history[this.historyIndex + 1];
      // 같은 수면 그냥 앞으로 이동
      if (nextMain && nextMain.san === san) {
        this.historyIndex++;
        this.restoreState();
        return true;
      }
      // 다른 수 → variation 시작
      this._startVariation(san, move);
      return true;
    }

    const fenBefore = boardToFen(this.board, this.turn, this.castling, this.enPassant, this.halfMove, this.fullMove);
    const boardAfter = applyMoveToBoard(this.cloneBoard(this.board), move, this.turn);
    // castling 계산 (임시)
    const castAfter = {...this.castling};
    if (this.board[move.from[0]][move.from[1]] === `${this.turn}K`) {
      if (this.turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
      else { castAfter.bK=false; castAfter.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castAfter.wK=false;
    if (move.from[0]===7&&move.from[1]===0) castAfter.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) castAfter.bK=false;
    if (move.from[0]===0&&move.from[1]===0) castAfter.bQ=false;
    const epAfter = move.doublePush ? [move.to[0]-(this.turn==='w'?-1:1), move.to[1]] : null;
    const movingPiece = this.board[move.from[0]][move.from[1]];
    const isCapture = !!this.board[move.to[0]][move.to[1]] || !!move.enPassant;
    const isPawnMove = movingPiece && movingPiece[1] === 'P';
    const hmAfter = (isPawnMove || isCapture) ? 0 : this.halfMove + 1;
    const fmAfter = this.turn === 'b' ? this.fullMove + 1 : this.fullMove;
    const fenAfter = boardToFen(boardAfter, this.turn==='w'?'b':'w', castAfter, epAfter, hmAfter, fmAfter);

    const state = {
      // board 클론 제거 — fenBefore/fenAfter로 완전 복원 가능 (메모리 절감)
      turn: this.turn,
      castling: {...this.castling},
      enPassant: this.enPassant,
      halfMove: this.halfMove,
      fullMove: this.fullMove,
      san, move,
      captured: this.board[move.to[0]][move.to[1]],
      fenBefore,
      fenAfter,
      annotation: null,
    };
    this.history.push(state);
    this.historyIndex++;

    this.board = applyMoveToBoard(this.board, move, this.turn);

    if (this.board[move.to[0]][move.to[1]] === `${this.turn}K`) {
      if (this.turn==='w') { this.castling.wK=false; this.castling.wQ=false; }
      else { this.castling.bK=false; this.castling.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) this.castling.wK=false;
    if (move.from[0]===7&&move.from[1]===0) this.castling.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) this.castling.bK=false;
    if (move.from[0]===0&&move.from[1]===0) this.castling.bQ=false;

    this.enPassant = move.doublePush ? [move.to[0]-(this.turn==='w'?-1:1), move.to[1]] : null;
    if (this.turn==='b') this.fullMove++;
    const _movingPiece0 = this.board[move.to[0]][move.to[1]]; // applyMoveToBoard 후이므로 이미 이동됨
    // halfMove 리셋: 폰 이동 또는 기물 잡기 → 0, 그 외 → +1
    // movingPiece는 위에서 구한 값(applyMove 전) 재사용
    if (isPawnMove || isCapture) { this.halfMove = 0; } else { this.halfMove++; }
    this.turn = enemyColor(this.turn);
    this.lastMove = move;
    this.selectedSq = null;
    this.possibleMoves = [];

    // 착수음 재생 — histState 전달로 fenBefore/captured 정확히 활용
    playMoveSound(move, parseFenBoard((state.fenBefore||'').split(' ')[0]) || null, state.turn, state);

    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);  // 수 이동: 강제 재분석
    // 위협/최선수 패널 리셋 (새 수에 맞게 재분석 대기)
    const tpanel = document.getElementById('threat-panel');
    if (tpanel && tpanel.style.display !== 'none') {
      document.getElementById('threat-content').innerHTML = '<div class="threat-loading">⚡ 분석 대기 중...</div>';
      lastThreatFen = '';
    }
    const bpanel = document.getElementById('best-explain-panel');
    if (bpanel && bpanel.style.display !== 'none') {
      document.getElementById('best-explain-content').innerHTML = '<div class="threat-loading">📖 분석 대기 중...</div>';
      document.getElementById('best-explain-seq').innerHTML = '';
      lastBestExplainFen = '';
    }
    if (typeof window._enginePracticeAfterHumanMove === 'function') {
      window._enginePracticeAfterHumanMove();
    }
    return true;
  }

  goToStart() {
    this.currentVariation = null;
    this.enginePreview = null;
    this.historyIndex = -1;
    this._restoreMainState();
  }

  goToEnd() {
    this.currentVariation = null;
    this.enginePreview = null;
    this.historyIndex = this.history.length - 1;
    this._restoreMainState();
  }

  prevMove() {
    if (this.enginePreview) {
      // 엔진라인 탐색 중 → 원래 포지션으로 먼저 복원
      this.enginePreview = null;
    }
    if (this.currentVariation) {
      const { varIdx, lineIdx, moveIdx } = this.currentVariation;
      if (moveIdx > 0) {
        this.currentVariation.moveIdx--;
        this._restoreVariationState(); return;
      } else {
        this.currentVariation = null;
        this._restoreMainState(); return;
      }
    }
    if (this.historyIndex >= 0) { this.historyIndex--; this._restoreMainState(); }
  }

  nextMove() {
    if (this.enginePreview) {
      this.enginePreview = null;
    }
    if (this.currentVariation) {
      const { varIdx, lineIdx, moveIdx } = this.currentVariation;
      const line = this.variations[varIdx].lines[lineIdx];
      if (moveIdx < line.length - 1) {
        this.currentVariation.moveIdx++;
        const s = line[this.currentVariation.moveIdx];
        playMoveSound(s.move, s.board || null, s.turn, s);
        this._restoreVariationState(); return;
      }
      return;
    }
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const s = this.history[this.historyIndex];
      if (s) playMoveSound(s.move, s.board || null, s.turn, s);
      this._restoreMainState();
    }
  }

  gotoMove(idx) {
    this.currentVariation = null;
    if (this.enginePreview) this.enginePreview = null;
    this.historyIndex = idx;
    this._restoreMainState();
  }

  // 메인라인 포지션 복원 (엔진라인 유지하면서)
  _restoreMainState() {
    _engineLineAnalysisFen = null;  // 엔진라인 수 분석 FEN 초기화
    this.enginePreview = null;      // 기보 수 이동 시 탐색 중인 enginePreview 초기화 (enginePreviews 맵은 유지)
    this.restoreState();
  }

  restoreState() {
    if (this.historyIndex < 0) {
      this.board = INIT_BOARD.map(r=>[...r]);
      this.turn = 'w';
      this.castling = { wK: true, wQ: true, bK: true, bQ: true };
      this.enPassant = null;
      this.halfMove = 0;
      this.fullMove = 1;
      this.lastMove = null;
    } else {
      const s = this.history[this.historyIndex];
      // fenAfter로 포지션 복원 — s.board 클론 불필요 (메모리 절감)
      const fp = s.fenAfter ? s.fenAfter.split(' ') : null;
      if (fp) {
        this.board    = parseFenBoard(fp[0]) || INIT_BOARD.map(r=>[...r]);
        this.turn     = fp[1] || 'w';
        this.castling = parseFenCastling(fp[2] || '-');
        this.enPassant = parseFenEP(fp[3] || '-');
        this.halfMove  = parseInt(fp[4] || '0');
        this.fullMove  = parseInt(fp[5] || '1');
      } else {
        // fallback: 구버전 저장 데이터 호환
        this.board = applyMoveToBoard(this.cloneBoard(s.board), s.move, s.turn);
        this.turn = s.turn === 'w' ? 'b' : 'w';
        this.castling = {...s.castling};
        this.enPassant = s.move.doublePush ? [s.move.to[0]-(s.turn==='w'?-1:1), s.move.to[1]] : null;
        if (s.board && s.board[s.move.from[0]][s.move.from[1]] === `${s.turn}K`) {
          if (s.turn==='w') { this.castling.wK=false; this.castling.wQ=false; }
          else { this.castling.bK=false; this.castling.bQ=false; }
        }
        if (s.move.from[0]===7&&s.move.from[1]===7) this.castling.wK=false;
        if (s.move.from[0]===7&&s.move.from[1]===0) this.castling.wQ=false;
        if (s.move.from[0]===0&&s.move.from[1]===7) this.castling.bK=false;
        if (s.move.from[0]===0&&s.move.from[1]===0) this.castling.bQ=false;
        this.halfMove = s.halfMove;
        this.fullMove = s.fullMove;
      }
      this.lastMove = s.move;
    }
    this.selectedSq = null;
    this.possibleMoves = [];
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);  // 기보 이동: 항상 강제 재분석
    // 패널 리셋
    lastThreatFen = '';
    lastBestExplainFen = '';
    const tp = document.getElementById('threat-panel');
    if (tp && tp.style.display !== 'none') {
      document.getElementById('threat-content').innerHTML = '<div class="threat-loading">⚡ 분석 대기 중...</div>';
    }
    const bp = document.getElementById('best-explain-panel');
    if (bp && bp.style.display !== 'none') {
      document.getElementById('best-explain-content').innerHTML = '<div class="threat-loading">📖 분석 대기 중...</div>';
      document.getElementById('best-explain-seq').innerHTML = '';
    }
  }

  loadFromFen(fenString) {
    this.variations = [];
    this.currentVariation = null;
    this.enginePreview = null;
    const fp = fenString.trim().split(/\s+/);
    if (!fp[0]) return false;
    this.board = parseFenBoard(fp[0]) || INIT_BOARD.map(r => [...r]);
    this.turn = fp[1] || 'w';
    this.castling = parseFenCastling(fp[2] || '-');
    this.enPassant = parseFenEP(fp[3] || '-');
    this.halfMove = parseInt(fp[4] || '0', 10);
    this.fullMove = parseInt(fp[5] || '1', 10);
    this.history = [];
    this.historyIndex = -1;
    this.lastMove = null;
    this.selectedSq = null;
    this.possibleMoves = [];
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
    return true;
  }

  resetBoard() {
    window._enginePracticeMode = null;
    window._enginePracticeThinking = false;
    this.reset();
    pvData = {};
    lastAnalyzedFen = '';
    renderTopMoves('새 게임');
    document.getElementById('eval-score').textContent = '0.0';
    updateEvalBarFromCp(0);
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
    showToast('보드가 초기화되었습니다');
  }

  flipBoard() {
    this.flipped = !this.flipped;
    this.renderBoard();
  }

  handleSquareClick(r, c) {
    if (window._enginePracticeMode) {
      if (window._enginePracticeThinking) return;
      if (this.turn !== window._enginePracticeMode.myColor) return;
    }
    // variation 모드일 때는 variation에 수 추가
    if (this.currentVariation) {
      const piece = this.board[r][c];
      if (this.selectedSq) {
        const [sr, sc] = this.selectedSq;
        const lm = legalMoves(this.board, sr, sc, this.castling, this.enPassant);
        const target = lm.find(m => m.to[0]===r && m.to[1]===c);
        if (target) { this._addToVariation(target); return; }
        if (piece && piece[0]===this.turn) {
          this.selectedSq = [r,c];
          this.possibleMoves = legalMoves(this.board,r,c,this.castling,this.enPassant);
          this.renderBoard(); return;
        }
        this.selectedSq = null; this.possibleMoves = []; this.renderBoard(); return;
      }
      if (piece && piece[0]===this.turn) {
        this.selectedSq = [r,c];
        this.possibleMoves = legalMoves(this.board,r,c,this.castling,this.enPassant);
        this.renderBoard();
      }
      return;
    }

    const piece = this.board[r][c];

    if (this.selectedSq) {
      const [sr, sc] = this.selectedSq;
      const lm = legalMoves(this.board, sr, sc, this.castling, this.enPassant);
      const target = lm.find(m => m.to[0]===r && m.to[1]===c);
      if (target) { this.makeMove(target); return; }
      if (piece && piece[0]===this.turn) {
        this.selectedSq = [r,c];
        this.possibleMoves = legalMoves(this.board,r,c,this.castling,this.enPassant);
        this.renderBoard();
        return;
      }
      this.selectedSq = null;
      this.possibleMoves = [];
      this.renderBoard();
      return;
    }

    if (piece && piece[0]===this.turn) {
      this.selectedSq = [r,c];
      this.possibleMoves = legalMoves(this.board,r,c,this.castling,this.enPassant);
      this.renderBoard();
    }
  }

  showPromoModal() {
    const color = this.turn;
    const pieces = ['Q','R','B','N'];
    const promoEl = document.getElementById('promo-pieces');
    promoEl.innerHTML = pieces.map(p =>
      `<div class="promo-piece" onclick="game.confirmPromo('${p}')"><img src="${pieceImg(color+p)}" alt="${p}"></div>`
    ).join('');
    document.getElementById('promotion-modal').classList.add('visible');
  }

  confirmPromo(piece) {
    document.getElementById('promotion-modal').classList.remove('visible');
    if (window._enginePracticeMode && window._enginePracticeThinking) return;
    if (this.pendingPromo) {
      const m = this.pendingPromo;
      this.pendingPromo = null;
      this.makeMove(m, piece);
    }
  }

  renderBoard() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    const theme = this.boardThemes[this.currentTheme];

    for (let displayR = 0; displayR < 8; displayR++) {
      for (let displayC = 0; displayC < 8; displayC++) {
        const r = this.flipped ? 7-displayR : displayR;
        const c = this.flipped ? 7-displayC : displayC;

        const sq = document.createElement('div');
        const isLight = (r+c)%2===0;
        sq.className = `square ${isLight?'light':'dark'}`;
        sq.style.background = isLight ? theme.light : theme.dark;

        // Last move highlight
        if (this.showHighlight && this.lastMove) {
          const [fr,fc]=this.lastMove.from,[tr,tc]=this.lastMove.to;
          if ((r===fr&&c===fc)||(r===tr&&c===tc)) {
            sq.style.background = isLight ? '#cdd46e' : '#aaa23a';
          }
        }

        // Selected
        if (this.selectedSq && this.selectedSq[0]===r && this.selectedSq[1]===c) {
          sq.style.background = 'rgba(50,200,100,0.55)';
        }

        // Possible moves
        const isPossible = this.possibleMoves.some(m => m.to[0]===r&&m.to[1]===c);
        if (isPossible) {
          sq.classList.add(this.board[r][c] ? 'possible-capture' : 'possible-move');
        }

        // Coords
        if (this.showCoords) {
          if (c === (this.flipped ? 7 : 0)) {
            const rank = document.createElement('span');
            rank.className = 'coord-rank';
            rank.textContent = this.flipped ? r+1 : 8-r;
            sq.appendChild(rank);
          }
          if (r === (this.flipped ? 0 : 7)) {
            const file = document.createElement('span');
            file.className = 'coord-file';
            file.textContent = FILES[c];
            sq.appendChild(file);
          }
        }

        // Piece — use Lichess SVG image
        const piece = this.board[r][c];
        if (piece) {
          const img = document.createElement('img');
          img.className = 'piece-img' + (piece.startsWith('b') ? ' black-piece' : '');
          img.src = pieceImg(piece);
          img.alt = piece;
          img.draggable = false; // HTML5 drag 완전 비활성
          // mousedown → 드래그 시작
          img.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            this._startMouseDrag(r, c, e, img);
          });
          sq.appendChild(img);
        }

        // 빈 칸 클릭: 선택된 기물의 이동 목적지로 처리
        sq.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          if (e.target.classList.contains('piece-img')) return; // 기물은 img mousedown이 처리
          e.preventDefault();
          // 이미 선택된 기물이 있으면 이동 시도
          if (this.selectedSq) {
            const [sr, sc] = this.selectedSq;
            const lm = legalMoves(this.board, sr, sc, this.castling, this.enPassant);
            const target = lm.find(m => m.to[0] === r && m.to[1] === c);
            if (target) {
              this.selectedSq = null; this.possibleMoves = [];
              this.makeMove(target);
              return;
            }
          }
          this.handleSquareClick(r, c);
        });

        board.appendChild(sq);
      }
    }

    this.updateCapturedPieces();
  }

  // ── 마우스 드래그 이동 (mousedown 즉시 드래그 시작) ──────────
  _startMouseDrag(r, c, e, img) {
    if (window._enginePracticeMode) {
      if (window._enginePracticeThinking) return;
      if (this.turn !== window._enginePracticeMode.myColor) return;
    }
    const piece = this.board[r][c];
    if (!piece) return;

    // 상대방 기물 → 클릭 선택 fallback
    if (piece[0] !== this.turn) {
      this.handleSquareClick(r, c);
      return;
    }

    // 기보 중간이면 variation 분기 준비 (잘라내기 안함)
    // 실제 잘라내기는 makeMove/_startVariation에서 처리

    // 선택 + 이동 가능한 칸 계산
    this.selectedSq = [r, c];
    this.possibleMoves = legalMoves(this.board, r, c, this.castling, this.enPassant);
    this.renderBoard();

    // ── 고스트 기물: mousedown 즉시 생성 ──────────────────
    const boardEl = document.getElementById('chessboard');

    const getRect  = () => boardEl.getBoundingClientRect();
    const getSqSize = () => getRect().width / 8;

    const ghost = document.createElement('img');
    ghost.src = img.src;
    const sz0 = getSqSize();
    ghost.style.cssText = [
      'position:fixed',
      `width:${sz0}px`,
      `height:${sz0}px`,
      'object-fit:contain',
      'pointer-events:none',
      'z-index:9999',
      'opacity:0.9',
      'filter:drop-shadow(0 6px 16px rgba(0,0,0,0.7))',
      'transform:translate(-50%,-50%)',
      `left:${e.clientX}px`,
      `top:${e.clientY}px`,
      'transition:none',
      'will-change:left,top',
    ].join(';');
    document.body.appendChild(ghost);

    // 커서를 grabbing으로 전체 변경
    document.body.classList.add('dragging');
    document.body.style.cursor = 'grabbing';

    let lastKey = null;  // 마지막으로 하이라이트한 칸 키

    // ── 칸 좌표 계산 헬퍼 ───────────────────────────────
    const getSquare = (cx, cy) => {
      const rect = getRect();
      const sqSz = rect.width / 8;
      const x = cx - rect.left;
      const y = cy - rect.top;
      const dc = Math.floor(x / sqSz);
      const dr = Math.floor(y / sqSz);
      if (dc < 0 || dc >= 8 || dr < 0 || dr >= 8) return null;
      return {
        tr: this.flipped ? 7 - dr : dr,
        tc: this.flipped ? 7 - dc : dc,
      };
    };

    // ── 하이라이트 업데이트 ─────────────────────────────
    const updateHighlight = (tr, tc) => {
      const key = `${tr},${tc}`;
      if (key === lastKey) return;
      lastKey = key;
      const squares = boardEl.querySelectorAll('.square');
      const theme = this.boardThemes[this.currentTheme];
      squares.forEach((sq, idx) => {
        const sqR = this.flipped ? 7 - Math.floor(idx / 8) : Math.floor(idx / 8);
        const sqC = this.flipped ? 7 - (idx % 8) : (idx % 8);
        const isLight = (sqR + sqC) % 2 === 0;
        // 마지막 수 하이라이트
        let bg = isLight ? theme.light : theme.dark;
        if (this.showHighlight && this.lastMove) {
          const [fr2,fc2] = this.lastMove.from, [tr2,tc2] = this.lastMove.to;
          if ((sqR===fr2&&sqC===fc2)||(sqR===tr2&&sqC===tc2)) bg = isLight?'#cdd46e':'#aaa23a';
        }
        // 출발 칸 초록
        if (sqR === r && sqC === c) { sq.style.background = 'rgba(50,200,100,0.55)'; return; }
        // 이동 가능 표시 (possible-move/capture는 CSS로)
        const isPoss = this.possibleMoves.some(m => m.to[0]===sqR && m.to[1]===sqC);
        // 현재 커서 칸 강조
        if (sqR === tr && sqC === tc) {
          sq.style.background = isPoss ? 'rgba(80,210,80,0.75)' : 'rgba(200,200,80,0.35)';
          return;
        }
        sq.style.background = bg;
      });
    };

    // ── mousemove: 고스트 이동 + 하이라이트 ─────────────
    const onMove = (ev) => {
      ev.preventDefault();
      const cx = ev.clientX;
      const cy = ev.clientY;
      // 고스트 크기 갱신 (창 리사이즈 대응)
      const sz = getSqSize();
      ghost.style.width  = sz + 'px';
      ghost.style.height = sz + 'px';
      ghost.style.left   = cx + 'px';
      ghost.style.top    = cy + 'px';
      const sq = getSquare(cx, cy);
      if (sq) updateHighlight(sq.tr, sq.tc);
    };

    // ── mouseup: 수 확정 ────────────────────────────────
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost.remove();
      document.body.classList.remove('dragging');
      document.body.style.cursor = '';

      const sq = getSquare(ev.clientX, ev.clientY);

      // 같은 칸 mouseup → 클릭 선택 상태 유지 (다음 클릭으로 목적지 지정)
      if (!sq || (sq.tr === r && sq.tc === c)) {
        // 선택은 유지, 보드만 다시 렌더
        this.renderBoard();
        return;
      }

      const target = this.possibleMoves.find(m => m.to[0] === sq.tr && m.to[1] === sq.tc);
      if (target) {
        this.selectedSq = null; this.possibleMoves = [];
        if (this.currentVariation) {
          this._addToVariation(target);
        } else {
          this.makeMove(target);
        }
      } else {
        this.selectedSq = null; this.possibleMoves = [];
        this.renderBoard();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── 변화수(Variation) 시작 ─────────────────────────────────
  _startVariation(san, move) {
    const branchIdx = this.historyIndex; // 분기점 메인라인 index

    // 기존 같은 분기점의 variation이 있으면 거기에 추가 (새 라인)
    // 아니면 새 variation 생성
    let varObj = this.variations.find(v => v.afterIndex === branchIdx);
    if (!varObj) {
      varObj = { afterIndex: branchIdx, lines: [] };
      this.variations.push(varObj);
    }

    // 현재 보드 상태로부터 수를 실행해 variation 라인 만들기
    const s = this.historyIndex >= 0 ? this.history[this.historyIndex] : null;
    let board = s ? this.cloneBoard(this.board) : INIT_BOARD.map(r=>[...r]);
    let turn = this.turn;
    let castling = {...this.castling};
    let enPassant = this.enPassant;
    let halfMove = s ? s.halfMove + 1 : 1;
    let fullMove = s ? (turn === 'b' ? s.fullMove + 1 : s.fullMove) : 1;

    const fenBefore = boardToFen(board, turn, castling, enPassant, halfMove-1, fullMove);
    const boardAfter = applyMoveToBoard(this.cloneBoard(board), move, turn);
    const castAfter = {...castling};
    if (board[move.from[0]][move.from[1]] === `${turn}K`) {
      if (turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
      else            { castAfter.bK=false; castAfter.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castAfter.wK=false;
    if (move.from[0]===7&&move.from[1]===0) castAfter.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) castAfter.bK=false;
    if (move.from[0]===0&&move.from[1]===0) castAfter.bQ=false;
    const epAfter = move.doublePush ? [move.to[0]-(turn==='w'?-1:1), move.to[1]] : null;
    const _svMovingPiece = board[move.from[0]][move.from[1]];
    const _svIsCapture = !!board[move.to[0]][move.to[1]] || !!move.enPassant;
    const _svIsPawn = _svMovingPiece && _svMovingPiece[1] === 'P';
    const hmAfterSV = (_svIsPawn || _svIsCapture) ? 0 : halfMove;
    const fenAfter = boardToFen(boardAfter, turn==='w'?'b':'w', castAfter, epAfter, hmAfterSV, fullMove);

    const varState = {
      // board 제거 — fenBefore/fenAfter로 복원 가능 (메모리 절감)
      turn, castling: {...castling}, enPassant, halfMove: halfMove-1, fullMove,
      san, move,
      captured: board[move.to[0]][move.to[1]],
      fenBefore, fenAfter, annotation: null,
    };

    // 이 variation line 생성 (첫 수)
    const newLine = [varState];
    varObj.lines.push(newLine);
    const lineIdx = varObj.lines.length - 1;

    // currentVariation 으로 진입
    this.currentVariation = { varIdx: this.variations.indexOf(varObj), lineIdx, moveIdx: 0 };

    // 보드 상태를 variation 첫 수 이후로 업데이트
    this.board = boardAfter;
    this.turn = turn === 'w' ? 'b' : 'w';
    this.castling = castAfter;
    this.enPassant = epAfter;
    if (turn==='b') this.fullMove++;
    if (_svIsPawn || _svIsCapture) { this.halfMove = 0; } else { this.halfMove++; }
    this.lastMove = move;
    this.selectedSq = null;
    this.possibleMoves = [];

    playMoveSound(move, parseFenBoard((varState.fenBefore||'').split(' ')[0]) || null, varState.turn, varState);
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
  }

  // ── Variation 내에서 수 추가 ────────────────────────────────
  _addToVariation(move) {
    const { varIdx, lineIdx, moveIdx } = this.currentVariation;
    const varObj = this.variations[varIdx];
    const line = varObj.lines[lineIdx];

    // 이미 다음 수가 있으면 (앞으로 이동) 체크
    if (moveIdx + 1 < line.length && line[moveIdx+1].san === moveToSAN(this.board, move, this.turn,
        getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant))) {
      this.currentVariation.moveIdx++;
      this._restoreVariationState();
      return;
    }

    const allMoves = getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant);
    const san = moveToSAN(this.board, move, this.turn, allMoves);
    const fenBefore = boardToFen(this.board, this.turn, this.castling, this.enPassant, this.halfMove, this.fullMove);
    const boardAfter = applyMoveToBoard(this.cloneBoard(this.board), move, this.turn);
    const castAfter = {...this.castling};
    if (this.board[move.from[0]][move.from[1]] === `${this.turn}K`) {
      if (this.turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
      else            { castAfter.bK=false; castAfter.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castAfter.wK=false;
    if (move.from[0]===7&&move.from[1]===0) castAfter.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) castAfter.bK=false;
    if (move.from[0]===0&&move.from[1]===0) castAfter.bQ=false;
    const epAfter = move.doublePush ? [move.to[0]-(this.turn==='w'?-1:1), move.to[1]] : null;
    const fmAfter = this.turn==='b' ? this.fullMove+1 : this.fullMove;
    const _avMovingPiece = this.board[move.from[0]][move.from[1]];
    const _avIsCapture = !!this.board[move.to[0]][move.to[1]] || !!move.enPassant;
    const _avIsPawn = _avMovingPiece && _avMovingPiece[1] === 'P';
    const hmAfterAV = (_avIsPawn || _avIsCapture) ? 0 : this.halfMove + 1;
    const fenAfter = boardToFen(boardAfter, this.turn==='w'?'b':'w', castAfter, epAfter, hmAfterAV, fmAfter);

    const varState = {
      // board 제거 — fenBefore/fenAfter로 복원 가능 (메모리 절감)
      turn: this.turn,
      castling: {...this.castling}, enPassant: this.enPassant,
      halfMove: this.halfMove, fullMove: this.fullMove,
      san, move,
      captured: this.board[move.to[0]][move.to[1]],
      fenBefore, fenAfter, annotation: null,
    };

    // 현재 위치 이후를 잘라내고 추가
    line.splice(moveIdx + 1);
    line.push(varState);
    this.currentVariation.moveIdx = line.length - 1;

    this.board = boardAfter;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.castling = castAfter;
    this.enPassant = epAfter;
    if (this.turn==='w') this.fullMove++;
    if (_avIsPawn || _avIsCapture) { this.halfMove = 0; } else { this.halfMove++; }
    this.lastMove = move;
    this.selectedSq = null;
    this.possibleMoves = [];

    playMoveSound(move, parseFenBoard((varState.fenBefore||'').split(' ')[0]) || null, varState.turn, varState);
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
    return true;
  }

  // ── 엔진라인 탐색 중 수를 두면 extraMoves에 이어붙임 ─────────
  _addToEngineLineExtra(move) {
    const ep = this.enginePreview;
    if (!ep) return false;
    const { histIdx, pvIdx } = ep;
    const lineData = (this.enginePreviews[histIdx] || []).find(l => l.pvIdx === pvIdx);
    if (!lineData) return false;
    if (!lineData.extraMoves) lineData.extraMoves = [];

    const allMoves = getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant);
    const san = moveToSAN(this.board, move, this.turn, allMoves);

    // 현재 activeIdx 이후를 잘라내고 추가
    const currentExtraIdx = ep.extraMoveIdx ?? -1;
    lineData.extraMoves.splice(currentExtraIdx + 1);

    // 보드 상태 계산
    const boardAfter = applyMoveToBoard(this.cloneBoard(this.board), move, this.turn);
    const castAfter = {...this.castling};
    if (this.board[move.from[0]][move.from[1]] === `${this.turn}K`) {
      if (this.turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
      else { castAfter.bK=false; castAfter.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castAfter.wK=false;
    if (move.from[0]===7&&move.from[1]===0) castAfter.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) castAfter.bK=false;
    if (move.from[0]===0&&move.from[1]===0) castAfter.bQ=false;
    const epAfter = move.doublePush ? [move.to[0]-(this.turn==='w'?-1:1), move.to[1]] : null;
    const fmAfter = this.turn==='b' ? this.fullMove+1 : this.fullMove;
    const _emMovingPiece = this.board[move.from[0]][move.from[1]];
    const _emIsCapture = !!this.board[move.to[0]][move.to[1]] || !!move.enPassant;
    const _emIsPawn = _emMovingPiece && _emMovingPiece[1] === 'P';
    const hmAfterEM = (_emIsPawn || _emIsCapture) ? 0 : this.halfMove + 1;

    // board/boardAfter 대신 FEN 저장 (메모리 절감: 8×8 배열 2개 → 문자열 2개)
    const emFenBefore = boardToFen(this.board, this.turn, this.castling, this.enPassant, this.halfMove, this.fullMove);
    const emFenAfter  = boardToFen(boardAfter, this.turn==='w'?'b':'w', castAfter, epAfter, hmAfterEM, fmAfter);
    lineData.extraMoves.push({
      san, move, turn: this.turn,
      captured: this.board[move.to[0]][move.to[1]] || (move.enPassant ? 'ep' : null),
      fenBefore: emFenBefore, fenAfter: emFenAfter,
      castAfter, epAfter, fmAfter,
      halfMove: this.halfMove, fullMove: this.fullMove,
    });

    ep.extraMoveIdx = lineData.extraMoves.length - 1;

    // 보드 상태 업데이트
    this.board = boardAfter;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.castling = castAfter;
    this.enPassant = epAfter;
    if (_emIsPawn || _emIsCapture) { this.halfMove = 0; } else { this.halfMove++; }
    if (this.turn==='w') this.fullMove++;
    this.lastMove = move;
    this.selectedSq = null;
    this.possibleMoves = [];

    // 방금 push한 extraMove에서 착수 전 board/turn 가져오기
    const em = lineData.extraMoves[lineData.extraMoves.length - 1];
    playMoveSound(move, parseFenBoard((em.fenBefore||'').split(' ')[0]) || null, em.turn, em);
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    // 새 수 이후 포지션 분석
    const fen = boardToFen(this.board, this.turn, this.castling, this.enPassant, this.halfMove, this.fullMove);
    _engineLineAnalysisFen = fen;
    _analyzeSpecificFen(fen);
    return true;
  }

  // ── Variation 상태 복원 ─────────────────────────────────────
  _restoreVariationState() {
    if (!this.currentVariation) return;
    const { varIdx, lineIdx, moveIdx } = this.currentVariation;
    const line = this.variations[varIdx].lines[lineIdx];
    const s = line[moveIdx];
    // fenAfter로 복원 — s.board 클론 불필요 (메모리 절감)
    const fp = s.fenAfter ? s.fenAfter.split(' ') : null;
    if (fp) {
      this.board     = parseFenBoard(fp[0]) || INIT_BOARD.map(r=>[...r]);
      this.turn      = fp[1] || 'w';
      this.castling  = parseFenCastling(fp[2] || '-');
      this.enPassant = parseFenEP(fp[3] || '-');
      this.halfMove  = parseInt(fp[4] || '0');
      this.fullMove  = parseInt(fp[5] || '1');
    } else {
      this.board = applyMoveToBoard(this.cloneBoard(s.board), s.move, s.turn);
      this.turn = s.turn === 'w' ? 'b' : 'w';
      const castAfter = {...s.castling};
      if (s.board && s.board[s.move.from[0]][s.move.from[1]] === `${s.turn}K`) {
        if (s.turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
        else              { castAfter.bK=false; castAfter.bQ=false; }
      }
      this.castling  = castAfter;
      this.enPassant = s.move.doublePush ? [s.move.to[0]-(s.turn==='w'?-1:1), s.move.to[1]] : null;
      this.halfMove  = s.halfMove;
      this.fullMove  = s.fullMove;
    }
    this.lastMove = s.move;
    this.selectedSq = null;
    this.possibleMoves = [];
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
  }

  // ── 엔진 라인 저장 (현재 히스토리 인덱스에 pvData 전체 저장) ──
  previewEngineLine(pvMovesSnap, pvIdx) {
    const histIdx = this.historyIndex;
    const finalPvIdx = pvIdx || 1;

    // ★ pvMovesSnap(클릭 시점 고정값) 우선 사용
    const clickedPv = pvData[finalPvIdx] || pvData[1];
    const moves = (pvMovesSnap && pvMovesSnap.length > 0)
      ? [...pvMovesSnap]
      : (clickedPv ? [...(clickedPv.moves || [])] : []);
    const uciMoves = clickedPv ? [...(clickedPv.pv || [])] : [];
    const evalStr = clickedPv ? clickedPv.eval : '';
    const depth = clickedPv ? clickedPv.depth : 0;

    // ── 기존 라인이 없으면 루트 라인으로 새로 생성 ──────────────
    if (!this.enginePreviews[histIdx] || this.enginePreviews[histIdx].length === 0) {
      const line = {
        pvIdx: finalPvIdx, moves, uciMoves, eval: evalStr, depth,
        extraMoves: [], subLines: [], parentLineId: null, branchAt: -1,
        id: Date.now()
      };
      this.enginePreviews[histIdx] = [line];
      this._applyEngineLine(histIdx, line.pvIdx, 0);
      return;
    }

    const existingLines = this.enginePreviews[histIdx];

    // ── enginePreview가 활성화된 상태에서 새 라인 클릭 ──────────
    if (this.enginePreview && this.enginePreview.histIdx === histIdx) {
      const ep = this.enginePreview;
      const activeIdx = ep.activeIdx ?? -1;
      const extraMoveIdx = ep.extraMoveIdx ?? -1;

      // 현재 탐색 중인 라인 (서브라인일 수도 있음)
      const currentLine = existingLines.find(l => l.pvIdx === ep.pvIdx);
      // ★ 수정: 새 서브라인의 부모는 현재 탐색 중인 라인 자체
      // (루트라인이든 서브라인이든 상관없이 currentLine.id를 부모로 사용)
      const parentId = currentLine
        ? currentLine.id
        : existingLines[0].id;

      // 분기 지점: extra 탐색 중이면 extra 위치, 아니면 엔진라인 수 위치
      const branchAt = extraMoveIdx >= 0 ? `extra:${extraMoveIdx}` : `engine:${activeIdx}`;

      // 같은 분기점·같은 수순 서브라인 중복 방지
      const dupLine = existingLines.find(l =>
        l.branchAt === branchAt &&
        l.parentLineId === parentId &&
        JSON.stringify(l.moves) === JSON.stringify(moves)
      );
      if (dupLine) {
        this._applyEngineLine(histIdx, dupLine.pvIdx, 0);
        return;
      }

      // 새 서브라인 생성
      const newPvIdx = `sub_${Date.now()}`;
      const subLine = {
        pvIdx: newPvIdx, moves, uciMoves, eval: evalStr, depth,
        extraMoves: [], subLines: [],
        parentLineId: parentId,
        branchAt,
        id: Date.now() + Math.random()
      };
      existingLines.push(subLine);
      this._applyEngineLine(histIdx, newPvIdx, 0);
      return;
    }

    // ── enginePreview 없음(기보 수 이동 후 첫 클릭) ──────────────
    // 같은 pvIdx 루트라인이 있어도 덮어쓰지 않고 새 루트라인으로 추가
    // (모든 라인 보존 원칙)
    const existingRootSamePv = existingLines.find(l => l.pvIdx === finalPvIdx && !l.parentLineId);
    if (existingRootSamePv) {
      // 완전히 같은 수순이면 재사용, 다르면 새 루트라인
      if (JSON.stringify(existingRootSamePv.moves) === JSON.stringify(moves)) {
        this._applyEngineLine(histIdx, existingRootSamePv.pvIdx, 0);
        return;
      }
      // 수순이 다르면 고유 pvIdx로 새 루트라인 추가
    }

    // ── 새 루트라인 추가 (기존 라인 절대 덮어씌우지 않음) ─────────
    const uniquePvIdx = existingRootSamePv ? `root_${finalPvIdx}_${Date.now()}` : finalPvIdx;
    const line = {
      pvIdx: uniquePvIdx, moves, uciMoves, eval: evalStr, depth,
      extraMoves: [], subLines: [], parentLineId: null, branchAt: -1,
      id: Date.now()
    };
    existingLines.push(line);
    this._applyEngineLine(histIdx, line.pvIdx, 0);
  }

  // ── 라인의 시작 보드 상태를 계산 (서브라인은 부모 분기점 이후) ──
  _getLineStartState(histIdx, line) {
    // 기준 루트 상태 계산 헬퍼 (histIdx 이후 포지션)
    // ★ 수정: s.board가 없으므로 fenAfter로 복원
    const _getRootState = () => {
      if (histIdx >= 0 && this.history[histIdx]) {
        const s = this.history[histIdx];
        // fenAfter: 해당 수가 착수된 이후 포지션 (board 필드는 메모리 절감으로 제거됨)
        const fen = s.fenAfter || null;
        if (fen) {
          const fp = fen.split(' ');
          const b = parseFenBoard(fp[0]);
          const t = fp[1] || (s.turn === 'w' ? 'b' : 'w');
          const c = parseFenCastling(fp[2] || '-');
          const ep = parseFenEP(fp[3] || '-');
          const hm = parseInt(fp[4]) || (s.halfMove + 1);
          const fm = parseInt(fp[5]) || (s.turn === 'b' ? s.fullMove + 1 : s.fullMove);
          return { b, t, c, ep, hm, fm };
        }
        // fenAfter 없으면 수동 계산 (legacy board 필드 있을 경우 fallback)
        const board = s.board ? s.board.map(r=>[...r]) : null;
        if (board) {
          const b = applyMoveToBoard(board, s.move, s.turn);
          const t = s.turn === 'w' ? 'b' : 'w';
          const c = {...s.castling};
          if (board[s.move.from[0]][s.move.from[1]] === `${s.turn}K`) {
            if (s.turn==='w') { c.wK=false; c.wQ=false; }
            else { c.bK=false; c.bQ=false; }
          }
          if (s.move.from[0]===7&&s.move.from[1]===7) c.wK=false;
          if (s.move.from[0]===7&&s.move.from[1]===0) c.wQ=false;
          if (s.move.from[0]===0&&s.move.from[1]===7) c.bK=false;
          if (s.move.from[0]===0&&s.move.from[1]===0) c.bQ=false;
          const ep = s.move.doublePush ? [s.move.to[0]-(s.turn==='w'?-1:1), s.move.to[1]] : null;
          return { b, t, c, ep, hm: s.halfMove + 1, fm: s.turn === 'b' ? s.fullMove + 1 : s.fullMove };
        }
      }
      return { b: INIT_BOARD.map(r=>[...r]), t: 'w', c: { wK:true, wQ:true, bK:true, bQ:true }, ep: null, hm: 0, fm: 1 };
    };

    // 서브라인이 아닌 루트라인이면 바로 반환
    if (!line.parentLineId || !line.branchAt || line.branchAt === -1) {
      return _getRootState();
    }

    // 서브라인: 부모 라인을 찾아서 분기점까지 수들을 적용
    // ★ 수정: 순수 함수로 리팩터링 — 클로저 변수 오염 제거
    const lines = this.enginePreviews[histIdx] || [];

    const _applyMovesUpTo = (parentLine, branchAt) => {
      // 부모의 시작 상태: 부모가 서브라인이면 재귀, 아니면 루트 상태
      let ctx;
      if (parentLine.parentLineId && parentLine.branchAt && parentLine.branchAt !== -1) {
        const grandParent = lines.find(l => l.id === parentLine.parentLineId);
        ctx = grandParent ? _applyMovesUpTo(grandParent, parentLine.branchAt) : _getRootState();
      } else {
        ctx = _getRootState();
      }

      // ctx를 로컬 변수로 복사 — 외부 스코프 오염 없음
      let { b, t, c, ep, hm, fm } = ctx;
      b = b.map(r=>[...r]);
      c = {...c};

      // ★ 수정: _snapshot이 있으면 스냅샷 데이터 사용 (엔진 깊이 업데이트로 라인이 변해도 분기점 계산 불변)
      const uciList2 = (parentLine._snapshot || parentLine).uciMoves || [];
      const sanList2 = (parentLine._snapshot || parentLine).moves || [];
      let limit = 0;
      let srcType = 'engine';
      if (branchAt && branchAt.startsWith('engine:')) {
        limit = parseInt(branchAt.split(':')[1]) + 1;
        srcType = 'engine';
      } else if (branchAt && branchAt.startsWith('extra:')) {
        limit = sanList2.length;
        srcType = 'extra';
      }

      const applyOne = (uci, san) => {
        const allLM = getAllLegalMoves(b, t, c, ep);
        let mv = null;
        if (uci && uci.length >= 4) {
          const fc=FILES.indexOf(uci[0]),fr=8-parseInt(uci[1]),tc2=FILES.indexOf(uci[2]),tr=8-parseInt(uci[3]);
          const promo=uci[4]?uci[4].toUpperCase():null;
          mv = allLM.find(m=>m.from[0]===fr&&m.from[1]===fc&&m.to[0]===tr&&m.to[1]===tc2&&(!promo||m.promo))||null;
          if(mv&&promo) mv.promoPiece=promo;
        }
        if (!mv && san) mv = sanToMove(san, b, t, allLM);
        if (!mv) return false;
        const nb = applyMoveToBoard(b.map(r=>[...r]), mv, t);
        const nc = {...c};
        if(b[mv.from[0]][mv.from[1]]===`${t}K`){if(t==='w'){nc.wK=false;nc.wQ=false;}else{nc.bK=false;nc.bQ=false;}}
        if(mv.from[0]===7&&mv.from[1]===7)nc.wK=false;if(mv.from[0]===7&&mv.from[1]===0)nc.wQ=false;
        if(mv.from[0]===0&&mv.from[1]===7)nc.bK=false;if(mv.from[0]===0&&mv.from[1]===0)nc.bQ=false;
        ep=mv.doublePush?[mv.to[0]-(t==='w'?-1:1),mv.to[1]]:null;
        fm=t==='b'?fm+1:fm; hm++;
        b=nb; t=t==='w'?'b':'w'; c=nc;
        return true;
      };

      const maxI = Math.max(uciList2.length, sanList2.length);
      for (let i=0; i<Math.min(limit, maxI); i++) {
        if (!applyOne(uciList2[i], sanList2[i])) break;
      }
      if (srcType === 'extra') {
        const extras = parentLine.extraMoves || [];
        const extraLimit = parseInt(branchAt.split(':')[1]) + 1;
        for (let i=0; i<extraLimit && i<extras.length; i++) {
          if (!applyOne(null, extras[i].san)) break;
        }
      }
      return { b, t, c, ep, hm, fm };
    };

    const parentLine = lines.find(l => l.id === line.parentLineId);
    if (parentLine) return _applyMovesUpTo(parentLine, line.branchAt);
    return _getRootState();
  }

  // 엔진라인 특정 수를 보드에 반영
  _applyEngineLine(histIdx, pvIdx, moveIdx) {
    console.group(`[DEBUG] _applyEngineLine(histIdx=${histIdx}, pvIdx=${pvIdx}, moveIdx=${moveIdx})`);
    const lines = this.enginePreviews[histIdx];
    if (!lines) { console.warn('❌ enginePreviews[histIdx] 없음'); console.groupEnd(); return; }
    const line = lines.find(l => l.pvIdx === pvIdx);
    if (!line) { console.warn('❌ pvIdx에 해당하는 라인 없음'); console.groupEnd(); return; }

    // ★ 클릭 시점 스냅샷 고정: 엔진이 나중에 같은 pvIdx 라인을 덮어써도
    //   클릭된 라인의 moves/uciMoves는 frozen 스냅샷에서 읽어 불변 유지
    if (!line._snapshot) {
      line._snapshot = {
        moves:    [...(line.moves    || [])],
        uciMoves: [...(line.uciMoves || [])],
        eval:     line.eval,
        depth:    line.depth,
      };
    }
    // 스냅샷에서 읽음 (엔진 업데이트에 의한 변경 무시)
    const frozenMoves    = line._snapshot.moves;
    const frozenUciMoves = line._snapshot.uciMoves;

    console.log('line.moves:', frozenMoves);
    console.log('line.uciMoves:', frozenUciMoves);

    // 시작 보드 상태 — 서브라인이면 분기점까지 수를 적용한 상태
    const startState = this._getLineStartState(histIdx, line);
    let startBoard = startState.b, startTurn = startState.t, startCast = startState.c;
    let startEP = startState.ep, startHM = startState.hm, startFM = startState.fm;
    console.log('startTurn:', startTurn, '| startFM:', startFM);
    const startFen = boardToFen(startBoard, startTurn, startCast, startEP, startHM, startFM);
    console.log('시작 FEN:', startFen);

    // 각 수의 보드 상태 계산 — UCI moves 우선, 없으면 SAN fallback
    const states = [];
    let curBoard = startBoard.map(r=>[...r]);
    let curTurn = startTurn;
    let curCast = {...startCast};
    let curEP = startEP;
    let curHM = startHM;
    let curFM = startFM;

    const uciList = frozenUciMoves;
    const sanList = frozenMoves;
    const moveCount = Math.max(uciList.length, sanList.length);
    console.log('총 수 개수:', moveCount, '| 요청 moveIdx:', moveIdx);

    for (let mi = 0; mi < moveCount; mi++) {
      const allLM = getAllLegalMoves(curBoard, curTurn, curCast, curEP);
      let matched = null;

      // 1) UCI move 우선 시도
      const uci = uciList[mi];
      if (uci && uci.length >= 4) {
        const fc = FILES.indexOf(uci[0]), fr = 8 - parseInt(uci[1]);
        const tc = FILES.indexOf(uci[2]), tr = 8 - parseInt(uci[3]);
        const promo = uci[4] ? uci[4].toUpperCase() : null;
        matched = allLM.find(m =>
          m.from[0]===fr && m.from[1]===fc && m.to[0]===tr && m.to[1]===tc &&
          (!promo || m.promo)
        ) || null;
        if (matched && promo) matched.promoPiece = promo;
        if (!matched) console.warn(`  mi=${mi}: UCI "${uci}" 매칭 실패 (fr=${fr},fc=${fc}→tr=${tr},tc=${tc}), SAN fallback 시도`);
      }

      // 2) SAN fallback
      if (!matched && sanList[mi]) {
        matched = sanToMove(sanList[mi], curBoard, curTurn, allLM);
        if (!matched) console.error(`  mi=${mi}: SAN "${sanList[mi]}" 도 매칭 실패! states 중단`);
        else console.log(`  mi=${mi}: SAN "${sanList[mi]}" fallback 성공`);
      } else if (matched) {
        console.log(`  mi=${mi}: UCI "${uci}" → SAN "${sanList[mi]}" 매칭 성공`);
      }

      if (!matched) { console.error(`❌ mi=${mi}에서 수 매칭 실패, states.length=${states.length}`); break; }

      const boardAfter = applyMoveToBoard(curBoard.map(r=>[...r]), matched, curTurn);
      const castAfter = {...curCast};
      if (curBoard[matched.from[0]][matched.from[1]] === `${curTurn}K`) {
        if (curTurn==='w') { castAfter.wK=false; castAfter.wQ=false; }
        else { castAfter.bK=false; castAfter.bQ=false; }
      }
      if (matched.from[0]===7&&matched.from[1]===7) castAfter.wK=false;
      if (matched.from[0]===7&&matched.from[1]===0) castAfter.wQ=false;
      if (matched.from[0]===0&&matched.from[1]===7) castAfter.bK=false;
      if (matched.from[0]===0&&matched.from[1]===0) castAfter.bQ=false;
      const epAfter = matched.doublePush ? [matched.to[0]-(curTurn==='w'?-1:1), matched.to[1]] : null;
      const fmAfter = curTurn==='b' ? curFM+1 : curFM;
      const _pgMovingPiece = curBoard[matched.from[0]][matched.from[1]];
      const _pgIsCapture = !!curBoard[matched.to[0]][matched.to[1]] || !!matched.enPassant;
      const _pgIsPawn = _pgMovingPiece && _pgMovingPiece[1] === 'P';
      const hmAfterPG = (_pgIsPawn || _pgIsCapture) ? 0 : curHM + 1;
      states.push({
        board: boardAfter, turn: curTurn==='w'?'b':'w',
        castling: castAfter, enPassant: epAfter,
        halfMove: hmAfterPG, fullMove: fmAfter, lastMove: matched,
        // ★ 사운드 재생용: 착수 전 보드/턴/캡처 저장
        boardBefore: curBoard.map(r=>[...r]),
        turnBefore: curTurn,
        captured: curBoard[matched.to[0]][matched.to[1]] || (matched.enPassant ? 'ep' : null),
      });
      curBoard = boardAfter;
      curTurn = curTurn==='w'?'b':'w';
      curCast = castAfter;
      curEP = epAfter;
      curHM = hmAfterPG;
      if (curTurn==='w') curFM++;
    }

    console.log(`states 계산 완료: ${states.length}개 / 요청 moveIdx=${moveIdx}`);
    if (moveIdx >= 0 && !states[moveIdx]) {
      console.error(`❌ states[${moveIdx}] 없음! 기준 포지션으로 fallback됩니다`);
    } else if (moveIdx >= 0 && states[moveIdx]) {
      const st = states[moveIdx];
      const fen = boardToFen(st.board, st.turn, st.castling, st.enPassant, st.halfMove, st.fullMove);
      console.log(`✅ 적용할 FEN (moveIdx=${moveIdx}):`, fen);
    }
    console.groupEnd();

    // 기존 enginePreview의 extraMoveIdx는 엔진라인 수 클릭 시 초기화 (엔진라인 수 선택)
    this.enginePreview = { histIdx, pvIdx, activeIdx: moveIdx, moves: frozenMoves, states, extraMoveIdx: -1 };
    this.historyIndex = histIdx; // 기준 포지션으로 히스토리 복원

    // 보드 상태 적용
    if (moveIdx >= 0 && states[moveIdx]) {
      const st = states[moveIdx];
      this.board = st.board.map(r=>[...r]);
      this.turn = st.turn;
      this.castling = {...st.castling};
      this.enPassant = st.enPassant;
      this.halfMove = st.halfMove;
      this.fullMove = st.fullMove;
      this.lastMove = st.lastMove;
      // ★ 엔진라인 수 클릭 사운드 재생
      playMoveSound(st.lastMove, st.boardBefore, st.turnBefore, st);
    } else {
      // 기준 포지션 복원
      this._applyHistState(histIdx);
    }
    this.selectedSq = null;
    this.possibleMoves = [];
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();

    // ── 클릭된 수의 포지션으로 실시간 분석 ──────────────────
    // moveIdx >= 0 이면 그 수 이후 포지션을 분석, -1이면 기준 포지션 분석
    if (moveIdx >= 0 && states[moveIdx]) {
      const st = states[moveIdx];
      const fen = boardToFen(
        st.board, st.turn, st.castling, st.enPassant,
        st.halfMove, st.fullMove
      );
      // 분석 컨텍스트에 현재 엔진라인 수 FEN 저장 (flushCycle 동기화용)
      _engineLineAnalysisFen = fen;
      _analyzeSpecificFen(fen);
    } else {
      _engineLineAnalysisFen = null;
      this._analyzeBasePosition(histIdx);
    }
  }

  _analyzeBasePosition(histIdx) {
    // _getHistFen 과 동일 로직으로 기준 FEN 계산 후 분석 요청
    const fen = _getHistFen(histIdx);
    if (fen) _analyzeSpecificFen(fen);
  }

  // extraMove 클릭 → 해당 수 이후 보드 상태 적용
  _applyEngineLineExtra(histIdx, pvIdx, extraIdx) {
    const lineData = (this.enginePreviews[histIdx] || []).find(l => l.pvIdx === pvIdx);
    if (!lineData || !lineData.extraMoves) return;
    const em = lineData.extraMoves[extraIdx];
    if (!em) return;

    this.enginePreview = {
      ...this.enginePreview,
      histIdx, pvIdx,
      activeIdx: lineData.moves.length - 1, // 마지막 엔진라인 수
      extraMoveIdx: extraIdx,
      moves: lineData.moves,
    };
    this.historyIndex = histIdx;

    // fenAfter로 보드 복원 (boardAfter 제거 후)
    const emFp = em.fenAfter ? em.fenAfter.split(' ') : null;
    if (emFp) {
      this.board     = parseFenBoard(emFp[0]) || INIT_BOARD.map(r=>[...r]);
      this.turn      = emFp[1] || 'w';
      this.castling  = parseFenCastling(emFp[2] || '-');
      this.enPassant = parseFenEP(emFp[3] || '-');
      this.halfMove  = parseInt(emFp[4] || '0');
      this.fullMove  = parseInt(emFp[5] || '1');
    } else {
      this.board = em.boardAfter ? em.boardAfter.map(r=>[...r]) : INIT_BOARD.map(r=>[...r]);
      this.turn = em.turn === 'w' ? 'b' : 'w';
      this.castling = {...em.castAfter};
      this.enPassant = em.epAfter;
      this.halfMove = em.halfMove + 1;
      this.fullMove = em.fmAfter;
    }
    this.lastMove = em.move;
    this.selectedSq = null;
    this.possibleMoves = [];

    // ★ extraMove 클릭/키보드 이동 사운드
    playMoveSound(em.move, parseFenBoard((em.fenBefore||'').split(' ')[0]) || null, em.turn, em);

    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();

    const fen = boardToFen(this.board, this.turn, this.castling, this.enPassant, this.halfMove, this.fullMove);
    _engineLineAnalysisFen = fen;
    _analyzeSpecificFen(fen);
  }

  _applyHistState(histIdx) {
    if (histIdx < 0) {
      this.board = INIT_BOARD.map(r=>[...r]);
      this.turn = 'w'; this.castling = { wK: true, wQ: true, bK: true, bQ: true };
      this.enPassant = null; this.halfMove = 0; this.fullMove = 1; this.lastMove = null;
    } else {
      const s = this.history[histIdx];
      if (!s) return;
      // ★ fenAfter로 복원 (s.board는 메모리 절감으로 제거됨)
      const fp = s.fenAfter ? s.fenAfter.split(' ') : null;
      if (fp) {
        this.board     = parseFenBoard(fp[0]) || INIT_BOARD.map(r=>[...r]);
        this.turn      = fp[1] || 'w';
        this.castling  = parseFenCastling(fp[2] || '-');
        this.enPassant = parseFenEP(fp[3] || '-');
        this.halfMove  = parseInt(fp[4] || '0');
        this.fullMove  = parseInt(fp[5] || '1');
      } else if (s.board) {
        // 레거시 fallback
        this.board = applyMoveToBoard(s.board.map(r=>[...r]), s.move, s.turn);
        this.turn = s.turn === 'w' ? 'b' : 'w';
        this.castling = {...s.castling};
        if (s.board[s.move.from[0]][s.move.from[1]] === `${s.turn}K`) {
          if (s.turn==='w') { this.castling.wK=false; this.castling.wQ=false; }
          else { this.castling.bK=false; this.castling.bQ=false; }
        }
        if (s.move.from[0]===7&&s.move.from[1]===7) this.castling.wK=false;
        if (s.move.from[0]===7&&s.move.from[1]===0) this.castling.wQ=false;
        if (s.move.from[0]===0&&s.move.from[1]===7) this.castling.bK=false;
        if (s.move.from[0]===0&&s.move.from[1]===0) this.castling.bQ=false;
        this.enPassant = s.move.doublePush ? [s.move.to[0]-(s.turn==='w'?-1:1), s.move.to[1]] : null;
        this.halfMove = s.halfMove; this.fullMove = s.fullMove;
      }
      this.lastMove = s.move;
    }
  }

  clearEnginePreview() {
    if (!this.enginePreview) return;
    const histIdx = this.enginePreview.histIdx;
    this.enginePreview = null;
    _engineLineAnalysisFen = null;
    this.historyIndex = histIdx;
    this._applyHistState(histIdx);
    this.selectedSq = null; this.possibleMoves = [];
    this.renderBoard();
    this.renderMoveList();
    this.updateStatus();
    analyzePosition(true);
  }

  removeEnginePreviewAt(histIdx) {
    delete this.enginePreviews[histIdx];
    if (this.enginePreview && this.enginePreview.histIdx === histIdx) {
      this.enginePreview = null;
      _engineLineAnalysisFen = null;
      this._applyHistState(histIdx);
      this.selectedSq = null; this.possibleMoves = [];
      this.renderBoard();
      this.updateStatus();
      analyzePosition(true);
    }
    this.renderMoveList();
  }

  updateCapturedPieces() {
    // Count material on board
    const counts = {};
    const allPieces = ['wP','wN','wB','wR','wQ','bP','bN','bB','bR','bQ'];
    allPieces.forEach(p => counts[p] = 0);
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
      if (this.board[r][c] && this.board[r][c][1]!=='K') {
        counts[this.board[r][c]] = (counts[this.board[r][c]]||0)+1;
      }
    }
    const initial = { wP:8,wN:2,wB:2,wR:2,wQ:1, bP:8,bN:2,bB:2,bR:2,bQ:1 };

    // Captured white pieces (shown near black player)
    const capturedByBlack = [];
    ['wQ','wR','wB','wN','wP'].forEach(p => {
      const n = (initial[p]||0) - (counts[p]||0);
      for (let i=0;i<n;i++) capturedByBlack.push(p);
    });

    // Captured black pieces (shown near white player)
    const capturedByWhite = [];
    ['bQ','bR','bB','bN','bP'].forEach(p => {
      const n = (initial[p]||0) - (counts[p]||0);
      for (let i=0;i<n;i++) capturedByWhite.push(p);
    });

    const elBlack = document.getElementById('captured-black');
    elBlack.innerHTML = capturedByBlack.map(p=>
      `<img src="${pieceImg(p)}" style="width:18px;height:18px;opacity:0.9" alt="${p}">`
    ).join('');

    const elWhite = document.getElementById('captured-white');
    elWhite.innerHTML = capturedByWhite.map(p=>
      `<img src="${pieceImg(p)}" style="width:18px;height:18px;opacity:0.9" alt="${p}">`
    ).join('');
  }

  renderMoveList() {
    const el = document.getElementById('move-list');
    el.innerHTML = '';

    // ── 메인라인 렌더 ────────────────────────────────────────
    for (let i = 0; i < this.history.length; i += 2) {
      const pair = document.createElement('div');
      pair.className = 'move-pair';

      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = (Math.floor(i/2)+1) + '.';
      pair.appendChild(num);

      const isVarActive = this.currentVariation !== null;
      const wCell = document.createElement('div');
      wCell.className = `move-cell${(!isVarActive && this.historyIndex===i) ? ' active' : ''}`;
      wCell.innerHTML = moveCellHTML(this.history[i]);
      wCell.onclick = () => { this.currentVariation=null; this.gotoMove(i); };
      pair.appendChild(wCell);

      if (this.history[i+1]) {
        const bCell = document.createElement('div');
        bCell.className = `move-cell${(!isVarActive && this.historyIndex===i+1) ? ' active' : ''}`;
        bCell.innerHTML = moveCellHTML(this.history[i+1]);
        bCell.onclick = () => { this.currentVariation=null; this.gotoMove(i+1); };
        pair.appendChild(bCell);
      } else {
        pair.appendChild(document.createElement('div'));
      }
      el.appendChild(pair);

      // 백의 수(i) 다음에 variation + 엔진라인이 있으면 렌더
      const varAfterW = this.variations.filter(v => v.afterIndex === i);
      for (const varObj of varAfterW) {
        for (let li = 0; li < varObj.lines.length; li++) {
          const varIdx = this.variations.indexOf(varObj);
          el.appendChild(this._buildVariationBlock(varObj, li, varIdx));
        }
      }
      // 백의 수(i) 다음 엔진라인
      this._renderEnginePreviewsAt(i, el);

      // 흑의 수(i+1) 다음에 variation이 있으면 렌더
      if (this.history[i+1]) {
        const varAfterB = this.variations.filter(v => v.afterIndex === i+1);
        for (const varObjB of varAfterB) {
          for (let li = 0; li < varObjB.lines.length; li++) {
            const varIdx = this.variations.indexOf(varObjB);
            el.appendChild(this._buildVariationBlock(varObjB, li, varIdx));
          }
        }
      }
      // 흑의 수(i+1) 다음 엔진라인
      if (this.history[i+1]) {
        this._renderEnginePreviewsAt(i+1, el);
      }
    }

    // ── 엔진 미리보기 (각 수 바로 아래에 삽입됨 — _renderEnginePreviewsAt 에서 처리)
    // (이 위치에는 별도 블록 없음)

    const count = this.history.length;
    document.getElementById('move-count').textContent = `${count} 수`;
    document.getElementById('move-count-bar').textContent = `${count} 수`;
  }

  // ── 변화수 블록 빌더 (인라인 스타일) ──────────────────────
  _buildVariationBlock(varObj, li, varIdx) {
    const line = varObj.lines[li];
    const branchMove = varObj.afterIndex >= 0 ? this.history[varObj.afterIndex] : null;
    let moveNum = branchMove ? branchMove.fullMove : 1;
    let curTurn = branchMove ? (branchMove.turn === 'w' ? 'b' : 'w') : 'w';

    const block = document.createElement('div');
    block.className = 'variation-block';

    line.forEach((vs, mi) => {
      if (curTurn === 'w') {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = moveNum + '.';
        block.appendChild(ns);
      } else if (mi === 0) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = moveNum + '...';
        block.appendChild(ns);
      }
      const isActive = this.currentVariation &&
        this.currentVariation.varIdx === varIdx &&
        this.currentVariation.lineIdx === li &&
        this.currentVariation.moveIdx === mi;
      const cell = document.createElement('span');
      cell.className = `var-move${isActive ? ' active' : ''}`;
      cell.innerHTML = moveCellHTML(vs);
      cell.onclick = () => {
        this.currentVariation = { varIdx, lineIdx: li, moveIdx: mi };
        this._restoreVariationState();
      };
      block.appendChild(cell);
      if (curTurn === 'b') moveNum++;
      curTurn = curTurn === 'w' ? 'b' : 'w';
    });

    // 삭제 버튼
    const closeBtn = document.createElement('span');
    closeBtn.className = 'var-close';
    closeBtn.title = '삭제';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.variations[varIdx].lines.splice(li, 1);
      if (this.variations[varIdx].lines.length === 0) this.variations.splice(varIdx, 1);
      if (this.currentVariation?.varIdx === varIdx) this.currentVariation = null;
      this.renderMoveList();
    });
    block.appendChild(closeBtn);

    return block;
  }

  // ── 특정 histIdx에 저장된 엔진라인들을 el에 렌더 ──────────
  _renderEnginePreviewsAt(histIdx, el) {
    const lines = this.enginePreviews[histIdx];
    if (!lines || lines.length === 0) return;

    let startTurn, startMoveNum;
    if (histIdx >= 0 && this.history[histIdx]) {
      const s = this.history[histIdx];
      startTurn = s.turn === 'w' ? 'b' : 'w';
      startMoveNum = s.turn === 'b' ? s.fullMove + 1 : s.fullMove;
    } else {
      startTurn = 'w'; startMoveNum = 1;
    }

    const histIdxSnap = histIdx;
    const rootLines = lines.filter(l => !l.parentLineId);
    const allSubLines = lines.filter(l => l.parentLineId);
    const multiRoot = rootLines.length > 1;

    const rootContainer = multiRoot ? document.createElement('div') : null;
    if (rootContainer) {
      rootContainer.className = 'multi-root-container';
      el.appendChild(rootContainer);
    }
    const rootTarget = rootContainer || el;

    for (let ri = 0; ri < rootLines.length; ri++) {
      const lineData = rootLines[ri];
      if (multiRoot && ri > 0) {
        const div = document.createElement('div');
        div.className = 'engine-line-divider';
        rootTarget.appendChild(div);
      }
      // 루트라인 블록 생성 — 서브라인을 내부에 포함하므로 flex-wrap 대신 block 레이아웃
      const outerBlock = document.createElement('div');
      outerBlock.className = 'variation-block variation-block-outer';
      if (multiRoot) outerBlock.classList.add('multi-root-item');

      // 수들이 들어갈 인라인 행
      const rowEl = document.createElement('div');
      rowEl.className = 'var-line-row';
      outerBlock.appendChild(rowEl);

      this._buildLineRow(rowEl, lineData, allSubLines, startTurn, startMoveNum, histIdxSnap, outerBlock);

      rootTarget.appendChild(outerBlock);
    }
  }

  // ── 단일 라인의 수 행 + 내부 서브라인들을 outerBlock에 빌드 ──
  // 분기점에서 행을 끊고 → 서브라인 → 나머지 행 순서로 배치
  _buildLineRow(rowEl, lineData, allSubLines, startTurn, startMoveNum, histIdxSnap, outerBlock) {
    const pvIdx = lineData.pvIdx;
    const isActiveLine = this.enginePreview &&
      this.enginePreview.histIdx === histIdxSnap &&
      this.enginePreview.pvIdx === pvIdx;
    const activeIdx    = isActiveLine ? (this.enginePreview.activeIdx    ?? -1) : -1;
    const extraMoveIdx = isActiveLine ? (this.enginePreview.extraMoveIdx ?? -1) : -1;

    if (isActiveLine) outerBlock.classList.add('active-engine-line');

    // 다중 루트라인 번호 배지
    const multiRoot = outerBlock.classList.contains('multi-root-item');
    const rootLines = (this.enginePreviews[histIdxSnap] || []).filter(l => !l.parentLineId);
    if (multiRoot) {
      const ri = rootLines.findIndex(l => l.pvIdx === pvIdx);
      if (ri >= 0) {
        const badge = document.createElement('span');
        badge.className = 'engine-line-index';
        badge.textContent = ri + 1;
        rowEl.appendChild(badge);
      }
    }

    // 평가 배지
    if (lineData.eval) {
      const evalBadge = document.createElement('span');
      evalBadge.className = 'engine-line-eval';
      const cp = parseFloat(lineData.eval);
      if (!isNaN(cp)) evalBadge.classList.add(cp >= 0 ? 'positive' : 'negative');
      evalBadge.textContent = lineData.eval;
      rowEl.appendChild(evalBadge);
    }

    let t2 = startTurn;
    let moveNum2 = startMoveNum;
    // currentRow: 현재 수들이 추가되는 행 (서브라인 삽입 후 교체됨)
    let currentRow = rowEl;

    // 엔진라인 수들
    lineData.moves.forEach((san, mi) => {
      const needsNum = t2 === 'w' || mi === 0 || currentRow._needsMoveNum;
      if (needsNum) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = t2 === 'w' ? moveNum2 + '.' : moveNum2 + '...';
        currentRow.appendChild(ns);
        currentRow._needsMoveNum = false;
      }
      const ms = document.createElement('span');
      ms.className = `var-move${mi === activeIdx ? ' active' : ''}`;
      ms.innerHTML = _sanToMoveCellHTML(san, t2);
      ms.addEventListener('click', () => this._applyEngineLine(histIdxSnap, pvIdx, mi));
      currentRow.appendChild(ms);

      if (t2 === 'b') moveNum2++;
      t2 = t2 === 'w' ? 'b' : 'w';

      // 이 수 이후 분기 서브라인 → 행 끊기 + 서브라인 + 새 행
      const branchKey = `engine:${mi}`;
      const branchHere = allSubLines.filter(sl => sl.parentLineId === lineData.id && sl.branchAt === branchKey);
      if (branchHere.length > 0) {
        for (const sl of branchHere) {
          this._renderSubLineInside(sl, allSubLines, histIdxSnap, outerBlock);
        }
        // 새 행 시작 — 나머지 수들은 여기에 추가
        const nextRow = document.createElement('div');
        nextRow.className = 'var-line-row var-line-continued';
        outerBlock.appendChild(nextRow);
        currentRow = nextRow;
        // 수번호 컨텍스트 리셋 플래그 (다음 수에서 수번호를 항상 표시)
        currentRow._needsMoveNum = true;
      }
    });

    // ── extraMoves ──
    const extraMoves = lineData.extraMoves || [];
    if (extraMoves.length > 0) {
      t2 = extraMoves[0].turn;
      moveNum2 = extraMoves[0].fullMove;
    }
    extraMoves.forEach((em, ei) => {
      if (ei === 0) {
        const sep = document.createElement('span');
        sep.className = 'branch-sep';
        sep.title = '직접 둔 수';
        currentRow.appendChild(sep);
      }
      if (t2 === 'w' || currentRow._needsMoveNum) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = moveNum2 + '.';
        currentRow.appendChild(ns);
        currentRow._needsMoveNum = false;
      } else if (t2 === 'b' && ei === 0) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = moveNum2 + '...';
        currentRow.appendChild(ns);
      }
      const ms = document.createElement('span');
      ms.className = `var-move extra-move${ei === extraMoveIdx ? ' active' : ''}`;
      ms.innerHTML = _sanToMoveCellHTML(em.san, t2);
      ms.addEventListener('click', () => this._applyEngineLineExtra(histIdxSnap, pvIdx, ei));
      currentRow.appendChild(ms);

      if (t2 === 'b') moveNum2++;
      t2 = t2 === 'w' ? 'b' : 'w';

      const extraBranchKey = `extra:${ei}`;
      const extraBranchHere = allSubLines.filter(sl => sl.parentLineId === lineData.id && sl.branchAt === extraBranchKey);
      if (extraBranchHere.length > 0) {
        for (const sl of extraBranchHere) {
          this._renderSubLineInside(sl, allSubLines, histIdxSnap, outerBlock);
        }
        const nextRow = document.createElement('div');
        nextRow.className = 'var-line-row var-line-continued';
        outerBlock.appendChild(nextRow);
        currentRow = nextRow;
        currentRow._needsMoveNum = true;
      }
    });

    // 닫기 버튼
    const closeBtn = document.createElement('span');
    closeBtn.className = 'var-close';
    closeBtn.title = multiRoot ? '이 라인 삭제' : '닫기';
    closeBtn.textContent = '✕';
    const closePvIdx = pvIdx;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (multiRoot) {
        const ls = this.enginePreviews[histIdxSnap];
        if (ls) {
          const target = ls.find(l => l.pvIdx === closePvIdx);
          const targetId = target?.id;
          this.enginePreviews[histIdxSnap] = ls.filter(l =>
            l.pvIdx !== closePvIdx && l.parentLineId !== targetId
          );
          if (this.enginePreview?.pvIdx === closePvIdx) {
            this.enginePreview = null;
            _engineLineAnalysisFen = null;
            this._applyHistState(histIdxSnap);
          }
        }
        this.renderMoveList();
      } else {
        this.removeEnginePreviewAt(histIdxSnap);
      }
    });
    currentRow.appendChild(closeBtn);
  }

  // ── 서브라인을 부모 outerBlock 안에 들여쓰기하여 렌더 (재귀) ──
  _renderSubLineInside(subLine, allSubLines, histIdxSnap, parentOuter) {
    const pvIdx = subLine.pvIdx;
    const histIdx = histIdxSnap;
    const { startTurn, startMoveNum } = this._getBranchStartContext(histIdx, subLine.branchAt, subLine.parentLineId);

    const isActiveLine = this.enginePreview &&
      this.enginePreview.histIdx === histIdx &&
      this.enginePreview.pvIdx === pvIdx;
    const activeIdx    = isActiveLine ? (this.enginePreview.activeIdx    ?? -1) : -1;
    const extraMoveIdx = isActiveLine ? (this.enginePreview.extraMoveIdx ?? -1) : -1;

    // 서브라인 외부 컨테이너 (들여쓰기 + 왼쪽 초록 선)
    const subOuter = document.createElement('div');
    subOuter.className = 'sub-line-outer' + (isActiveLine ? ' active-engine-line' : '');

    // 수 행
    const rowEl = document.createElement('div');
    rowEl.className = 'var-line-row';
    subOuter.appendChild(rowEl);

    // 평가 배지
    if (subLine.eval) {
      const evalBadge = document.createElement('span');
      evalBadge.className = 'engine-line-eval';
      const cp = parseFloat(subLine.eval);
      if (!isNaN(cp)) evalBadge.classList.add(cp >= 0 ? 'positive' : 'negative');
      evalBadge.textContent = subLine.eval;
      rowEl.appendChild(evalBadge);
    }

    let t2 = startTurn;
    let moveNum2 = startMoveNum;
    let currentRow = rowEl;

    subLine.moves.forEach((san, mi) => {
      const needsNum = t2 === 'w' || mi === 0 || currentRow._needsMoveNum;
      if (needsNum) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = t2 === 'w' ? moveNum2 + '.' : moveNum2 + '...';
        currentRow.appendChild(ns);
        currentRow._needsMoveNum = false;
      }
      const ms = document.createElement('span');
      ms.className = `var-move${mi === activeIdx ? ' active' : ''}`;
      ms.innerHTML = _sanToMoveCellHTML(san, t2);
      ms.addEventListener('click', () => this._applyEngineLine(histIdxSnap, pvIdx, mi));
      currentRow.appendChild(ms);
      if (t2 === 'b') moveNum2++;
      t2 = t2 === 'w' ? 'b' : 'w';

      // 재귀: 이 서브라인의 자식 서브라인 — 행 끊고 삽입
      const branchKey = `engine:${mi}`;
      const branchHere = allSubLines.filter(sl => sl.parentLineId === subLine.id && sl.branchAt === branchKey);
      if (branchHere.length > 0) {
        for (const child of branchHere) {
          this._renderSubLineInside(child, allSubLines, histIdxSnap, subOuter);
        }
        const nextRow = document.createElement('div');
        nextRow.className = 'var-line-row var-line-continued';
        subOuter.appendChild(nextRow);
        currentRow = nextRow;
        currentRow._needsMoveNum = true;
      }
    });

    // extraMoves
    const extraMoves = subLine.extraMoves || [];
    if (extraMoves.length > 0) {
      t2 = extraMoves[0].turn;
      moveNum2 = extraMoves[0].fullMove;
    }
    extraMoves.forEach((em, ei) => {
      if (ei === 0) {
        const sep = document.createElement('span');
        sep.className = 'branch-sep';
        currentRow.appendChild(sep);
      }
      const needsNum2 = t2 === 'w' || (t2 === 'b' && ei === 0) || currentRow._needsMoveNum;
      if (needsNum2) {
        const ns = document.createElement('span');
        ns.className = 'var-num';
        ns.textContent = t2 === 'w' ? moveNum2 + '.' : moveNum2 + '...';
        currentRow.appendChild(ns);
        currentRow._needsMoveNum = false;
      }
      const ms = document.createElement('span');
      ms.className = `var-move extra-move${ei === extraMoveIdx ? ' active' : ''}`;
      ms.innerHTML = _sanToMoveCellHTML(em.san, t2);
      ms.addEventListener('click', () => this._applyEngineLineExtra(histIdxSnap, pvIdx, ei));
      currentRow.appendChild(ms);
      if (t2 === 'b') moveNum2++;
      t2 = t2 === 'w' ? 'b' : 'w';

      const extraBranchKey = `extra:${ei}`;
      const extraBranchHere = allSubLines.filter(sl => sl.parentLineId === subLine.id && sl.branchAt === extraBranchKey);
      if (extraBranchHere.length > 0) {
        for (const child of extraBranchHere) {
          this._renderSubLineInside(child, allSubLines, histIdxSnap, subOuter);
        }
        const nextRow = document.createElement('div');
        nextRow.className = 'var-line-row var-line-continued';
        subOuter.appendChild(nextRow);
        currentRow = nextRow;
        currentRow._needsMoveNum = true;
      }
    });

    // 닫기
    const closeBtn = document.createElement('span');
    closeBtn.className = 'var-close';
    closeBtn.title = '서브라인 삭제';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ls = this.enginePreviews[histIdx];
      if (!ls) return;
      // 이 서브라인 및 자식 서브라인 모두 삭제
      const toDelete = new Set();
      const collect = (id) => {
        ls.forEach(l => { if (l.parentLineId === id) { toDelete.add(l.pvIdx); collect(l.id); } });
      };
      toDelete.add(pvIdx);
      collect(subLine.id);
      this.enginePreviews[histIdx] = ls.filter(l => !toDelete.has(l.pvIdx));
      if (this.enginePreview?.pvIdx === pvIdx) {
        this.enginePreview = null;
        _engineLineAnalysisFen = null;
        this._applyHistState(histIdx);
        this.historyIndex = histIdx;
        this.selectedSq = null; this.possibleMoves = [];
        this.renderBoard(); this.updateStatus(); analyzePosition(true);
      }
      this.renderMoveList();
    });
    currentRow.appendChild(closeBtn);

    parentOuter.appendChild(subOuter);
  }

  // 구버전 _renderSubLine — 호환성 유지 (내부 호출 없음)
  _renderSubLine(subLine, allSubLines, histIdxSnap, el) {
    // _renderSubLineInside로 대체됨 — 빈 구현
  }

  // ── 분기 시작 컨텍스트 계산 ─────────────────────────────────
  // subLine의 branchAt 기준으로 시작 턴/수번호 계산
  // 부모가 루트가 아닌 서브라인일 수도 있으므로 부모 라인을 추적
  _getBranchStartContext(histIdx, branchAt, parentLineId) {
    const lines = this.enginePreviews[histIdx] || [];

    // 기준 루트 시작 턴/수번호
    let rootTurn, rootMoveNum;
    if (histIdx >= 0 && this.history[histIdx]) {
      const s = this.history[histIdx];
      rootTurn = s.turn === 'w' ? 'b' : 'w';
      rootMoveNum = s.turn === 'b' ? s.fullMove + 1 : s.fullMove;
    } else {
      rootTurn = 'w'; rootMoveNum = 1;
    }

    if (!branchAt || branchAt === -1) {
      return { startTurn: rootTurn, startMoveNum: rootMoveNum };
    }

    // 부모 라인의 시작 컨텍스트를 재귀로 계산한 뒤,
    // 거기서 branchAt까지만 수를 소비 → 서브라인의 시작점
    const _computeLineStart = (line) => {
      // 루트라인이면 기준 상태에서 시작
      if (!line.parentLineId || !line.branchAt || line.branchAt === -1) {
        return { t: rootTurn, mn: rootMoveNum };
      }
      // 서브라인이면: 부모의 시작 컨텍스트 + 부모의 branchAt까지 소비
      const parent = lines.find(l => l.id === line.parentLineId);
      if (!parent) return { t: rootTurn, mn: rootMoveNum };
      const parentStart = _computeLineStart(parent);
      let t = parentStart.t, mn = parentStart.mn;
      // 부모 라인의 branchAt까지만 소비 (inclusive)
      const ba = line.branchAt;
      let consumeCount = 0;
      if (ba.startsWith('engine:')) {
        consumeCount = parseInt(ba.split(':')[1]) + 1;
      } else if (ba.startsWith('extra:')) {
        // 부모의 모든 엔진수 + extra 인덱스까지
        consumeCount = (parent.moves || []).length + parseInt(ba.split(':')[1]) + 1;
      }
      for (let i = 0; i < consumeCount; i++) {
        const wasTurn = t; t = t === 'w' ? 'b' : 'w'; if (wasTurn === 'b') mn++;
      }
      return { t, mn };
    };

    const parentLine = parentLineId
      ? lines.find(l => l.id === parentLineId)
      : lines.find(l => !l.parentLineId);

    if (!parentLine) return { startTurn: rootTurn, startMoveNum: rootMoveNum };

    // 부모의 시작점 계산
    const parentStart = _computeLineStart(parentLine);
    let t = parentStart.t, mn = parentStart.mn;

    // 부모에서 branchAt까지 소비
    let consumeCount = 0;
    if (branchAt.startsWith('engine:')) {
      consumeCount = parseInt(branchAt.split(':')[1]) + 1;
    } else if (branchAt.startsWith('extra:')) {
      consumeCount = (parentLine.moves || []).length + parseInt(branchAt.split(':')[1]) + 1;
    }
    for (let i = 0; i < consumeCount; i++) {
      const wasTurn = t; t = t === 'w' ? 'b' : 'w'; if (wasTurn === 'b') mn++;
    }

    return { startTurn: t, startMoveNum: mn };
  }

  updateStatus() {
    const statusEl = document.getElementById('status-text');
    const allMoves = getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant);

    if (allMoves.length === 0) {
      if (isInCheck(this.board, this.turn)) {
        const winner = this.turn==='w'?'흑':'백';
        statusEl.textContent = `♟ 체크메이트! ${winner} 승리`;
        showToast(`♟ 체크메이트! ${winner} 승리`);
      } else {
        statusEl.textContent = '스테일메이트 - 무승부';
      }
    } else if (isInCheck(this.board, this.turn)) {
      statusEl.textContent = `${this.turn==='w'?'백':'흑'} 체크!`;
    } else {
      statusEl.textContent = `${this.turn==='w'?'백':'흑'}의 차례`;
    }
  }

  parsePGN(pgn) {
    _soundMuted = true;  // PGN 일괄 파싱 중 사운드 비활성화
    try {
    this.variations = [];
    this.currentVariation = null;
    this.enginePreview = null;
    // Parse headers
    const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
    const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);
    const dateMatch  = pgn.match(/\[Date "([^"]+)"\]/);
    const resultMatch= pgn.match(/\[Result "([^"]+)"\]/);
    const openingMatch=pgn.match(/\[Opening "([^"]+)"\]/);
    const eloWhiteMatch=pgn.match(/\[WhiteElo "([^"]+)"\]/);
    const eloBlackMatch=pgn.match(/\[BlackElo "([^"]+)"\]/);

    if (whiteMatch) {
      document.getElementById('info-white').textContent = whiteMatch[1];
      document.getElementById('name-white').textContent = whiteMatch[1];
      document.getElementById('rating-white').textContent = eloWhiteMatch ? eloWhiteMatch[1] : '?';
    }
    if (blackMatch) {
      document.getElementById('info-black').textContent = blackMatch[1];
      document.getElementById('name-black').textContent = blackMatch[1];
      document.getElementById('rating-black').textContent = eloBlackMatch ? eloBlackMatch[1] : '?';
    }
    if (dateMatch)   document.getElementById('info-date').textContent = dateMatch[1];
    if (resultMatch) document.getElementById('info-result').textContent = resultMatch[1];
    if (openingMatch)document.getElementById('info-opening').textContent = openingMatch[1];

    this.reset();

    const cleaned = pgn
      .replace(/\[[^\]]*\]/g,'')
      .replace(/\{[^}]*\}/g,'')
      .replace(/\([^)]*\)/g,'')
      .replace(/\d+\.\.\./g,' ')
      .replace(/\d+\./g,' ')
      .replace(/\s+/g,' ').trim();

    const tokens = cleaned.split(' ').filter(t => t && !['*','1-0','0-1','1/2-1/2'].includes(t));

    for (const token of tokens) {
      const san = token.replace(/[+#!?]/g,'');
      const allMoves = getAllLegalMoves(this.board, this.turn, this.castling, this.enPassant);

      let matched = null;
      if (san==='O-O'||san==='0-0') {
        matched = allMoves.find(m=>m.castle==='K');
      } else if (san==='O-O-O'||san==='0-0-0') {
        matched = allMoves.find(m=>m.castle==='Q');
      } else {
        let type='P', file=null, rank=null, promo=null;
        let s = san.replace(/[+#!?]/g,'');

        const promoMatch=s.match(/=([QRBN])$/);
        if(promoMatch){promo=promoMatch[1];s=s.replace(/=[QRBN]$/,'');}
        if('KQRBN'.includes(s[0])){type=s[0];s=s.slice(1);}
        s=s.replace('x','');

        if (s.length>=2) {
          const toFile=s[s.length-2], toRank=s[s.length-1];
          const disambig=s.slice(0,s.length-2);
          if(disambig){
            if('abcdefgh'.includes(disambig))file=disambig;
            else if('12345678'.includes(disambig))rank=disambig;
            else if(disambig.length===2){file=disambig[0];rank=disambig[1];}
          }
          const toC=FILES.indexOf(toFile), toR=8-parseInt(toRank);

          matched=allMoves.find(m=>{
            const p=this.board[m.from[0]][m.from[1]];
            if(!p||p[1]!==type)return false;
            if(m.to[0]!==toR||m.to[1]!==toC)return false;
            if(file&&FILES[m.from[1]]!==file)return false;
            if(rank&&(8-m.from[0]).toString()!==rank)return false;
            return true;
          });
          if(matched&&promo)matched.promoPiece=promo;
        }
      }

      if (matched) {
        this.makeMove(matched, matched.promoPiece||null);
      }
    }

    this.goToStart();
    setTimeout(()=>this.goToEnd(),50);
    } finally {
      _soundMuted = false;  // 파싱 완료 후 사운드 복원
    }
  }
}

// ui.js 내용 (analyzePosition은 engine.js에 있음)
// ===== EVAL BAR =====
function updateEvalBarFromCp(cpFromWhite, evalStr) {
  const maxCp = 800;
  const clamped = Math.max(-maxCp, Math.min(maxCp, cpFromWhite));
  const pct = 50 + (clamped / maxCp) * 45;
  const whitePct = Math.max(5, Math.min(95, pct));
  const blackPct = 100 - whitePct;

  document.getElementById('eval-bar-fill').style.height = whitePct + '%';
  document.getElementById('eval-bar-black').style.height = blackPct + '%';

  // Format score string — evalStr(M1 등)이 있으면 그대로 사용
  let scoreStr;
  if (evalStr && typeof evalStr === 'string' && (evalStr.includes('M') || evalStr.includes('m'))) {
    scoreStr = evalStr;
  } else if (typeof cpFromWhite === 'string' && cpFromWhite.startsWith('M')) {
    scoreStr = cpFromWhite;
  } else if (Math.abs(cpFromWhite) >= 9000) {
    // 메이트 cp(±9900)가 evalStr 없이 들어온 경우
    scoreStr = cpFromWhite > 0 ? 'M?' : '-M?';
  } else {
    const val = cpFromWhite / 100;
    if (val > 0) scoreStr = '+' + val.toFixed(1);
    else if (val < 0) scoreStr = val.toFixed(1);
    else scoreStr = '0.0';
  }

  // Show score on the correct side
  const blackLabel = document.getElementById('eval-score-black');
  const whiteLabel = document.getElementById('eval-score-white');

  if (cpFromWhite >= 0) {
    // White is better → show score in white area (bottom)
    whiteLabel.textContent = scoreStr;
    whiteLabel.style.color = '#222';
    whiteLabel.style.opacity = '1';
    blackLabel.textContent = '';
    blackLabel.style.opacity = '0';
  } else {
    // Black is better → show score in black area (top)
    blackLabel.textContent = scoreStr;
    blackLabel.style.color = '#ddd';
    blackLabel.style.opacity = '1';
    whiteLabel.textContent = '';
    whiteLabel.style.opacity = '0';
  }
}