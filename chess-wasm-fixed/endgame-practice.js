/**
 * 엔드게임 연습: chess-wasm-fixed.html?practice=endgame&topic=KEY
 * 학습 카드는 practice.html?mode=endgame&topic=KEY 로 연결됨 (chess-wasm-fixed/practice-page.js 의 ENDGAME_TOPICS 와 동기화)
 */
(function () {
  var POSITIONS = {
    square_rule: {
      fen: '8/8/8/8/3p4/8/3P4/3K4 w - - 0 1',
      myColor: 'w',
      title: '사각형 규칙',
    },
    king_pawn_vs_king: {
      fen: '8/8/8/8/8/4P3/4K3/3k4 w - - 0 1',
      myColor: 'w',
      title: '킹+폰 vs 킹',
    },
    rook_knight_pawn: {
      fen: '8/8/8/8/8/4P3/4K3/3k4 w - - 0 1',
      myColor: 'w',
      title: '룩폰·나이트폰',
    },
    connected_passed: {
      fen: '8/8/8/8/3p4/1P2P3/4K3/3k4 w - - 0 1',
      myColor: 'w',
      title: '연결된 통과폰',
    },
    breakthrough: {
      fen: '8/8/8/8/8/PP6/4K3/3k4 w - - 0 1',
      myColor: 'w',
      title: '돌파',
    },
    bar_rule: {
      fen: '8/8/8/8/8/1p6/6P1/6K1 w - - 0 1',
      myColor: 'w',
      title: '바의 규칙',
    },
    philidor: {
      fen: '6k1/8/8/8/1p5/6P1/6P1/6K1 b - - 0 1',
      myColor: 'b',
      title: '필리도어',
    },
    lucena: {
      fen: '3K4/3P1k2/8/8/8/8/8/3R4 w - - 0 1',
      myColor: 'w',
      title: '루세나',
    },
    short_side_defense: {
      fen: '6k1/8/8/8/8/1p6/6P1/6K1 w - - 0 1',
      myColor: 'w',
      title: '숏 사이드 디펜스',
    },
    mate_king_queen_vs_king: {
      fen: '6k1/8/8/8/8/8/6K1/3Q4 w - - 0 1',
      myColor: 'w',
      title: '킹·퀸 vs 킹',
    },
    mate_king_rook_vs_king: {
      fen: '6k1/8/8/8/8/8/6K1/3R4 w - - 0 1',
      myColor: 'w',
      title: '킹·룩 vs 킹',
    },
    rook_vs_queen: {
      fen: '5k2/8/8/8/8/8/6r1/2K1Q3 w - - 0 1',
      myColor: 'w',
      title: '룩 vs 퀸',
    },
    queen_vs_pawn: {
      fen: '8/8/8/8/8/4p3/2K5/3Q4 w - - 0 1',
      myColor: 'w',
      title: '퀸 vs 폰',
    },
  };

  function getFenForEngine() {
    return boardToFen(game.board, game.turn, game.castling, game.enPassant, game.halfMove, game.fullMove);
  }

  function scheduleEngineTurn() {
    if (!window._enginePracticeMode || !game) return;
    if (game.turn === window._enginePracticeMode.myColor) return;
    window._enginePracticeThinking = true;
    var fen = getFenForEngine();
    executeEnginePlayMove(fen, function (uci) {
      window._enginePracticeThinking = false;
      if (!uci || !window._enginePracticeMode) {
        analyzePosition(true);
        return;
      }
      var mv = uciToMove(uci, game.board, game.turn, game.castling, game.enPassant);
      if (!mv) {
        showToast('엔진 수 적용 실패');
        analyzePosition(true);
        return;
      }
      game.makeMove(mv, mv.promoPiece || null);
      analyzePosition(true);
    });
  }

  window._enginePracticeAfterHumanMove = function () {
    scheduleEngineTurn();
  };

  window.tryInitEndgamePractice = function () {
    if (!game || typeof executeEnginePlayMove !== 'function') return;
    var params = new URLSearchParams(window.location.search);
    if (params.get('practice') !== 'endgame') return;
    var topic = params.get('topic') || '';
    var cfg = POSITIONS[topic];
    if (!cfg) {
      showToast('알 수 없는 엔드게임 주제: ' + topic);
      return;
    }
    window._enginePracticeMode = { myColor: cfg.myColor, title: cfg.title };
    window._enginePracticeThinking = false;
    game.loadFromFen(cfg.fen);
    if (cfg.myColor === 'b' && !game.flipped) {
      game.flipBoard();
    }
    document.title = '엔드게임 · ' + cfg.title + ' — Stockfish';
    showToast('엔드게임 연습: ' + cfg.title + ' — 상대는 Stockfish(최선수)');
    scheduleEngineTurn();
  };
})();
