import {extractHtml} from './model';
/** Scripts run only inside an opaque sandbox; no access to the host or network. */
export function previewHtml(raw:string){extractHtml(raw);const template=document.createElement('template');template.innerHTML=raw;
 template.content.querySelectorAll('script[src],iframe,frame,object,embed,base,link,meta[http-equiv]').forEach(n=>n.remove());
 template.content.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes])if(['src','href','action','formaction','target','srcdoc'].includes(attr.name.toLowerCase())||/^on/i.test(attr.name))el.removeAttribute(attr.name);});
 template.content.querySelectorAll('script[src]').forEach(n=>n.remove());
 const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; worker-src 'none'; form-action 'none'; base-uri 'none'";
 // CSP must precede everything the generated document supplies.
 return '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta charset="utf-8"></head><body>'+template.innerHTML+'</body></html>';
}
