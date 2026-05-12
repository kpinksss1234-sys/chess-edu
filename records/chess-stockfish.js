/**
 * chess-stockfish.js  (SharedWorker 클라이언트 버전)
 * ─────────────────────────────────────────────────────────────────────────────
 * records.html 등에서 사용하는 Stockfish 분석 인터페이스.
 *
 * ▶ 변경점: 자체 Worker 대신 /stockfish-shared-worker.js (SharedWorker) 를
 *   통해 Stockfish에 접근합니다.
 *   chess-wasm-fixed.html 이 이미 엔진을 올렸다면 SharedWorker는 재사용되어
 *   추가 로딩 없이 즉시 준비 완료 신호를 받습니다.
 *
 *   SharedWorker 미지원 브라우저(드문 경우)에서는 기존 Worker 방식으로 자동 폴백.
 *
 * 외부에 노출하는 함수 (chess-analyzer.js 의존):
 *   initStockfish()          → Promise<void>
 *   analyzePosition(fen)     → Promise<{ pvs, bestmove }>
 *   cpFor(cp, mate, turn)    → number
 *   cpToLabel(diff)          → string
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const SF_DEPTH      = 18;
const SF_MULTIPV    = 3;
const BLUNDER_CP    = 150;
const MISTAKE_CP    = 75;
const INACCURACY_CP = 30;

// ── SharedWorker 상태 ────────────────────────────────────────────────────────
let _port           = null;   // SharedWorker 포트
let _sfReady        = false;
let _readyPromise   = null;
let _readyResolve   = null;

// 분석 콜백 맵: reqId → resolve
let _reqId    = 0;
const _pending = new Map();

// ── 폴백(일반 Worker) 상태 ──────────────────────────────────────────────────
let _fallbackWorker  = null;
let _fallbackReady   = false;
let _fbQueue         = [];
let _fbCurrentRes    = null;
let _fbBuffer        = '';
let _useFallback     = false;

// ── 초기화 ───────────────────────────────────────────────────────────────────
function initStockfish() {
  if (_sfReady) return Promise.resolve();
  if (_readyPromise) return _readyPromise;

  _readyPromise = new Promise((resolve, reject) => {
    _readyResolve = resolve;

    // SharedWorker 지원 여부 확인
    if (typeof SharedWorker === 'undefined') {
      console.warn('[SF] SharedWorker 미지원 → 일반 Worker 폴백');
      _useFallback = true;
      _initFallback().then(resolve).catch(reject);
      return;
    }

    try {
      const sw = new SharedWorker('/stockfish-shared-worker.js', { name: 'stockfish-shared' });
      _port = sw.port;

      _port.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;

        if (msg.type === 'ready') {
          _sfReady = true;
          console.log('[SF] SharedWorker 준비 완료');
          resolve();
          return;
        }

        if (msg.type === 'result') {
          const cb = _pending.get(msg.id);
          if (cb) { _pending.delete(msg.id); cb(msg); }
          return;
        }

        if (msg.type === 'error') {
          console.error('[SF] SharedWorker 오류:', msg.message);
          // SharedWorker 실패 → 폴백
          _useFallback = true;
          _port = null;
          _initFallback().then(resolve).catch(reject);
          return;
        }
      };

      _port.onerror = (e) => {
        console.warn('[SF] SharedWorker 포트 오류, 폴백으로 전환:', e);
        _useFallback = true;
        _port = null;
        _initFallback().then(resolve).catch(reject);
      };

      _port.start();
      _port.postMessage({ type: 'init' });

      // 10초 타임아웃 → 폴백
      setTimeout(() => {
        if (!_sfReady && !_useFallback) {
          console.warn('[SF] SharedWorker 타임아웃 → 폴백');
          _useFallback = true;
          _port = null;
          _initFallback().then(resolve).catch(reject);
        }
      }, 10000);

    } catch (e) {
      console.warn('[SF] SharedWorker 생성 실패, 폴백:', e);
      _useFallback = true;
      _initFallback().then(resolve).catch(reject);
    }
  });

  return _readyPromise;
}

// ── 폴백: 일반 Worker ────────────────────────────────────────────────────────
function _initFallback() {
  return new Promise((resolve, reject) => {
    try {
      _fallbackWorker = new Worker('/stockfish/stockfish-18-single.js');
    } catch (e) { reject(e); return; }

    _fallbackWorker.onmessage = (e) => {
      const line = e.data;
      if (line === 'readyok' && !_fallbackReady) {
        _fallbackReady = true; _sfReady = true;
        resolve();
        _fbProcessQueue();
        return;
      }
      if (_fbCurrentRes) {
        if (line.startsWith('info'))      _fbBuffer += line + '\n';
        if (line.startsWith('bestmove')) {
          const buf = _fbBuffer, res = _fbCurrentRes;
          _fbBuffer = ''; _fbCurrentRes = null;
          res({ bestmove: line, info: buf });
          _fbProcessQueue();
        }
      }
    };
    _fallbackWorker.onerror = (e) => reject(e);
    _fallbackWorker.postMessage('uci');
    _fallbackWorker.postMessage(`setoption name MultiPV value ${SF_MULTIPV}`);
    _fallbackWorker.postMessage('isready');
  });
}

function _fbProcessQueue() {
  if (_fbCurrentRes || _fbQueue.length === 0) return;
  const { fen, resolve } = _fbQueue.shift();
  _fbCurrentRes = resolve;
  _fbBuffer = '';
  _fallbackWorker.postMessage(`setoption name MultiPV value ${SF_MULTIPV}`);
  _fallbackWorker.postMessage(`position fen ${fen}`);
  _fallbackWorker.postMessage(`go depth ${SF_DEPTH}`);
}

// ── 포지션 분석 ──────────────────────────────────────────────────────────────
function analyzePosition(fen) {
  return new Promise(resolve => {
    if (_useFallback || !_port) {
      // 폴백 경로
      _fbQueue.push({
        fen,
        resolve: (raw) => resolve(_parseInfoLines(raw.info, raw.bestmove)),
      });
      _fbProcessQueue();
      return;
    }

    // SharedWorker 경로
    const id = ++_reqId;
    _pending.set(id, (msg) => {
      resolve({ pvs: msg.pvs, bestmove: msg.bestmove });
    });
    _port.postMessage({ type: 'analyze', id, fen, depth: SF_DEPTH, multipv: SF_MULTIPV });
  });
}

// ── info 파싱 (폴백 전용) ────────────────────────────────────────────────────
function _parseInfoLines(infoStr, bestmoveLine) {
  const lines = infoStr.split('\n').filter(l => l.startsWith('info') && l.includes('multipv'));
  const pvMap = {};
  for (const line of lines) {
    const mpvM   = line.match(/multipv (\d+)/);
    const depthM = line.match(/depth (\d+)/);
    const cpM    = line.match(/score cp (-?\d+)/);
    const mateM  = line.match(/score mate (-?\d+)/);
    const pvM    = line.match(/ pv (.+)$/);
    if (!mpvM) continue;
    const mpv   = parseInt(mpvM[1]);
    const depth = depthM ? parseInt(depthM[1]) : 0;
    if (!pvMap[mpv] || depth >= pvMap[mpv].depth) {
      pvMap[mpv] = {
        depth,
        cp:    cpM   ? parseInt(cpM[1])   : null,
        mate:  mateM ? parseInt(mateM[1]) : null,
        moves: pvM   ? pvM[1].trim().split(' ') : [],
      };
    }
  }
  const bm = bestmoveLine.match(/bestmove (\S+)/);
  return { pvs: Object.values(pvMap), bestmove: bm ? bm[1] : null };
}

// ── 평가값 변환 ──────────────────────────────────────────────────────────────
function cpFor(cp, mate, turn) {
  if (mate !== null) return mate > 0 ? 99999 : -99999;
  if (cp === null)   return 0;
  return turn === 'w' ? cp : -cp;
}

function cpToLabel(diff) {
  if (diff >= BLUNDER_CP)    return 'blunder';
  if (diff >= MISTAKE_CP)    return 'mistake';
  if (diff >= INACCURACY_CP) return 'inaccuracy';
  return 'good';
}
