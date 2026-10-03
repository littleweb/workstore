/** Down-only mouse selection for the compact tool list, not action buttons. */
export function createToolSelection(target: EventTarget, select: (id: string) => void) {
  let composing = false;
  let pending: string | null = null;
  let consumed: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const start = () => {
    composing = true;
    pending = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const end = () => {
    composing = false;
    // Let the editor stage the final composition input before saving.
    timer = setTimeout(() => {
      timer = null;
      const id = pending;
      pending = null;
      if (id !== null) select(id);
    }, 0);
  };
  target.addEventListener('compositionstart', start, true);
  target.addEventListener('compositionend', end, true);
  const request = (id: string) => {
    if (composing || timer !== null) pending = id;
    else select(id);
  };
  return {
    pointerDown(event: { pointerType: string; button: number; isPrimary: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; preventDefault(): void }, id: string) {
      consumed = null;
      if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      consumed = id;
      if (!composing && timer === null) event.preventDefault();
      request(id);
    },
    click(event: { detail: number; button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; preventDefault(): void }, id: string) {
      if (event.detail > 0 && consumed === id) {
        consumed = null;
        event.preventDefault();
        return;
      }
      consumed = null;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      request(id);
    },
    dispose() {
      target.removeEventListener('compositionstart', start, true);
      target.removeEventListener('compositionend', end, true);
      if (timer !== null) clearTimeout(timer);
      pending = consumed = null;
    },
  };
}
