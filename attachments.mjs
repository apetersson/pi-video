import {createHash} from 'node:crypto';

const markerPattern = /\[pi-video-ref:([a-f0-9]{64})\]/g;

/** Mark only cloned request context; provider serializers may rewrite tool IDs. */
export function prepareVideoContext(messages) {
  const refs = new Map();
  const tagged = messages.map(message => {
    const ref = message.details?.piVideo;
    if (message.role !== 'toolResult' || message.toolName !== 'read' || message.isError || ref?.version !== 1) return message;
    const key = createHash('sha256').update(JSON.stringify([message.toolCallId, ref.path, ref.sha256])).digest('hex');
    refs.set(key, ref);
    return {...message, content: [...(message.content ?? []), {type: 'text', text: `[pi-video-ref:${key}]`}]};
  });
  return {messages: tagged, refs};
}

export function referenceForTool(message, refs) {
  const text = typeof message.content === 'string' ? message.content :
    Array.isArray(message.content) ? message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
  for (const match of text.matchAll(markerPattern)) {
    if (refs.has(match[1])) return refs.get(match[1]);
  }
}

// Walk request text values so cleanup also works for
// Responses output, Anthropic tool_result, Gemini functionResponse, and wrappers.
// Leave unaffected values intact, including whitespace in ordinary tool output.
function mapText(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) {
    const mapped = value.map(item => mapText(item, transform));
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  if (value && typeof value === 'object') {
    // Native adapters can carry typed byte arrays (for example Bedrock images).
    // They are not text containers and must retain their type and identity.
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const entries = Object.entries(value).map(([key, item]) => [key, mapText(item, transform)]);
    return entries.some(([key, item]) => item !== value[key]) ? Object.fromEntries(entries) : value;
  }
  return value;
}

export function cleanVideoMarkers(payload) {
  return mapText(payload, text => {
    const cleaned = text.replace(markerPattern, '');
    return cleaned === text ? text : cleaned.trimEnd();
  });
}

export function cleanToolMessage(message) {
  return message.role === 'tool' ? {...message, content: cleanVideoMarkers(message.content)} : message;
}

export function omitVideos(payload, refs, reason) {
  return mapText(payload, text => {
    for (const match of text.matchAll(markerPattern)) {
      if (refs.has(match[1])) return `Previously read video omitted: ${reason}`;
    }
    return cleanVideoMarkers(text);
  });
}
