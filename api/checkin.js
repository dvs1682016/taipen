/**
 * Vercel Node.js Function: /api/checkin
 * 環境變數：STAFF_PASSWORD、APP_API_SECRET、GAS_WEBAPP_URL
 * 不使用 NEXT_PUBLIC_ 前綴，避免洩漏至瀏覽器。
 */
const crypto = require('crypto');

function matches(a,b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'POST') return res.status(405).json({ok:false,message:'僅接受 POST'});
  const {STAFF_PASSWORD,APP_API_SECRET,GAS_WEBAPP_URL} = process.env;
  if (!STAFF_PASSWORD || STAFF_PASSWORD.length < 8 || !APP_API_SECRET || APP_API_SECRET.length < 32 || !GAS_WEBAPP_URL) {
    return res.status(503).json({ok:false,message:'伺服器環境變數尚未設定完成'});
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec(?:\?.*)?$/.test(GAS_WEBAPP_URL)) {
    return res.status(503).json({ok:false,message:'GAS_WEBAPP_URL 格式不正確'});
  }
  const data = typeof req.body === 'string' ? (()=>{try{return JSON.parse(req.body)}catch{return {}}})() : (req.body || {});
  const {password,action,code} = data;
  if (!matches(password,STAFF_PASSWORD)) return res.status(401).json({ok:false,message:'工作人員密碼不正確'});
  if (!['stats','lookup','confirm'].includes(action)) return res.status(400).json({ok:false,message:'操作類型錯誤'});
  if (action !== 'stats' && (typeof code !== 'string' || !/^TP-[A-Fa-f0-9]{16}$/.test(code.trim()))) {
    return res.status(400).json({ok:false,message:'請提供有效的 TP- 報到編號'});
  }
  try {
    const aborter = new AbortController();
    const timeout = setTimeout(()=>aborter.abort(),25000);
    let upstream;
    try {
      upstream = await fetch(GAS_WEBAPP_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({secret:APP_API_SECRET,action,code:typeof code==='string'?code.trim().toUpperCase():''}),
        redirect:'follow',signal:aborter.signal
      });
    } finally { clearTimeout(timeout); }
    if (!upstream.ok) return res.status(502).json({ok:false,message:'Apps Script API 無法連線（HTTP '+upstream.status+'）'});
    const output = await upstream.text();
    let result;
    try { result = JSON.parse(output); }
    catch { return res.status(502).json({ok:false,message:'Apps Script 回傳非 JSON；請檢查部署存取權與網址'}); }
    if (!result || typeof result.ok !== 'boolean') return res.status(502).json({ok:false,message:'後端回傳格式不正確'});
    return res.status(200).json(result);
  } catch(err) {
    console.error('GAS proxy error:',err && err.message);
    return res.status(502).json({ok:false,message:'後端連線逾時或失敗，請稍後再試'});
  }
};
