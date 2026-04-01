/**
 * practice.html — 오프닝·미들·엔드게임 대전 연습 (상대: Stockfish 최선수)
 */
(function () {
  'use strict';

  const PHASE = {
    opening: {
      title: '오프닝',
      useReset: true,
    },
    middlegame: {
      title: '미들게임',
      fen: 'r2q1rk1/ppp2ppp/2npbn2/2B1p3/3PP3/2N2N2/PPP2PPP/R1BQ1RK1 w - - 0 11',
    },
    endgame: {
      title: '엔드게임',
      fen: '6k1/8/8/8/8/8/6K1/3Q4 w - - 0 1',
    },
  };

  function readPhaseFromUrl() {
    try {
      const q = new URLSearchParams(location.search).get('mode');
      if (q && PHASE[q]) return q;
    } catch (e) { /* ignore */ }
    return 'opening';
  }

  function readStoredColor() {
    try {
      const s = localStorage.getItem('chess_practice_human_color');
      if (s === 'b' || s === 'w') return s;
    } catch (e) { /* ignore */ }
    return 'w';
  }

  function scheduleEngineTurn() {
    if (!window._enginePracticeMode || typeof game === 'undefined' || !game) return;
    if (game.turn === window._enginePracticeMode.myColor) return;
    window._enginePracticeThinking = true;
    var fen = boardToFen(game.board, game.turn, game.castling, game.enPassant, game.halfMove, game.fullMove);
    executeEnginePlayMove(fen, function (uci) {
      window._enginePracticeThinking = false;
      if (!uci || !window._enginePracticeMode) {
        if (typeof analyzePosition === 'function') analyzePosition(true);
        return;
      }
      var mv = uciToMove(uci, game.board, game.turn, game.castling, game.enPassant);
      if (!mv) {
        if (typeof showToast === 'function') showToast('엔진 수 적용 실패');
        if (typeof analyzePosition === 'function') analyzePosition(true);
        return;
      }
      game.makeMove(mv, mv.promoPiece || null);
      if (typeof analyzePosition === 'function') analyzePosition(true);
    });
  }

  window._enginePracticeAfterHumanMove = function () {
    scheduleEngineTurn();
  };

  function applyHumanFlip(humanColor) {
    var wantFlip = humanColor === 'b';
    if (wantFlip && !game.flipped) game.flipBoard();
    else if (!wantFlip && game.flipped) game.flipBoard();
  }

  function setPlayerLabels(humanColor) {
    var nw = document.getElementById('name-white');
    var nb = document.getElementById('name-black');
    var rw = document.getElementById('rating-white');
    var rb = document.getElementById('rating-black');
    if (nw) nw.textContent = humanColor === 'w' ? '나 (백)' : 'Stockfish';
    if (nb) nb.textContent = humanColor === 'b' ? '나 (흑)' : 'Stockfish';
    if (rw) rw.textContent = humanColor === 'w' ? '연습' : 'SF18';
    if (rb) rb.textContent = humanColor === 'b' ? '연습' : 'SF18';
  }

  function syncModeButtons(phase) {
    document.querySelectorAll('[data-practice-mode]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-practice-mode') === phase);
    });
  }

  function syncColorButtons(hc) {
    document.querySelectorAll('[data-human-color]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-human-color') === hc);
    });
  }

  function currentPhaseFromUI() {
    var el = document.querySelector('[data-practice-mode].active');
    if (el) return el.getAttribute('data-practice-mode');
    return readPhaseFromUrl();
  }

  function currentHumanColorFromUI() {
    var el = document.querySelector('[data-human-color].active');
    if (el) return el.getAttribute('data-human-color');
    return readStoredColor();
  }

  function activatePractice(phaseKey, humanColor) {
    var cfg = PHASE[phaseKey];
    if (!cfg || typeof game === 'undefined' || !game) return;

    window._enginePracticeThinking = false;
    window._enginePracticeMode = {
      myColor: humanColor,
      title: cfg.title,
      phase: phaseKey,
    };

    if (cfg.useReset) {
      game.reset();
    } else if (cfg.fen) {
      game.loadFromFen(cfg.fen);
    }

    applyHumanFlip(humanColor);
    setPlayerLabels(humanColor);

    document.title = '연습 · ' + cfg.title + ' — Stockfish';

    var el = document.getElementById('practice-phase-label');
    if (el) el.textContent = cfg.title;

    if (typeof analyzePosition === 'function') analyzePosition(true);
    scheduleEngineTurn();
  }

  window.tryInitPracticePage = function () {
    if (!document.body || !document.body.classList.contains('practice-page')) return;
    var phase = currentPhaseFromUI();
    if (!PHASE[phase]) phase = 'opening';
    var hc = currentHumanColorFromUI();
    syncModeButtons(phase);
    syncColorButtons(hc);
    activatePractice(phase, hc);
  };

  window.practiceNewGame = function () {
    window.tryInitPracticePage();
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.body.classList.contains('practice-page')) return;

    document.querySelectorAll('[data-practice-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var phase = btn.getAttribute('data-practice-mode');
        if (!PHASE[phase]) return;
        syncModeButtons(phase);
        try {
          history.replaceState(null, '', 'practice.html?mode=' + encodeURIComponent(phase));
        } catch (e) { /* ignore */ }
        var hc = currentHumanColorFromUI();
        activatePractice(phase, hc);
      });
    });

    document.querySelectorAll('[data-human-color]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hc = btn.getAttribute('data-human-color');
        try {
          localStorage.setItem('chess_practice_human_color', hc);
        } catch (e) { /* ignore */ }
        syncColorButtons(hc);
        var phase = currentPhaseFromUI();
        if (!PHASE[phase]) phase = 'opening';
        activatePractice(phase, hc);
      });
    });

    var newGame = document.getElementById('practice-new-game');
    if (newGame) newGame.addEventListener('click', function () { window.practiceNewGame(); });
  });
})();
