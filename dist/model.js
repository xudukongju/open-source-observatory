export const states = {todo:'待跟进',doing:'进行中',blocked:'受阻',done:'已完成',needs_reply:'待回复',replied:'已回复',closed:'已关闭',watching:'持续观察'};
export function sources(p){return [{name:'仓库指标',...p.metrics},{name:'发行与下载',...p.releases},{name:'Issues',...p.issues},...(p.promotions||[]).map(s=>({name:s.key,...s}))]}
export function feedback(p){return [...(p.issues?.value||[]),...(p.promotions||[]).flatMap(s=>s.value?.comments||[])].map(f=>({...f,project:p.id}))}
export function total(projects,key){const values=projects.map(p=>p.metrics?.value?.[key]);return values.some(v=>typeof v!=='number')?null:values.reduce((a,b)=>a+b,0)}
export function downloads(p){return !p.releases?.value?null:p.releases.value.reduce((sum,r)=>sum+r.assets.reduce((a,b)=>a+b.downloads,0),0)}
export function freshness(data,now=Date.now()){const age=(now-Date.parse(data.generated_at))/60000;const failed=data.projects.flatMap(sources).filter(s=>!s.ok);return {age,failed,stale:!Number.isFinite(age)||age>45}}
export function matches(value,query){return JSON.stringify(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
export function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function safeUrl(s){try{const u=new URL(s);return u.protocol==='https:'?u.href:'#'}catch{return '#'}}
export function validate(data){if(data?.schema!==1||!Array.isArray(data.projects)||!Array.isArray(data.history)||!Array.isArray(data.releases)||!Array.isArray(data.followups)||!Number.isFinite(Date.parse(data.generated_at)))throw Error('快照格式无效');return data}
