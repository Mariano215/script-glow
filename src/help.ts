// In-app user guide. Static text only; keep it in step with README.md.
const sections: [string, string, string][] = [
  ['quick-start', 'Quick start', `<ol>
    <li>Open <strong>Projects</strong> and press <strong>New project from a script</strong> to import a text, Fountain, or text-based PDF script. The included sample works too.</li>
    <li><strong>Edit script</strong> shows the parsed scenes and characters. Fix headings or names, then press <strong>Save script</strong>.</li>
    <li>No GPU? Open <strong>Settings</strong> and pick who reads the other parts. <strong>Built-in voices</strong> are free and need no key, where your version offers them. Otherwise choose a paid engine (ElevenLabs, OpenAI or Google Gemini), add its key under <strong>Keys for paid services</strong>, then press <strong>Save changes</strong>.</li>
    <li>Open <strong>Cast</strong>. Press <strong>I’m playing this role</strong> on your character, then pick and preview a voice for every other character.</li>
    <li>Return to <strong>Rehearsal</strong>. Choose <strong>Full script</strong> or one scene, then press <strong>Play</strong>. Script Glow makes the audio first. The first time is slower while the voice model loads.</li>
    <li>Listen in <strong>Full cast</strong> to learn the rhythm. Switch to <strong>Practice</strong>: your lines become silence of the same length, so you speak them on cue.</li>
    <li>When you are ready, open <strong>Self-tape</strong> to record yourself against the cast, or download a WAV to rehearse away from the app.</li>
  </ol>`],
  ['rehearsal', 'Rehearsal and practice', `<ul>
    <li>The top menu holds every screen: Rehearsal, Cast, Self-tape, Projects and Settings. Saved projects, new imports and backups live on Projects. Voices, your own voice and keys live on Settings. The sidebar lists the scenes of the open project.</li>
    <li><strong>Hide my lines</strong> covers your dialogue with a blank block. Click a covered line to reveal it.</li>
    <li><strong>Listen only</strong> hides the whole scene, so you rehearse by ear instead of reading along.</li>
    <li><strong>First letters of hidden lines</strong> shows the first letter of each word instead of a blank block, as a prompt.</li>
    <li><strong>Wait for me on my line</strong> pauses practice mode on your line. Press Space or tap <strong>Continue</strong> on the player to go on.</li>
    <li><strong>Continue when I stop speaking</strong> listens through your microphone and goes on by itself once you stop. <strong>How long I can pause</strong> sets how long a silence has to be before your line counts as finished, from half a second to five seconds, so a scene with pauses in it is not cut short. Both appear on the Practice card once <strong>Wait for me on my line</strong> is ticked. Space and <strong>Continue</strong> still work, so you can always come in early. Only the loudness of the room is read: nothing is recorded, nothing is saved and nothing is sent anywhere.</li>
    <li><strong>Build up line by line</strong> learns the scene the way actors do: your first line, repeated, then your first and second, and so on. Set <strong>Times through each block</strong>, and press <strong>Start again</strong> to go back to the first line.</li>
    <li>Click any line to move the scene to it. Play carries on from there.</li>
    <li>The player steps cue by cue with the arrow buttons, or the left and right arrow keys. Space plays and pauses. Seek by dragging the scrub bar.</li>
    <li>The loop button repeats the whole scene. Mark <strong>A</strong> and <strong>B</strong> at the current cue to repeat just that exchange instead; <strong>Clear</strong> removes the marks.</li>
    <li>Playback runs from 0.75× to 1.5× speed. Speed does not need new audio, and it never shortens the pause left for your own line in practice mode.</li>
    <li><strong>Pause between lines</strong> and <strong>Read stage directions</strong> change the audio. Press <strong>Make audio</strong> again after you change them.</li>
    <li>Download the full-cast or practice WAV to rehearse away from the app.</li>
    <li><strong>Mark your script</strong> sets highlight colors for your role or another character. Colors never need new audio and stay visible in print.</li>
  </ul>`],
  ['cast', 'Casting and voices', `<ul>
    <li>Default voices follow character descriptions and pronoun cues in the script. When the script gives no cue, an AI (Ollama on this machine, or a hosted model you choose in Settings) can suggest a voice type from the name. Suggestions are labeled; press <strong>Apply AI voice suggestions</strong> to use them, and you can override every one.</li>
    <li>A voice that another character uses is greyed out, so every part sounds distinct.</li>
    <li>Press <strong>Preview voice</strong> to hear a sample. Accent labels describe the reference recordings; generated delivery can vary. Some voices have no sample.</li>
    <li>Press <strong>I’m playing this role</strong> on your character. Your selected role is silent in practice mode.</li>
    <li>Press <strong>Highlight lines</strong> to mark a character’s dialogue in the script, whether or not you are playing them.</li>
    <li><strong>Your own voice:</strong> in Settings, press <strong>Record my voice</strong> and read the short passage (5 to 30 seconds). Script Glow uses it for your role with Chatterbox.</li>
  </ul>`],
  ['selftape', 'Self-tape', `<ul>
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
  ['finish-tape', 'Finish the tape', `<ul>
    <li>Set <strong>Reader volume in the take</strong> a little below your own voice. It changes only what the recording hears; your headphones are not affected.</li>
    <li>Type your name under <strong>Your name on saved files</strong>. Takes are named Performer_Project_Scene, for example Jane_Doe_Evelyn_Kitchen, as casting instructions usually ask.</li>
    <li>Each take shows whether it fits Casting Networks (MP4, MOV or MKV, up to 300 MB), Eco Cast (up to 500 MB), and Spotlight (MP4, MOV, WebM or MKV, no stated limit).</li>
    <li>Press <strong>Trim / MP4</strong> to open the trim panel. Play the take, then press <strong>Start here</strong> and <strong>End here</strong> at the moments to keep. <strong>Play the kept part</strong> previews the trim.</li>
    <li>Press <strong>Make MP4</strong>. With FFmpeg installed, the trim is exact and fast, and the original take is kept beside it. Without FFmpeg, Chrome and Edge can make the MP4 by playing the take through once; other browsers cannot. Set <code>SCRIPT_GLOW_FFMPEG</code> to point at an FFmpeg program if it is not on your PATH.</li>
    <li>A take recorded as WebM is marked for conversion, since some casting sites only take MP4.</li>
  </ul>`],
  ['settings', 'Settings and paid services', `<ul>
    <li><strong>Who reads the other parts:</strong> choose the built-in voices (free, private, no key, where your version offers them), Chatterbox (free and private; fast with an NVIDIA graphics card, slow without one), ElevenLabs, OpenAI, or Google Gemini. A hosted engine is paid: the lines of a scene are sent to it when you make audio, and lines already made are kept and never sent twice. Choose its model, or leave the recommended one.</li>
    <li>Press <strong>Test this server</strong> for Chatterbox, or <strong>Test the key</strong> for a hosted engine, to check the connection before you rehearse.</li>
    <li><strong>Your own voice:</strong> press <strong>Record my voice</strong> and read the passage aloud (5 to 30 seconds), or press <strong>or choose a file</strong>. Listen back, then press <strong>Use this recording</strong>. Name it under Voice name. Only used with Chatterbox.</li>
    <li><strong>Guess voice types from names:</strong> choose who guesses, Ollama (this computer, free, needs an installed model) or a hosted engine (OpenAI, Claude, Gemini, Grok or OpenRouter, which charge a very small amount per guess). Only the names are sent, never the script.</li>
    <li><strong>Keys for paid services:</strong> press Add key, paste it, and press Save key. Keys are kept in your private user folder, never shown again once saved, and never included in a project backup. Replace or Remove a key from the same list. <strong>Voice server token</strong> is only for a Chatterbox server on another computer: paste the <code>VOICE_TOKEN</code> that server was started with.</li>
    <li>Changes wait in a save bar at the bottom of the page. Press <strong>Save changes</strong> to apply them, or <strong>Undo</strong> to discard them.</li>
    <li><strong>Advanced:</strong> press <strong>Show advanced settings</strong> for the Chatterbox server address (when a paid engine reads the parts), the WhisperX server address (not used yet; <strong>Continue when I stop speaking</strong> listens through the microphone on this computer and needs no server), the name shown for this set-up, and <strong>Reuse audio made by an older Script Glow</strong>. Settings are saved in <code>data/connections.json</code>, which never holds a key, so it is safe to copy to another computer.</li>
  </ul>`],
  ['projects', 'Projects, saving, and backups', `<ul>
    <li>Projects lists every saved project with its last edited date and how many scenes have audio. Press <strong>Open</strong> to switch to one.</li>
    <li>Press <strong>New project from a script</strong> to import a .txt, .fountain, or text-based PDF file as a separate project. Your current project is not replaced.</li>
    <li>Rename the open project by editing its name field at the top of the list. Press <strong>Delete</strong> to move a project’s script, audio and takes to <code>data/projects/.trash</code>, where they can be moved back by hand.</li>
    <li>Settings autosave. Wait for <strong>Saved locally</strong> before you close the tab. Script text changes need <strong>Save script</strong> in the editor.</li>
    <li>Scene labels show <strong>Audio ready</strong> or <strong>Audio not made yet</strong>. Changes to the script, cast, your role, the pause, or stage directions need new audio.</li>
    <li><strong>Export backup</strong> downloads a <code>.sgbackup</code> file with the script, cast, settings, and scene audio. It does not include your self-tapes or your keys. <strong>Restore backup</strong> always opens it as a new project.</li>
    <li>If another tab saved newer settings, use <strong>Save draft as new project</strong> to keep your version.</li>
  </ul>`],
  ['writing-scripts', 'Writing scripts that parse well', `<ul>
    <li>Give every scene its own heading line: <code>INT.</code>/<code>EXT.</code>, a numbered heading, <code>SCENE 1</code>, or a Fountain heading such as <code>.THE GARDEN</code>.</li>
    <li>If a scene break is not detected, add <code># Scene title</code> above it.</li>
    <li>Put character names in uppercase above their dialogue, or use <code>NAME: dialogue</code>.</li>
    <li>Leave a blank line between dialogue and action.</li>
    <li>Scanned PDFs have no text. Run OCR on them before import.</li>
  </ul>`],
  ['troubleshooting', 'Troubleshooting', `<dl>
    <dt>“Voices not connected”</dt><dd>The voice server is not running or not reachable. Start it (see <code>voice-server/README.md</code>), check its address in <strong>Settings</strong>, press <strong>Test this server</strong>, then <strong>Check again</strong>. With a paid engine, check that its key is saved under <strong>Keys for paid services</strong>.</dd>
    <dt>AI suggestions do not appear</dt><dd>Open <strong>Settings</strong>, <strong>Guess voice types from names</strong>, and choose Ollama with an installed model, or a paid service with its key. Casting by hand works without it.</dd>
    <dt>Play is disabled</dt><dd>The scene has no dialogue, the voices are not connected, or audio or an AI check is still in progress.</dd>
    <dt>Wrong scenes or characters</dt><dd>Open <strong>Edit script</strong>. The preview under the text shows the detected counts before you save.</dd>
    <dt>Camera or microphone will not turn on</dt><dd>Allow the permission for this page in your browser, and check that nothing else is using the camera. Current Chrome, Edge, Firefox and Safari can all record. Firefox saves WebM, which some casting sites refuse; make an MP4 from it with FFmpeg.</dd>
    <dt><strong>Make MP4</strong> is disabled</dt><dd>Install FFmpeg, or use Chrome or Edge, which can make an MP4 without it. To install FFmpeg: on Windows run <code>winget install Gyan.FFmpeg</code>, on a Mac <code>brew install ffmpeg</code>, on Linux <code>sudo apt install ffmpeg</code> (or your system's package manager). Then restart Script Glow.</dd>
    <dt>“The voice server refused the token”</dt><dd>The Chatterbox server was started with <code>VOICE_TOKEN</code>. Paste the same value under <strong>Keys for paid services</strong>, <strong>Voice server token</strong>.</dd>
  </dl>`],
  ['privacy', 'Privacy', `<p>Script Glow runs on this computer. Scripts, casting, settings and audio are saved under <code>data/</code> on this machine and go only to the voice and AI services you configure. With Chatterbox and Ollama on this computer, nothing leaves the machine. If they run on another computer, the lines, names and your voice recording go to that computer. If you choose a hosted voice engine (ElevenLabs, OpenAI or Google Gemini) in Settings, the lines of each scene you voice are sent to that company, which charges for them. If a hosted AI (OpenAI, Claude, Gemini, Grok or OpenRouter) guesses voice types, only the character names are sent to it. Your script file, your settings and your self-tapes are never sent to either. API keys are kept in your private user folder, not in the project, never shown again once saved, and never included in a project backup. The app has no user accounts, so keep it on <code>127.0.0.1</code> and do not expose it to a network.</p>`],
  // Opened by the ⓘ buttons beside each service in Settings. Written for someone who has never
  // made an API key before, so every step names the button to press and where it is.
  ['keys', 'What a key is, and how to add one', `<p>A paid service will not talk to Script Glow until you prove the account is yours. It does that with a <strong>key</strong>: a long line of letters and numbers you copy from that company’s website once and paste here. It is like a password for one app, and you can cancel it at any time without changing your real password.</p>
    <p>You only need a key for a paid service. The built-in voices, Chatterbox on this computer and Ollama need none.</p>
    <ol>
      <li>Get the key from the service. The ⓘ button beside each service below gives the exact steps for that one.</li>
      <li>In Script Glow, open <strong>Settings</strong>, then <strong>Keys for paid services</strong>.</li>
      <li>Find the service in the list and press <strong>Add key</strong>.</li>
      <li>Paste the key into the box and press <strong>Save key</strong>.</li>
      <li>Go back up to <strong>Who reads the other parts</strong>, pick that service, and press <strong>Test the key</strong>. A green tick means it worked.</li>
      <li>Press <strong>Save changes</strong> at the bottom of the page.</li>
    </ol>
    <p>Once saved, a key is never shown again, only its first and last few characters. That is normal. If you lose it, make a new one on the service’s website and press <strong>Replace</strong> here. Keys are kept in your private user folder, never in the project, and never in a backup you send to someone else.</p>
    <p>These companies redesign their websites from time to time, so a button may have moved since this was written. The links here go to the right page rather than describing where to click. If one is wrong, say so with <strong>Ask for help on GitHub</strong> at the bottom of this guide and it will be fixed.</p>`],
  ['service-kokoro', 'Built-in voices, step by step', `<p><strong>Free. Private. No account and no key.</strong> These voices run inside Script Glow on this computer. Nothing you write or record leaves the machine.</p>
    <p class="callout is-warn" role="note">They are held back in some versions while a licensing question about their word lists is settled. If <strong>Built-in voices</strong> is not on the Settings screen, your version does not have them yet: use one of the services below instead.</p>
    <ol>
      <li>Open <strong>Settings</strong>.</li>
      <li>Under <strong>Who reads the other parts</strong>, click the <strong>Built-in voices</strong> card.</li>
      <li>The first time only, Script Glow downloads the voice model. A progress figure shows on the card. Leave the page open until it says <strong>✓ Ready</strong>.</li>
      <li>Press <strong>Save changes</strong> at the bottom.</li>
      <li>Open <strong>Cast</strong> and pick a voice for each character.</li>
    </ol>
    <p>These voices work on any laptop, with no graphics card. On an older machine the first scene takes longer while the model loads, and audio you have already made is reused rather than made again.</p>`],
  ['service-chatterbox', 'Chatterbox, step by step', `<p><strong>Free and private, but it needs a separate program running.</strong> Chatterbox is a voice server. It can run on this computer or on another one on your home network.</p>
    <p>It is fast on a computer with an NVIDIA graphics card and slow without one. If that sounds like work, use <strong>Built-in voices</strong> instead. They need no server at all.</p>
    <ol>
      <li>Start the Chatterbox server by following <code>voice-server/README.md</code> in the Script Glow folder.</li>
      <li>Note the address it prints, for example <code>http://127.0.0.1:8095</code> on this computer, or <code>http://192.168.1.20:8095</code> on another one.</li>
      <li>In Script Glow, open <strong>Settings</strong> and click the <strong>Chatterbox</strong> card.</li>
      <li>Paste the address into <strong>Your Chatterbox server address</strong>.</li>
      <li>Press <strong>Test this server</strong>. A green tick means Script Glow can reach it.</li>
      <li>Press <strong>Save changes</strong>.</li>
    </ol>
    <p>If the server was started with a <code>VOICE_TOKEN</code>, paste that same value under <strong>Keys for paid services</strong>, <strong>Voice server token</strong>, or the server will refuse Script Glow.</p>
    <p>Chatterbox is also the only engine that can speak your own lines in your own voice. See <strong>Your own voice</strong> in Settings.</p>`],
  ['service-elevenlabs', 'ElevenLabs, step by step', `<p><strong>Paid.</strong> The most natural voices, and it uses the voices already in your ElevenLabs account. You are charged for the dialogue it reads, counted by character. Lines Script Glow has already made are kept and never paid for twice.</p>
    <p>Getting the key:</p>
    <ol>
      <li>Go to <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">elevenlabs.io/app/settings/api-keys</a> and sign in, or create an account. That link goes straight to the right page.</li>
      <li>Press the button to create a new API key, and give it any name you like, such as Script Glow.</li>
      <li>Copy the key it shows you. Copy it now: these services normally show a key once and never again. If you lose it, delete it there and make another.</li>
    </ol>
    <p>Putting it into Script Glow:</p>
    <ol>
      <li>Open <strong>Settings</strong>, then <strong>Keys for paid services</strong>.</li>
      <li>Find <strong>ElevenLabs</strong>, press <strong>Add key</strong>, paste, and press <strong>Save key</strong>.</li>
      <li>Scroll up to <strong>Who reads the other parts</strong> and click the <strong>ElevenLabs</strong> card.</li>
      <li>Press <strong>Test the key</strong>, then <strong>Save changes</strong>.</li>
    </ol>`],
  ['service-openai', 'OpenAI, step by step', `<p><strong>Paid.</strong> Clear, reliable voices that work on any laptop. You are charged for the dialogue it reads. Lines already made are kept and never paid for twice.</p>
    <p>Getting the key:</p>
    <ol>
      <li>Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a> and sign in, or create an account.</li>
      <li>This is the developer site, not ChatGPT. <strong>A ChatGPT Plus subscription does not pay for it.</strong> API use is billed separately, so check that the account has a payment method and some credit under Billing.</li>
      <li>Create a new secret key and give it any name.</li>
      <li>Copy the key. Copy it now: these services normally show a key once and never again.</li>
    </ol>
    <p>Putting it into Script Glow:</p>
    <ol>
      <li>Open <strong>Settings</strong>, then <strong>Keys for paid services</strong>.</li>
      <li>Find <strong>OpenAI</strong>, press <strong>Add key</strong>, paste, and press <strong>Save key</strong>.</li>
      <li>Scroll up to <strong>Who reads the other parts</strong>, click the <strong>OpenAI</strong> card, press <strong>Test the key</strong>, then <strong>Save changes</strong>.</li>
    </ol>`],
  ['service-gemini', 'Google Gemini, step by step', `<p><strong>Paid.</strong> A wide range of voices, and it works on any laptop. You are charged for the dialogue it reads. Lines already made are kept and never paid for twice.</p>
    <p>Getting the key:</p>
    <ol>
      <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/app/apikey</a> and sign in with your Google account.</li>
      <li>Create an API key. Google AI Studio makes a default project for a new account on its own, so accept whatever project it offers.</li>
      <li>Copy the key it shows you.</li>
    </ol>
    <p>Putting it into Script Glow:</p>
    <ol>
      <li>Open <strong>Settings</strong>, then <strong>Keys for paid services</strong>.</li>
      <li>Find <strong>Google Gemini</strong>, press <strong>Add key</strong>, paste, and press <strong>Save key</strong>.</li>
      <li>Scroll up to <strong>Who reads the other parts</strong>, click the <strong>Google Gemini</strong> card, press <strong>Test the key</strong>, then <strong>Save changes</strong>.</li>
    </ol>`],
  ['service-ollama', 'Ollama, step by step', `<p><strong>Free and private, and entirely optional.</strong> Ollama is only used to guess whether a character is a man or a woman from their name, when the script does not say. Casting every voice by hand works perfectly well without it.</p>
    <p>Only the character names are sent to it. Your script is not.</p>
    <ol>
      <li>Go to <strong>ollama.com</strong> and download Ollama for your system. Install it like any other program.</li>
      <li>Open it once so it is running. It sits in the menu bar on a Mac, or the system tray on Windows.</li>
      <li>Give it a model to use. Open Terminal on a Mac, or Command Prompt on Windows, and type <code>ollama pull</code> followed by a model name, then press Enter. Wait for it to finish.</li>
      <li>Pick a small model. All it does here is guess whether a name sounds like a man or a woman, so the smallest one on <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer">ollama.com/library</a> is plenty. The big ones are several gigabytes and need a lot of memory for no benefit here.</li>
      <li>In Script Glow, open <strong>Settings</strong>, then <strong>Guess voice types from names</strong>.</li>
      <li>Under <strong>Who guesses</strong>, choose <strong>Ollama (this computer, free)</strong>.</li>
      <li>Leave <strong>Ollama server</strong> as <code>http://127.0.0.1:11434</code> unless you run it elsewhere.</li>
      <li>Leave <strong>Installed model</strong> empty to use the first model you installed, or type its exact name.</li>
      <li>Press <strong>Save changes</strong>.</li>
    </ol>
    <p>Script Glow never downloads a model by itself. If suggestions do not appear, the model is usually missing: run the <code>ollama pull</code> step again.</p>`],
];

// A report from someone who cannot get started is only useful with the version and the browser
// in it, and that is exactly what a non-technical person cannot be expected to find. So the link
// carries both, and they only describe what went wrong.
function askForHelpUrl(): string {
  const body = [
    'Tell me what you were trying to do, and what happened instead.',
    '',
    '',
    '---',
    `Script Glow version: ${__APP_VERSION__}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
  return `https://github.com/Mariano215/script-glow/issues/new?template=install_help.md&title=${encodeURIComponent('Help installing Script Glow')}&body=${encodeURIComponent(body)}`;
}

// sectionId opens the guide at one section instead of the top, so an ⓘ button beside a control
// lands on the steps for that control. An unknown id falls back to the whole guide.
export function openHelp(sectionId?: string) {
  const wanted = sections.some(([id]) => id === sectionId) ? sectionId : '';
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog help-dialog';
  dialog.setAttribute('aria-labelledby', 'help-title');
  dialog.innerHTML = `<form method="dialog"><div class="editor-heading"><div><p class="eyebrow">USER GUIDE</p><h2 id="help-title">How Script Glow works.</h2></div><button value="close" class="icon-button" aria-label="Close help">✕</button></div>
    ${sections.map(([id, title, body], index) => `<details id="help-${id}" ${wanted ? id === wanted ? 'open' : '' : index === 0 ? 'open' : ''}><summary>${title}</summary>${body}</details>`).join('')}
    <p class="help-ask">Still stuck? <a href="${askForHelpUrl()}" target="_blank" rel="noopener noreferrer">Ask for help on GitHub</a>. Your version and browser are filled in for you, so you only have to say what happened. A free GitHub account is needed to post.</p></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  if (wanted) dialog.querySelector(`#help-${wanted}`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
