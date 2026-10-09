/** Latest intent wins; share the departing tool's save without draining other jobs. */
export function createToolNavigation(options: {
  active: () => string;
  flush: (owner: string) => Promise<void>;
  pending: (target: string | null) => void;
  error: (error: unknown) => void;
  activate?: (commit: () => void) => Promise<void>;
}) {
  let version = 0;
  const saves = new Map<string, Promise<void>>();
  return {
    async select(target: string, commit: () => void): Promise<boolean> {
      const ticket = ++version;
      const owner = options.active();
      if (target === owner) { options.pending(null); commit(); return true; }
      options.pending(target);
      try {
        let save = saves.get(owner);
        if (!save) {
          save = Promise.resolve().then(() => options.flush(owner));
          saves.set(owner, save);
          // Both branches clean up without creating an unhandled rejected promise.
          void save.then(() => saves.delete(owner), () => saves.delete(owner));
        }
        await save;
        let activated = false;
        const activate = () => {
          if (ticket !== version) return;
          commit();
          activated = true;
        };
        if (options.activate) await options.activate(activate);
        else activate();
        return activated;
      } catch (error) {
        if (ticket === version) options.error(error);
        return false;
      } finally { if (ticket === version) options.pending(null); }
    },
    dispose() { ++version; saves.clear(); },
  };
}
