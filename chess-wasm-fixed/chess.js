// ── abortController 폴백 (WASM에서는 사용 안 함) ─────────────
let abortController = null;

// ===== LICHESS PIECE IMAGE URLS =====
const PIECE_STYLE_BASE = 'https://lichess1.org/assets/piece/';
let currentPieceStyle = 'cburnett';

function pieceImg(piece) {
  // piece = 'wK', 'bP', etc.
  return `${PIECE_STYLE_BASE}${currentPieceStyle}/${piece}.svg`;
}

const PIECE_NAMES = {
  wK:'wK', wQ:'wQ', wR:'wR', wB:'wB', wN:'wN', wP:'wP',
  bK:'bK', bQ:'bQ', bR:'bR', bB:'bB', bN:'bN', bP:'bP'
};

const PIECE_VALUES = { P:1, N:3, B:3, R:5, Q:9, K:0 };

const INIT_BOARD = [
  ['bR','bN','bB','bQ','bK','bB','bN','bR'],
  ['bP','bP','bP','bP','bP','bP','bP','bP'],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null],
  ['wP','wP','wP','wP','wP','wP','wP','wP'],
  ['wR','wN','wB','wQ','wK','wB','wN','wR'],
];

const FILES = ['a','b','c','d','e','f','g','h'];

// ===== CHESS LOGIC (standalone functions for UCI conversion) =====
function isInBounds(r,c) { return r>=0&&r<8&&c>=0&&c<8; }
function enemyColor(color) { return color==='w'?'b':'w'; }

function pseudoMoves(board, r, c, castling, enPassant) {
  const p=board[r][c]; if(!p) return [];
  const color=p[0], type=p[1], moves=[], enemy=enemyColor(color), dir=color==='w'?-1:1;

  const addMove=(tr,tc,extra={})=>{
    if(isInBounds(tr,tc)){const t=board[tr][tc];if(!t||t[0]===enemy)moves.push({from:[r,c],to:[tr,tc],...extra});}
  };
  const addSlide=(drs,dcs)=>{
    for(let i=0;i<drs.length;i++){
      let nr=r+drs[i],nc=c+dcs[i];
      while(isInBounds(nr,nc)){const t=board[nr][nc];if(t){if(t[0]===enemy)moves.push({from:[r,c],to:[nr,nc]});break;}moves.push({from:[r,c],to:[nr,nc]});nr+=drs[i];nc+=dcs[i];}
    }
  };

  if(type==='P'){
    const nr=r+dir;
    if(isInBounds(nr,c)&&!board[nr][c]){
      moves.push({from:[r,c],to:[nr,c],promo:(nr===0||nr===7)});
      const startRow=color==='w'?6:1, nr2=r+2*dir;
      if(r===startRow&&!board[nr2][c])moves.push({from:[r,c],to:[nr2,c],doublePush:true});
    }
    for(const dc of[-1,1]){
      const tc=c+dc;
      if(isInBounds(nr,tc)){
        if(board[nr][tc]&&board[nr][tc][0]===enemy)moves.push({from:[r,c],to:[nr,tc],promo:(nr===0||nr===7)});
        if(enPassant&&enPassant[0]===nr&&enPassant[1]===tc)moves.push({from:[r,c],to:[nr,tc],enPassant:true});
      }
    }
  } else if(type==='N'){
    for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])addMove(r+dr,c+dc);
  } else if(type==='B'){
    addSlide([-1,-1,1,1],[-1,1,-1,1]);
  } else if(type==='R'){
    addSlide([-1,1,0,0],[0,0,-1,1]);
  } else if(type==='Q'){
    addSlide([-1,1,0,0,-1,-1,1,1],[0,0,-1,1,-1,1,-1,1]);
  } else if(type==='K'){
    for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])addMove(r+dr,c+dc);
    if(color==='w'&&r===7&&c===4){
      if(castling.wK&&!board[7][5]&&!board[7][6]&&board[7][7]==='wR')moves.push({from:[7,4],to:[7,6],castle:'K'});
      if(castling.wQ&&!board[7][3]&&!board[7][2]&&!board[7][1]&&board[7][0]==='wR')moves.push({from:[7,4],to:[7,2],castle:'Q'});
    }
    if(color==='b'&&r===0&&c===4){
      if(castling.bK&&!board[0][5]&&!board[0][6]&&board[0][7]==='bR')moves.push({from:[0,4],to:[0,6],castle:'K'});
      if(castling.bQ&&!board[0][3]&&!board[0][2]&&!board[0][1]&&board[0][0]==='bR')moves.push({from:[0,4],to:[0,2],castle:'Q'});
    }
  }
  return moves;
}

function isAttacked(board, r, c, byColor) {
  const enemy=byColor, pDir=enemy==='w'?1:-1;
  for(const dc of[-1,1]){const pr=r+pDir,pc=c+dc;if(isInBounds(pr,pc)&&board[pr][pc]===`${enemy}P`)return true;}
  for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){const nr=r+dr,nc=c+dc;if(isInBounds(nr,nc)&&board[nr][nc]===`${enemy}N`)return true;}
  for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){let nr=r+dr,nc=c+dc;while(isInBounds(nr,nc)){const t=board[nr][nc];if(t){if(t===`${enemy}B`||t===`${enemy}Q`)return true;break;}nr+=dr;nc+=dc;}}
  for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){let nr=r+dr,nc=c+dc;while(isInBounds(nr,nc)){const t=board[nr][nc];if(t){if(t===`${enemy}R`||t===`${enemy}Q`)return true;break;}nr+=dr;nc+=dc;}}
  for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){const nr=r+dr,nc=c+dc;if(isInBounds(nr,nc)&&board[nr][nc]===`${enemy}K`)return true;}
  return false;
}

function findKing(board,color){for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]===`${color}K`)return[r,c];return null;}
function isInCheck(board,color){const[kr,kc]=findKing(board,color);return isAttacked(board,kr,kc,enemyColor(color));}

function applyMoveToBoard(board, move, color) {
  const[fr,fc]=move.from,[tr,tc]=move.to,p=board[fr][fc];
  board[tr][tc]=p;board[fr][fc]=null;
  if(move.enPassant){const captureRow=color==='w'?tr+1:tr-1;board[captureRow][tc]=null;}
  if(move.castle==='K'){board[fr][7]=null;board[fr][5]=`${color}R`;}
  else if(move.castle==='Q'){board[fr][0]=null;board[fr][3]=`${color}R`;}
  if(move.promoPiece){board[tr][tc]=`${color}${move.promoPiece}`;}
  return board;
}

function legalMoves(board, r, c, castling, enPassant) {
  const p=board[r][c];if(!p)return[];
  const color=p[0],pseudo=pseudoMoves(board,r,c,castling,enPassant),legal=[];
  for(const move of pseudo){
    const nb=applyMoveToBoard(board.map(r=>[...r]),move,color);
    if(!isInCheck(nb,color)){
      if(move.castle){
        const midC=move.castle==='K'?5:3;
        const midBoard=board.map(r=>[...r]);
        midBoard[move.from[0]][midC]=`${color}K`;midBoard[move.from[0]][move.from[1]]=null;
        if(isInCheck(board,color))continue;
        if(isAttacked(midBoard,move.from[0],midC,enemyColor(color)))continue;
      }
      legal.push(move);
    }
  }
  return legal;
}

function getAllLegalMoves(board, color, castling, enPassant) {
  const moves=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]&&board[r][c][0]===color)moves.push(...legalMoves(board,r,c,castling,enPassant));
  return moves;
}

// SAN 문자열을 move 객체로 변환하는 헬퍼
function sanToMove(san, board, turn, allMoves) {
  const s = san.replace(/[+#!?]/g, '');
  if (s === 'O-O' || s === '0-0') return allMoves.find(m => m.castle === 'K') || null;
  if (s === 'O-O-O' || s === '0-0-0') return allMoves.find(m => m.castle === 'Q') || null;

  let type = 'P', file = null, rank = null, promo = null;
  let raw = s;
  const promoMatch = raw.match(/=([QRBN])$/);
  if (promoMatch) { promo = promoMatch[1]; raw = raw.replace(/=[QRBN]$/, ''); }
  if ('KQRBN'.includes(raw[0])) { type = raw[0]; raw = raw.slice(1); }
  raw = raw.replace('x', '');

  if (raw.length >= 2) {
    const toFile = raw[raw.length - 2], toRank = raw[raw.length - 1];
    const disambig = raw.slice(0, raw.length - 2);
    if (disambig) {
      if ('abcdefgh'.includes(disambig)) file = disambig;
      else if ('12345678'.includes(disambig)) rank = disambig;
      else if (disambig.length === 2) { file = disambig[0]; rank = disambig[1]; }
    }
    const toC = FILES.indexOf(toFile), toR = 8 - parseInt(toRank);
    const matched = allMoves.find(m => {
      const p = board[m.from[0]][m.from[1]];
      if (!p || p[1] !== type) return false;
      if (m.to[0] !== toR || m.to[1] !== toC) return false;
      if (file && FILES[m.from[1]] !== file) return false;
      if (rank && (8 - m.from[0]).toString() !== rank) return false;
      return true;
    });
    if (matched && promo) { matched.promoPiece = promo; }
    return matched || null;
  }
  return null;
}

function moveToSAN(board, move, color, allMoves) {
  const[fr,fc]=move.from,[tr,tc]=move.to,p=board[fr][fc],type=p[1];
  const captured=board[tr][tc]||(move.enPassant?'ep':null);
  let san='';
  if(move.castle==='K')return'O-O';
  if(move.castle==='Q')return'O-O-O';
  if(type!=='P'){
    san+=type;
    const ambig=allMoves.filter(m=>m!==move&&board[m.from[0]][m.from[1]]===p&&m.to[0]===tr&&m.to[1]===tc);
    if(ambig.length){
      const sameFile=ambig.some(m=>m.from[1]===fc),sameRank=ambig.some(m=>m.from[0]===fr);
      if(!sameFile)san+=FILES[fc];else if(!sameRank)san+=(8-fr);else san+=FILES[fc]+(8-fr);
    }
  } else if(captured){san+=FILES[fc];}
  if(captured)san+='x';
  san+=FILES[tc]+(8-tr);
  if(move.promo&&move.promoPiece)san+='='+move.promoPiece;
  const nb=applyMoveToBoard(board.map(r=>[...r]),move,color);
  const enemy=enemyColor(color);
  if(isInCheck(nb,enemy)){
    const enemyMoves=getAllLegalMoves(nb,enemy,{wK:false,wQ:false,bK:false,bQ:false},null);
    san+=enemyMoves.length===0?'#':'+';
  }
  return san;
}

// ── FEN 파싱 헬퍼 (engine.js에서 legalMoveCount 계산용) ─────
function parseFenBoard(fenBoard) {
  const board = Array.from({length:8}, ()=>Array(8).fill(null));
  const rows  = fenBoard.split('/');
  if (rows.length !== 8) return null;
  const pieceMap = {
    'P':'wP','N':'wN','B':'wB','R':'wR','Q':'wQ','K':'wK',
    'p':'bP','n':'bN','b':'bB','r':'bR','q':'bQ','k':'bK',
  };
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { c += parseInt(ch); }
      else { board[r][c] = pieceMap[ch] || null; c++; }
    }
  }
  return board;
}

function parseFenCastling(cas) {
  return { wK: cas.includes('K'), wQ: cas.includes('Q'),
           bK: cas.includes('k'), bQ: cas.includes('q') };
}

function parseFenEP(ep) {
  if (ep === '-') return null;
  const col = FILES.indexOf(ep[0]);
  const row = 8 - parseInt(ep[1]);
  return col >= 0 ? [row, col] : null;
}

// ═══════════════════════════════════════════════════════════
// 수 분류 — Lichess 오픈소스 방식 (WinPercent 기반)
// 출처: lichess-org/lila (MIT License)
//   WinPercent.scala, Advice.scala
// ═══════════════════════════════════════════════════════════

// FEN 정규화: halfMove/fullMove 제거 → 포지션 비교 키로 사용
function normFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// ── cp → 승률 변환 (Lichess 오픈소스 공식) ──────────────────
// 출처: lichess-org/lila WinPercent.scala
// cp는 ±1000으로 ceiling 처리 (Lichess 방식)
// 반환값: 0~100 (%), 현재 두는 플레이어 기준
// ── Chess.com 공식 승률 변환 ──────────────────────────────────
// W = 1 / (1 + 10^(-cp / 400))  — 체스닷컴 시그모이드 공식
// cp는 "내 관점" (양수 = 내게 유리), 반환값 [0, 1]
function winProb(cpMe) {
  return 1 / (1 + Math.pow(10, -cpMe / 400));
}

// cpFromWhite(백 기준 cp)와 turn을 받아 내 관점 승률(0~1) 반환
function getWinProb(cpFromWhite, turn) {
  const cpMe = turn === 'w' ? cpFromWhite : -cpFromWhite;
  return winProb(cpMe);
}

// 하위 호환 래퍼: 기존 lichessWinningChances 호출부 대응 ([-1,+1] 형식 유지)
function lichessWinningChances(cpRaw) {
  return winProb(cpRaw) * 2 - 1;
}

// ── 기물 가치 (cp 단위) ──────────────────────────────────────
const PIECE_VALUE = { P:100, N:320, B:330, R:500, Q:900, K:0 };

// ── 희생 수 판정 ─────────────────────────────────────────────
// 진짜 희생 = 즉시 되잡히는 손해 교환이지만 전략적 이유가 있는 수.
//
// 조건:
//   1) 잡는 수이고 내 기물 가치 > 잡은 기물 가치 + 150 (상당한 손해)
//      ※ +50이 아닌 +150: 나이트(320)가 폰(100)을 잡는 것은 희생이 아님
//         (Nxd4처럼 폰을 먹는 나이트 = 정상적인 교환/이득)
//   2) 수를 둔 후 상대가 착지 칸을 즉시 되잡을 수 있어야 함
function isSacrifice(h) {
  if (!h || !h.move || !h.captured) return false;

  // board가 없으면 fenBefore로 복원 (메모리 최적화: history에서 board 제거 대비)
  const board = h.board || (h.fenBefore ? parseFenBoard(h.fenBefore.split(' ')[0]) : null);
  if (!board) return false;

  const movingPiece = board[h.move.from[0]][h.move.from[1]];
  if (!movingPiece) return false;
  const myVal       = PIECE_VALUE[movingPiece[1]] || 0;
  const capturedVal = PIECE_VALUE[h.captured[1]]  || 0;

  if (myVal < 450) return false;
  if (myVal <= capturedVal + 150) return false;

  try {
    const boardAfter = applyMoveToBoard(board.map(r=>[...r]), h.move, h.turn);
    const enemy = h.turn === 'w' ? 'b' : 'w';
    const toR = h.move.to[0];
    const toC = h.move.to[1];

    const castAfter = {...(h.castling || {wK:true,wQ:true,bK:true,bQ:true})};
    if (movingPiece === h.turn + 'K') {
      if (h.turn==='w') { castAfter.wK=false; castAfter.wQ=false; }
      else               { castAfter.bK=false; castAfter.bQ=false; }
    }
    if (h.move.from[0]===7&&h.move.from[1]===7) castAfter.wK=false;
    if (h.move.from[0]===7&&h.move.from[1]===0) castAfter.wQ=false;
    if (h.move.from[0]===0&&h.move.from[1]===7) castAfter.bK=false;
    if (h.move.from[0]===0&&h.move.from[1]===0) castAfter.bQ=false;

    const epAfter = h.move.doublePush
      ? [h.move.to[0] - (h.turn==='w' ? -1 : 1), h.move.to[1]] : null;

    const enemyMoves = getAllLegalMoves(boardAfter, enemy, castAfter, epAfter);
    const canRecapture = enemyMoves.some(m => m.to[0] === toR && m.to[1] === toC);

    if (!canRecapture) return false;
  } catch(e) {
    return myVal > capturedVal + 300;
  }

  return true;
}

// ── 핵심: 수 분류 함수 (Chess.com 공식 방식) ─────────────────
//
// 출처: Chess.com 공식 분류 알고리즘
//   - 승률 변환: W = 1 / (1 + 10^(-cp/400))  [체스닷컴 시그모이드]
//   - ΔW = W_best - W_move  (최선수 승률 − 실제 둔 수 승률)
//
// 분류 기준 (ΔW):
//   Brilliant !! : 기물 희생 + ΔW ≈ 0 + W_move > 0.5
//   Great     !  : 유일수 (top1-top2 ≥ 0.1) 또는 역전 (before<0.5→after>0.6)
//   Best      ⭐ : 엔진 1순위와 동일 (ΔW = 0)
//   Excellent ✅ : ΔW ≤ 0.02
//   Good      👍 : 0.02 < ΔW ≤ 0.05
//   Inaccuracy?! : 0.05 < ΔW ≤ 0.10
//   Mistake   ?  : 0.10 < ΔW ≤ 0.20
//   Blunder   ?? : ΔW > 0.20
//   Miss      ✗  : W_best > 0.8 이었으나 W_move < 0.5
//
// cpBefore : 이 수를 두기 전 포지션 평가 (백 기준 cp)
// cpAfter  : 이 수를 두고 난 후 포지션 평가 (백 기준 cp)
// turn     : 이 수를 둔 플레이어 ('w' | 'b')
// topAlts  : { best1cp, best2cp, hasSacrifice, legalMoveCount,
//              mateInBefore, mateInAfter }
//
function classifyMove(cpBefore, cpAfter, turn, topAlts) {

  // ── 1) 내 관점 cp ────────────────────────────────────────
  const cpMe      = turn === 'w' ? cpBefore : -cpBefore;
  const cpMeAfter = turn === 'w' ? cpAfter  : -cpAfter;

  // ── 2) 체스닷컴 승률 W (0~1) — 내 관점 ─────────────────
  const wBefore = winProb(cpMe);
  const wAfter  = winProb(cpMeAfter);

  // ── 3) 최선수 승률 ───────────────────────────────────────
  // best1cp: before 포지션의 엔진 1순위 PV cp (=cpBefore와 동일한 경우가 많음)
  // best2cp: 2순위 PV cp
  const best1cp = topAlts?.best1cp ?? null;
  const best2cp = topAlts?.best2cp ?? null;

  // best1cp가 null이거나 cpBefore와 같으면 wBefore를 직접 사용
  // (before.cp === before.topAlts.best1cp인 경우 deltaW = wBefore - wAfter)
  const wBest1  = best1cp != null ? winProb(turn === 'w' ? best1cp : -best1cp) : wBefore;
  const wBest2  = best2cp != null ? winProb(turn === 'w' ? best2cp : -best2cp) : null;

  // ΔW = W_best1 − W_move  (양수 = 최선수 대비 손실, 음수 = 최선수보다 나은 수)
  const deltaW = wBest1 - wAfter;

  // ── 4) Forced (합법 수 1개) ──────────────────────────────
  if (topAlts?.legalMoveCount === 1) return 'forced';

  // ── 4.5) 엔진 1순위 수와 완전 일치 → 즉시 Best ───────────
  // UCI 수 비교로 확정 (deltaW 계산 오차 없이 정확하게 판정)
  if (topAlts?.isEngineBest) return 'best';

  // ── 5) 메이트 판정 ───────────────────────────────────────
  const hadMateWin = topAlts?.mateInBefore != null && topAlts.mateInBefore > 0;
  const gaveMate   = topAlts?.mateInAfter  != null && topAlts.mateInAfter  > 0;
  const iMateWin   = cpMe      >=  9000;
  const iMateLose  = cpMe      <= -9000;
  const afterMateMe= cpMeAfter <= -9000;

  if (gaveMate) return 'blunder';

  if ((hadMateWin || iMateWin) && !gaveMate) {
    if (afterMateMe)       return 'blunder';
    if (cpMeAfter >= 200)  return 'best';
    if (cpMeAfter >= -50)  return 'excellent';
    if (cpMeAfter >= -300) return 'mistake';
    return 'blunder';
  }

  if (iMateLose) {
    if (afterMateMe) {
      if (deltaW <= 0)    return 'best';
      if (deltaW <= 0.02) return 'excellent';
      if (deltaW <= 0.05) return 'good';
      return 'inaccuracy';
    }
    if (cpMeAfter > -200) return (topAlts?.hasSacrifice ?? false) ? 'brilliant' : 'best';
    return 'inaccuracy';
  }

  // ── 6) Brilliant !! ─────────────────────────────────────
  // 기물 희생 + 최선수 수준(ΔW ≤ 0.02) + 균형 이상(wAfter > 0.5)
  if ((topAlts?.hasSacrifice ?? false) && deltaW <= 0.02 && wAfter > 0.5) {
    return 'brilliant';
  }

  // ── 7) Great ! ───────────────────────────────────────────
  // 반드시 두 조건을 동시에 만족해야 함:
  //   A) 실질적 포지션 개선: wAfter > wBefore (두고 나서 실제로 더 유리해짐)
  //      — 단순 교환/되잡기는 wAfter ≈ wBefore이므로 이 조건에서 탈락
  //   B-1) 유일수: top1-top2 승률 격차 ≥ 0.15 (0.1은 너무 관대)
  //        + 절대 개선 폭이 유의미해야 함 (wAfter - wBefore ≥ 0.05)
  //   B-2) 역전: 두기 전 열세(wBefore < 0.45)에서 두고 난 후 유리(wAfter > 0.60)
  //        + 최선수 수준이어야 함 (ΔW ≤ 0.02)
  const actualGain = wAfter - wBefore;  // 실제 승률 개선 폭

  // 유일수 Great: 격차가 크고 + 실제 승률도 올라야 함
  if (
    wBest1 != null && wBest2 != null &&
    (wBest1 - wBest2) >= 0.15 &&
    deltaW <= 0.02 &&
    actualGain >= 0.05          // 단순 교환처럼 제자리인 수 제거
  ) {
    return 'great';
  }
  // 역전 Great: 열세 → 유리 + 최선수
  if (wBefore < 0.45 && wAfter > 0.60 && deltaW <= 0.02) {
    return 'great';
  }

  // ── 8) Best ⭐ ───────────────────────────────────────────
  // deltaW ≤ 0 : 최선수와 동일하거나 더 나은 수
  // deltaW ≤ 0.005 : 부동소수점 오차 허용 (사실상 동일)
  if (deltaW <= 0.005) return 'best';

  // ── 9) 포지션 유형별 ΔW 임계값 ──────────────────────────
  // 체스닷컴은 포지션의 "복잡도(complexity)"에 따라 기준을 다르게 적용.
  // wBefore가 균형(0.35~0.65)일수록 수 선택의 폭이 넓어 임계값을 완화.
  // wBefore가 한쪽으로 치우칠수록(이기거나 지는 상황) 임계값을 엄격히 적용.

  // 균형 포지션 (wBefore 35%~65%): 오프닝·복잡한 미들게임
  const balanced = wBefore >= 0.35 && wBefore <= 0.65;
  // 우세 포지션 (wBefore 65%~85%): 유리하지만 아직 결정나지 않은 상황
  const winning  = wBefore > 0.65 && wBefore <= 0.85;

  if (balanced) {
    // 균형 상태에서는 임계값을 넓게 — 체스닷컴도 이 구간에서 관대
    if (deltaW <= 0.04) return 'excellent';
    if (deltaW <= 0.08) return 'good';
    if (deltaW <= 0.14) return 'inaccuracy';
    if (deltaW <= 0.24) return 'mistake';
    return 'blunder';
  }

  if (winning) {
    // 우세 상태: 중간 수준 적용
    if (deltaW <= 0.03) return 'excellent';
    if (deltaW <= 0.06) return 'good';
    if (deltaW <= 0.12) return 'inaccuracy';
    if (deltaW <= 0.22) return 'mistake';
    return 'blunder';
  }

  // 압도적 우세(>85%) 또는 열세(<35%): 표준 임계값
  if (deltaW <= 0.02) return 'excellent';
  if (deltaW <= 0.05) return 'good';
  if (deltaW <= 0.10) return 'inaccuracy';
  if (deltaW <= 0.20) return 'mistake';
  return 'blunder';
}
// ── 배지 아이콘 ─────────────────────────────────────────────
const ANN_ICON = {
  brilliant:  '!!',
  great:      '!',
  best:       '',   // 배지 없음 — 가장 흔해서 시각적 노이즈 방지
  excellent:  '',
  good:       '',
  book:       '',
  inaccuracy: '?!',
  mistake:    '?',
  blunder:    '??',
  miss:       '✗',
  forced:     '',   // 배지 없음 — 강제 수는 책임 없음
};

// ── 배지 툴팁 레이블 (Chess.com 분류 기준) ─────────────────
const ANN_LABEL = {
  brilliant:  '탁월한 수 (!!)  — 기물 희생 + 최선수',
  great:      '훌륭한 수 (!)   — 유일수 또는 역전',
  best:       '최선의 수       — 엔진 1순위',
  excellent:  '뛰어난 수       — ΔW ≤ 2%',
  good:       '좋은 수         — ΔW ≤ 5%',
  book:       '이론',
  inaccuracy: '부정확한 수 (?!) — ΔW 5~10%',
  mistake:    '실수 (?)         — ΔW 10~20%',
  blunder:    '블런더 (??)      — ΔW > 20%',
  miss:       '놓친 수 (✗)     — 승리 기회 상실',
  forced:     '강제 수',
};

// ── 수 분류 전체 업데이트 ────────────────────────────────────
function updateMoveAnnotations() {
  if (!game || game.history.length === 0) return;

  let changed = false;

  for (let i = 0; i < game.history.length; i++) {
    const h = game.history[i];

    // ── 이미 확정된 수는 절대 재분류하지 않음 (1회 고정) ──
    if (h.annotation !== null && h.annotation !== undefined) continue;

    const fenBefore = h.fenBefore;
    const fenAfter  = h.fenAfter || (game.history[i+1] && game.history[i+1].fenBefore);
    if (!fenBefore || !fenAfter) continue;

    const before = evalCache[normFen(fenBefore)];
    const after  = evalCache[normFen(fenAfter)];
    if (!before || !after) continue;

    // ── 최소 depth 18 미만이면 분류 보류 (불안정한 평가로 오분류 방지) ──
    const MIN_DEPTH = 18;
    if ((before.depth ?? 0) < MIN_DEPTH || (after.depth ?? 0) < MIN_DEPTH) continue;

    // best1uci: 엔진 1순위 수의 UCI 표기 (e.g. "e2e4") — 실제 둔 수와 비교용
    const best1uci = before.pvs?.[1]?.pv?.[0] ?? null;
    // 실제 둔 수를 UCI로 변환
    const FILES = ['a','b','c','d','e','f','g','h'];
    let playedUci = null;
    if (h.move) {
      const fr = 8 - h.move.from[0], ff = FILES[h.move.from[1]];
      const tr = 8 - h.move.to[0],   tf = FILES[h.move.to[1]];
      const promo = h.move.promotion ? h.move.promotion.toLowerCase() : '';
      playedUci = ff + fr + tf + tr + promo;
    }

    // legalMoveCount: 캐시에 없으면 lazy 계산 (forced 판정용, 드문 케이스)
    let legalMoveCount = before.legalMoveCount ?? null;
    if (legalMoveCount === null && h.fenBefore) {
      try {
        const fp = h.fenBefore.split(' ');
        const tb = parseFenBoard(fp[0]);
        const tc = parseFenCastling(fp[2] || '-');
        const te = parseFenEP(fp[3] || '-');
        if (tb) {
          legalMoveCount = getAllLegalMoves(tb, fp[1], tc, te).length;
          before.legalMoveCount = legalMoveCount; // 캐시에 저장해 다음 호출 시 재계산 방지
        }
      } catch(e) {}
    }
    const topAlts = {
      best1cp:        before.topAlts?.best1cp  ?? null,
      best2cp:        before.topAlts?.best2cp  ?? null,
      hasSacrifice:   isSacrifice(h),
      legalMoveCount,
      mateInBefore:   (before.mateIn != null && before.mateIn > 0) ? before.mateIn : null,
      mateInAfter:    (after.mateIn  != null && after.mateIn  > 0) ? after.mateIn  : null,
      isEngineBest:   best1uci != null && playedUci != null && best1uci === playedUci,
    };

    let cls = classifyMove(before.cp, after.cp, h.turn, topAlts);

    // ── Miss 판정 (Chess.com 공식) ──────────────────────────
    // W_best > 0.8이었는데 실제 둔 수로 W_move < 0.5가 된 경우 (승리 기회 상실)
    // brilliant/great/best/forced/blunder/mistake는 miss로 격하 안 함
    const missExempt = new Set(['brilliant','great','best','forced','blunder','mistake']);
    if (!missExempt.has(cls)) {
      const wBest1_miss = before.topAlts?.best1cp != null
        ? winProb(h.turn === 'w' ? before.topAlts.best1cp : -before.topAlts.best1cp)
        : getWinProb(before.cp, h.turn);
      const wMove_miss = getWinProb(after.cp, h.turn);
      if (wBest1_miss > 0.8 && wMove_miss < 0.5) cls = 'miss';
    }

    // ── 최초 1회 확정 저장 (이후 변경 불가) ─────────────
    h.annotation = cls;
    changed = true;
  }

  if (changed) game.renderMoveList();
}

// ── 기보 셀 HTML 생성 (기물 아이콘 포함) ──────────────────────
const SAN_PIECE_MAP = { 'N': 'N', 'B': 'B', 'R': 'R', 'Q': 'Q', 'K': 'K' };

function moveCellHTML(h) {
  const ann      = h.annotation;
  const icon     = ann && ANN_ICON[ann] ? ANN_ICON[ann] : '';
  const iconHTML = icon
    ? `<span class="move-ann ann-${ann}" title="${ANN_LABEL[ann] || ann}">${icon}</span>`
    : '';

  // 기물 아이콘 이미지 추가
  const san = h.san;
  const color = h.turn; // 'w' or 'b'
  let pieceCode = null;
  if (san === 'O-O' || san === 'O-O-O') {
    pieceCode = color + 'K';
  } else if (san && 'NBRQK'.includes(san[0])) {
    pieceCode = color + san[0];
  } else {
    pieceCode = color + 'P';
  }
  const isBlack = pieceCode.startsWith('b');
  const blackFilter = isBlack
    ? 'drop-shadow(0 0 1px rgba(180,180,180,0.9)) drop-shadow(0 0 1px rgba(150,150,150,0.7)) drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
    : 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))';
  const pieceIconHTML = `<img src="${pieceImg(pieceCode)}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:2px;filter:${blackFilter}">`;

  // SAN 표시 정제:
  // 1) 기물 대문자(아이콘으로 대체) 제거
  // 2) 출발 칸(파일/랭크 명시 부분) 제거 → 목적지 + 캡처 기호만 표시
  let displaySan = san;
  if (san === 'O-O' || san === 'O-O-O') {
    displaySan = san; // 캐슬링은 그대로
  } else {
    // 기물 기호 제거
    if (displaySan && 'NBRQK'.includes(displaySan[0])) {
      displaySan = displaySan.slice(1);
    }
    // 출발 칸 표기 제거: xa6 → xa6 (출발 파일 없음)
    // 패턴: [a-h]?[1-8]?x[a-h][1-8] 또는 [a-h][1-8][a-h][1-8]
    // 즉 목적지 앞에 있는 출발 파일/랭크 제거
    // e2xe7 → xe7 / a6xb5 → xb5 / f3e5 → e5 / g3xf5 → xf5
    displaySan = displaySan.replace(
      /^([a-h]?[1-8]?)(x?)([a-h][1-8].*)$/,
      (_, _from, cap, dest) => cap + dest
    );
  }

  return `${pieceIconHTML}<span>${displaySan}</span>${iconHTML}`;
}

// SAN 문자열 + 차례(turn)로 moveCellHTML과 동일한 HTML 생성 (엔진라인용)
function _sanToMoveCellHTML(san, turn) {
  if (!san) return san;
  let pieceCode;
  if (san === 'O-O' || san === 'O-O-O') {
    pieceCode = turn + 'K';
  } else if ('NBRQK'.includes(san[0])) {
    pieceCode = turn + san[0];
  } else {
    pieceCode = turn + 'P';
  }
  const isBlack2 = pieceCode.startsWith('b');
  const blackFilter2 = isBlack2
    ? 'drop-shadow(0 0 1px rgba(180,180,180,0.9)) drop-shadow(0 0 1px rgba(150,150,150,0.7)) drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
    : 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))';
  const pieceIconHTML = `<img src="${pieceImg(pieceCode)}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:2px;filter:${blackFilter2}">`;
  let displaySan = san;
  if (san !== 'O-O' && san !== 'O-O-O') {
    if ('NBRQK'.includes(displaySan[0])) displaySan = displaySan.slice(1);
    displaySan = displaySan.replace(
      /^([a-h]?[1-8]?)(x?)([a-h][1-8].*)$/,
      (_, _from, cap, dest) => cap + dest
    );
  }
  return `${pieceIconHTML}<span>${displaySan}</span>`;
}

/** 단일 UCI → legal move 객체 (엔진 대국용) */
function uciToMove(uci, board, turn, castling, enPassant) {
  if (!uci || uci.length < 4) return null;
  const fc = FILES.indexOf(uci[0]);
  const fr = 8 - parseInt(uci[1]);
  const tc = FILES.indexOf(uci[2]);
  const tr = 8 - parseInt(uci[3]);
  const promo = uci[4] ? uci[4].toUpperCase() : null;
  const allLegal = getAllLegalMoves(board, turn, castling, enPassant);
  const move = allLegal.find(m =>
    m.from[0] === fr && m.from[1] === fc && m.to[0] === tr && m.to[1] === tc &&
    (!promo || m.promo)
  );
  if (move && promo) move.promoPiece = promo;
  return move || null;
}

function uciMovesToSan(uciMoves, startBoard, startTurn, startCastling, startEnPassant) {
  let board = startBoard.map(r=>[...r]);
  let turn = startTurn;
  let castling = {...startCastling};
  let enPassant = startEnPassant;
  const result = [];

  for (const uci of uciMoves) {
    if (!uci || uci.length < 4) break;
    const fc = FILES.indexOf(uci[0]);
    const fr = 8 - parseInt(uci[1]);
    const tc = FILES.indexOf(uci[2]);
    const tr = 8 - parseInt(uci[3]);
    const promo = uci[4] ? uci[4].toUpperCase() : null;

    const allLegal = getAllLegalMoves(board, turn, castling, enPassant);
    const move = allLegal.find(m =>
      m.from[0]===fr && m.from[1]===fc && m.to[0]===tr && m.to[1]===tc &&
      (!promo || (m.promo && promo))
    );
    if (!move) break;
    if (promo) move.promoPiece = promo;

    const san = moveToSAN(board, move, turn, allLegal);
    result.push(san);

    const nb = applyMoveToBoard(board.map(r=>[...r]), move, turn);
    if (nb[move.to[0]][move.to[1]] === `${turn}K`) {
      if (turn==='w') { castling.wK=false; castling.wQ=false; }
      else { castling.bK=false; castling.bQ=false; }
    }
    if (move.from[0]===7&&move.from[1]===7) castling.wK=false;
    if (move.from[0]===7&&move.from[1]===0) castling.wQ=false;
    if (move.from[0]===0&&move.from[1]===7) castling.bK=false;
    if (move.from[0]===0&&move.from[1]===0) castling.bQ=false;
    enPassant = move.doublePush ? [move.to[0]-(turn==='w'?-1:1), move.to[1]] : null;
    turn = turn==='w' ? 'b' : 'w';
    board = nb;
  }
  return result;
}

function renderTopMoves(msg) {
  const container = document.getElementById('top-moves');
  const rowCount = Math.max(multiPV, 1);

  // 항상 고정 높이 (행 수 × 52px) — 분석 중/완료 상관없이 크기 동일
  const fixedH = (rowCount * 52) + 'px';
  container.style.minHeight = fixedH;
  container.style.height    = fixedH;

  container.innerHTML = '';

  for (let i = 1; i <= rowCount; i++) {
    const pv = pvData[i];
    const row = document.createElement('div');

    if (pv) {
      // 점수 색상 결정 — 항상 백 기준 cpFromWhite로 판단
      const cp = pv.cpFromWhite ?? 0;
      let scoreClass = 'equal';
      if (cp > 20)  scoreClass = 'positive';  // 백 유리 → 녹색
      if (cp < -20) scoreClass = 'negative';  // 흑 유리 → 적색

      // 수 분리: 첫 번째 수 + 나머지
      const allMoves = pv.moves || [];
      // 전체 수순을 수번호와 함께 구성
      const buildMoveSeq = (() => {
        if (!allMoves.length) return { firstStr: '', restStr: '' };
        const startTurn = game.turn; // 'w' or 'b'
        const startNum  = game.fullMove;
        let t = startTurn;
        let num = startNum;
        const parts = [];
        allMoves.forEach((m, idx) => {
          if (t === 'w') {
            parts.push({ label: num + '.', move: m });
          } else {
            // 흑 차례: 첫 번째 수이면 "N..." 붙이기
            if (idx === 0) {
              parts.push({ label: num + '...', move: m });
            } else {
              parts.push({ label: null, move: m });
            }
          }
          if (t === 'b') num++;
          t = t === 'w' ? 'b' : 'w';
        });
        // 첫 번째 수의 표시 (수번호 포함)
        const first = parts[0];
        const firstStr = (first.label ? first.label + ' ' : '') + first.move;
        // 나머지 수들 — 수번호 포함
        const restParts = [];
        parts.slice(1).forEach(p => {
          if (p.label) restParts.push(p.label);
          restParts.push(p.move);
        });
        return { firstStr, restStr: restParts.join(' ') };
      })();

      // depth 배지
      const depthStr = pv.depth ? `d${pv.depth}` : '';

      row.className = `top-move-row${i === 1 ? ' rank-1' : ''}`;
      row.innerHTML = `
        <div class="top-move-score-col${i === 1 ? ' rank-1' : ''}">
          <span class="top-move-score ${scoreClass}">${pv.eval}</span>
          <span class="top-move-depth-badge">${depthStr}</span>
        </div>
        <div class="top-move-moves-col">
          <span class="top-move-first">${buildMoveSeq.firstStr}</span>
          ${buildMoveSeq.restStr ? `<span class="top-move-rest">${buildMoveSeq.restStr}</span>` : ''}
        </div>
      `;
      // 엔진 라인 클릭 → 기보 패널에 미리보기
      // ★ 버그1 수정: 클릭 시점 pvMoves를 즉시 딥카피로 고정 (이후 pvData 변경에 영향 안 받음)
      const pvMovesSnap = JSON.parse(JSON.stringify(pv.moves || []));
      const pvIdxSnap = i;
      row.addEventListener('click', () => {
        document.querySelectorAll('.top-move-row').forEach(r => r.classList.remove('previewing'));
        row.classList.add('previewing');
        // top-move 클릭은 항상 previewEngineLine으로 처리
        // → 엔진라인 탐색 중이면 서브라인으로, 아니면 루트라인으로 추가
        // → 기존 라인은 절대 덮어씌우지 않음
        game.previewEngineLine(pvMovesSnap, pvIdxSnap);
      });

    } else {
      // 빈 행
      row.className = 'top-move-row empty-row';
      row.innerHTML = `
        <div class="top-move-score-col">
          <span class="top-move-score equal">—</span>
        </div>
        <div class="top-move-moves-col">
          <span class="top-move-first" style="color:var(--text-muted)">분석 중...</span>
        </div>
      `;
    }
    container.appendChild(row);
  }
}

function boardToFen(board, turn, castling, enPassant, halfMove, fullMove) {
  let fen = '';
  for (let r=0; r<8; r++) {
    let empty = 0;
    for (let c=0; c<8; c++) {
      const p = board[r][c];
      if (!p) { empty++; continue; }
      if (empty) { fen += empty; empty = 0; }
      const color = p[0], type = p[1];
      fen += color==='w' ? type : type.toLowerCase();
    }
    if (empty) fen += empty;
    if (r<7) fen += '/';
  }
  fen += ' ' + turn;
  let cas = '';
  if (castling.wK) cas += 'K';
  if (castling.wQ) cas += 'Q';
  if (castling.bK) cas += 'k';
  if (castling.bQ) cas += 'q';
  fen += ' ' + (cas || '-');
  if (enPassant) fen += ' ' + FILES[enPassant[1]] + (8-enPassant[0]);
  else fen += ' -';
  fen += ' ' + (halfMove||0) + ' ' + (fullMove||1);
  return fen;
}

function hideLoading() {
  document.getElementById('engine-loading').classList.add('hidden');
}

