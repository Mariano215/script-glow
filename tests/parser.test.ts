import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, SAMPLE } from '../src/parser.ts';

test('sample identifies scenes and cast without treating prose as dialogue', () => {
  const script = parseScript(SAMPLE);
  assert.equal(script.scenes.length, 2);
  assert.deepEqual(script.characters, ['ELENA', 'MARCUS']);
  assert.equal(script.scenes[0].lines[0].kind, 'direction');
  assert.ok(script.scenes[0].lines.some(line => line.text === 'a small smile' && line.kind === 'direction'));
});
test('multiline dialogue joins but blank lines start action', () => {
  const script = parseScript('INT. ROOM - DAY\n\nJUNE\nFirst sentence.\nAnother sentence.\n\nA door opens.');
  assert.equal(script.scenes[0].lines[0].text, 'First sentence. Another sentence.');
  assert.equal(script.scenes[0].lines[1].kind, 'direction');
});
test('colon format, Windows line endings, forced cues, and voice-over suffix', () => {
  const script = parseScript('SCENE 1\r\nMAYA: Hello.\r\nLEO: Hi.\r\n\r\n@Soft name\r\nLook here.\r\n\r\nMAYA (V.O.)\r\nGoodbye.');
  assert.deepEqual(script.characters, ['MAYA', 'LEO', 'Soft name']);
  assert.equal(script.scenes[0].lines.at(-1)?.character, 'MAYA');
});
test('empty and unrecognized scripts surface parser warnings', () => {
  assert.equal(parseScript('').scenes.length, 0);
  assert.ok(parseScript('Some narrative prose.').warnings.length);
});
test('source remains text even when it includes HTML', () => {
  assert.equal(parseScript('JO: <script>alert(1)</script>').scenes[0].lines[0].text, '<script>alert(1)</script>');
});
test('uppercase dialogue stays dialogue and Fountain dual cues are recognized', () => {
  const script = parseScript('INT. ROOM - DAY\n\nJOHN\nSTOP\nPlease listen.\n\nJUNE ^\nI am listening.');
  assert.deepEqual(script.characters, ['JOHN', 'JUNE']);
  assert.equal(script.scenes[0].lines[0].text, 'STOP Please listen.');
  assert.equal(script.scenes[0].lines[1].character, 'JUNE');
});
test('stage-play acts, roman and word scene headings stay separate; cast notes are not spoken', () => {
  const result = parseScript('CAST\nALICE - female\nBOB - male\nACT I\nSCENE ONE\nALICE: Hello.\nSCENE II\nBOB: Welcome.\nACT II\nSCENE 1\nALICE: Goodbye.');
  assert.deepEqual(result.scenes.map(scene => scene.title), ['ACT I — SCENE ONE', 'ACT I — SCENE II', 'ACT II — SCENE 1']);
  assert.equal(result.scenes.flatMap(scene => scene.lines).length, 3);
});

test('numbered shooting headings and compact INT/EXT punctuation identify every scene', () => {
  const headings = ['12 INT. ROOM - DAY 12', '12A EXT.GARDEN - NIGHT 12A', '13. INT./EXT. CAR - DAY', '14) EXT / INT. HOUSE - NIGHT', 'I/E.CAR - DAY', 'INT ROOM - DAY'];
  const result = parseScript(headings.map((heading, index) => `${heading}\nJO: Line ${index}.`).join('\n'));
  assert.deepEqual(result.scenes.map(scene => scene.title), headings);
  assert.deepEqual(result.scenes.map(scene => scene.lines.length), headings.map(() => 1));
  assert.equal(result.warnings.length, 0);
});

test('Thorne shooting headings retain both scenes even when the second is pasted after action', () => {
  const first = '5 INT. THORNE RESEARCH LAB – LATER - CONTINUOUS 5';
  const second = '35 INT. THORNE RESIDENCE – FAMILY ROOM – NIGHT 35';
  const action = 'David carefully removes a small vial filled with luminescent,\n\nclear serum from the incubator. His hand trembles slightly.';
  const family = 'Elizabeth sits on the couch, surrounded by open books and\n\njournals - genetic engineering, CRISPR, fetal gene therapy.\n\nNotes scribbled in the margins. Fear disguised as diligence.\n\nThe FRONT DOOR opens. David steps inside, loosening his tie.\n\nHe stops when he sees the scene.';
  for (const separator of ['\n\n', '  ']) {
    const parsed = parseScript(`${first}\n${action}${separator}${second}\n${family}`);
    assert.deepEqual(parsed.scenes.map(scene => scene.title), [first, second], JSON.stringify(separator));
    assert.ok(parsed.scenes[0].lines.at(-1).text.endsWith('His hand trembles slightly.'));
    assert.equal(parsed.scenes[1].lines[0].text, 'Elizabeth sits on the couch, surrounded by open books and');
    assert.equal(parsed.scenes[1].lines.at(-1).text, 'He stops when he sees the scene.');
  }
});

test('dated screenplay page headers are not characters, directions, or scenes', () => {
  const header = 'EVELYN SCREENPLAY THE FEATURE FINAL 8.27.26';
  const parsed = parseScript(`${header}\n\n5 INT. THORNE RESEARCH LAB – LATER - CONTINUOUS 5\n\nDAVID\nI found it.\n${header}\nWe need to leave.\n\n${header} 12.\n35 INT. THORNE RESIDENCE – FAMILY ROOM – NIGHT 35\n\nELIZABETH\nWhere have you been?`);
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(parsed.characters, ['DAVID', 'ELIZABETH']);
  assert.equal(parsed.scenes[0].lines[0].text, 'I found it. We need to leave.');
  assert.ok(!parsed.scenes.flatMap(scene => scene.lines).some(line => line.text.includes(header)));
});

test('attached-heading recovery leaves quoted dialogue, mismatched numbers, and prose unchanged', () => {
  for (const text of ['Read this. 35 INT. HOUSE - NIGHT 36', 'Read this. 35 INT. HOUSE - NIGHT', 'Read this. 35 INT. house - night 35', 'Read this. 35 ORDINARY WORDS 35', 'Read this. "35 INT. HOUSE - NIGHT 35"']) {
    const parsed = parseScript(`INT. ROOM - DAY\n\nDAVID\n${text}`);
    assert.equal(parsed.scenes.length, 1, text);
    assert.equal(parsed.scenes[0].lines[0].text, text);
  }
  const text = 'This screenplay is final. We can shoot it now.';
  assert.equal(parseScript(`DAVID: ${text}`).scenes[0].lines[0].text, text);
});

test('stage punctuation, compound act/scene headings, and longer word numbers identify scenes', () => {
  const result = parseScript('ACT I, SCENE II\nJO: Hello.\nSCENE:3\nJO: Again.\nScene Eleven\nJO: Welcome.\nACT II SCENE TWENTY-ONE\nJO: Later.\nScene Twenty Two - The garden\nJO: Goodbye.');
  assert.deepEqual(result.scenes.map(scene => scene.title), ['ACT I — SCENE II', 'ACT I — SCENE:3', 'ACT I — Scene Eleven', 'ACT II — SCENE TWENTY-ONE', 'ACT II — Scene Twenty Two - The garden']);
  assert.equal(result.scenes.flatMap(scene => scene.lines).length, 5);
});

test('Fountain forced headings and explicit empty scenes remain selectable without an invented preamble scene', () => {
  const result = parseScript('A note before the scene.\n\n.THE GARDEN\nJO: Hello.\n# Empty scene\n## Last scene\nJO: Goodbye.\n.SCENE WITHOUT DIALOGUE');
  assert.deepEqual(result.scenes.map(scene => scene.title), ['THE GARDEN', 'Empty scene', 'Last scene', 'SCENE WITHOUT DIALOGUE']);
  assert.deepEqual(result.scenes.map(scene => scene.id), ['scene-1', 'scene-2', 'scene-3', 'scene-4']);
  assert.equal(result.scenes[0].lines[0].text, 'A note before the scene.');
  assert.equal(result.scenes[1].lines.length, 0);
  assert.equal(result.scenes[3].lines.length, 0);
});

test('prose about scenes and interior spaces does not create false scene boundaries', () => {
  const result = parseScript('INT. ROOM - DAY\n\nJO\nScene one was a disaster.\nAct two needs more work.\nInterior decoration is expensive.\nExternal noise is loud.\nThe scene ends here.\n...Not yet.');
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].lines.length, 1);
  assert.match(result.scenes[0].lines[0].text, /Scene one was a disaster/);
});

test('headingless dialogue provides a specific scene detection warning without losing text', () => {
  const result = parseScript('JO: Hello.\nPAT: Hi.');
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].title, 'Scene 1');
  assert.equal(result.scenes[0].lines.length, 2);
  assert.ok(result.warnings.some(warning => warning.startsWith('No scene headings recognized.')));
  assert.ok(!parseScript('').warnings.some(warning => warning.startsWith('No scene headings recognized.')));
});

test('spoken scene and act references with punctuation remain dialogue, including immediately after a cue', () => {
  for (const spoken of ['Scene one, the lights went out.', 'Act two: I come back.', 'Scene one - the lights went out.', 'Scene one - The lights went out.']) {
    const result = parseScript(`INT. ROOM - DAY\n\nJO\n${spoken}\nWe were terrified.`);
    assert.deepEqual(result.characters, ['JO'], spoken);
    assert.equal(result.scenes.length, 1, spoken);
    assert.equal(result.scenes[0].lines[0].text, `${spoken} We were terrified.`, spoken);
  }
  assert.deepEqual(parseScript('SCENE 1 - Kitchen\nJO: Hello.\nSCENE 2 - The garden\nJO: Goodbye.').scenes.map(scene => scene.title), ['SCENE 1 - Kitchen', 'SCENE 2 - The garden']);
});

test('nonempty standalone act sections stay separate while empty act prefixes do not invent scenes', () => {
  const result = parseScript('ACT I\nJO: Hello.\nACT II\nJO: Goodbye.');
  assert.deepEqual(result.scenes.map(scene => scene.title), ['ACT I', 'ACT II']);
  assert.deepEqual(result.scenes.map(scene => scene.lines[0].text), ['Hello.', 'Goodbye.']);
  const nested = parseScript('ACT I\nSCENE 1\nJO: Hello.\nACT II\nSCENE 1\nJO: Goodbye.');
  assert.deepEqual(nested.scenes.map(scene => scene.title), ['ACT I — SCENE 1', 'ACT II — SCENE 1']);
  const combined = parseScript('ACT I\nJO: Hello.\nACT II SCENE 1\nJO: Goodbye.');
  assert.deepEqual(combined.scenes.map(scene => scene.title), ['ACT I', 'ACT II — SCENE 1']);
});
test('character extensions of any kind or case belong to the base character', () => {
  const script = parseScript("INT. ROOM - DAY\n\nSARAH\nHello.\n\nSARAH (O.C.)\nAre you there?\n\nSARAH (cont'd)\nStill here.\n\nSARAH (V.O.) (CONT'D)\nGoodbye.");
  assert.deepEqual(script.characters, ['SARAH']);
  assert.ok(script.scenes[0].lines.every(line => line.kind === 'dialogue' && line.character === 'SARAH'));
  assert.equal(script.scenes[0].lines.map(line => line.text).join(' '), 'Hello. Are you there? Still here. Goodbye.');
});
