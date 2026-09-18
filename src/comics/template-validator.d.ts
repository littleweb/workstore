import type { Template } from './types';
declare const validate: ((value:unknown)=>value is Template) & {errors?:Array<{instancePath?:string;message?:string}>|null};
export default validate;
