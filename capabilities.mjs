/** Video input capability, not video generation or image-only support. */
export function advertisedVideo(record) {
  if (!record || typeof record !== 'object') return undefined;
  const sources = [record, record.architecture, record.meta];
  let enabled = false;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['modalities', 'capabilities', 'input_modalities', 'inputModalities', 'input']) {
      const value = source[key];
      if (value?.video === false) return false;
      if (value?.video === true) enabled = true;
      if (Array.isArray(value) && value.some(item => String(item).toLowerCase() === 'video')) enabled = true;
    }
  }
  return enabled ? true : undefined;
}

function matches(record, id) {
  return record?.id === id || record?.name === id || record?.model === id || record?.aliases?.includes(id);
}

function declaredFormat(record) {
  const value = record?.video_input_format ?? record?.meta?.video_input_format;
  return ['input_video', 'video_url'].includes(value) ? value : undefined;
}

/** Query only the selected model's endpoint; do not infer capabilities from names. */
export async function discoverVideo(model, {fetchJson = async url => {
  const response = await fetch(url, {signal: AbortSignal.timeout(5000), redirect: 'error'});
  if (!response.ok) throw new Error('Capability discovery failed');
  return response.json();
}} = {}) {
  if (!model || model.api !== 'openai-completions') {
    return {supported: false, reason: 'This API does not yet have a pi-video transport adapter. Select an OpenAI-compatible video model.'};
  }
  let base;
  try { base = new URL(model.baseUrl); } catch {
    return {supported: false, reason: 'The selected model has no valid endpoint URL.'};
  }
  if (!['http:', 'https:'].includes(base.protocol)) return {supported: false, reason: 'Unsupported endpoint protocol.'};
  base.search = ''; base.hash = '';
  const root = base.href.replace(/\/$/, '');
  const safeFetch = async url => { try { return await fetchJson(url); } catch { return undefined; } };
  const own = advertisedVideo(model);
  if (own === false) return {supported: false, reason: 'The selected model explicitly disables video input.'};
  const catalog = await safeFetch(root + '/models');
  const entries = [...(Array.isArray(catalog?.data) ? catalog.data : []), ...(Array.isArray(catalog?.models) ? catalog.models : [])];
  const selected = entries.filter(entry => matches(entry, model.id));
  if (selected.some(entry => advertisedVideo(entry) === false)) {
    return {supported: false, reason: 'The selected model endpoint explicitly disables video input.'};
  }
  // llama.cpp's single-model props response also tells us its payload dialect.
  const props = await safeFetch(root.replace(/\/v1$/, '') + '/props');
  const propsMatches = props && (props.model_path === model.id || props.model_alias === model.id ||
    selected.some(entry => matches(entry, props.model_path)));
  if (propsMatches && typeof props.modalities?.video === 'boolean') {
    return props.modalities.video
      ? {supported: true, format: 'input_video', source: 'props'}
      : {supported: false, reason: 'The selected server has video input disabled.'};
  }
  if (own === true || selected.some(entry => advertisedVideo(entry) === true)) {
    return {supported: true, format: declaredFormat(model) || selected.map(declaredFormat).find(Boolean) || 'video_url', source: 'model'};
  }
  return {supported: false, reason: 'The selected model does not advertise video input. Its model metadata must include video in input_modalities, modalities, capabilities, or input.'};
}

export function videoBlock(bytes, format) {
  const data = bytes.toString('base64');
  if (format === 'input_video') return {type: 'input_video', input_video: {data}};
  if (format === 'video_url') return {type: 'video_url', video_url: {url: `data:video/mp4;base64,${data}`}};
  throw new Error('Unsupported video transport format');
}
