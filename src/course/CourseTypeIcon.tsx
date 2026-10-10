const labels={cards:'知识卡片',whiteboard:'白板沙画',animation:'动画教程',web:'交互网页'};
export default function CourseTypeIcon({mode='cards'}:{mode?:string}){
 const type=mode in labels?mode as keyof typeof labels:'cards';
 return <svg className="course-type-icon" data-course-type={type} role="img" aria-label={labels[type]} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
 {type==='cards'?<><path d="M7 3h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M5 7H3v13a2 2 0 0 0 2 2h11M9 8h7M9 12h7M9 16h4"/></>:type==='whiteboard'?<><path d="M3 4h18v13H3zM7 21l3-4m7 4-3-4M6 13c2-5 4 3 6-2"/><path d="m13 10 5-5 2 2-5 5-3 1z"/></>:type==='animation'?<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 6 3-6 3zM3 8h4M3 16h4M17 8h4M17 16h4"/></>:<><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 8h20m-13 3-3 3 3 3m6-6 3 3-3 3M4.5 6h.1M7.5 6h.1"/></>}
 </svg>;
}
