// In-app user guide. Static text only; keep it in step with README.md.
const sections: [string, string][] = [
  ['Quick start', `<ol>
    <li>Open <strong>Projects</strong> and press <strong>New project from a script</strong> to import a text, Fountain, or text-based PDF script. The included sample works too.</li>
    <li><strong>Edit script</strong> shows the parsed scenes and characters. Fix headings or names, then press <strong>Save script</strong>.</li>
    <li>No GPU? Open <strong>Settings</strong>, choose a paid voice engine (ElevenLabs, OpenAI or Google Gemini) under <strong>Who reads the other parts</strong>, add its key under <strong>Keys for paid services</strong>, then press <strong>Save changes</strong>.</li>
    <li>Open <strong>Cast</strong>. Press <strong>I’m playing this role</strong> on your character, then pick and preview a voice for every other character.</li>
    <li>Return to <strong>Rehearsal</strong>. Choose <strong>Full script</strong> or one scene, then press <strong>Play</strong>. Script Glow makes the audio first. The first time is slower while the voice model loads.</li>
    <li>Listen in <strong>Full cast</strong> to learn the rhythm. Switch to <strong>Practice</strong>: your lines become silence of the same length, so you speak them on cue.</li>
    <li>When you are ready, open <strong>Self-tape</strong> to record yourself against the cast, or download a WAV to rehearse away from the app.</li>
  </ol>`],
  ['Rehearsal and practice', `<ul>
    <li>The top menu holds every screen: Rehearsal, Cast, Self-tape, Projects and Settings. Saved projects, new imports and backups live on Projects. Voices, your own voice and keys live on Settings. The sidebar lists the scenes of the open project.</li>
    <li><strong>Hide my lines</strong> covers your dialogue with a blank block. Click a covered line to reveal it.</li>
    <li><strong>Listen only</strong> hides the whole scene, so you rehearse by ear instead of reading along.</li>
    <li><strong>First letters of hidden lines</strong> shows the first letter of each word instead of a blank block, as a prompt.</li>
    <li><strong>Wait for me on my line</strong> pauses practice mode on your line. Press Space or tap <strong>Continue</strong> on the player to go on.</li>
    <li><strong>Build up line by line</strong> learns the scene the way actors do: your first line, repeated, then your first and second, and so on. Set <strong>Times through each block</strong>, and press <strong>Start again</strong> to go back to the first line.</li>
    <li>Click any line to move the scene to it. Play carries on from there.</li>
    <li>The player steps cue by cue with the arrow buttons, or the left and right arrow keys. Space plays and pauses. Seek by dragging the scrub bar.</li>
    <li>The loop button repeats the whole scene. Mark <strong>A</strong> and <strong>B</strong> at the current cue to repeat just that exchange instead; <strong>Clear</strong> removes the marks.</li>
    <li>Playback runs from 0.75× to 1.5× speed. Speed does not need new audio, and it never shortens the pause left for your own line in practice mode.</li>
    <li><strong>Pause between lines</strong> and <strong>Read stage directions</strong> change the audio. Press <strong>Make audio</strong> again after you change them.</li>
    <li>Download the full-cast or practice WAV to rehearse away from the app.</li>
    <li><strong>Mark your script</strong> sets highlight colors for your role or another character. Colors never need new audio and stay visible in print.</li>
  </ul>`],
  ['Casting and voices', `<ul>
    <li>Default voices follow character descriptions and pronoun cues in the script. When the script gives no cue, an AI (Ollama on this machine, or a hosted model you choose in Settings) can suggest a voice type from the name. Suggestions are labeled; press <strong>Apply AI voice suggestions</strong> to use them, and you can override every one.</li>
    <li>A voice that another character uses is greyed out, so every part sounds distinct.</li>
    <li>Press <strong>Preview voice</strong> to hear a sample. Accent labels describe the reference recordings; generated delivery can vary. Some voices have no sample.</li>
    <li>Press <strong>I’m playing this role</strong> on your character. Your selected role is silent in practice mode.</li>
    <li>Press <strong>Highlight lines</strong> to mark a character’s dialogue in the script, whether or not you are playing them.</li>
    <li><strong>Your own voice:</strong> in Settings, press <strong>Record my voice</strong> and read the short passage (5 to 30 seconds). Script Glow uses it for your role with Chatterbox.</li>
  </ul>`],
  ['Self-tape', `<ul>
    <li>Open <strong>Self-tape</strong> and press <strong>Turn on camera and microphone</strong>. The camera stays off, and nothing is recorded, until you do.</li>
    <li>Wear headphones, or the cast comes back through your microphone.</li>
    <li>Press <strong>Record a take</strong> for a scene against the cast, or <strong>Record a slate</strong> to state your name, height and location on its own. Each counts in with three beeps before it starts.</li>
    <li>A red REC light and a running clock show while you are recording. A scene take stops itself after 5 minutes; a slate stops itself after 1 minute. Either way, the take is kept.</li>
    <li>A take switches the rehearsal to Practice mode on its own, so the cast reads every other part and your lines stay silent. Hide my lines, Listen only and First letters still work during a take.</li>
    <li>Check <strong>Put the script over the camera</strong> to place it on the video. Drag its grip, or use the arrow keys, to set it near the lens; hold Shift to move it further. Drag its edge to resize it. Press <strong>Put it back under the lens</strong> to reset its place.</li>
    <li>Check <strong>Scroll with the scene</strong> to have the script follow the active line on its own.</li>
    <li>Press <strong>Fill the screen</strong> to hide everything but the camera; press <strong>Show everything again</strong> to bring the rest back.</li>
    <li>Takes are kept with the project, on this machine only, and are left out of project backups.</li>
    <li>Each take can be renamed (click its name), played, or deleted. <strong>Save</strong> downloads it under your performer file name.</li>
  </ul>`],
  ['Finish the tape', `<ul>
    <li>Set <strong>Reader volume in the take</strong> a little below your own voice. It changes only what the recording hears; your headphones are not affected.</li>
    <li>Type your name under <strong>Your name on saved files</strong>. Takes are named Performer_Project_Scene, for example Jane_Doe_Evelyn_Kitchen, as casting instructions usually ask.</li>
    <li>Each take shows whether it fits Casting Networks (MP4, MOV or MKV, up to 300 MB), Eco Cast (up to 500 MB), and Spotlight (MP4, MOV, WebM or MKV, no stated limit).</li>
    <li>Press <strong>Trim / MP4</strong> to open the trim panel. Play the take, then press <strong>Start here</strong> and <strong>End here</strong> at the moments to keep. <strong>Play the kept part</strong> previews the trim.</li>
    <li>Press <strong>Make MP4</strong>. With FFmpeg installed, the trim is exact and fast, and the original take is kept beside it. Without FFmpeg, Chrome and Edge can make the MP4 by playing the take through once; other browsers cannot. Set <code>SCRIPT_GLOW_FFMPEG</code> to point at an FFmpeg program if it is not on your PATH.</li>
    <li>A take recorded as WebM is marked for conversion, since some casting sites only take MP4.</li>
  </ul>`],
  ['Settings and paid services', `<ul>
    <li><strong>Who reads the other parts:</strong> choose Chatterbox (free and private; fast with an NVIDIA graphics card, slow without one), ElevenLabs, OpenAI, or Google Gemini. A hosted engine is paid: the lines of a scene are sent to it when you make audio, and lines already made are kept and never sent twice. Choose its model, or leave the recommended one.</li>
    <li>Press <strong>Test this server</strong> for Chatterbox, or <strong>Test the key</strong> for a hosted engine, to check the connection before you rehearse.</li>
    <li><strong>Your own voice:</strong> press <strong>Record my voice</strong> and read the passage aloud (5 to 30 seconds), or press <strong>or choose a file</strong>. Listen back, then press <strong>Use this recording</strong>. Name it under Voice name. Only used with Chatterbox.</li>
    <li><strong>Guess voice types from names:</strong> choose who guesses, Ollama (this computer, free, needs an installed model) or a hosted engine (OpenAI, Claude, Gemini, Grok or OpenRouter, which charge a very small amount per guess). Only the names are sent, never the script.</li>
    <li><strong>Keys for paid services:</strong> press Add key, paste it, and press Save key. Keys are kept in your private user folder, never shown again once saved, and never included in a project backup. Replace or Remove a key from the same list. <strong>Voice server token</strong> is only for a Chatterbox server on another computer: paste the <code>VOICE_TOKEN</code> that server was started with.</li>
    <li>Changes wait in a save bar at the bottom of the page. Press <strong>Save changes</strong> to apply them, or <strong>Undo</strong> to discard them.</li>
    <li><strong>Advanced:</strong> press <strong>Show advanced settings</strong> for the Chatterbox server address (when a paid engine reads the parts), the WhisperX server address (not used yet), the name shown for this set-up, and <strong>Reuse audio made by an older Script Glow</strong>. Settings are saved in <code>data/connections.json</code>, which never holds a key, so it is safe to copy to another computer.</li>
  </ul>`],
  ['Projects, saving, and backups', `<ul>
    <li>Projects lists every saved project with its last edited date and how many scenes have audio. Press <strong>Open</strong> to switch to one.</li>
    <li>Press <strong>New project from a script</strong> to import a .txt, .fountain, or text-based PDF file as a separate project. Your current project is not replaced.</li>
    <li>Rename the open project by editing its name field at the top of the list. Press <strong>Delete</strong> to move a project’s script, audio and takes to <code>data/projects/.trash</code>, where they can be moved back by hand.</li>
    <li>Settings autosave. Wait for <strong>Saved locally</strong> before you close the tab. Script text changes need <strong>Save script</strong> in the editor.</li>
    <li>Scene labels show <strong>Audio ready</strong> or <strong>Audio not made yet</strong>. Changes to the script, cast, your role, the pause, or stage directions need new audio.</li>
    <li><strong>Export backup</strong> downloads a <code>.sgbackup</code> file with the script, cast, settings, and scene audio. It does not include your self-tapes or your keys. <strong>Restore backup</strong> always opens it as a new project.</li>
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
    <dt>“Voices not connected”</dt><dd>The voice server is not running or not reachable. Start it (see <code>voice-server/README.md</code>), check its address in <strong>Settings</strong>, press <strong>Test this server</strong>, then <strong>Check again</strong>. With a paid engine, check that its key is saved under <strong>Keys for paid services</strong>.</dd>
    <dt>AI suggestions do not appear</dt><dd>Open <strong>Settings</strong>, <strong>Guess voice types from names</strong>, and choose Ollama with an installed model, or a paid service with its key. Casting by hand works without it.</dd>
    <dt>Play is disabled</dt><dd>The scene has no dialogue, the voices are not connected, or audio or an AI check is still in progress.</dd>
    <dt>Wrong scenes or characters</dt><dd>Open <strong>Edit script</strong>. The preview under the text shows the detected counts before you save.</dd>
    <dt>Camera or microphone will not turn on</dt><dd>Allow the permission for this page in your browser, and check that nothing else is using the camera. Current Chrome, Edge, Firefox and Safari can all record. Firefox saves WebM, which some casting sites refuse; make an MP4 from it with FFmpeg.</dd>
    <dt><strong>Make MP4</strong> is disabled</dt><dd>Install FFmpeg, or use Chrome or Edge, which can make an MP4 without it. To install FFmpeg: on Windows run <code>winget install Gyan.FFmpeg</code>, on a Mac <code>brew install ffmpeg</code>, on Linux <code>sudo apt install ffmpeg</code> (or your system's package manager). Then restart Script Glow.</dd>
    <dt>“The voice server refused the token”</dt><dd>The Chatterbox server was started with <code>VOICE_TOKEN</code>. Paste the same value under <strong>Keys for paid services</strong>, <strong>Voice server token</strong>.</dd>
  </dl>`],
  ['Privacy', `<p>Script Glow runs on this computer. Scripts, casting, settings and audio are saved under <code>data/</code> on this machine and go only to the voice and AI services you configure. With Chatterbox and Ollama on this computer, nothing leaves the machine. If they run on another computer, the lines, names and your voice recording go to that computer. If you choose a hosted voice engine (ElevenLabs, OpenAI or Google Gemini) in Settings, the lines of each scene you voice are sent to that company, which charges for them. If a hosted AI (OpenAI, Claude, Gemini, Grok or OpenRouter) guesses voice types, only the character names are sent to it. Your script file, your settings and your self-tapes are never sent to either. API keys are kept in your private user folder, not in the project, never shown again once saved, and never included in a project backup. The app has no user accounts, so keep it on <code>127.0.0.1</code> and do not expose it to a network.</p>`],
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
