/**
 * Minimal RFC 4180 CSV reader for the scraper's output files.
 *
 * Hand-written rather than a dependency because the input is ours and narrow:
 * Python's csv module writes it, so the only rules are comma separators,
 * double-quoted fields, "" for a quote inside quotes, and newlines inside
 * quoted fields (course descriptions have them). A ragged row throws: a
 * wrong column count means the file and this reader disagree, and guessing
 * would load wrong data silently.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // skip a UTF-8 BOM

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells, n) => {
    if (cells.length !== header.length)
      throw new Error(`CSV row ${n + 2} has ${cells.length} fields, header has ${header.length}`);
    return Object.fromEntries(header.map((h, k) => [h, cells[k]]));
  });
}
