// TeaEditor serializes a blank document as styled paragraph/line-break markup.
// Treat only these known empty wrappers as blank; unknown elements (including
// media, tables and horizontal rules) remain meaningful content.
export function emptyNoteHtml(html: string) {
  return html.replace(/<\/?(?:p|div|span|br)(?:\s[^<>]*)?\s*\/?>/gi, "")
    .replace(/&(?:nbsp|#160|#x0*a0|#8203|#x0*200b);/gi, "")
    .replace(/[\s\u200b]/g, "") === "";
}

export function sameNoteContent(left: string, right: string) {
  return left === right || (emptyNoteHtml(left) && emptyNoteHtml(right));
}
