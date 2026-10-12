const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DEFAULT_MODEL = 'AI-WhatsAppBot';
// This model was used successfully before AI-WhatsAppBot was selected.
const DEFAULT_FALLBACK_MODELS = ['cx/gpt-5.6-luna'];
const REQUEST_TIMEOUT_MS = 90_000;

function getModelCandidates(primaryModel) {
  const configured = (process.env.NINE_ROUTER_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS.join(','))
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primaryModel, ...configured])];
}

function isModelUnavailableError(status, detail) {
  if (![400, 403, 404, 422].includes(status)) return false;
  return /model|unsupported|not found|does not exist|unknown|unavailable|invalid\s+model|mimo-auto/i.test(detail);
}

/** Send a prompt to 9Router's OpenAI-compatible Chat Completions endpoint. */
export const responAI = async (chatMessage, sessID) => {
  const prompt = String(chatMessage ?? '').trim();
  if (!prompt) return 'Tulis pesan setelah command /ai. Contoh: /ai jelaskan apa itu API.';

  const baseUrl = (process.env.NINE_ROUTER_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (process.env.NINE_ROUTER_MODEL || DEFAULT_MODEL).trim();
  const models = getModelCandidates(model);
  const apiKey = (process.env.NINE_ROUTER_API_KEY || '').trim();
  const endpoint = `${baseUrl}/chat/completions`;

  for (let index = 0; index < models.length; index += 1) {
    const candidateModel = models[index];
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
          model: candidateModel,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || response.statusText || 'Unknown error';
        if (isModelUnavailableError(response.status, detail) && index < models.length - 1) {
          console.warn(`[AI] Model ${candidateModel} tidak tersedia (${response.status}: ${detail}); mencoba fallback ${models[index + 1]}.`);
          continue;
        }
        throw new Error(`9Router HTTP ${response.status}: ${detail}`);
      }

      const answer = payload?.choices?.[0]?.message?.content
        ?? payload?.choices?.[0]?.text
        ?? payload?.output_text;
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new Error('9Router merespons, tetapi teks jawaban tidak ditemukan. Periksa model dan format respons.');
      }

      if (candidateModel !== model) console.log(`[AI] Fallback berhasil menggunakan model ${candidateModel}.`);
      return answer.trim();
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? `Permintaan ke 9Router timeout setelah ${REQUEST_TIMEOUT_MS / 1000} detik.`
        : error?.message || String(error);
      console.error(`[AI] Gagal meminta ${candidateModel} dari ${endpoint}:`, message);

      if (error?.name === 'AbortError') {
        throw new Error('Permintaan AI terlalu lama. Coba lagi sebentar.');
      }
      if (error instanceof TypeError) {
        throw new Error(`Tidak bisa terhubung ke 9Router di ${baseUrl}. Pastikan 9Router aktif dan alamatnya dapat dijangkau dari proses bot.`);
      }
      throw new Error(`Gagal mendapatkan respons dari 9Router (model ${candidateModel}): ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Semua model AI gagal memberikan respons.');
};
