import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.ts';
import { inferCharacters, assignCast as assignConfiguredCast, resolvedGender, partnerVoices as configuredPartnerVoices, voiceOwners as configuredVoiceOwners, voiceIdentity, voiceGenders, withNameGuesses, validGuesses } from '../src/casting.ts';
import type { CastingConfig } from '../src/casting.ts';
import { voiceCatalog } from '../src/voice-catalog.ts';

const personalConfig: CastingConfig = { preferredActorVoice: 'MyVoice', aliases: { default: 'MyVoice' } };
const assignCast = (...[characters, available, role, current, profiles, choices, manual, config = personalConfig]: Parameters<typeof assignConfiguredCast>) => assignConfiguredCast(characters, available, role, current, profiles, choices, manual, config);
const partnerVoices = (available: string[], gender: Parameters<typeof configuredPartnerVoices>[1]) => configuredPartnerVoices(available, gender, personalConfig);
const voiceOwners = (...args: Parameters<typeof configuredVoiceOwners>) => configuredVoiceOwners(args[0], args[1], args[2], args[3], args[4] ?? personalConfig.aliases);

const source = 'CAST\nALICE (female, 30)\nBOB - male, 40\n\nSCENE 1\n\nALICE: Hello.\nBOB: Welcome.\nALEX: Ready.';
const script = parseScript(source);
test('script descriptions determine gender; names alone do not', () => {
  const profiles = inferCharacters(source, script);
  assert.equal(profiles.ALICE.gender, 'female');
  assert.equal(profiles.BOB.gender, 'male');
  assert.equal(profiles.ALEX.gender, 'unknown');
  assert.match(profiles.ALICE.evidence, /female/);
});

test('expanded reference catalog joins gender-matched pools without replacing manual voices or actor', () => {
  const added = Object.entries(voiceCatalog).filter(([id]) => id.startsWith('VoiceZero-') || ['Stock-Slate', 'Stock-Quartz'].includes(id));
  assert.equal(added.length, 12);
  assert.equal(added.filter(([, voice]) => voice.gender === 'female').length, 6);
  assert.equal(added.filter(([, voice]) => voice.gender === 'male').length, 6);
  const available = ['MyVoice', 'default', ...added.map(([id]) => id)];
  for (const [id, voice] of added) {
    assert.ok(partnerVoices(available, voice.gender).includes(id));
    assert.ok(!partnerVoices(available, voice.gender === 'female' ? 'male' : 'female').includes(id));
    assert.ok(voice.label && voice.accent && voice.tone && voice.sourceUrl);
  }
  const profiles = inferCharacters(source, script);
  const assigned = assignCast(script.characters, available, 'ALEX', { ALICE: 'VoiceZero-Alan', BOB: 'VoiceZero-Alana' }, profiles, {}, { ALICE: true, BOB: true });
  assert.equal(assigned.ALICE, 'VoiceZero-Alan');
  assert.equal(assigned.BOB, 'VoiceZero-Alana');
  assert.equal(assigned.ALEX, 'MyVoice');
  assert.ok(!partnerVoices(available, 'unknown').includes('MyVoice'));
  assert.ok(!partnerVoices(available, 'unknown').includes('default'));
});
test('subject pronouns in unambiguous stage directions are usable evidence', () => {
  const text = 'INT. ROOM - DAY\n\nSAM opens the window. She waits.\n\nSAM\nHello.\n\nJO looks down. He smiles.\n\nJO\nHello.';
  const profiles = inferCharacters(text, parseScript(text));
  assert.equal(profiles.SAM.gender, 'female');
  assert.equal(profiles.JO.gender, 'male');
});
test('ambiguous directions, dialogue about others, and contradictory cues stay unknown', () => {
  const text = 'INT. ROOM - DAY\n\nSAM joins JO. She laughs.\n\nSAM\nHe is here.\n\nJO\nI see.\n\nALEX (male)\n\nALEX (female)\n\nALEX: Fine.';
  const profiles = inferCharacters(text, parseScript(text));
  assert.equal(profiles.SAM.gender, 'unknown');
  assert.equal(profiles.JO.gender, 'unknown');
  assert.equal(profiles.ALEX.gender, 'unknown');
});
test('automatic casting repairs legacy mismatches and preserves actor and manual overrides', () => {
  const voices = ['default', 'MyVoice', 'Stock-Mica', 'Stock-Amber', 'Stock-Ash', 'Stock-Granite'];
  const profiles = inferCharacters(source, script);
  const cast = assignCast(['ALICE', 'BOB', 'ALEX'], voices, 'ALEX', { ALICE: 'Stock-Ash', BOB: 'Stock-Mica' }, profiles, {}, {});
  assert.ok(['Stock-Mica', 'Stock-Amber'].includes(cast.ALICE));
  assert.ok(['Stock-Ash', 'Stock-Granite'].includes(cast.BOB));
  assert.equal(cast.ALEX, 'MyVoice');
  assert.equal(assignCast(['ALICE'], voices, 'OTHER', { ALICE: 'Stock-Ash' }, profiles, {}, { ALICE: true }).ALICE, 'Stock-Ash');
  assert.deepEqual(partnerVoices(voices, 'female'), ['Stock-Amber', 'Stock-Mica']);
  assert.equal(resolvedGender(profiles.ALICE, 'male'), 'male');
});

test('ownership includes actor aliases, narrator and existing shared selections', () => {
  const cast = { ALICE: 'default', BOB: 'MyVoice', Narrator: 'Stock-Ash' };
  assert.deepEqual(voiceOwners('MyVoice', 'ALICE', Object.keys(cast), cast), ['BOB']);
  assert.deepEqual(voiceOwners('default', 'BOB', Object.keys(cast), cast), ['ALICE']);
  assert.deepEqual(voiceOwners('Stock-Ash', 'ALICE', Object.keys(cast), cast), ['Narrator']);
  assert.deepEqual(voiceOwners('Stock-Ash', 'ALICE', ['ALICE', 'BOB'], cast), []);
});

test('reserve later selections before new defaults; use a free voice before sharing', () => {
  const voices = ['MyVoice', 'Stock-Amber', 'Stock-Mica', 'Stock-Ash'];
  const profiles = inferCharacters(source, script);
  const cast = assignCast(['ALICE', 'BOB', 'ALEX'], voices, 'ALEX', { BOB: 'Stock-Amber' }, profiles, {}, { BOB: true });
  assert.equal(cast.ALICE, 'Stock-Mica');
  assert.equal(cast.BOB, 'Stock-Amber');
  const exhausted = assignCast(['ALICE', 'BOB', 'ALEX'], voices.slice(0, 2).concat('Stock-Ash'), 'ALEX', { BOB: 'Stock-Amber' }, profiles, {}, { BOB: true });
  assert.equal(exhausted.ALICE, 'Stock-Ash', 'Use free fallback instead of sharing');
  const manual = assignCast(['ALICE', 'BOB'], voices, 'OTHER', { ALICE: 'Stock-Amber', BOB: 'Stock-Amber' }, profiles, {}, { ALICE: true, BOB: true });
  assert.equal(manual.ALICE, manual.BOB, 'Existing explicit choices are not rewritten');
});

test('AI fallback never outranks script cues, conflicts, or manual gender choices', () => {
  const base = inferCharacters(source, script);
  const profiles = withNameGuesses(base, { ALICE: 'male', BOB: 'female', ALEX: 'male' });
  assert.equal(profiles.ALICE.gender, 'female');
  assert.equal(profiles.BOB.gender, 'male');
  assert.equal(profiles.ALEX.source, 'ai');
  assert.equal(profiles.ALEX.gender, 'male');
  assert.equal(resolvedGender(profiles.ALEX, 'female'), 'female');
  assert.equal(resolvedGender(profiles.ALEX, 'unknown'), 'unknown');
  const conflict = 'ALEX (male)\nALEX (female)\nSCENE 1\nALEX: Hello.';
  assert.equal(withNameGuesses(inferCharacters(conflict, parseScript(conflict)), { ALEX: 'female' }).ALEX.source, 'conflict');
  assert.equal(withNameGuesses(base, { ALEX: 'unknown' }).ALEX.gender, 'unknown');
  assert.deepEqual(validGuesses({ ALICE: 'female', BOB: 'invalid', ALEX: null }), { ALICE: 'female' });
  assert.deepEqual(validGuesses(['female']), {});
  assert.deepEqual(validGuesses({ ALICE: ['female'], BOB: { toString: 'male' }, ALEX: 'unknown' }), { ALEX: 'unknown' });
});

test('generic casting has no personal voice defaults, aliases, genders, or preview', () => {
  assert.equal(voiceIdentity('default'), 'default');
  assert.equal(voiceGenders.MyVoice, undefined);
  assert.equal(voiceGenders.default, undefined);
  assert.equal(voiceCatalog.MyVoice, undefined);
  assert.deepEqual(configuredPartnerVoices(['MyVoice', 'default'], 'unknown'), ['default', 'MyVoice']);
  const cast = assignConfiguredCast(['ALICE', 'BOB'], ['Stock-Amber', 'Stock-Ash'], 'ALICE', {}, inferCharacters(source, script), {}, {});
  assert.equal(cast.ALICE, 'Stock-Amber');
  assert.equal(cast.BOB, 'Stock-Ash');
  assert.deepEqual(configuredVoiceOwners('default', 'ALICE', ['ALICE', 'BOB'], { ALICE: 'default', BOB: 'MyVoice' }), []);
});

test('arbitrary configured actor voice and aliases reserve one identity without overwriting manual choices', () => {
  const config: CastingConfig = { preferredActorVoice: 'MyReference', aliases: { default: 'MyReference', micaAlias: 'Stock-Mica' } };
  const available = ['default', 'MyReference', 'micaAlias', 'Stock-Mica', 'Stock-Amber'];
  assert.deepEqual(configuredPartnerVoices(available, 'female', config), ['Stock-Amber', 'Stock-Mica']);
  const cast = assignConfiguredCast(['ALICE', 'BOB', 'ALEX'], available, 'ALEX', { BOB: 'micaAlias' }, inferCharacters(source, script), {}, { BOB: true }, config);
  assert.deepEqual(cast, { ALICE: 'Stock-Amber', BOB: 'micaAlias', ALEX: 'MyReference' });
  assert.deepEqual(configuredVoiceOwners('Stock-Mica', 'ALICE', ['ALICE', 'BOB'], cast, config.aliases), ['BOB']);
  assert.equal(assignConfiguredCast(['ALEX'], available, 'ALEX', { ALEX: 'Stock-Mica' }, {}, {}, { ALEX: true }, config).ALEX, 'Stock-Mica');
  assert.equal(assignConfiguredCast(['ALEX'], ['default', 'Stock-Mica'], 'ALEX', {}, {}, {}, {}, config).ALEX, 'default', 'Available alias still represents the configured actor voice');
});
