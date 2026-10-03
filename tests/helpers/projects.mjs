// Isolate unrelated editor tests from the project persistence layer. The real
// project controller, component and desktop storage have dedicated tests.
export const noProjects = {ProjectSection:()=>null,useProjects:()=>({projectOf:()=>null,menu:()=>[],handle:()=>false})};
