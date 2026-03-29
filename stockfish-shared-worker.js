/**
 * stockfish-shared-worker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stockfish 18 SharedWorker
 *
 * 역할:
 *   - 모든 탭(chess-wasm-fixed, records 등)이 이 SharedWorker 하나를 공유
 *   - Stockfish 실제 Worker를 내부에서 단 한 번만 생성
 *   - 각 탭으로부터 받은 분석 요청을 큐로 직렬화, 순서대로 처리
 *   - 결과는 요청을 보낸 포트에만 응답
 *
 * 프로토콜 (포트 메시지):
 *   탭 → SharedWorker:
 *     { type: 'init' }                       초기화 요청 (연결 시 자동)
 *     { type: 'analyze', id, fen, depth, multipv }  분석 요청
 *     { type: 'stop' }                       현재 분석 중단
 *
 *   SharedWorker → 탭:
 *     { type: 'ready' }                      Stockfish 준비 완료
 *     { type: 'result', id, pvs, bestmove }  분석 결과
 *     { type: 'error', message }             오류
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const SF_PATH = '/stockfish/stockfish-18-single.js';

let _sfWorker   = null;  // 실제 Stockfish Worker (단 하나)
let _sfReady    = false;
let _initPromise = null;

// 연결된 모든 포트 목록
const _ports = new Set();

// 분석 큐: { port, id, fen, depth, multipv }
const _queue = [];
let _current = null;  // 현재 처리 중인 작업
let _infoBuffer = '';

// ── Stockfish Worker 초기화 ──────────────────────────────────────────────────
function _initSF() {
  if (_initPromise) return _initPromise;
  _initPromise = new Promise((resolve, reject) => {
    try {
      _sfWorker = new Worker(SF_PATH);
    } catch (e) {
      reject(e); return;
    }

    _sfWorker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (!line) return;

      // 초기화 완료
      if (line === 'readyok' && !_sfReady) {
        _sfReady = true;
        // 모든 연결된 포트에 ready 알림
        _ports.forEach(p => p.postMessage({ type: 'ready' }));
        resolve();
        _processQueue();
        return;
      }

      // 분석 결과 수집
      if (_current) {
        if (line.startsWith('info')) {
          _infoBuffer += line + '\n';
        } else if (line.startsWith('bestmove')) {
          const result = _parseResult(_infoBuffer, line, _current.multipv);
          _current.port.postMessage({ type: 'result', id: _current.id, ...result });
          _infoBuffer = '';
          _current = null;
          _processQueue();
        }
      }
    };

    _sfWorker.onerror = (e) => {
      const msg = e.message || String(e);
      _ports.forEach(p => p.postMessage({ type: 'error', message: msg }));
      reject(new Error(msg));
    };

    _sfWorker.postMessage('uci');
    _sfWorker.postMessage('isready');
  });
  return _initPromise;
}

// ── 큐 처리 ─────────────────────────────────────────────────────────────────
function _processQueue() {
  if (_current || _queue.length === 0 || !_sfReady) return;
  _current = _queue.shift();
  _infoBuffer = '';
  _sfWorker.postMessage(`setoption name MultiPV value ${_current.multipv}`);
  _sfWorker.postMessage(`position fen ${_current.fen}`);
  _sfWorker.postMessage(`go depth ${_current.depth}`);
}

// ── info 파싱 ────────────────────────────────────────────────────────────────
function _parseResult(infoStr, bestmoveLine, multipv) {
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
        uci:   pvM   ? pvM[1].trim().split(' ')[0] : '',
        moves: pvM   ? pvM[1].trim().split(' ')    : [],
      };
    }
  }
  const bm = bestmoveLine.match(/bestmove (\S+)/);
  return { pvs: Object.values(pvMap), bestmove: bm ? bm[1] : null };
}

// ── 포트 연결 처리 ───────────────────────────────────────────────────────────
self.onconnect = (e) => {
  const port = e.ports[0];
  _ports.add(port);

  port.onmessage = async (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'init') {
      try {
        await _initSF();
        // 이미 ready면 즉시 알림
        if (_sfReady) port.postMessage({ type: 'ready' });
      } catch (err) {
        port.postMessage({ type: 'error', message: err.message });
      }
      return;
    }

    if (msg.type === 'analyze') {
      if (!_sfReady) {
        // 아직 준비 안 됐으면 큐에 넣고 init도 같이
        _initSF().catch(() => {});
      }
      _queue.push({
        port,
        id:      msg.id,
        fen:     msg.fen,
        depth:   msg.depth   || 14,
        multipv: msg.multipv || 3,
      });
      _processQueue();
      return;
    }

    if (msg.type === 'stop') {
      if (_sfWorker && _sfReady) {
        _sfWorker.postMessage('stop');
      }
      return;
    }

    if (msg.type === 'disconnect') {
      _ports.delete(port);
      return;
    }
  };

  port.start();
};
