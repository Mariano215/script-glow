import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.ts';

// A real PDF with screenplay indentation, wrapped dialogue and vertical blank space.
const rows = [
  [72, 720, 'INT. ROOM - DAY'],
  [240, 684, 'JORDAN'],
  [180, 672, 'Are you ready'],
  [180, 660, 'to begin?'],
  [240, 636, 'PARTNER'],
  [180, 624, 'Yes. The stage is yours.'],
  [72, 600, 'The lights dim.'],
  [240, 576, 'JORDAN'],
  [180, 564, 'Then let us begin.'],
];
const content = rows.map(([x, y, text]) => `BT /F1 12 Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`).join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const response = await fetch(`${process.env.APP_URL || 'http://127.0.0.1:3001'}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'screenplay.pdf', data: Buffer.from(pdf).toString('base64') }) });
const body = await response.json();
assert.ok(response.ok, JSON.stringify(body));
const parsed = parseScript(body.text);
assert.deepEqual(parsed.characters, ['JORDAN', 'PARTNER'], `Extracted text: ${JSON.stringify(body.text)}`);
assert.equal(parsed.scenes[0].lines[0].text, 'Are you ready to begin?');
assert.ok(parsed.scenes[0].lines.some((line) => line.kind === 'direction' && line.text === 'The lights dim.'));
console.log('PASS: real screenplay PDF retains cast, wrapped dialogue and stage directions.');
