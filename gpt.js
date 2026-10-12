const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DEFAULT_MODEL = 'AI-WhatsAppBot';
const REQUEST_TIMEOUT_MS = 90_000;

/** Send a prompt to 9Router's OpenAI-compatible Chat Completions endpoint. */
export const responAI = async (chatMessage, sessID) => {
  const prompt = String(chatMessage ?? '').trim();
  if (!prompt) return 'Tulis pesan setelah command /ai. Contoh: /ai jelaskan apa itu API.';

  const baseUrl = (process.env.NINE_ROUTER_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (process.env.NINE_ROUTER_MODEL || DEFAULT_MODEL).trim();
  const apiKey = (process.env.NINE_ROUTER_API_KEY || '').trim();
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // 9Router can run locally without authentication; send a key only if configured.
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || response.statusText || 'Unknown error';
      throw new Error(`9Router HTTP ${response.status}: ${detail}`);
    }

    const answer = payload?.choices?.[0]?.message?.content
      ?? payload?.choices?.[0]?.text
      ?? payload?.output_text;
    if (typeof answer !== 'string' || !answer.trim()) {
      throw new Error('9Router merespons, tetapi teks jawaban tidak ditemukan. Periksa model dan format respons.');
    }

    return answer.trim();
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `Permintaan ke 9Router timeout setelah ${REQUEST_TIMEOUT_MS / 1000} detik.`
      : error?.message || String(error);
    console.error(`[AI] Gagal meminta ${model} dari ${endpoint}:`, message);

    if (error?.name === 'AbortError') {
      throw new Error('Permintaan AI terlalu lama. Coba lagi sebentar.');
    }
    if (error instanceof TypeError) {
      throw new Error(`Tidak bisa terhubung ke 9Router di ${baseUrl}. Pastikan 9Router aktif dan alamatnya dapat dijangkau dari proses bot.`);
    }
    throw new Error(`Gagal mendapatkan respons dari 9Router: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
};
