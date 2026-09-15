// PDF.js TextItem geometry is in page coordinates. The viewport converts
// baselines to top-down display coordinates, including page rotation.
export function pageText(items, viewportTransform) {
  const [a, b, c, d, e, f] = viewportTransform;
  const fragments = items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const t = item.transform;
    return {
      text: item.str,
      x: a * t[4] + c * t[5] + e,
      y: b * t[4] + d * t[5] + f,
      width: item.width,
      height: Math.max(1, Math.hypot(t[2], t[3])),
    };
  }).sort((left, right) => left.y - right.y || left.x - right.x);
  const rows = [];
  for (const fragment of fragments) {
    const previous = rows.at(-1);
    if (previous && Math.abs(previous.y - fragment.y) <= Math.min(previous.height, fragment.height) * 0.35) {
      previous.fragments.push(fragment);
      previous.height = Math.max(previous.height, fragment.height);
    } else rows.push({ y: fragment.y, height: fragment.height, fragments: [fragment] });
  }
  let output = '';
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (index) {
      const previous = rows[index - 1];
      // A screenplay's blank line is a physical vertical gap, not a text item.
      const paragraph = row.y - previous.y > 1.5 * Math.max(previous.height, row.height);
      output += paragraph ? '\n\n' : '\n';
    }
    const fragments = row.fragments.sort((left, right) => left.x - right.x);
    let line = '';
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i], previous = fragments[i - 1];
      if (previous && !/\s$/.test(line) && !/^\s/.test(fragment.text) && fragment.x - (previous.x + previous.width) > fragment.height * 0.15) line += ' ';
      line += fragment.text;
    }
    output += line.trim();
  }
  return output;
}
