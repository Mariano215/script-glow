// In-app user guide. Static text only; keep it in step with README.md.
const sections: [string, string][] = [
  ['Quick start', `<ol>
    <li><strong>New project</strong> in the sidebar imports a text, Fountain, or text-based PDF script. The included sample works too.</li>
    <li><strong>Edit script</strong> shows the parsed scenes and characters. Fix headings or names, then press <strong>Save script</strong>.</li>
    <li>Open <strong>Cast</strong>. Press <strong>I’m playing this role</strong> on your character, then pick and preview a voice for every other character.</li>
    <li>Return to <strong>Rehearsal</strong>. Choose <strong>Full script</strong> or one scene, then press <strong>Play</strong>. Script Glow makes the audio first. The first time is slower while the voice model loads.</li>
    <li>Listen in <strong>Full cast</strong> to learn the rhythm. Switch to <strong>Practice</strong>: your lines become silence of the same length, so you speak them on cue.</li>
  </ol>`],
  ['Rehearsal controls', `<ul>
    <li><strong>Hide my lines</strong> covers your dialogue. Click a covered line to reveal it.</li>
    <li><strong>Pause between lines</strong> and <strong>Read stage directions</strong> change the audio. Press <strong>Make audio</strong> again after you change them.</li>
    <li>The player has restart, loop, speed (0.75× to 1.5×), and seek. Speed does not need new audio.</li>
    <li>Download the full-cast or practice WAV to rehearse away from the app.</li>
    <li><strong>Mark your script</strong> sets highlight colors for your role or another character. Colors never need new audio.</li>
  </ul>`],
  ['Casting and voices', `<ul>
    <li>Default voices follow character descriptions and pronoun cues in the script. When the script gives no cue, the local AI (Ollama) can suggest a voice type. Suggestions are labeled, and you can override every one.</li>
    <li>A voice that another character uses is greyed out, so every part sounds distinct.</li>
    <li>Accent labels describe the reference recordings. Generated delivery can vary.</li>
  </ul>`],
  ['Projects, saving, and backups', `<ul>
    <li>Settings autosave. Wait for <strong>Saved locally</strong> before you close the tab.</li>
    <li>Script text changes need <strong>Save script</strong> in the editor.</li>
    <li>Scene labels show <strong>Audio ready</strong> or <strong>Audio not made yet</strong>. Changes to the script, cast, your role, the pause, or stage directions need new audio.</li>
    <li><strong>Export backup</strong> downloads a <code>.sgbackup</code> file with the script, cast, settings, and audio. <strong>Restore backup</strong> always opens it as a new project.</li>
    <li>If another tab saved newer settings, use <strong>Save draft as new project</strong> to keep your version.</li>
  </ul>`],
  ['Writing scripts that parse well', `<ul>
    <li>Give every scene its own heading line: <code>INT.</code>/<code>EXT.</code>, a numbered heading, <code>SCENE 1</code>, or a Fountain heading such as <code>.THE GARDEN</code>.</li>
    <li>If a scene break is not detected, add <code># Scene title</code> above it.</li>
    <li>Put character names in uppercase above their dialogue, or use <code>NAME: dialogue</code>.</li>
    <li>Leave a blank line between dialogue and action.</li>
    <li>Scanned PDFs have no text. Run OCR on them before import.</li>
  </ul>`],
  ['Troubleshooting', `<dl>
    <dt>“Voices not connected”</dt><dd>The voice server is not running or not reachable. Start it (see <code>voice-server/README.md</code>), check the address in <code>data/connections.json</code> if you changed it, then press <strong>Check again</strong>.</dd>
    <dt>AI suggestions do not appear</dt><dd>Set <code>ollama.model</code> in <code>data/connections.json</code> to an installed model and restart the app. Manual casting works without it.</dd>
    <dt>Play is disabled</dt><dd>The scene has no dialogue, the voices are not connected, or audio or an AI check is still in progress.</dd>
    <dt>Wrong scenes or characters</dt><dd>Open <strong>Edit script</strong>. The preview under the text shows the detected counts before you save.</dd>
  </dl>`],
  ['Privacy', `<p>Script Glow runs on this computer. Scripts, casting, and audio are saved under <code>data/</code> on this machine and go only to the voice and AI services you configure. The app has no user accounts, so keep it on <code>127.0.0.1</code> and do not expose it to a network.</p>`],
];

export function openHelp() {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog help-dialog';
  dialog.setAttribute('aria-labelledby', 'help-title');
  dialog.innerHTML = `<form method="dialog"><div class="editor-heading"><div><p class="eyebrow">USER GUIDE</p><h2 id="help-title">How Script Glow works.</h2></div><button value="close" class="icon-button" aria-label="Close help">✕</button></div>
    ${sections.map(([title, body], index) => `<details ${index === 0 ? 'open' : ''}><summary>${title}</summary>${body}</details>`).join('')}</form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
