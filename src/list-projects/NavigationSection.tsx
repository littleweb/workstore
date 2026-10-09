import { useState, type ReactNode } from 'react';
import './projects.css';
export function NavigationSection({title,children,action,className=''}: {title:string;children:ReactNode;action?:ReactNode;className?:string}) {
  const [expanded,setExpanded]=useState(true);
  return <section className={`list-navigation-section ${className}`}>
    <div className="list-project-label">
      <button className="list-section-toggle" aria-label={`${expanded?'折叠':'展开'}${title}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
        <span>{title}</span><svg className="list-section-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{transform:expanded?'rotate(90deg)':undefined}}><path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
      </button>
      {action}
    </div>
    {expanded&&children}
  </section>;
}
