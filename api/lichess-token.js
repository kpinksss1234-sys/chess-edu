// api/lichess-token.js
// Vercel Serverless Function
// LICHESS_TOKEN 환경변수를 클라이언트에 안전하게 전달

export default function handler(req, res) {
  // GET 요청만 허용
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.LICHESS_TOKEN || '';

  if (!token) {
    return res.status(404).json({ token: null });
  }

  // 캐시 방지 (토큰 갱신 시 즉시 반영)
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ token });
}
