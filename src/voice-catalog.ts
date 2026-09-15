export interface VoiceProfile {
  label: string;
  gender: 'male' | 'female' | 'unknown';
  accent: string;
  tone: string;
  previewUrl?: string;
  sourceUrl?: string;
  license?: string;
}

const stockSource = 'https://github.com/n33kos/kokoro-voices/tree/bbf160ee12f887b872d4f7f18ec0c29ce186086c';
const zeroSource = 'https://github.com/OwenTyme/voice-zero/blob/490cfbee850a6d409076f477c766f567000a79b6/voices/README.md';
// Accent labels describe references, not guaranteed TTS output. Voice-Zero calls
// some accent classifications estimates. Tone for that pack is not yet rated.
export const voiceCatalog: Readonly<Record<string, VoiceProfile>> = {
  'Stock-Mica': { previewUrl: '/voice-previews/Stock-Mica.wav', label: 'Mica', gender: 'female', accent: 'American', tone: 'Lively, clear', sourceUrl: stockSource, license: 'CC0-1.0' },
  'Stock-Amber': { previewUrl: '/voice-previews/Stock-Amber.wav', label: 'Amber', gender: 'female', accent: 'American', tone: 'Warm, brisk', sourceUrl: stockSource, license: 'CC0-1.0' },
  'Stock-Granite': { previewUrl: '/voice-previews/Stock-Granite.wav', label: 'Granite', gender: 'male', accent: 'American', tone: 'Low, deliberate', sourceUrl: stockSource, license: 'CC0-1.0' },
  'Stock-Ash': { previewUrl: '/voice-previews/Stock-Ash.wav', label: 'Ash', gender: 'male', accent: 'American', tone: 'Gravelly, textured', sourceUrl: stockSource, license: 'CC0-1.0' },
  'Stock-Slate': { previewUrl: '/voice-previews/Stock-Slate.wav', label: 'Slate', gender: 'male', accent: 'American', tone: 'Even, restrained', sourceUrl: stockSource, license: 'CC0-1.0' },
  'Stock-Quartz': { previewUrl: '/voice-previews/Stock-Quartz.wav', label: 'Quartz', gender: 'female', accent: 'American', tone: 'High, clear', sourceUrl: stockSource, license: 'CC0-1.0' },
  'VoiceZero-Alana': { previewUrl: '/voice-previews/VoiceZero-Alana.wav', label: 'Alana', gender: 'female', accent: 'American Midwest', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Ruth': { previewUrl: '/voice-previews/VoiceZero-Ruth.wav', label: 'Ruth', gender: 'female', accent: 'English RP', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Linda': { previewUrl: '/voice-previews/VoiceZero-Linda.wav', label: 'Linda', gender: 'female', accent: 'Australian', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Rachael': { previewUrl: '/voice-previews/VoiceZero-Rachael.wav', label: 'Rachael', gender: 'female', accent: 'Scottish (source estimate)', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Kara': { previewUrl: '/voice-previews/VoiceZero-Kara.wav', label: 'Kara', gender: 'female', accent: 'American Southern California', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Alan': { previewUrl: '/voice-previews/VoiceZero-Alan.wav', label: 'Alan', gender: 'male', accent: 'American New York City', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-David': { previewUrl: '/voice-previews/VoiceZero-David.wav', label: 'David', gender: 'male', accent: 'English Black Country', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Graeme': { previewUrl: '/voice-previews/VoiceZero-Graeme.wav', label: 'Graeme', gender: 'male', accent: 'Australian', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Ian': { previewUrl: '/voice-previews/VoiceZero-Ian.wav', label: 'Ian', gender: 'male', accent: 'Scottish (source estimate)', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
  'VoiceZero-Sean': { previewUrl: '/voice-previews/VoiceZero-Sean.wav', label: 'Sean', gender: 'male', accent: 'American Pacific Northwest', tone: 'Narrative reference; tone unrated', sourceUrl: zeroSource, license: 'CC0-1.0' },
};
