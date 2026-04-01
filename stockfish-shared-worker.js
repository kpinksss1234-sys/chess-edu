/**
 * Stockfish 18 SharedWorker — 브라우저 전역 단일 엔진 인스턴스
 *
 * · records.html  : 배치 분석 큐 (analyze → result)
 * · chess-wasm    : 실시간 UCI 스트림 (claimStream → streamUci / uciLine)
 *
 * 스트림이 잡혀 있으면 배치 큐는 대기(releaseStream 후 처리).
 */

'use strict';

const SF_PATH = '/stockfish/stockfish-18-single.js';

let _sfWorker = null;
let _sfReady = false;
let _initPromise = null;

const _ports = new Set();

const _queue = [];
let _current = null;
let _infoBuffer = '';

/** 분석 보드 전용: 이 포트로 SF의 모든 출력 라인을 그대로 전달 */
let _streamPort = null;

function _processQueue() {
  if (_streamPort || _current || _queue.length === 0 || !_sfReady) return;
  _current = _queue.shift();
  _infoBuffer = '';
  _sfWorker.postMessage(`setoption name MultiPV value ${_current.multipv}`);
  _sfWorker.postMessage(`position fen ${_current.fen}`);
  _sfWorker.postMessage(`go depth ${_current.depth}`);
}

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

function _failInit(err) {
  _initPromise = null;
  _sfReady = false;
  if (_sfWorker) {
    try { _sfWorker.terminate(); } catch (e) { /* ignore */ }
    _sfWorker = null;
  }
  return err;
}

function _initSF() {
  if (_sfReady) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    let uciReceived = false;
    try {
      _sfWorker = new Worker(SF_PATH);
    } catch (e) {
      _failInit(e);
      reject(e);
      return;
    }

    _sfWorker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data.trim() : '';
      if (!line) return;

      if (!_sfReady) {
        if (line.includes('uciok')) {
          uciReceived = true;
          _sfWorker.postMessage('setoption name Threads value 2');
          _sfWorker.postMessage('setoption name Hash value 128');
          _sfWorker.postMessage('setoption name UCI_AnalyseMode value true');
          _sfWorker.postMessage('setoption name Move Overhead value 0');
          _sfWorker.postMessage('setoption name Contempt value 0');
          _sfWorker.postMessage('setoption name Analysis Contempt value Off');
          _sfWorker.postMessage('setoption name Skill Level value 20');
          _sfWorker.postMessage('isready');
          return;
        }
        if (line.includes('readyok')) {
          _sfReady = true;
          _ports.forEach(p => p.postMessage({ type: 'ready' }));
          resolve();
          _processQueue();
          return;
        }
        return;
      }

      if (_streamPort) {
        _streamPort.postMessage({ type: 'uciLine', line });
        return;
      }

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
        return;
      }
    };

    _sfWorker.onerror = (ev) => {
      const msg = ev.message || String(ev);
      _ports.forEach(p => p.postMessage({ type: 'error', message: msg }));
      reject(_failInit(new Error(msg)));
    };

    setTimeout(() => {
      _sfWorker.postMessage('uci');
    }, 500);

    setTimeout(() => {
      if (!_sfReady) {
        reject(_failInit(new Error(uciReceived ? 'readyok 미수신' : 'uciok 미수신')));
      }
    }, 30000);
  });

  return _initPromise;
}

self.onconnect = (e) => {
  const port = e.ports[0];
  _ports.add(port);

  port.onmessage = async (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'init') {
      try {
        await _initSF();
        if (_sfReady) port.postMessage({ type: 'ready' });
      } catch (err) {
        port.postMessage({ type: 'error', message: err.message });
      }
      return;
    }

    if (msg.type === 'claimStream') {
      try {
        await _initSF();
        _streamPort = port;
        port.postMessage({ type: 'streamReady' });
      } catch (err) {
        port.postMessage({ type: 'error', message: err.message || String(err) });
      }
      return;
    }

    if (msg.type === 'releaseStream') {
      if (_streamPort === port) {
        _streamPort = null;
        _processQueue();
      }
      return;
    }

    if (msg.type === 'streamUci') {
      if (port !== _streamPort || !_sfWorker || !_sfReady) return;
      _sfWorker.postMessage(msg.line);
      return;
    }

    if (msg.type === 'analyze') {
      if (!_sfReady) {
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
      if (_streamPort === port) {
        _streamPort = null;
        _processQueue();
      }
      return;
    }
  };

  port.start();
};
