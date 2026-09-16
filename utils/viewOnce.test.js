import test from 'node:test';
import assert from 'node:assert/strict';
import { extractViewOnceContent, isViewOnceMessage } from './viewOnce.js';

const image = { mimetype: 'image/jpeg', url: 'https://example.invalid/file' };

for (const wrapper of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
  test(`detects ${wrapper}`, () => {
    const payload = { [wrapper]: { message: { imageMessage: image } } };
    const result = extractViewOnceContent(payload);

    assert.equal(result?.wrapperType, wrapper);
    assert.equal(result?.mediaType, 'imageMessage');
    assert.equal(result?.mediaMessage, image);
  });
}

test('detects a view-once wrapper nested in an ephemeral message', () => {
  const payload = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2Extension: {
          message: { videoMessage: { mimetype: 'video/mp4' } },
        },
      },
    },
  };

  assert.equal(extractViewOnceContent(payload)?.mediaType, 'videoMessage');
});

test('detects normalized media using the inner viewOnce flag', () => {
  const payload = { imageMessage: { ...image, viewOnce: true } };
  assert.equal(extractViewOnceContent(payload)?.detectedBy, 'media-flag');
});

test('detects unavailable view-once marker on a WAMessage key', () => {
  const payload = { key: { isViewOnce: true }, message: {} };
  const result = extractViewOnceContent(payload);

  assert.equal(result?.detectedBy, 'message-key');
  assert.equal(result?.mediaMessage, null);
});

test('detects unavailable view-once marker even when message content is absent', () => {
  const payload = { key: { isViewOnce: true } };
  const result = extractViewOnceContent(payload);

  assert.equal(result?.detectedBy, 'message-key');
  assert.equal(result?.mediaMessage, null);
});

test('does not classify regular media as view-once', () => {
  assert.equal(isViewOnceMessage({ imageMessage: image }), false);
});
