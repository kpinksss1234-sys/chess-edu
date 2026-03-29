/**
 * chess-stockfish.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stockfish 워커 관리 모듈
 *
 * 담당 역할:
 *   - Stockfish Web Worker 초기화 및 생명주기 관리
 *   - UCI 프로토콜 기반 포지션 분석 요청/응답 처리
 *   - 분석 큐 관리 (동시에 하나씩 순서대로 처리)
 *   - info 문자열 파싱 → PV(최선 수순) / 평가값 추출
 *   - cp(센티폰) 값을 현재 플레이어 기준으로 변환
 *   - 수 품질 레이블 분류 (블런더/실수/부정확/양호)
 *
 * 설정 상수 (이 파일 상단에서 조정):
 *   SF_DEPTH      - 탐색 깊이 (높을수록 정확, 느림)
 *   SF_MULTIPV    - 후보수 개수 (3: 핀 라인 비교를 위해 3개 확보)
 *   BLUNDER_CP    - 블런더 기준 센티폰 손실
 *   MISTAKE_CP    - 실수 기준 센티폰 손실
 *   INACCURACY_CP - 부정확 기준 센티폰 손실
 *
 * 의존성: stockfish/stockfish-18-single.js (Worker 파일)
 *
 * 외부에 노출하는 주요 함수:
 *   initStockfish()             → Promise<void>  워커 초기화
 *   analyzePosition(fen)        → Promise<{pvs, bestmove}>
 *   cpFor(cp, mate, turn)       → number  플레이어 기준 평가값
 *   cpToLabel(diff)             → 'blunder'|'mistake'|'inaccuracy'|'good'
 *
 * analyzePosition 반환값 형태:
 *   {
 *     pvs: [{ depth, cp, mate, moves }],  // multipv 순서 (최대 3개)
 *     bestmove: 'e2e4'                    // UCI 최선수
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── 분석 설정 ────────────────────────────────────────────────────────────────
const SF_DEPTH      = 14;   // 탐색 깊이. 높을수록 정확하지만 느림 (권장: 12~16)
const SF_MULTIPV    = 3;    // 후보수 개수. 3개 라인으로 핀 라인 유무 비교
const BLUNDER_CP    = 150;  // 이 이상 손해 = 블런더
const MISTAKE_CP    = 75;   // 이 이상 손해 = 실수
const INACCURACY_CP = 30;   // 이 이상 손해 = 부정확

// ── 워커 상태 ────────────────────────────────────────────────────────────────
let _sfWorker          = null;
let _sfReady           = false;
let _sfQueue           = [];
let _sfCurrentResolve  = null;
let _sfBuffer          = '';

// ── 초기화 ───────────────────────────────────────────────────────────────────
/**
 * Stockfish 워커를 초기화합니다.
 * 이미 초기화된 경우 즉시 resolve합니다.
 * @returns {Promise<void>}
 */
function initStockfish() {
  if (_sfReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      _sfWorker = new Worker('stockfish/stockfish-18-single.js');
    } catch (e) {
      reject(e); return;
    }
    _sfWorker.onmessage = (e) => {
      const line = e.data;
      if (line === 'readyok') { _sfReady = true; resolve(); return; }
      if (_sfCurrentResolve && line.startsWith('info'))    _sfBuffer += line + '\n';
      if (_sfCurrentResolve && line.startsWith('bestmove')) {
        const buf = _sfBuffer, res = _sfCurrentResolve;
        _sfBuffer = ''; _sfCurrentResolve = null;
        res({ bestmove: line, info: buf });
        _processQueue();
      }
    };
    _sfWorker.onerror = (e) => { console.error('Stockfish 에러:', e); reject(e); };
    _sfWorker.postMessage('uci');
    _sfWorker.postMessage('setoption name MultiPV value ' + SF_MULTIPV);
    _sfWorker.postMessage('isready');
  });
}

function _processQueue() {
  if (_sfCurrentResolve || _sfQueue.length === 0) return;
  const { fen, resolve } = _sfQueue.shift();
  _sfCurrentResolve = resolve;
  _sfBuffer = '';
  _sfWorker.postMessage('position fen ' + fen);
  _sfWorker.postMessage('go depth ' + SF_DEPTH);
}

// ── 포지션 분석 ──────────────────────────────────────────────────────────────
/**
 * 주어진 FEN 포지션을 분석하여 최선수와 평가값을 반환합니다.
 * 분석 요청은 큐에 쌓여 순서대로 처리됩니다.
 * @param {string} fen
 * @returns {Promise<{pvs: Array, bestmove: string}>}
 */
function analyzePosition(fen) {
  return new Promise(resolve => {
    _sfQueue.push({
      fen,
      resolve: (raw) => resolve(_parseInfoLines(raw.info, raw.bestmove))
    });
    _processQueue();
  });
}

// ── info 파싱 ────────────────────────────────────────────────────────────────
function _parseInfoLines(infoStr, bestmoveLine) {
  const lines = infoStr.split('\n').filter(l => l.startsWith('info') && l.includes('multipv'));
  const pvMap = {};
  for (const line of lines) {
    const mpvM  = line.match(/multipv (\d+)/);
    const depthM = line.match(/depth (\d+)/);
    const cpM   = line.match(/score cp (-?\d+)/);
    const mateM = line.match(/score mate (-?\d+)/);
    const pvM   = line.match(/ pv (.+)$/);
    if (!mpvM) continue;
    const mpv   = parseInt(mpvM[1]);
    const depth = depthM ? parseInt(depthM[1]) : 0;
    if (!pvMap[mpv] || depth >= pvMap[mpv].depth) {
      pvMap[mpv] = {
        depth,
        cp:    cpM   ? parseInt(cpM[1])   : null,
        mate:  mateM ? parseInt(mateM[1]) : null,
        moves: pvM   ? pvM[1].trim().split(' ') : []
      };
    }
  }
  const bm = bestmoveLine.match(/bestmove (\S+)/);
  return { pvs: Object.values(pvMap), bestmove: bm ? bm[1] : null };
}

// ── 평가값 변환 ──────────────────────────────────────────────────────────────
/**
 * Stockfish cp(백 기준)를 현재 플레이어 기준으로 변환
 * @param {number|null} cp
 * @param {number|null} mate
 * @param {string} turn - 'w'|'b'
 * @returns {number}
 */
function cpFor(cp, mate, turn) {
  if (mate !== null) return mate > 0 ? 99999 : -99999;
  if (cp === null) return 0;
  return turn === 'w' ? cp : -cp;
}

/**
 * cp 손실량을 수 품질 레이블로 변환
 * @param {number} diff - 손실 센티폰 (양수)
 * @returns {'blunder'|'mistake'|'inaccuracy'|'good'}
 */
function cpToLabel(diff) {
  if (diff >= BLUNDER_CP)    return 'blunder';
  if (diff >= MISTAKE_CP)    return 'mistake';
  if (diff >= INACCURACY_CP) return 'inaccuracy';
  return 'good';
}
