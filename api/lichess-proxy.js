// api/lichess-proxy.js
// Vercel Serverless Function — Lichess API CORS 프록시
// 클라이언트 → /api/lichess-proxy?path=... → lichess.org API → 클라이언트
//
// 지원 엔드포인트:
//   POST /api/lichess-proxy?path=import
//        → lichess.org/api/import  (게임 ID 획득)
//   POST /api/lichess-proxy?path=request-analysis&id={id}&color={white|black}
//        → lichess.org/api/analyse/{id}/{color}  (명시적 분석 요청)
//   GET  /api/lichess-proxy?path=export&id={id}
//        → lichess.org/game/export/{id}?evals=true&literate=true  (%judgment 포함)

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://chess-education.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ];
  if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://chess-education.vercel.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const token = process.env.LICHESS_TOKEN || '';
  if (!token) {
    return res.status(500).json({ error: 'LICHESS_TOKEN 환경변수가 설정되지 않았습니다.' });
  }

  const { path, id, color } = req.query;

  try {
    // ── 1) PGN import ── 게임 ID 획득
    // analyse=true 제거: 이미 분석된 게임은 무시되므로 request-analysis로 별도 요청
    if (path === 'import' && req.method === 'POST') {
      const body = req.body;
      const pgn = typeof body === 'object' ? body.pgn : body;

      const form = new URLSearchParams();
      form.append('pgn', pgn);

      const lichessRes = await fetch('https://lichess.org/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${token}`,
        },
        body: form.toString(),
      });

      const data = await lichessRes.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(lichessRes.status).json(data);
    }

    // ── 2) 명시적 분석 요청 ── POST /api/analyse/{gameId}/{color}
    // 이미 분석된 게임도 재분석 큐에 등록하는 유일한 방법
    if (path === 'request-analysis' && req.method === 'POST') {
      if (!id) return res.status(400).json({ error: 'id 파라미터 필요' });

      const analyzeColor = (color === 'black') ? 'black' : 'white';
      const analyseUrl = `https://lichess.org/api/analyse/${id}/${analyzeColor}`;

      console.log(`[lichess-proxy] request-analysis → ${analyseUrl}`);

      const lichessRes = await fetch(analyseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const responseText = await lichessRes.text();
      console.log(`[lichess-proxy] request-analysis status=${lichessRes.status} body=${responseText.slice(0, 200)}`);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');

      if (lichessRes.ok) {
        return res.status(200).json({ ok: true, status: lichessRes.status, body: responseText.slice(0, 200) });
      } else {
        return res.status(lichessRes.status).json({ ok: false, status: lichessRes.status, body: responseText.slice(0, 500) });
      }
    }

    // ── 3) export — literate=true 추가해야 %judgment 포함됨
    if (path === 'export' && req.method === 'GET') {
      if (!id) return res.status(400).json({ error: 'id 파라미터 필요' });

      const exportUrl = `https://lichess.org/game/export/${id}?evals=true&literate=true&clocks=false&opening=false`;
      const lichessRes = await fetch(exportUrl, {
        headers: {
          'Accept': 'application/x-chess-pgn',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!lichessRes.ok) {
        return res.status(lichessRes.status).json({ error: `export 실패: ${lichessRes.status}` });
      }

      const pgnText = await lichessRes.text();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/x-chess-pgn');
      return res.status(200).send(pgnText);
    }

    return res.status(400).json({ error: `알 수 없는 path: ${path}` });

  } catch (err) {
    console.error('[lichess-proxy]', err);
    return res.status(500).json({ error: err.message });
  }
}
