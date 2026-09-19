import { pageText } from './pdf-text.js';
// pdfjs takes an Electron utility process (process.type 'utility') for a browser and skips its
// Node setup: the native canvas helpers and in-process parsing. This worker is plain Node apart
// from its message channel, so process.type is hidden while pdfjs and its parser load (both read
// it once, at load) and then put back.
const type = Object.getOwnPropertyDescriptor(process, 'type');
if (type) delete process.type;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
if (type) Object.defineProperty(process, 'type', type);
async function extract(data) {
// Byte input only: no remote document URLs or external font/CMap URLs.
const loading = getDocument({
  data: new Uint8Array(data), isEvalSupported: false,
  disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
  disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0,
});
let result;
try {
  const document = await loading.promise;
  if (document.numPages > 300) throw new Error('PDF exceeds the 300 page limit. Import a smaller section.');
  const pages = []; let length = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const extracted = pageText(content.items, page.getViewport({ scale: 1 }).transform);
    length += extracted.length + 2;
    if (length > 500000) throw new Error('PDF text exceeds 500,000 characters. Import a smaller section.');
    pages.push(extracted); page.cleanup();
  }
  const text = pages.join('\n\n').trim();
  if (text.length < 5) throw new Error('No readable text found. This PDF may be scanned; run OCR or paste the script text.');
  if (text.length > 500000) throw new Error('PDF text exceeds 500,000 characters. Import a smaller section.');
  result = { text };
} catch (error) {
  result = { error: error.message };
} finally {
  await loading.destroy();
}
return result;
}
// The desktop app starts this file with Electron's utilityProcess, which talks over
// process.parentPort. Plain Node (npm start, tests) forks it with child_process.
if (process.parentPort) process.parentPort.once('message', async ({ data }) => process.parentPort.postMessage(await extract(data)));
else process.once('message', async data => process.send(await extract(data), () => process.disconnect()));
