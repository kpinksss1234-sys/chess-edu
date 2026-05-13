// ── 설정 ────────────────────────────────────────────────────
// file:// 환경과 로컬 서버 환경 모두 지원
// 로컬 서버(/stockfish/) 우선, 없으면 unpkg CDN에서 자동 로드
const _isFileProtocol = location.protocol === 'file:';
const _localOrigin = (!_isFileProtocol && location.origin && location.origin !== 'null')
  ? location.origin : null;

// CDN 절대 URL (항상 고정)
const _CDN_JS   = 'https://unpkg.com/stockfish@18.0.0/src/stockfish-18-single.js';
const _CDN_WASM = 'https://unpkg.com/stockfish@18.0.0/src/stockfish-18-single.wasm';

// 로드 소스 목록 (우선순위 순)
const STOCKFISH_SOURCES = [
  // 로컬 호스팅 우선 (public/stockfish/ 폴더 배포 시)
  { js: '/stockfish/stockfish-18-single.js',
    wasm: '/stockfish/stockfish-18-single.wasm',
    label: '로컬' },
  // 로컬 파일이 없거나 너무 작으면 CDN으로 자동 폴백
  { js: _CDN_JS,
    wasm: _CDN_WASM,
    label: 'CDN' },
];

// Blob Worker URL 캐시
let _stockfishBlobUrl = null;
let _stockfishBlobPromise = null;

/**
 * Stockfish JS URL 결정:
 *  1) 로컬 경로로 HEAD 요청 → 파일 존재 + 크기 충분(>50KB)하면 로컬 URL 사용
 *  2) 로컬 파일 없거나 너무 작으면 CDN URL 사용
 *
 * [왜 크기를 확인하는가]
 *  배포 환경에 stub(21KB) 파일만 있고 실제 WASM 로더가 없는 경우를 걸러내기 위함.
 *  진짜 stockfish-18-single.js는 수백KB 이상이어야 정상 동작.
 */
async function getStockfishBlobUrl() {
  if (_stockfishBlobUrl) return _stockfishBlobUrl;
  if (_stockfishBlobPromise) return _stockfishBlobPromise;

  _stockfishBlobPromise = (async () => {
    let lastErr;
    for (const { js: src, wasm, label } of STOCKFISH_SOURCES) {
      try {
        console.log(`[Stockfish] 로드 시도 (${label}):`, src);

        // CDN이 아닌 로컬 경로는 fetch HEAD로 존재 여부 + 크기를 확인
        if (label !== 'CDN') {
          const res = await fetch(src, { method: 'HEAD' }).catch(() => null);
          if (!res || !res.ok) {
            throw new Error(`파일 없음 (HTTP ${res ? res.status : 'network error'})`);
          }
          // Content-Length로 크기 확인 — 50KB 미만이면 stub으로 간주
          const cl = parseInt(res.headers.get('content-length') || '0', 10);
          if (cl > 0 && cl < 50 * 1024) {
            throw new Error(`파일 너무 작음 (${(cl/1024).toFixed(1)}KB) — stub 파일로 판단, CDN으로 폴백`);
          }
        }

        _stockfishBlobUrl = src;
        console.log(`[Stockfish] Worker URL 준비 완료 (${label}):`, src);
        return _stockfishBlobUrl;
      } catch (e) {
        console.warn(`[Stockfish] 실패 (${label}):`, e.message);
        _stockfishBlobUrl = null;
        lastErr = e;
      }
    }
    throw lastErr || new Error('모든 Stockfish 소스 로드 실패');
  })();

  return _stockfishBlobPromise;
}

let multiPV        = 3;
let analysisDepth  = 20;    // 시작 depth — 항상 20부터 movetime까지 무제한 상승
let analysisTime   = 15000; // ms — 최대 분석 시간 (기본 15초)
let autoAnalyze    = true;
let analysisTimeout = null;
let lastAnalyzedFen = '';
let pvData         = {};
let pendingTurn    = 'w';
let pendingFen     = '';
let _soundMuted    = false; // PGN 로드 등 일괄 처리 시 음소거
let lastSentFen    = '';
let currentAnalysisId = 0;

// 엔진라인 수 클릭 시 분석 중인 FEN (null이면 기보 기준 분석)
let _engineLineAnalysisFen = null;

// evalCache: LRU 방식 최대 500 포지션 유지 (장시간 사용 시 메모리 누수 방지)
const evalCache = (() => {
  const MAX = 500;
  const map = new Map();
  return new Proxy({}, {
    get(_, key) { const v = map.get(key); if (v !== undefined) { map.delete(key); map.set(key, v); } return v; },
    set(_, key, value) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= MAX) map.delete(map.keys().next().value);
      map.set(key, value); return true;
    },
    has(_, key) { return map.has(key); },
    deleteProperty(_, key) { return map.delete(key); },
    ownKeys() { return [...map.keys()]; },
    getOwnPropertyDescriptor(_, key) { return map.has(key) ? { configurable: true, enumerable: true, writable: true, value: map.get(key) } : undefined; },
  });
})();

// ── Worker 풀 ────────────────────────────────────────────────
// mainWorker  : 화면 포지션 분석 전용 (실제 Worker 또는 SharedWorker 프록시 { postMessage })
// bgWorkers[] : 백그라운드 전체 기보 병렬 분석
let mainWorker      = null;
let bgWorkers       = [];
let _mainEnginePort = null;
let _useSharedWorkerMain = false;
let mainReady       = false;
let renderTimer     = null;
let engineSearching = false;  // go 전송 후 bestmove 수신 전
let pendingNextFen  = null;   // stop 후 bestmove 오면 실행할 다음 분석 파라미터

// Worker 생성: Blob URL 방식
function createStockfishWorker(threads = 1, hashMb = 64) {
  return new Promise((resolve, reject) => {
    getStockfishBlobUrl().then(blobUrl => {
      const worker = new Worker(blobUrl);
      let ready = false;
      let uciReceived = false;

      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data.trim() : null;
        if (!line) return;
        // 모든 메시지 로그 (초기화 전까지)
        if (!ready) console.log('[SF]', line.substring(0, 120));

        if (line.includes('uciok')) {
          uciReceived = true;
          worker.postMessage('setoption name Threads value ' + threads);
          worker.postMessage('setoption name Hash value ' + hashMb);
          worker.postMessage('setoption name UCI_AnalyseMode value true');
          worker.postMessage('setoption name Move Overhead value 0');
          worker.postMessage('setoption name Contempt value 0');
          worker.postMessage('setoption name Analysis Contempt value Off');
          worker.postMessage('setoption name Skill Level value 20');
          worker.postMessage('isready');
        } else if (line.includes('readyok') && !ready) {
          ready = true;
          console.log('[Stockfish] 초기화 완료!');
          resolve(worker);
        }
      };

      worker.onerror = (e) => {
        console.error('[Stockfish] Worker 오류:', e.message || e);
        reject(e);
      };

      // 500ms 후 uci 전송 (WASM 로드 대기)
      setTimeout(() => {
        console.log('[Stockfish] uci 전송');
        worker.postMessage('uci');
      }, 500);

      // 타임아웃 30초
      setTimeout(() => {
        if (!ready) {
          const why = uciReceived ? 'readyok 미수신' : 'uciok 미수신';
          console.error('[Stockfish] 타임아웃:', why);
          reject(new Error('Stockfish Worker 초기화 타임아웃 — ' + why));
        }
      }, 30000);
    }).catch(err => {
      console.error('[Stockfish] Blob URL 생성 실패:', err);
      reject(err);
    });
  });
}


// 같은 탭에서 분석 보드를 다시 열 때 전체 화면 오버레이 생략 (SharedWorker 재사용 시 특히 빠름)
const STOCKFISH_OVERLAY_SESSION_KEY = 'chess_education_sf_analysis_ready';

function releaseSharedMainEngine() {
  if (!_useSharedWorkerMain || !_mainEnginePort) return;
  try {
    _mainEnginePort.postMessage({ type: 'releaseStream' });
  } catch (e) { /* ignore */ }
  _mainEnginePort = null;
  _useSharedWorkerMain = false;
}

function connectSharedMainEngine() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) reject(new Error('SharedWorker stream 연결 타임아웃'));
    }, 35000);
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      fn();
    };
    try {
      const sw = new SharedWorker('/stockfish-shared-worker.js', { name: 'stockfish-shared' });
      const port = sw.port;
      _mainEnginePort = port;
      port.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;
        if (msg.type === 'uciLine' && msg.line) {
          handleMainWorkerMessage({ data: typeof msg.line === 'string' ? msg.line.trim() : msg.line });
          return;
        }
        if (msg.type === 'streamReady') {
          finish(() => resolve());
          return;
        }
        if (msg.type === 'error' && msg.message) {
          finish(() => reject(new Error(msg.message)));
        }
      };
      port.start();
      port.postMessage({ type: 'claimStream' });
    } catch (e) {
      finish(() => reject(e));
    }
  });
}

// ── 엔진 초기화 ──────────────────────────────────────────────
async function initEngine() {
  var skipFullScreenOverlay = false;
  try {
    skipFullScreenOverlay = sessionStorage.getItem(STOCKFISH_OVERLAY_SESSION_KEY) === '1';
  } catch (e) { /* private mode 등 */ }

  if (skipFullScreenOverlay) {
    var loadEl0 = document.getElementById('engine-loading');
    if (loadEl0) loadEl0.classList.add('hidden');
  }

  setEngineBadge('loading', '로딩 중...');
  if (!skipFullScreenOverlay) {
    document.getElementById('loading-text').textContent = 'Stockfish 18 WASM 로딩 중...';
  }

  try {
    const cores   = navigator.hardwareConcurrency || 2;
    const bgCount = Math.max(1, Math.min(Math.floor(cores / 2), 2));
    const mainThr = Math.max(2, Math.floor(cores / 2));
    const bgThr   = 1;

    let usedShared = false;
    if (typeof SharedWorker !== 'undefined') {
      if (!skipFullScreenOverlay) {
        document.getElementById('loading-text').textContent =
          'Stockfish 공유 엔진 연결 중... (처음만 전체 로딩)';
      }
      try {
        await connectSharedMainEngine();
        mainWorker = {
          postMessage(s) {
            _mainEnginePort.postMessage({ type: 'streamUci', line: s });
          }
        };
        mainReady = true;
        _useSharedWorkerMain = true;
        bgWorkers = [];
        usedShared = true;
        window.addEventListener('pagehide', releaseSharedMainEngine, { once: false });
        console.log('[Engine] 메인 엔진 — SharedWorker 스트림 (탭 간 WASM 1회)');
      } catch (swErr) {
        const swMsg = (swErr && (swErr.message || String(swErr))) || '';
        // SharedWorker 전역에 Worker 생성자가 없는 브라우저(Safari 등)에서 흔함 — 전용 Worker 폴백이 정상 경로
        if (/Worker is not defined|NESTED_WORKER_UNSUPPORTED/i.test(swMsg)) {
          console.info('[Engine] SharedWorker 미사용 — 이 환경에서는 공유 워커 내부 전용 Worker를 쓸 수 없어 탭 전용 Worker로 Stockfish를 띄웁니다.');
        } else {
          console.warn('[Engine] SharedWorker 실패, 전용 Worker로 폴백:', swMsg || swErr);
        }
        releaseSharedMainEngine();
        mainWorker = null;
        mainReady = false;
        _mainEnginePort = null;
        _useSharedWorkerMain = false;
      }
    }

    if (!usedShared) {
      console.log(`[Engine] 코어: ${cores} | 메인: ${mainThr}스레드 | 백그라운드: ${bgCount}개`);

      const workerPromises = [
        createStockfishWorker(mainThr, 128),
        ...Array.from({ length: bgCount }, () => createStockfishWorker(bgThr, 32))
      ];

      if (!skipFullScreenOverlay) {
        document.getElementById('loading-text').textContent =
          `Stockfish 18 초기화 중... (0/${1 + bgCount})`;
      }

      let doneCount = 0;
      const results = await Promise.all(workerPromises.map((p, idx) =>
        p.then(w => {
          doneCount++;
          if (!skipFullScreenOverlay) {
            document.getElementById('loading-text').textContent =
              `Stockfish 18 초기화 중... (${doneCount}/${1 + bgCount})`;
          }
          return { idx, worker: w };
        })
      ));

      for (let i = 0; i < results.length; i++) {
        const { idx, worker: w } = results[i];
        if (idx === 0) {
          mainWorker = w;
          mainWorker.onmessage = handleMainWorkerMessage;
          mainReady = true;
        } else {
          bgWorkers.push({ worker: w, busy: false });
        }
      }
      console.log(`[Engine] 초기화 완료 — 메인 1개 + 백그라운드 ${bgCount}개`);
    }

    setEngineBadge('ready', `SF18 WASM | ${cores}코어` + (usedShared ? ' · 공유' : ''));
    hideLoading();
    try {
      sessionStorage.setItem(STOCKFISH_OVERLAY_SESSION_KEY, '1');
    } catch (e) { /* ignore */ }

    if (autoAnalyze) analyzePosition();
    if (typeof tryInitEndgamePractice === 'function') tryInitEndgamePractice();
    if (typeof tryInitPracticePage === 'function') tryInitPracticePage();

  } catch (err) {
    console.error('[Engine] 초기화 실패:', err);
    setEngineBadge('error', '엔진 오류');
    var errEl = document.getElementById('engine-loading');
    if (errEl) errEl.classList.remove('hidden');
    var lt = document.getElementById('loading-text');
    if (lt) {
      lt.textContent =
        'Stockfish 18 로딩 실패: ' + (err && err.message ? err.message : String(err)) + ' — F12 콘솔에서 상세 오류를 확인하세요.';
    }
  }
}

// ── 메인 Worker 메시지 처리 ──────────────────────────────────
// rawPvStore : 마지막으로 확정된 사이클의 parsed 원본
// pvData     : 화면 표시용 processed 결과
// cycleId    : 현재 수집 중인 사이클의 analysisId (stale flush 완전 차단)
// cycleSnap  : 사이클 시작 시 고정된 board/turn 스냅샷

let rawPvStore  = {};
let cycleDepth  = 0;
let cycleStore  = {};
let cycleId     = 0;
let cycleSnap   = null;

function flushCycleToDisplay() {
  // 현재 분석 id와 다르면 완전 무시 (stale flush 차단)
  if (cycleId !== currentAnalysisId) return;
  if (!Object.keys(cycleStore).length) return;
  if (!cycleSnap) return;  // 스냅샷 미초기화 방어

  rawPvStore = { ...cycleStore };
  const { turn, board, cast, ep } = cycleSnap;
  const processed = processPvData(rawPvStore, turn, board, cast, ep);
  if (!processed[1]) return;

  pvData = processed;
  const best = processed[1];

  document.getElementById('depth-info').textContent =
    `⚙ d${best.depth}` +
    (best.nps    ? ` · ${(best.nps/1e6).toFixed(1)}Mnps` : '') +
    (best.time_ms? ` · ${(best.time_ms/1000).toFixed(1)}s` : '');
  document.getElementById('eval-score').textContent = best.eval;
  updateEvalBarFromCp(best.cpFromWhite, best.eval);
  renderTopMoves();

  // ── 엔진 라인 실시간 동기화 ──────────────────────────────
  // _engineLineAnalysisFen 이 설정되어 있으면 엔진라인 수 포지션을 분석 중
  // → 기보 패널 enginePreviews 덮어쓰기 금지 (최선수 패널만 업데이트됨)
  if (_engineLineAnalysisFen) return;

  // ★ 버그1 근본 수정: enginePreview가 활성화된 상태(사용자가 라인 클릭해서 탐색 중)이면
  // 기보 패널의 moves를 절대 업데이트하지 않음 (클릭 시점으로 고정)
  // top-move 패널(renderTopMoves)만 계속 최신 분석으로 업데이트됨
  if (game && game.enginePreview) return;

  // 현재 분석 FEN이 어떤 histIdx의 기준 포지션과 일치하면
  // 그 histIdx의 enginePreviews를 새 pvData로 갱신하고 기보 패널도 업데이트
  if (game && game.enginePreviews) {
    const analyzedFen = lastAnalyzedFen;
    let syncedHistIdx = null;

    // 활성 엔진라인이 없으면 전체 맵 탐색
    for (const hIdx of Object.keys(game.enginePreviews)) {
      const hi = parseInt(hIdx);
      if (_getHistFen(hi) === analyzedFen) {
        syncedHistIdx = hi;
        break;
      }
    }

    if (syncedHistIdx !== null && game.enginePreviews[syncedHistIdx]) {
      // 현재 표시 중인 pvIdx의 라인만 업데이트 (1개만 표시 정책)
      const existingLines = game.enginePreviews[syncedHistIdx];
      const activePvIdx = existingLines[0]?.pvIdx ?? 1;
      const updatedPv = pvData[activePvIdx] || pvData[1];
      if (updatedPv && updatedPv.moves && updatedPv.moves.length > 0) {
        // 기존 라인 찾아서 moves/eval/depth만 업데이트 (extraMoves 보존)
        const existingLine = existingLines.find(l => l.pvIdx === activePvIdx) || existingLines[0];
        if (existingLine) {
          // ★ 수정: 클릭으로 스냅샷이 고정된 라인은 엔진 업데이트로 덮어쓰지 않음
          //   (사용자가 클릭한 시점의 수순이 기보에 고정되어야 하므로)
          if (!existingLine._snapshot) {
            existingLine.moves = [...updatedPv.moves];
            existingLine.uciMoves = [...(updatedPv.pv || updatedPv.uciMoves || [])];
          }
          existingLine.eval = updatedPv.eval;
          existingLine.depth = updatedPv.depth;
          game.renderMoveList();
        }
      }
    }
  }
}

// 특정 histIdx의 기준 포지션 FEN 계산 헬퍼
function _getHistFen(histIdx) {
  if (!game) return null;
  if (histIdx < 0) {
    return boardToFen(INIT_BOARD, 'w', { wK: true, wQ: true, bK: true, bQ: true }, null, 0, 1);
  }
  const s = game.history[histIdx];
  if (!s) return null;
  // fenAfter가 이미 저장돼 있으므로 board 재계산 불필요
  return s.fenAfter || null;
}

// 엔진 정지 상태에서만 호출 — go 명령 전송
function _sendGoCommand(fen, myId, mpv, movetime) {
  if (myId !== currentAnalysisId) return;
  engineSearching = true;
  cycleId   = myId;
  cycleSnap = {
    turn:  pendingTurn,
    board: pendingBoard,
    cast:  pendingCastling,
    ep:    pendingEP,
  };
  console.log('[CMD] → setoption MultiPV', mpv);
  mainWorker.postMessage(`setoption name MultiPV value ${mpv}`);
  console.log('[CMD] → position fen', fen.slice(0,30));
  mainWorker.postMessage(`position fen ${fen}`);
  // depth와 movetime 동시 지정 — 둘 중 먼저 도달하는 조건에서 종료
  const targetDepth = Math.max(analysisDepth, 25);
  console.log('[CMD] → go depth', targetDepth, 'movetime', movetime);
  mainWorker.postMessage(`go depth ${targetDepth} movetime ${movetime}`);
  console.log('[CMD] → go sent ✓');
}

/**
 * 현재 포지션에서 Stockfish 최선 1수만 요청 (엔드게임 연습 상대)
 */
function executeEnginePlayMove(fen, callback) {
  if (!mainWorker || !mainReady) {
    callback(null);
    return;
  }
  var sendGo = function () {
    window._enginePlayResolve = callback;
    mainWorker.postMessage('setoption name MultiPV value 1');
    mainWorker.postMessage('position fen ' + fen);
    mainWorker.postMessage('go depth 40 movetime 10000');
    engineSearching = true;
    var ed = document.getElementById('engine-dot');
    if (ed) ed.className = 'engine-dot thinking';
  };
  if (engineSearching) {
    window._enginePlayAfterStop = sendGo;
    mainWorker.postMessage('stop');
  } else {
    sendGo();
  }
}
window.executeEnginePlayMove = executeEnginePlayMove;

function handleMainWorkerMessage(e) {
  const line = e.data;
  if (!line) return;
  if (line.includes('currmove')) return;

  if (line.startsWith('info') && line.includes('depth') && line.includes('score')) {
    const parsed = parseInfoLine(line);
    if (!parsed) return;

    // cycleId가 currentAnalysisId와 다르면 새 분석이 시작된 것
    // → cycleId 동기화하고 스냅샷 고정
    if (cycleId !== currentAnalysisId) {
      cycleId    = currentAnalysisId;
      cycleDepth = 0;
      cycleStore = {};
      cycleSnap  = {
        turn:  pendingTurn,
        board: pendingBoard,
        cast:  pendingCastling,
        ep:    pendingEP,
      };
    }
    // 스냅샷이 어떤 이유로든 null이면 항상 보완 (race condition 방어)
    if (!cycleSnap) {
      cycleSnap = {
        turn:  pendingTurn,
        board: pendingBoard,
        cast:  pendingCastling,
        ep:    pendingEP,
      };
    }

    const mpv   = parsed.multipv || 1;
    const depth = parsed.depth;

    // 새 depth 사이클: mpv=1이 더 깊은 depth로 오면 버퍼 리셋
    if (mpv === 1 && depth > cycleDepth) {
      cycleDepth = depth;
      cycleStore = {};
    }

    cycleStore[mpv] = parsed;

    // multiPV개 모두 도착 → 즉시 flush
    if (Object.keys(cycleStore).length >= multiPV) {
      clearTimeout(renderTimer);
      flushCycleToDisplay();
    } else {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => flushCycleToDisplay(), 120);
    }

  } else if (line.startsWith('bestmove')) {
    if (typeof window._enginePlayAfterStop === 'function') {
      clearTimeout(renderTimer);
      const next = window._enginePlayAfterStop;
      window._enginePlayAfterStop = null;
      engineSearching = false;
      next();
      return;
    }
    if (typeof window._enginePlayResolve === 'function') {
      clearTimeout(renderTimer);
      const resolve = window._enginePlayResolve;
      window._enginePlayResolve = null;
      engineSearching = false;
      const m = line.match(/^bestmove (\S+)/);
      let uci = null;
      if (m && m[1] !== '(none)') uci = m[1];
      resolve(uci);
      if (document.getElementById('engine-dot')) {
        document.getElementById('engine-dot').className = 'engine-dot ready';
      }
      return;
    }

    clearTimeout(renderTimer);
    engineSearching = false;
    // 이 bestmove가 현재 분석에 속하지 않으면 무시
    if (cycleId !== currentAnalysisId) return;

    document.getElementById('engine-dot').className = 'engine-dot ready';

    // 미처 flush 안 된 마지막 사이클
    if (Object.keys(cycleStore).length && cycleSnap) {
      flushCycleToDisplay();
    }

    const b = pvData[1];
    if (!b) return;

    document.getElementById('depth-info').textContent =
      `✓ d${b.depth}` +
      (b.nps    ? ` · ${(b.nps/1e6).toFixed(1)}Mnps` : '') +
      (b.time_ms? ` · ${(b.time_ms/1000).toFixed(1)}s` : '');
    document.getElementById('eval-score').textContent = b.eval;
    updateEvalBarFromCp(b.cpFromWhite, b.eval);
    renderTopMoves();

    // evalCache 저장
    const savedFen = lastSentFen || pendingFen;
    if (savedFen && b) {
      // 메이트 수순 정보 추출 (양수: 현재 플레이어가 메이트 가능, 음수: 상대가 메이트 가능)
      // b는 현재 플레이어 기준 1순위 PV
      let mateIn = null;
      if (b.score_type === 'mate') {
        // score_val 양수 = 현재 플레이어가 N수 내 메이트
        // score_val 음수 = 현재 플레이어가 N수 내 메이트당함
        mateIn = b.score_val; // 그대로 저장 (부호 포함)
      } else if (Math.abs(b.cpFromWhite) >= 9000) {
        // cp가 ±9000 이상이면 메이트로 간주 (score_type 누락 방어)
        const turn = savedFen.split(' ')[1] || 'w';
        mateIn = b.cpFromWhite > 0
          ? (turn === 'w' ? 99 : -99)
          : (turn === 'w' ? -99 : 99);
      }
      const topAlts = {
        best1cp: pvData[1] ? pvData[1].cpFromWhite : null,
        best2cp: pvData[2] ? pvData[2].cpFromWhite : null,
      };
      let legalMoveCount = null;
      try {
        const fp = savedFen.split(' ');
        if (fp.length >= 2) {
          const tb = parseFenBoard(fp[0]);
          const tt = fp[1];
          const tc = parseFenCastling(fp[2] || '-');
          const te = parseFenEP(fp[3] || '-');
          if (tb) legalMoveCount = getAllLegalMoves(tb, tt, tc, te).length;
        }
      } catch(e) {}
      // pvs 슬림화: nps/time_ms 제거, pv 수열 6수로 제한 (메모리 절감)
      const slimPvs = {};
      for (const [k, v] of Object.entries(rawPvStore)) {
        slimPvs[k] = {
          depth: v.depth, score_type: v.score_type, score_val: v.score_val,
          pv: (v.pv || []).slice(0, 6), multipv: v.multipv,
        };
      }
      evalCache[normFen(savedFen)] = {
        cp: b.cpFromWhite, depth: b.depth, topAlts, legalMoveCount,
        mateIn, pvs: slimPvs, turn: pendingTurn,
      };
      updateMoveAnnotations();
    }
    // 사이클 완전 초기화
    rawPvStore = {};
    cycleStore = {};
    cycleDepth = 0;
    cycleSnap  = null;
    cycleId    = 0;

    // stop 후 대기 중인 다음 분석이 있으면 즉시 실행
    if (pendingNextFen) {
      const p = pendingNextFen;
      pendingNextFen = null;
      _sendGoCommand(p.fen, p.myId, p.multiPV, p.movetime);
    }
  }
}

// ── UCI info 라인 파서 ───────────────────────────────────────
function parseInfoLine(line) {
  const depthM   = line.match(/depth (\d+)/);
  const pvM      = line.match(/ pv (.+)/);
  const scoreM   = line.match(/score (cp|mate) (-?\d+)/);
  const multipvM = line.match(/multipv (\d+)/);
  const npsM     = line.match(/nps (\d+)/);
  const timeM    = line.match(/ time (\d+)/);

  if (!depthM || !scoreM) return null;

  return {
    depth:      parseInt(depthM[1]),
    multipv:    multipvM ? parseInt(multipvM[1]) : 1,
    score_type: scoreM[1],
    score_val:  parseInt(scoreM[2]),
    pv:         pvM ? pvM[1].trim().split(' ').slice(0, 6) : [],  // 6수면 top-moves 표시에 충분
    nps:        npsM  ? parseInt(npsM[1])  : 0,
    time_ms:    timeM ? parseInt(timeM[1]) : 0,
    // _id는 handleMainWorkerMessage에서 수신 즉시 캡처 (타이밍 버그 방지)
  };
}

// ── PV 데이터 처리 ───────────────────────────────────────────
// rawPvData: parseInfoLine 원본 ({score_type, score_val, pv[], ...})
function processPvData(rawPvData, turn, snapBoard, snapCastling, snapEP) {
  const out = {};
  const board    = snapBoard    || pendingBoard    || game.board;
  const castling = snapCastling || pendingCastling || game.castling;
  const ep       = snapEP !== undefined ? snapEP
                 : pendingEP !== undefined ? pendingEP : game.enPassant;
  for (const [key, pv] of Object.entries(rawPvData)) {
    const pvNum = parseInt(key);
    // raw 형태 (score_type 있음) 또는 이미 processed (cpFromWhite 있음) 모두 처리
    let cpFromWhite, evalStr;
    if (pv.score_type !== undefined) {
      cpFromWhite = computeCp(pv, turn);
      evalStr     = cpToStr(cpFromWhite, pv, turn);
    } else {
      cpFromWhite = pv.cpFromWhite ?? 0;
      evalStr     = pv.eval ?? '0.00';
    }
    const sanMoves = uciMovesToSan(pv.pv || [], board, turn, castling, ep);
    out[pvNum] = {
      depth: pv.depth, eval: evalStr, cpFromWhite,
      moves: sanMoves.length ? sanMoves : (pv.moves || []),
      nps: pv.nps, time_ms: pv.time_ms,
      score_type: pv.score_type, score_val: pv.score_val, pv: pv.pv,
    };
  }
  return out;
}

function computeCp(pv, turn) {
  if (pv.score_type === 'mate') {
    const fromSide = pv.score_val > 0 ? 9900 : -9900;
    return turn === 'w' ? fromSide : -fromSide;
  }
  return turn === 'w' ? pv.score_val : -pv.score_val;
}

function cpToStr(cpFromWhite, pv, turn) {
  if (pv.score_type === 'mate') {
    return cpFromWhite > 0 ? `M${Math.abs(pv.score_val)}` : `-M${Math.abs(pv.score_val)}`;
  }
  const v = cpFromWhite / 100;
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

// ── 분석 요청 ────────────────────────────────────────────────
// 분석 시작 시점의 보드 상태 스냅샷 (결과 수신 시 SAN 변환에 사용)
let pendingBoard    = null;
let pendingCastling = null;
let pendingEP       = null;

// 설정 변경 플래그 — 같은 FEN이어도 강제 재분석
let settingsDirty = false;

function analyzePosition(force) {
  if (coachOpen) updateCoachContext();
  if (!autoAnalyze || !mainReady) return;
  if (analysisTimeout) clearTimeout(analysisTimeout);

  const fen = boardToFen(
    game.board, game.turn, game.castling, game.enPassant,
    game.halfMove, game.fullMove
  );

  // 같은 FEN + 설정 변경 없음 + force 아님 → 스킵
  if (fen === lastAnalyzedFen && !settingsDirty && !force) return;

  const wasSettingsDirty = settingsDirty;
  settingsDirty = false;
  currentAnalysisId++;
  const myId = currentAnalysisId;
  pendingTurn     = game.turn;
  pendingFen      = fen;
  pendingBoard    = game.board.map(r=>[...r]);
  pendingCastling = {...game.castling};
  pendingEP       = game.enPassant;

  document.getElementById('engine-dot').className = 'engine-dot thinking';

  // 캐시: force/설정변경 아닐 때만 즉시 표시 (재분석 루프 방지)
  const cachedEntry = evalCache[normFen(fen)];
  if (cachedEntry && cachedEntry.pvs && !force && !wasSettingsDirty) {
    const cachedTurn = cachedEntry.turn || game.turn;
    const snapB  = game.board.map(r=>[...r]);
    const snapC  = {...game.castling};
    const snapEP = game.enPassant;
    pvData = processPvData(cachedEntry.pvs, cachedTurn, snapB, snapC, snapEP);
    const bestEval = pvData[1] ? pvData[1].eval : null;
    const v = cachedEntry.cp / 100;
    const evalStr = bestEval || (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
    document.getElementById('eval-score').textContent = evalStr;
    updateEvalBarFromCp(cachedEntry.cp, bestEval);
    document.getElementById('depth-info').textContent =
      `⚙ d${cachedEntry.depth} (재분석 중...)`;
    renderTopMoves();
  } else {
    pvData = {};
    renderTopMoves('분석 중...');
    document.getElementById('depth-info').textContent = '분석 시작 중...';
  }

  analysisTimeout = setTimeout(() => {
    if (myId !== currentAnalysisId) return;
    if (!mainWorker) return;

    lastAnalyzedFen = fen;
    lastSentFen     = fen;
    pvData          = {};
    rawPvStore      = {};
    cycleStore      = {};
    cycleDepth      = 0;
    cycleSnap = null;
    cycleId   = 0;

    if (engineSearching) {
      console.log('[CMD] → stop (searching, queuing)');
      pendingNextFen = { fen, myId, multiPV, movetime: analysisTime };
      mainWorker.postMessage('stop');
    } else {
      // 대기 중 → 즉시 go 전송
      pendingNextFen = null;
      _sendGoCommand(fen, myId, multiPV, analysisTime);
    }
  }, 150);
}

// 설정 변경 시 강제 재분석
function reanalyzeWithSettings() {
  settingsDirty = true;
  lastAnalyzedFen = '';   // FEN 캐시 무효화
  analyzePosition(true);
}

// 엔진라인 탐색 중 특정 FEN 분석 (게임 보드 상태와 무관)
function _analyzeSpecificFen(fen) {
  if (!autoAnalyze || !mainReady || !fen) return;
  if (analysisTimeout) clearTimeout(analysisTimeout);
  if (fen === lastAnalyzedFen) return;

  const fenParts = fen.split(' ');
  const turn = fenParts[1] || 'w';
  const board = parseFenBoard(fenParts[0]);
  const castling = parseFenCastling(fenParts[2] || '-');
  const ep = parseFenEP(fenParts[3] || '-');
  if (!board) return;

  currentAnalysisId++;
  const myId = currentAnalysisId;
  pendingTurn = turn;
  pendingFen = fen;
  pendingBoard = board;
  pendingCastling = castling;
  pendingEP = ep;

  document.getElementById('engine-dot').className = 'engine-dot thinking';

  analysisTimeout = setTimeout(() => {
    if (myId !== currentAnalysisId) return;
    if (!mainWorker) return;
    lastAnalyzedFen = fen;
    lastSentFen = fen;
    pvData = {};
    rawPvStore = {};
    cycleStore = {};
    cycleDepth = 0;
    cycleSnap = null;
    cycleId = 0;
    if (engineSearching) {
      pendingNextFen = { fen, myId, multiPV, movetime: analysisTime };
      mainWorker.postMessage('stop');
    } else {
      pendingNextFen = null;
      _sendGoCommand(fen, myId, multiPV, analysisTime);
    }
  }, 100);
}

function setEngineBadge(state, text) {
  const dot   = document.getElementById('engine-dot');
  const label = document.getElementById('engine-name');
  const depth = document.getElementById('depth-info');
  if (dot)   dot.className   = `engine-dot ${state}`;
  if (label) label.textContent = text || 'Stockfish 18 WASM';
  if (depth && text) depth.textContent = text;
}

// ═══════════════════════════════════════════════════════════
// 백그라운드 전체 기보 병렬 분석 — WASM Worker 풀 사용
// ═══════════════════════════════════════════════════════════

// ── 단일 Worker로 FEN 하나 분석 ──────────────────────────────
function analyzeWithWorker(workerObj, fen, depth, movetime, multipv) {
  return new Promise((resolve) => {
    const { worker } = workerObj;
    workerObj.busy = true;

    const pvs = {};
    let bestDepth = 0;       // 현재까지 수신한 최고 depth
    let completeCycle = {};  // 최고 depth에서 multipv개 모두 모인 사이클
    const turn = fen.split(' ')[1] || 'w';

    worker.onmessage = (e) => {
      const line = e.data;
      if (!line || line.includes('currmove')) return;

      if (line.startsWith('info') && line.includes('depth') && line.includes('score')) {
        const parsed = parseInfoLine(line);
        if (!parsed) return;
        const mpv = parsed.multipv || 1;
        const d   = parsed.depth;

        // 새 depth 사이클 시작
        if (d > bestDepth) {
          bestDepth = d;
          completeCycle = {};
        }
        // 같은 depth 사이클에서 각 multipv 슬롯 저장 (가장 높은 depth만 유지)
        if (d === bestDepth) {
          completeCycle[mpv] = parsed;
          // multipv개 모두 도착하면 pvs에 확정
          if (Object.keys(completeCycle).length >= multipv) {
            for (const [k, v] of Object.entries(completeCycle)) pvs[k] = v;
          }
        }

      } else if (line.startsWith('bestmove')) {
        workerObj.busy = false;

        // 미완성 사이클도 반영 (movetime 초과로 중간 종료된 경우)
        for (const [k, v] of Object.entries(completeCycle)) {
          if (!pvs[k] || v.depth >= pvs[k].depth) pvs[k] = v;
        }

        const processed = {};
        for (const [k, pv] of Object.entries(pvs)) {
          const cpFromWhite = computeCp(pv, turn);
          processed[parseInt(k)] = {
            depth: pv.depth, cpFromWhite,
            score_type: pv.score_type, score_val: pv.score_val,
            pv: (pv.pv || []).slice(0, 6),
          };
        }
        resolve({ fen: normFen(fen) + ' 0 1', turn, pvs: processed });
      }
    };

    worker.postMessage('stop');
    worker.postMessage(`setoption name MultiPV value ${multipv}`);
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth} movetime ${movetime}`);
  });
}

// ── 전체 기보 병렬 분석 시작 ─────────────────────────────────
// 수 분류는 Lichess API(%judgment)만 사용하므로 로컬 백그라운드 분석 비활성화
async function startBgAnalysis() {
  return; // 로컬 수 분류 비활성화 — 우측 패널 "Lichess로 분석" 버튼 사용
  if (!game || game.history.length === 0) return; // eslint-disable-line no-unreachable
  if (bgWorkers.length === 0) {
    // SharedWorker 모드: 메인 엔진은 공유하며 백그라운드 전용 Worker는 두지 않음
    return;
  }

  // FEN 수집: fenBefore만 수집 (fenAfter[i] === fenBefore[i+1] 이므로 중복 없음 → 분석량 절반)
  const fenSet = new Set();
  fenSet.add('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  for (const h of game.history) {
    if (h.fenBefore) fenSet.add(normFen(h.fenBefore) + ' 0 1');
    // fenAfter는 다음 수의 fenBefore와 동일하므로 별도 수집 불필요
    // 마지막 수의 fenAfter만 추가 (다음 fenBefore가 없음)
  }
  // 마지막 수의 fenAfter는 별도로 추가
  const lastH = game.history[game.history.length - 1];
  if (lastH?.fenAfter) fenSet.add(normFen(lastH.fenAfter) + ' 0 1');

  const allFens = [...fenSet];

  // 캐시에 없는 것만
  const toAnalyze = allFens.filter(f => !evalCache[normFen(f)]);
  if (toAnalyze.length === 0) {
    updateMoveAnnotations();
    showToast('✅ 전체 분석 완료 (캐시)');
    return;
  }

  const bgDepth    = Math.min(analysisDepth, 18); // depth 18 = MIN_DEPTH와 동일, 이 이상이면 분류 확정
  const bgMovetime = 1500;                         // 포지션당 최대 1.5초 (3초→1.5초)
  const bgMultipv  = 2;                            // best1/best2만 필요 (best3는 분류에 미사용)

  showToast(`📊 전체 분석 시작 (${toAnalyze.length}개 · ${bgWorkers.length}개 병렬)`);

  let done = 0;
  const total = toAnalyze.length;

  // Worker 풀로 병렬 처리 (세마포어 패턴)
  const queue = [...toAnalyze];

  async function runWorker(workerObj) {
    while (queue.length > 0) {
      const fen = queue.shift();
      if (!fen) break;
      if (evalCache[normFen(fen)]) { done++; continue; }

      try {
        const result = await analyzeWithWorker(
          workerObj, fen, bgDepth, bgMovetime, bgMultipv
        );
        handleBgResult(result);
      } catch (e) {
        console.warn('[BG] 분석 실패:', fen.slice(0, 30), e);
      }

      done++;
      if (done % 20 === 0 || done === total) {
        const pct = Math.round(done / total * 100);
        showToast(`📊 분석 중... ${done}/${total} (${pct}%)`);
      }
    }
  }

  // 모든 Worker 동시 실행
  await Promise.all(bgWorkers.map(w => runWorker(w)));

  updateMoveAnnotations();
  showToast(`✅ 전체 분석 완료 (${total}개 포지션)`);
}

// ── 백그라운드 분석 결과 처리 ────────────────────────────────
function handleBgResult({ fen, turn, pvs }) {
  const pv1 = pvs[1], pv2 = pvs[2];
  if (!pv1) return;

  const topAlts = {
    best1cp: pv1.cpFromWhite,
    best2cp: pv2 ? pv2.cpFromWhite : null,
  };

  // 메이트 수순 정보 추출
  // pv1.score_val: UCI 기준 현재 두는 플레이어(turn) 관점 양수=내가 메이트, 음수=상대가 메이트
  // 단, cpFromWhite로도 메이트 여부 확인 가능 (±9900 이상)
  let mateIn = null;
  if (pv1.score_type === 'mate') {
    mateIn = pv1.score_val; // 양수: turn 플레이어가 메이트 가능, 음수: 메이트당함
  } else if (Math.abs(pv1.cpFromWhite) >= 9000) {
    // score_type이 없어도 cp가 ±9000 이상이면 메이트 수순으로 간주
    mateIn = pv1.cpFromWhite > 0
      ? (turn === 'w' ? 99 : -99)
      : (turn === 'w' ? -99 : 99);
  }

  // legalMoveCount: forced 판정 시에만 lazy 계산 (매 포지션 getAllLegalMoves 호출 제거 → CPU 절감)
  const legalMoveCount = null;

  // pvs 슬림화: nps/time_ms 제거, pv 수열 6수로 제한 (메모리 절감)
  const slimPvsBg = {};
  for (const [k, v] of Object.entries(pvs)) {
    slimPvsBg[k] = {
      depth: v.depth, score_type: v.score_type, score_val: v.score_val,
      pv: (v.pv || []).slice(0, 6), multipv: v.multipv,
      cpFromWhite: v.cpFromWhite,
    };
  }
  evalCache[normFen(fen)] = {
    cp:    pv1.cpFromWhite,
    depth: pv1.depth,
    topAlts,
    legalMoveCount,
    mateIn,
    pvs: slimPvsBg,
    turn,
  };

  // 실시간 배지 업데이트
  updateMoveAnnotations();

  // 위협 분석 자동 트리거: 패널 열려있고 depth 충분하고 FEN 바뀐 경우에만
  if (pv1.depth >= 16 && fen !== lastThreatFen && coachApiKey && !threatLoading) {
    clearTimeout(window._threatTimer);
    window._threatTimer = setTimeout(() => {
      const panel = document.getElementById('threat-panel');
      const panelOpen = panel && panel.style.display !== 'none';
      if (panelOpen && fen !== lastThreatFen && !threatLoading) {
        runThreatAnalysis();
      }
      // 최선수 설명도 함께 갱신
      const bestPanel = document.getElementById('best-explain-panel');
      const bestOpen = bestPanel && bestPanel.style.display !== 'none';
      if (bestOpen && fen !== lastBestExplainFen && !bestExplainLoading) {
        runBestMoveExplain();
      }
    }, 1200);
  }
}