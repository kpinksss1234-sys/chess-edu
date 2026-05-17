// api/analyze.js
// Render 백엔드 /analyze 프록시

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    console.log('[Proxy] Client request body:', req.body);

    const response = await fetch('https://chess-backend-r3bc.onrender.com/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('[Proxy] Backend non-JSON response:', text);
      return res.status(response.status).json({ error: 'Backend returned non-JSON response', detail: text });
    }
    
    if (!response.ok) {
      console.error('[Proxy] Backend error:', response.status, data);
      return res.status(response.status).json({ error: data.error || data.detail || 'Backend API 오류', status: response.status });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('[Proxy] Exception:', error.message);
    return res.status(500).json({ error: 'Internal Server Error', detail: error.message });
  }
}
