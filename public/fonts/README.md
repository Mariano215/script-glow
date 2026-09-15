# Self-hosted fonts

Downloaded 2026-09-14 from the official Google Fonts CSS API using a Chrome browser user agent. WOFF2 files are unchanged. Both families are distributed under SIL Open Font License 1.1; their complete official copyright notices and licenses are included beside the files.

CSS request: https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700&family=Libre+Baskerville:ital,wght@0,400..700;1,400&display=swap

| Local file | Official asset | SHA-256 |
| --- | --- | --- |
| dm-sans-latin.woff2 | https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2 | 9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543 |
| libre-baskerville-latin.woff2 | https://fonts.gstatic.com/s/librebaskerville/v24/kmKnZrc3Hgbbcjq75U4uslyuy4kn0qNZaxM.woff2 | 22219fb90e3b9bd28debd1825fe8d9a0154a0e31f8b3fa601ac1a0a5aa5e6d1b |
| libre-baskerville-italic-latin.woff2 | https://fonts.gstatic.com/s/librebaskerville/v24/kmKWZrc3Hgbbcjq75U4uslyuy4kn0qNccR04_RUJeby2OU36SjNNluc.woff2 | efb7e5f4376a557314f5bb9f5197ef837d86c0ab38e1a50a0ff5c60c3400c629 |

License sources:

- https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/OFL.txt
- https://raw.githubusercontent.com/google/fonts/main/ofl/librebaskerville/OFL.txt

`src/fonts.css` supplies DM Sans normal weights 400–700, Libre Baskerville normal weights 400–700, and Libre Baskerville italic 400, all with `font-display: swap`. These are the API's Latin subsets; unsupported characters use the existing CSS fallback families. Normal weights are variable, including the UI's intermediate weights 450, 550 and 650. No runtime Google Fonts request is required.
