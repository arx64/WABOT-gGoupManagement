/**
 * Helpers for WhatsApp view-once payloads.
 *
 * Baileys can expose view-once media through multiple wrapper generations and
 * those wrappers may themselves be inside an ephemeral/edited message. Newer
 * payloads can also arrive as a regular media message with `viewOnce: true`.
 */

const VIEW_ONCE_WRAPPERS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];

const TRANSPARENT_WRAPPERS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
];

const MEDIA_MESSAGE_TYPES = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
];

/**
 * Find and unwrap view-once content without mutating the original payload.
 *
 * @param {object|null|undefined} input A Baileys WAMessage or message content.
 * @param {{ keyIsViewOnce?: boolean }} options
 * @returns {{content: object, mediaType: string|null, mediaMessage: object|null, wrapperType: string|null, detectedBy: string}|null}
 */
export function extractViewOnceContent(input, { keyIsViewOnce = false } = {}) {
  if (!input || typeof input !== 'object') return null;

  const isEnvelope = Boolean(input.key && input.message);
  let content = isEnvelope ? input.message : input;
  let detected = Boolean(keyIsViewOnce || input.key?.isViewOnce);
  let detectedBy = detected ? 'message-key' : '';
  let wrapperType = null;

  // WhatsApp wrappers are effectively one-of values, but cap traversal to
  // protect the event handler from malformed/cyclic data.
  for (let depth = 0; depth < 10 && content && typeof content === 'object'; depth += 1) {
    const viewOnceWrapper = VIEW_ONCE_WRAPPERS.find(
      (key) => content[key]?.message && typeof content[key].message === 'object',
    );

    if (viewOnceWrapper) {
      detected = true;
      detectedBy = 'wrapper';
      wrapperType = viewOnceWrapper;
      content = content[viewOnceWrapper].message;
      continue;
    }

    const transparentWrapper = TRANSPARENT_WRAPPERS.find(
      (key) => content[key]?.message && typeof content[key].message === 'object',
    );

    if (transparentWrapper) {
      content = content[transparentWrapper].message;
      continue;
    }

    break;
  }

  if (!content || typeof content !== 'object') return null;

  const mediaType = MEDIA_MESSAGE_TYPES.find((type) => content[type]) || null;
  const mediaMessage = mediaType ? content[mediaType] : null;

  // Depending on the message version/decryption path, Baileys may expose the
  // inner media directly instead of retaining a viewOnceMessage wrapper.
  if (mediaMessage?.viewOnce === true) {
    detected = true;
    if (!detectedBy) detectedBy = 'media-flag';
  }

  if (!detected) return null;

  return {
    content,
    mediaType,
    mediaMessage,
    wrapperType,
    detectedBy,
  };
}

export function isViewOnceMessage(input, options) {
  return extractViewOnceContent(input, options) !== null;
}

export const VIEW_ONCE_WRAPPER_TYPES = Object.freeze([...VIEW_ONCE_WRAPPERS]);
