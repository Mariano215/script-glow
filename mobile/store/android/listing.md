# Google Play listing: Script Glow

## Store listing

**App name** (30 max)
Script Glow

**Short description** (80 max)
Rehearse your lines. The app reads every other part and waits for yours.

**Full description** (4000 max)

Script Glow is a rehearsal partner for actors. It reads every other part in the scene out loud and leaves your lines as silence, so you can run a scene alone, on the train or backstage.

How it works
You make the scene on your computer with the free Script Glow desktop app for Mac, Windows or Linux. It gives each character a voice. You back up the project, move the file to your phone, and add it in the app. Two sample scenes come with the app, so you can try it right away.

Practice mode
Your partners speak and your lines stay silent. Your lines are hidden until you tap to peek.

Full read
Every line is voiced, yours too. Use it to learn the scene before you practice.

When your line comes
Keep playing, with a silence the length of your line. Or have the scene wait until you tap Continue. Or let it go on when you stop talking. That option reads only the microphone level. Nothing is recorded.

First-letter hints
Stuck on a line? Show only the first letter of each word.

Partner speed
Slow your partners down to 0.75x or speed them up to 1.5x. Your silent lines always run at 1x.

Private by design
No account. No ads. No analytics. Your scripts and audio stay on your phone.

**App icon**: icon-512.png
**Feature graphic**: feature-graphic.png
**Phone screenshots**: phone-1.png to phone-4.png

## Store settings

- App category: Entertainment
- Tags: pick the closest to "Education" or "Performing arts" if offered
- Contact email: mariano215@gmail.com
- Website: https://github.com/Mariano215/script-glow

## App content

- **Privacy policy**: https://mariano215.github.io/script-glow/privacy.html
- **App access**: All functionality is available without special access.
- **Ads**: No, the app does not contain ads.
- **Content rating**: Category "All other app types". Answer No to every question. The two sample scenes have no violence, sexual content, drugs or profanity. Users cannot talk to each other, share location or buy anything.
- **Target audience**: 18 and over. (A younger range pulls in the Families policy and extra review.)
- **News app**: No.
- **Government app**: No.
- **Financial features**: My app does not provide any financial features.
- **Health**: My app does not have any health features.
- **Advertising ID**: No, the app does not use an advertising ID.

## Data safety

- Does your app collect or share any of the required user data types? **No.**
- Is all user data encrypted in transit? The form skips this when you answer No above.
- Account deletion: not applicable, the app has no accounts.

Why "No" is correct, from the code:
- Microphone (`RECORD_AUDIO`): used only for "go on when I stop talking". `src/listening.ts` reads the level on the device. The phone app never starts the recorder (`mobile/src/main.ts` calls `startListening` without a clip), and nothing is saved or sent. Google does not count data that is processed only on the device and never leaves it as "collected".
- Files: the user picks a `.sgbackup` file. It is stored in the app's own storage (IndexedDB) and never uploaded.
- Network: the `INTERNET` permission comes with Capacitor. The app makes no calls to any server. It only reads the files packaged in the app.
