import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const source=transformSync(readFileSync(new URL('../../src/tasks/store.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
export function taskStore(){const module={exports:{}};vm.runInNewContext(source,{module,crypto,Date});return module.exports;}
