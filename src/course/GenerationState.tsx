export default function GenerationState({kind,stage,progress=0}:{kind:string;stage:string;progress?:number}){
 return <div className="course-generating" role="status" aria-live="polite" aria-busy="true"><span className="course-generating-spinner" aria-hidden="true"/><h2>{kind}生成中</h2><p>{stage}</p>{progress>0&&<progress aria-label="生成进度" max={100} value={progress}/>}<small>完成后将在这里展示作品</small></div>;
}
