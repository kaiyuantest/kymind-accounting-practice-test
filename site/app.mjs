import {openBank,saveProgress,readProgress,evaluate} from './core.mjs';
import {renderContent} from './render.mjs';
const $=id=>document.getElementById(id),base=new URL('../',location.href);
let bank,current,queue=[],position=0,page=0,serial=0,loadController,searchController,urls=[],selected=[],collections=[];
let searching=false,searchOffset=0;
function status(text){$('status').textContent=text;}
function fail(error){if(error.name==='AbortError'||error.message==='cancelled')return;status(`未完成：${error.message||error}。网络失败请检查 GitHub／代理；校验失败不会显示未验证内容。`);}
function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
const render=(body,occurrences,signal)=>renderContent(body,occurrences,(o,s)=>bank.image(o,s),signal,urls);
async function typeset(container){if(window.MathJax?.startup?.promise)await window.MathJax.startup.promise;if(window.MathJax?.typesetPromise)await window.MathJax.typesetPromise([container]);}
function clear(){loadController?.abort();for(const url of urls)URL.revokeObjectURL(url);urls=[];$('question').replaceChildren();$('solution').replaceChildren();$('solution').hidden=true;$('response').replaceChildren();current=null;}
function list(items){queue=items;position=0;$('list').replaceChildren();for(const [i,item]of items.entries()){const b=element('button',item.stemExcerpt||item.questionId);b.className='question-item';b.disabled=!item.practiceEligible;b.title=item.practiceEligible?item.questionId:'题目尚未达到可练状态';b.onclick=()=>{position=i;void select(item).catch(fail);};$('list').append(b);}}
async function select(item){
  clear();const generation=++serial,controller=loadController=new AbortController();selected=[];status('正在校验题目、材料及图片…');
  const q=await bank.question(item,controller.signal),passages=await bank.passages(q,controller.signal),fragment=document.createDocumentFragment();
  for(const passage of passages)fragment.append(await render(passage.content,passage.mediaOccurrences,controller.signal));
  fragment.append(await render(q.stem,q.mediaOccurrences.filter(o=>o.zone==='stem'),controller.signal));
  const response=document.createDocumentFragment();
  for(const option of q.options){const label=element('label');label.className='answer-option';const input=element('input');input.type=q.type==='multiple-choice'?'checkbox':'radio';input.name='answer';input.value=option.optionId;input.onchange=()=>{selected=[...$('response').querySelectorAll('input:checked')].map(e=>e.value);};label.append(input,element('span',option.label),await render(option.content,q.mediaOccurrences.filter(o=>o.zone==='option'),controller.signal));response.append(label);}
  if(!q.options.length){const text=element('textarea');text.placeholder='输入思路或答案（此类题目使用自评）';response.append(text);}
  if(generation!==serial||controller.signal.aborted)return;
  $('question-title').textContent=`第 ${position+1} 题 · ${q.type}`;$('question').append(fragment);$('response').append(response);current=q;
  await typeset($('question'));await typeset($('response'));
  let restored=false;
  try{const saved=await readProgress(bank.manifest.bankId,q.questionId,q.revisionDigest);if(generation!==serial)return;if(saved){selected=saved.response.optionIds||[];for(const input of $('response').querySelectorAll('input'))input.checked=selected.includes(input.value);const text=$('response').querySelector('textarea');if(text)text.value=saved.response.text||'';restored=true;}}catch{/* Private browsing can disable IndexedDB; never prevent reading. */}
  if(generation===serial)status(`固定版本 ${bank.manifest.versionLabel}；题目 ID：${q.questionId}${restored?'；已恢复本浏览器上次作答':''}`);
}
async function submit(){
  if(!current)return;const q=current,generation=serial,signal=loadController.signal,result=evaluate(q,selected),fragment=document.createDocumentFragment();
  fragment.append(element('h3',result==='correct'?'回答正确':result==='incorrect'?'回答有误':'此题需自行核对／自评'));
  fragment.append(await render(q.answer.content,q.mediaOccurrences.filter(o=>o.zone==='answer'),signal));
  if(q.answer.optionIds.length)fragment.append(element('p','参考选项：'+q.answer.optionIds.map(id=>q.options.find(o=>o.optionId===id)?.label||id).join('、')));
  fragment.append(await render(q.solution,q.mediaOccurrences.filter(o=>o.zone==='solution'),signal));
  if(generation!==serial)return;$('solution').replaceChildren(fragment);$('solution').hidden=false;await typeset($('solution'));
  try{await saveProgress({id:crypto.randomUUID(),bankId:bank.manifest.bankId,releaseId:bank.manifest.releaseId,questionId:q.questionId,revisionDigest:q.revisionDigest,response:{optionIds:selected,text:$('response').querySelector('textarea')?.value||null},evaluation:result,submittedAt:Date.now()});if(generation===serial)status('作答已保存到当前浏览器；答案与解析已揭晓。');}catch{if(generation===serial)status('答案与解析已显示，但浏览器存储不可用／容量不足，作答未保存。');}
}
async function pageList(){searching=false;const items=await bank.page(page);list(items.filter(item=>!$('type').value||item.type===$('type').value));status(`索引第 ${page+1}/${bank.root.pages.length} 页；可选择章节或搜索。`);}
// Bounded viewport, not a bank-size limit. Collections follow official order.
async function search(next=false){
  searchController?.abort();const controller=searchController=new AbortController(),query=$('search').value.trim(),collection=$('collection').value,type=$('type').value;
  searchOffset=next?searchOffset+1000:0;searching=true;
  const refs=collections.find(c=>c.collectionId===collection)?.orderedQuestionRefs;
  const order=refs?new Map(refs.map((r,i)=>[r.questionId,i])):null;
  let matches=0;const result=[];
  for(let i=0;i<bank.root.pages.length;i++){
    for(const item of await bank.page(i,controller.signal)){
      if((query&&!item.stemExcerpt.includes(query))||(collection&&!item.collectionIds.includes(collection))||(type&&item.type!==type))continue;
      const rank=order?.get(item.questionId);
      if(order){if(rank===undefined)throw Error('collection_index_mismatch');if(rank>=searchOffset&&rank<searchOffset+1000)result.push(item);}
      else if(matches>=searchOffset&&matches<searchOffset+1000)result.push(item);
      matches++;
    }
    status(`已读取 ${i+1}/${bank.root.pages.length} 页；匹配 ${matches} 题`);
    if(!order&&matches>=searchOffset+1000)break;
  }
  if(controller.signal.aborted)return;
  if(order)result.sort((a,b)=>order.get(a.questionId)-order.get(b.questionId));
  list(result);status(`显示第 ${searchOffset+1} 起的 ${result.length} 题；“更多”读取下一批。搜索范围为题干摘要。`);
}
for(const [id,fn]of [['submit',submit],['find',()=>search()],['more',async()=>{if(searching)await search(true);else{page=(page+1)%bank.root.pages.length;await pageList();}}],['prev',async()=>{if(position>0)await select(queue[--position]);}],['next',async()=>{if(position+1<queue.length)await select(queue[++position]);}]])$(id).onclick=()=>void fn().catch(fail);
$('stop').onclick=()=>{searchController?.abort();status('搜索已停止；题库未修改。');};$('collection').onchange=()=>void search().catch(fail);
$('copy').onclick=()=>void navigator.clipboard.writeText(`https://raw.githubusercontent.com/${bank.entry.repository.owner}/${bank.entry.repository.name}/main/bank.json`).then(()=>status('已复制应用导入链接：在应用“题库管理”粘贴导入。')).catch(()=>status('复制失败，请手动复制题库 bank.json 地址。'));
try{
  bank=await openBank(base);$('title').textContent=bank.entry.title;$('meta').textContent=`${bank.entry.subject} · ${bank.manifest.versionLabel} · ${bank.manifest.questionCount} 题 · ${bank.entry.authorId} · ${new Date(bank.manifest.publishedAt).toLocaleString()} · ${bank.manifest.changeSummary} · 许可：${bank.entry.license.name}`;
  $('download').href=`https://github.com/${bank.entry.repository.owner}/${bank.entry.repository.name}/archive/refs/heads/main.zip`;$('download').title='下载完整仓库 ZIP，在应用通过“选择仓库 ZIP”校验导入';
  collections=await bank.collections();for(const c of collections){const option=element('option',c.title);option.value=c.collectionId;$('collection').append(option);}await pageList();
}catch(error){fail(error);for(const b of document.querySelectorAll('button'))b.disabled=true;}
window.addEventListener('pagehide',()=>{clear();searchController?.abort();});
