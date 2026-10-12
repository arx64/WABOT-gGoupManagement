import test from 'node:test';
import assert from 'node:assert/strict';
import { responAI } from './gpt.js';

const envKeys = ['NINE_ROUTER_BASE_URL', 'NINE_ROUTER_MODEL', 'NINE_ROUTER_API_KEY'];

function withEnv(values, run) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('responAI sends an OpenAI-compatible request to 9Router and returns its answer', async () => {
  await withEnv({
    NINE_ROUTER_BASE_URL: 'http://localhost:20128/v1/',
      NINE_ROUTER_MODEL: 'AI-WhatsAppBot',
    NINE_ROUTER_API_KEY: 'test-key',
  }, async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl;
    let requestOptions;
    globalThis.fetch = async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '  Halo dari AI  ' } }] }),
      };
    };

    try {
      assert.equal(await responAI('Halo'), 'Halo dari AI');
      assert.equal(requestUrl, 'http://localhost:20128/v1/chat/completions');
      assert.equal(requestOptions.method, 'POST');
      assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(requestOptions.body), {
        model: 'AI-WhatsAppBot',
        messages: [{ role: 'user', content: 'Halo' }],
        stream: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('responAI rejects empty prompts without calling the API', async () => {
  await withEnv({}, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fetch should not run'); };
    try {
      assert.match(await responAI('   '), /Tulis pesan setelah command \/ai/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('responAI exposes useful errors from a non-success API response', async () => {
  await withEnv({}, async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { message: 'unknown model' } }),
    });
    console.error = () => {};
    try {
      await assert.rejects(responAI('Tes'), /9Router HTTP 404: unknown model/);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });
});
