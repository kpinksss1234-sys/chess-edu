/**
 * practice.html — 오프닝·미들·엔드게임 대전 연습 (상대: Stockfish 최선수)
 *
 * 학습 엔드게임 카드: practice.html?mode=endgame&topic=square_rule 등
 * (endgame-practice.js POSITIONS 와 동일 데이터)
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

  /** 학습 페이지 카드와 동일 엔드게임 포지션 */
  const ENDGAME_TOPICS = {
    square_rule:        { fen: '8/1p4p1/5b1p/8/P2B4/2P5/1Pk2KP1/8 w - - 2 2',           myColor: 'w', title: '사각형 규칙' },
    king_pawn_vs_king:  { fen: '8/8/8/8/8/4P3/4K3/3k4 w - - 0 1',           myColor: 'w', title: '킹+폰 vs 킹' },
    rook_knight_pawn:   { fen: '8/8/8/8/8/4P3/4K3/3k4 w - - 0 1',           myColor: 'w', title: '룩폰·나이트폰' },
    connected_passed: { fen: '8/8/8/8/3p4/1P2P3/4K3/3k4 w - - 0 1',       myColor: 'w', title: '연결된 통과폰' },
    breakthrough:      { fen: '8/8/8/8/8/PP6/4K3/3k4 w - - 0 1',           myColor: 'w', title: '돌파' },
    bar_rule:          { fen: '8/8/8/8/8/1p6/6P1/6K1 w - - 0 1',          myColor: 'w', title: '바의 규칙' },
    philidor:          { fen: '6k1/8/8/8/1p5/6P1/6P1/6K1 b - - 0 1',       myColor: 'b', title: '필리도어' },
    lucena:            { fen: '3K4/3P1k2/8/8/8/8/8/3R4 w - - 0 1',          myColor: 'w', title: '루세나' },
    short_side_defense:{ fen: '6k1/8/8/8/8/1p6/6P1/6K1 w - - 0 1',         myColor: 'w', title: '숏 사이드 디펜스' },
    mate_king_queen_vs_king: { fen: '6k1/8/8/8/8/8/6K1/3Q4 w - - 0 1',     myColor: 'w', title: '킹·퀸 vs 킹' },
    mate_king_rook_vs_king:  { fen: '6k1/8/8/8/8/8/6K1/3R4 w - - 0 1',     myColor: 'w', title: '킹·룩 vs 킹' },
    rook_vs_queen:     { fen: '5k2/8/8/8/8/8/6r1/2K1Q3 w - - 0 1',         myColor: 'w', title: '룩 vs 퀸' },
    queen_vs_pawn:     { fen: '8/8/8/8/8/4p3/2K5/3Q4 w - - 0 1',           myColor: 'w', title: '퀸 vs 폰' },
  };

  function readTopicFromUrl() {
    try {
      const t = new URLSearchParams(location.search).get('topic');
      return t && ENDGAME_TOPICS[t] ? t : null;
    } catch (e) { /* ignore */ }
    return null;
  }

  function replacePracticeUrl(mode, topicKey) {
    try {
      let qs = 'mode=' + encodeURIComponent(mode);
      if (topicKey) qs += '&topic=' + encodeURIComponent(topicKey);
      history.replaceState(null, '', 'practice.html?' + qs);
    } catch (e) { /* ignore */ }
  }

  function readPhaseFromUrl() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('topic') && ENDGAME_TOPICS[q.get('topic')]) return 'endgame';
      const mode = q.get('mode');
      if (mode && PHASE[mode]) return mode;
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
      if (!uci || !window._enginePracticeMode) {
        window._enginePracticeThinking = false;
        if (typeof analyzePosition === 'function') analyzePosition(true);
        return;
      }
      // 1초 딜레이 후 엔진 수 적용 (사용자가 생각할 시간 제공)
      setTimeout(function () {
        window._enginePracticeThinking = false;
        var mv = uciToMove(uci, game.board, game.turn, game.castling, game.enPassant);
        if (!mv) {
          if (typeof showToast === 'function') showToast('엔진 수 적용 실패');
          if (typeof analyzePosition === 'function') analyzePosition(true);
          return;
        }
        game.makeMove(mv, mv.promoPiece || null);
        if (typeof analyzePosition === 'function') analyzePosition(true);
      }, 1000);
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

  function resetHintPanel() {
    var panel = document.getElementById('hint-panel');
    var btn = document.getElementById('hint-toggle-btn');
    if (panel) panel.style.display = 'none';
    if (btn) { btn.classList.remove('active'); btn.title = '힌트 보기'; }
  }

  function activateEndgameTopic(topicKey, humanColor) {
    var t = ENDGAME_TOPICS[topicKey];
    if (!t || typeof game === 'undefined' || !game) return;

    window._enginePracticeThinking = false;
    window._enginePracticeMode = {
      myColor: humanColor,
      title: t.title,
      phase: 'endgame',
      topicKey: topicKey,
    };

    game.loadFromFen(t.fen);
    applyHumanFlip(humanColor);
    setPlayerLabels(humanColor);
    resetHintPanel();

    document.title = '연습 · ' + t.title + ' — Stockfish';

    var el = document.getElementById('practice-phase-label');
    if (el) el.textContent = t.title;

    replacePracticeUrl('endgame', topicKey);

    if (typeof analyzePosition === 'function') analyzePosition(true);
    scheduleEngineTurn();
  }

  function activatePractice(phaseKey, humanColor) {
    var cfg = PHASE[phaseKey];
    if (!cfg || typeof game === 'undefined' || !game) return;

    window._enginePracticeThinking = false;
    window._enginePracticeMode = {
      myColor: humanColor,
      title: cfg.title,
      phase: phaseKey,
      topicKey: null,
    };

    if (cfg.useReset) {
      game.reset();
    } else if (cfg.fen) {
      game.loadFromFen(cfg.fen);
    }

    applyHumanFlip(humanColor);
    setPlayerLabels(humanColor);
    resetHintPanel();

    document.title = '연습 · ' + cfg.title + ' — Stockfish';

    var el = document.getElementById('practice-phase-label');
    if (el) el.textContent = cfg.title;

    if (typeof analyzePosition === 'function') analyzePosition(true);
    scheduleEngineTurn();
  }

  window.tryInitPracticePage = function () {
    if (!document.body || !document.body.classList.contains('practice-page')) return;

    var topic = readTopicFromUrl();
    if (topic) {
      var t = ENDGAME_TOPICS[topic];
      var hc = t.myColor;
      try {
        localStorage.setItem('chess_practice_human_color', hc);
      } catch (e) { /* ignore */ }
      syncModeButtons('endgame');
      syncColorButtons(hc);
      activateEndgameTopic(topic, hc);
      return;
    }

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
        replacePracticeUrl(phase, null);
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
        var topic = readTopicFromUrl();
        if (!topic && window._enginePracticeMode && window._enginePracticeMode.topicKey) {
          topic = window._enginePracticeMode.topicKey;
        }
        if (topic && ENDGAME_TOPICS[topic]) {
          activateEndgameTopic(topic, hc);
        } else {
          var phase = currentPhaseFromUI();
          if (!PHASE[phase]) phase = 'opening';
          activatePractice(phase, hc);
        }
      });
    });

    var newGame = document.getElementById('practice-new-game');
    if (newGame) newGame.addEventListener('click', function () { window.practiceNewGame(); });
  });
  /** ── 힌트 패널 토글 ── */
  window.toggleHintPanel = function () {
    var panel = document.getElementById('hint-panel');
    var btn = document.getElementById('hint-toggle-btn');
    if (!panel || !btn) return;

    var isVisible = panel.style.display !== 'none';
    if (isVisible) {
      panel.style.display = 'none';
      btn.classList.remove('active');
      btn.title = '힌트 보기';
      return;
    }

    // 패널 열기 + 힌트 로드
    panel.style.display = 'block';
    btn.classList.add('active');
    btn.title = '힌트 숨기기';

    var hintContent = document.getElementById('hint-content');
    if (!hintContent) return;

    // 현재 연습 중인 topic 또는 phase 키 결정
    var key = null;
    if (window._enginePracticeMode) {
      key = window._enginePracticeMode.topicKey || window._enginePracticeMode.phase || null;
    }
    if (!key) key = readTopicFromUrl() || readPhaseFromUrl();

    // hints.js 에 정의된 HINT_TEXT 에서 내용 조회
    var hints = (typeof window.HINT_TEXT !== 'undefined') ? window.HINT_TEXT : {};
    var hint = key ? hints[key] : null;

    if (hint) {
      hintContent.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:var(--accent-green-bright);margin-bottom:6px">💡 ' +
        (hint.title || '힌트') + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.6">' +
        hint.body.replace(/\n/g, '<br>') + '</div>';
    } else {
      hintContent.innerHTML =
        '<span style="color:var(--text-muted);font-size:12px">이 포지션에 등록된 힌트가 없습니다.</span>';
    }
  };

})();
