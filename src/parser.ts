export interface ScriptLine { id: string; character: string; text: string; kind: 'dialogue' | 'direction'; format?: 'parenthetical' | 'heading' }
export interface Scene { id: string; title: string; lines: ScriptLine[] }
export interface ParsedScript { scenes: Scene[]; characters: string[]; warnings: string[] }

const ordinal = '(?:\\d+[A-Z]?|[IVXLCDM]+|(?:TWENTY|THIRTY|FORTY|FIFTY|SIXTY|SEVENTY|EIGHTY|NINETY)(?:[ -](?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN)';
const stageScene = new RegExp(`^SCENE(?:\\s*[:.]\\s*|\\s+)${ordinal}\\b(.*)$`, 'i');
const stageAct = new RegExp(`^(ACT(?:\\s*[:.]\\s*|\\s+)${ordinal}\\b)(.*)$`, 'i');
// Mixed-case comma/colon continuations are often spoken prose. Accept a mixed-case
// location only after a dash, starting with a capital and without sentence punctuation.
const headingSuffix = (suffix: string) => !suffix.trim() || /^[.:]$/.test(suffix.trim()) || /^\s*[-–—]\s*[A-Z][^.!?]*$/.test(suffix) || (/^[\sA-Z\d'’"().,:\-–—]+$/.test(suffix) && /[A-Z]/.test(suffix));
const isStageScene = (line: string) => { const match = line.match(stageScene); return Boolean(match && headingSuffix(match[1])); };
function readHeading(line: string): { title: string; act?: string; actOnly?: boolean } | null {
  const actMatch = line.match(stageAct);
  if (actMatch) {
    const remainder = actMatch[2].replace(/^[\s,.:\-–—]+/, '');
    if (isStageScene(remainder)) return { title: `${actMatch[1]} — ${remainder}`, act: actMatch[1] };
    if (headingSuffix(actMatch[2])) return { title: line, act: line, actOnly: true };
  }
  if (isStageScene(line)) return { title: line };
  if (/^#{1,3}\s+\S/.test(line)) return { title: line.replace(/^#+\s*/, '') };
  // Fountain forced headings use one leading period, with no following space.
  if (/^\.[^.\s]/.test(line)) return { title: line.slice(1) };
  const unnumbered = line.replace(/^\d+[A-Z]?[.)]?\s+/, '');
  if (/^(?:INT(?:\.?\s*\/\s*EXT)?|EXT(?:\.?\s*\/\s*INT)?|I\s*\/\s*E|EST)(?:\.\s*|\s+)\S/i.test(unnumbered)) return { title: line };
  return null;
}
// Cue extensions such as (O.C.), (V.O.) or (cont'd) name the same character, in any case.
const extensions = /(?:\s*\([^()]{1,20}\))+\s*$/;
const cue = (line: string) => /^@/.test(line) || (/^[A-Z][A-Z\d ._'’\-]{0,49}$/.test(line.replace(extensions, '')) && !/^(FADE |CUT TO|DISSOLVE|THE END|TITLE:|CREDIT:|AUTHOR:)/.test(line));
const cleanName = (line: string) => line.replace(/^@/, '').replace(/\s*\^$/, '').replace(extensions, '').trim();

// A PDF copy/paste can attach a numbered slugline to the end of action.
// Recover only uppercase headings with matching leading/trailing scene numbers,
// after a sentence boundary. Ordinary mentions of a scene remain untouched.
const attachedShootingHeading = /([.!?])[ \t]+((\d+[A-Z]?)[ \t]+[A-Z][A-Z\d \t./'’():–—-]*[ \t]+\3)[ \t]*$/;
const runningDraftHeader = /^.+\s+SCREENPLAY\s+(?:THE\s+)?FEATURE\s+FINAL\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d+\.?)?$/;
function scriptRows(source: string): string[] {
  return source.replace(/\r\n?/g, '\n').split('\n').flatMap(row => {
    const match = row.match(attachedShootingHeading);
    if (!match || !readHeading(match[2])) return [row];
    return [row.slice(0, match.index! + 1), '', match[2]];
  });
}

export function parseScript(source: string): ParsedScript {
  const rows = scriptRows(source);
  const scenes: Scene[] = [];
  const characters = new Set<string>();
  const warnings: string[] = [];
  let scene: Scene = { id: 'scene-1', title: 'Scene 1', lines: [] };
  let current: string | null = null;
  let act = '';
  let castList = false;
  let serial = 0;
  let explicitScene = false;
  let pendingAct = false;
  let recognizedHeading = false;
  const append = (kind: ScriptLine['kind'], character: string, text: string) => {
    const previous = scene.lines.at(-1);
    if (kind === 'dialogue' && previous?.kind === kind && previous.character === character && current) previous.text += ` ${text}`;
    else scene.lines.push({ id: `line-${++serial}`, kind, character, text });
    if (kind === 'dialogue') characters.add(character);
  };
  for (let index = 0; index < rows.length; index++) {
    const line = rows[index].trim();
    if (runningDraftHeader.test(line)) continue;
    if (!line) { current = null; continue; }
    if (/^(?:CAST(?: OF CHARACTERS)?|CHARACTERS|DRAMATIS PERSONAE)\s*:?$/i.test(line)) { castList = true; current = null; continue; }
    if (/^(Title|Credit|Author|Source|Draft date|Contact):/i.test(line) || /^\[\[.*\]\]$/.test(line)) continue;
    const heading = readHeading(line);
    if (heading) {
      recognizedHeading = true;
      castList = false;
      const closeSection = explicitScene || (pendingAct && scene.lines.length > 0 && Boolean(heading.act));
      if (closeSection) scenes.push(scene);
      // Keep introductory text; do not invent an extra scene before the first heading.
      const introduction = closeSection ? [] : scene.lines;
      if (heading.act) act = heading.act;
      const title = act && isStageScene(heading.title) ? `${act} — ${heading.title}` : heading.title;
      scene = { id: `scene-${scenes.length + 1}`, title, lines: introduction };
      explicitScene = !heading.actOnly;
      pendingAct = Boolean(heading.actOnly);
      current = null;
      continue;
    }
    if (castList) continue;
    const inline = line.match(/^([A-Z][A-Z\d _'’\-]{0,40}):\s*(.+)$/);
    if (inline) { current = null; append('dialogue', inline[1].trim(), inline[2]); continue; }
    const next = rows[index + 1]?.trim();
    if ((!current || line.startsWith('@')) && cue(line.replace(/\s*\^$/, '')) && next && !readHeading(next)) { current = cleanName(line); continue; }
    if (/^\(.*\)$/.test(line)) { append('direction', 'Narrator', line.slice(1, -1)); scene.lines.at(-1)!.format = 'parenthetical'; continue; }
    if (current) append('dialogue', current, line);
    else append('direction', 'Narrator', line.replace(/^!/, ''));
  }
  if (scene.lines.length || explicitScene) scenes.push(scene);
  if (source.trim() && !recognizedHeading) warnings.push('No scene headings recognized. Showing the text as one scene. Add headings such as INT. ROOM - DAY, SCENE 2, or # Scene title in Edit script to separate scenes.');
  if (!characters.size && source.trim()) warnings.push('No character cues found. Put an uppercase character name above dialogue, or use NAME: dialogue.');
  if (scenes.length === 0) warnings.push('Add some script text to get started.');
  return { scenes, characters: [...characters], warnings };
}

export const SAMPLE = `Title: The Last Light
Author: Script Glow

INT. LIGHTHOUSE — DUSK

The last of the daylight slips across the room. A small radio hums.

ELENA, a woman in her thirties, checks the radio.

MARCUS, a man in his forties, waits by the door.

ELENA
You came back.

MARCUS
I said I would.

ELENA
You say a lot of things when the tide is out.

MARCUS
(a small smile)
This time I brought a coat.

ELENA
The boat leaves at six. If you're going to ask me to stay, now would be a good time.

MARCUS
I'm not asking you to stay. I'm asking if there's room for one more.

EXT. LIGHTHOUSE STEPS — NIGHT

Two cups of coffee steam in the cold air.

ELENA
You know there's no lighthouse where we're going.

MARCUS
Then we'll have to find another way home.

ELENA
One more cup. Then we go.

MARCUS
Then we go.`;
