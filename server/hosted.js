// Hosted services: voices that speak the cast, and text models that guess a voice type from a
// character's name. Only the lines being voiced, or the names being guessed, are ever sent.
//
// Hosted voice services. Each one turns a line into raw 16-bit mono PCM at 24 kHz, the format the
// rest of the app already uses, so a hosted line is cached, mixed and exported like a local one.
// Voice ids carry the engine as a prefix ("openai:coral"), so a cast made for one engine is never
// sent to another.
import { SAMPLE_RATE, decodeWav } from './audio.js';

// A 16-bit mono WAV header at any rate, so decodeWav can resample foreign PCM.
function wavHeaderAt(bytes, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + bytes, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(bytes, 40);
  return header;
}

// Genders drive automatic casting only; every choice can be changed by hand.
const openaiVoices = { alloy: 'unknown', ash: 'male', ballad: 'male', cedar: 'male', coral: 'female', echo: 'male', fable: 'male', marin: 'female', nova: 'female', onyx: 'male', sage: 'female', shimmer: 'female', verse: 'male' };
// Google publishes these names with genders for its Chirp 3 HD voices, which the Gemini voices share.
const geminiVoices = { Achernar: 'female', Achird: 'male', Algenib: 'male', Algieba: 'male', Alnilam: 'male', Aoede: 'female', Autonoe: 'female', Callirrhoe: 'female', Charon: 'male', Despina: 'female', Enceladus: 'male', Erinome: 'female', Fenrir: 'male', Gacrux: 'female', Iapetus: 'male', Kore: 'female', Laomedeia: 'female', Leda: 'female', Orus: 'male', Puck: 'male', Pulcherrima: 'female', Rasalgethi: 'male', Sadachbia: 'male', Sadaltager: 'male', Schedar: 'male', Sulafat: 'female', Umbriel: 'male', Vindemiatrix: 'female', Zephyr: 'female', Zubenelgenubi: 'male' };
const fixed = (engine, voices) => Object.entries(voices).map(([name, gender]) => ({ id: `${engine}:${name}`, label: name[0].toUpperCase() + name.slice(1), gender }));
const json = buffer => JSON.parse(buffer.toString('utf8'));
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withKey = (options, headers) => ({ ...options, headers: { ...options.headers, ...headers } });

export const ENGINES = Object.freeze({
  openai: {
    label: 'OpenAI', site: 'https://platform.openai.com/api-keys', model: 'gpt-4o-mini-tts', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    auth: key => ({ Authorization: `Bearer ${key}` }),
    voices: async () => fixed('openai', openaiVoices),
    // Listing models proves the key works and costs nothing.
    check: async (call) => { const body = json(await call('https://api.openai.com/v1/models', {}, 2_000_000)); return `Key accepted. ${Object.keys(openaiVoices).length} voices.${body.data?.some(item => item.id === 'gpt-4o-mini-tts') ? '' : ' This key cannot see gpt-4o-mini-tts.'}`; },
    speak: (call, { text, voice, model }) => call('https://api.openai.com/v1/audio/speech', post({ model, voice, input: text, response_format: 'pcm' })),
  },
  gemini: {
    label: 'Google Gemini', site: 'https://aistudio.google.com/apikey', model: 'gemini-3.1-flash-tts-preview', models: ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
    auth: key => ({ 'x-goog-api-key': key }),
    voices: async () => fixed('gemini', geminiVoices),
    check: async (call) => { json(await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {}, 200_000)); return `Key accepted. ${Object.keys(geminiVoices).length} voices.`; },
    speak: async (call, { text, voice, model }) => {
      // The model is a speaker, not an interpreter: it is told to read the line as written.
      const body = json(await call('https://generativelanguage.googleapis.com/v1beta/interactions', post({ model, input: `Read this line aloud exactly as written: ${text}`, response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } }), 50_000_000));
      // The audio has arrived in more than one place in this reply as the API has changed.
      const parts = [body.output_audio, ...(body.outputs ?? []), ...(body.steps ?? []).flatMap(step => step?.content ?? [])];
      const audio = parts.find(item => typeof item?.data === 'string' && (item.type === 'audio' || item === body.output_audio));
      if (!audio) throw new Error('Gemini answered without audio.');
      const rate = Number(/rate=(\d+)/.exec(audio.mime_type ?? '')?.[1] ?? SAMPLE_RATE);
      if (/wav/i.test(audio.mime_type ?? '')) return decodeWav(Buffer.from(audio.data, 'base64'));
      if (audio.mime_type && !/l16|pcm/i.test(audio.mime_type)) throw new Error(`Gemini sent ${audio.mime_type} audio, which this app cannot read.`);
      const pcm = Buffer.from(audio.data, 'base64');
      return rate === SAMPLE_RATE ? pcm : decodeWav(Buffer.concat([wavHeaderAt(pcm.length, rate), pcm]));
    },
  },
  elevenlabs: {
    label: 'ElevenLabs', site: 'https://elevenlabs.io/app/settings/api-keys', model: 'eleven_multilingual_v2', models: ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3'],
    auth: key => ({ 'xi-api-key': key }),
    // The voices are the ones in this account's library, so they are read from the service.
    voices: async (call) => {
      const body = json(await call('https://api.elevenlabs.io/v1/voices', {}, 5_000_000));
      if (!Array.isArray(body.voices)) throw new Error('ElevenLabs did not answer with a list of voices.');
      return body.voices.filter(item => typeof item?.voice_id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(item.voice_id)).slice(0, 500).map(item => ({
        id: `elevenlabs:${item.voice_id}`, label: String(item.name ?? item.voice_id).slice(0, 60),
        gender: ['male', 'female'].includes(item.labels?.gender) ? item.labels.gender : 'unknown',
        accent: typeof item.labels?.accent === 'string' ? item.labels.accent.slice(0, 40) : '',
      }));
    },
    check: async (call) => `Key accepted. ${(await ENGINES.elevenlabs.voices(call)).length} voices in this account.`,
    speak: (call, { text, voice, model }) => call(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_${SAMPLE_RATE}`, post({ text, model_id: model })),
  },
});

// Text models, for one small job: male, female or unknown for each character name. Only the names
// are sent. Model names change often, so the model is a free field with suggestions.
const chat = (url, extra = {}) => ({
  ask: async (call, { model, system, prompt, schema }) => {
    const body = json(await call(url, post({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...extra(schema) }), 200_000));
    return body.choices?.[0]?.message?.content;
  },
});
export const TEXT_ENGINES = Object.freeze({
  openai: {
    label: 'OpenAI', model: 'gpt-5.6', models: ['gpt-5.6'],
    auth: ENGINES.openai.auth,
    check: async (call) => { json(await call('https://api.openai.com/v1/models', {}, 2_000_000)); return 'Key accepted.'; },
    ...chat('https://api.openai.com/v1/chat/completions', schema => ({ response_format: { type: 'json_schema', json_schema: { name: 'guesses', strict: true, schema } } })),
  },
  anthropic: {
    label: 'Anthropic (Claude)', model: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    auth: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    check: async (call) => { json(await call('https://api.anthropic.com/v1/models', {}, 500_000)); return 'Key accepted.'; },
    ask: async (call, { model, system, prompt, schema }) => {
      // A refused request is re-run on another model inside the same call, rather than failing.
      const fallback = model === 'claude-opus-5' ? { fallbacks: 'default' } : {};
      const request = post({ model, max_tokens: 16000, system, messages: [{ role: 'user', content: prompt }], output_config: { ...(model.startsWith('claude-haiku') ? {} : { effort: 'low' }), format: { type: 'json_schema', schema } }, ...fallback });
      if (fallback.fallbacks) request.headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const body = json(await call('https://api.anthropic.com/v1/messages', request, 500_000));
      if (body.stop_reason === 'refusal') throw new Error('Claude declined to guess these names.');
      return body.content?.find(block => block?.type === 'text')?.text;
    },
  },
  gemini: {
    label: 'Google Gemini', model: 'gemini-3.8-flash', models: ['gemini-3.8-flash'],
    auth: ENGINES.gemini.auth,
    check: async (call) => { json(await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {}, 200_000)); return 'Key accepted.'; },
    ask: async (call, { model, system, prompt }) => {
      const body = json(await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, post({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }), 500_000));
      return body.candidates?.[0]?.content?.parts?.map(part => part?.text ?? '').join('');
    },
  },
  xai: {
    label: 'xAI (Grok)', model: 'grok-4', models: ['grok-4'],
    auth: key => ({ Authorization: `Bearer ${key}` }),
    check: async (call) => { json(await call('https://api.x.ai/v1/models', {}, 500_000)); return 'Key accepted.'; },
    ...chat('https://api.x.ai/v1/chat/completions', () => ({ response_format: { type: 'json_object' } })),
  },
  openrouter: {
    label: 'OpenRouter', model: 'openai/gpt-5.6', models: ['openai/gpt-5.6', 'anthropic/claude-opus-5', 'google/gemini-3.8-flash'],
    auth: key => ({ Authorization: `Bearer ${key}` }),
    check: async (call) => { json(await call('https://openrouter.ai/api/v1/key', {}, 100_000)); return 'Key accepted.'; },
    // Not every model behind OpenRouter takes a JSON format, so the prompt asks and the reply is checked.
    ...chat('https://openrouter.ai/api/v1/chat/completions', () => ({})),
  },
});

// Say what went wrong in words an actor can act on. The key never appears in a message.
function explain(label, error, said = '') {
  const status = Number(/HTTP (\d{3})/.exec(error?.message ?? '')?.[1]);
  const reason = said ? ` ${label} said: "${said}"` : '';
  if (status === 401 || status === 403) return `${label} refused the key. Check it in Settings, under Keys for paid services.${reason}`;
  if (status === 402) return `${label} said the account is out of credit. Add credit on their site, then try again.${reason}`;
  if (status === 429) return `${label} said too many requests. Wait a minute, then try again.${reason}`;
  if (status === 400 || status === 404 || status === 422) return `${label} rejected the request (HTTP ${status}).${reason || ' Check the model name in Settings.'}`;
  if (error?.name === 'TimeoutError') return `${label} did not answer in time.`;
  if (status) return `${label} had a problem (HTTP ${status}). Try again in a minute.${reason}`;
  return `${label} could not be reached. Check this machine's internet connection.`;
}

// serviceFetch is the app's bounded fetch: no redirects (a key must never follow one), capped size.
function keyedCaller({ serviceFetch, secrets }, specs) {
  return async (engine, timeout) => {
    const spec = specs[engine];
    const key = await secrets.get(engine);
    if (!key) throw Object.assign(new Error(`There is no ${spec.label} key yet. Add one in Settings, under Keys for paid services.`), { status: 503 });
    return async (url, options = {}, max = 25 * 1024 * 1024) => {
      try { return await serviceFetch(url, withKey({ ...options, signal: AbortSignal.timeout(timeout) }, spec.auth(key)), max); }
      catch (error) { throw Object.assign(new Error(explain(spec.label, error, String(error?.detail ?? '').split(key).join('[key]'))), { status: 502 }); }
    };
  };
}
export function hostedVoices(deps) {
  const caller = keyedCaller(deps, ENGINES);
  return {
    async voices(engine) { return ENGINES[engine].voices(await caller(engine, 10000)); },
    async check(engine) { return ENGINES[engine].check(await caller(engine, 10000)); },
    async speak(engine, model, id, text) {
      let pcm;
      try { pcm = await ENGINES[engine].speak(await caller(engine, 180000), { text, voice: id.slice(engine.length + 1), model: model || ENGINES[engine].model }); }
      catch (error) { throw error.status ? error : Object.assign(new Error(`${ENGINES[engine].label}: ${error.message}`), { status: 502 }); }
      if (pcm.length < 2 || pcm.length % 2) throw Object.assign(new Error(`${ENGINES[engine].label} returned audio this app cannot read.`), { status: 502 });
      return pcm;
    },
  };
}
export function hostedText(deps) {
  const caller = keyedCaller(deps, TEXT_ENGINES);
  return {
    async check(engine) { return TEXT_ENGINES[engine].check(await caller(engine, 10000)); },
    // Returns the model's reply as text. The caller checks it; nothing here trusts its shape.
    async ask(engine, model, request) {
      let reply;
      try { reply = await TEXT_ENGINES[engine].ask(await caller(engine, 120000), { ...request, model: model || TEXT_ENGINES[engine].model }); }
      catch (error) { throw error.status ? error : Object.assign(new Error(`${TEXT_ENGINES[engine].label}: ${error.message}`), { status: 502 }); }
      if (typeof reply !== 'string') throw Object.assign(new Error(`${TEXT_ENGINES[engine].label} answered without text.`), { status: 502 });
      // Some models wrap JSON in a code fence even when asked not to.
      return reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    },
  };
}
