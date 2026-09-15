import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageText } from './pdf-text.js';
process.once('message', async data => {
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
process.send(result, () => process.disconnect());
});
