import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { Conversation, ModelCatalog, ModelOption, ModelSelection } from '../shared/types';
import { api } from './api';
const modelKey=(m:ModelSelection)=>`${m.providerID||''}:${m.id}`;
const effortLabel=(id:string)=>({default:'Default',low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra',fast:'Fast',none:'None',thinking:'Thinking'}[id]||id);

export default function ModelPicker({conversation,onUpdate,disabled,onOpenReady}:{conversation:Conversation;onUpdate:(c:Conversation)=>void;disabled:boolean;onOpenReady?:(open:(()=>void)|null)=>void}) {
  const [catalog,setCatalog]=useState<ModelCatalog>(),[open,setOpen]=useState(false),[selection,setSelection]=useState<ModelSelection>(),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [placement,setPlacement]=useState({left:0,top:0,width:420,maxHeight:480,ready:false});
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
  const panelId=useId(),callback=useRef(onUpdate);callback.current=onUpdate;
  const requestVersion=useRef(0),saving=useRef(false),edited=useRef(false);
  const ref={harness:conversation.harness,id:conversation.id};
  async function refresh(){if(saving.current)return;const version=++requestVersion.current;setError('');try{const d=await api<ModelCatalog>('/api/models',ref);if(version!==requestVersion.current)return;setCatalog(d);callback.current(d.conversation);return d;}catch(e){if(version===requestVersion.current)setError(e instanceof Error?e.message:String(e));}}
  useEffect(()=>{let valid=true;setCatalog(undefined);setOpen(false);setSelection(undefined);setError('');const load=async()=>{if(saving.current)return;const version=++requestVersion.current;try{const d=await api<ModelCatalog>('/api/models',ref);if(valid&&version===requestVersion.current){setCatalog(d);callback.current(d.conversation);}}catch(e){if(valid&&version===requestVersion.current)setError(e instanceof Error?e.message:String(e));}};void load();const timer=setInterval(()=>void load(),15000);return()=>{valid=false;clearInterval(timer);};},[conversation.harness,conversation.id]);
  function show(){if(disabled||saving.current)return;edited.current=false;setSelection(catalog?.current);setQuery('');setPlacement(p=>({...p,ready:false}));setOpen(true);void refresh().then(d=>{if(d&&!edited.current)setSelection(d.current);});}
  useEffect(()=>{onOpenReady?.(show);return()=>onOpenReady?.(null);});
  const current=catalog?.current,currentOption=catalog?.models.find(m=>current&&modelKey(m)===modelKey(current));
  const chosen=catalog?.models.find(m=>selection&&modelKey(selection)===modelKey(m));
  const filtered=catalog?.models.filter(m=>`${m.name} ${m.id} ${m.providerName}`.toLowerCase().includes(query.toLowerCase()))||[];
  const groups=[...new Set(filtered.map(m=>m.providerName))];
  const efforts=chosen?.efforts||[],effortIndex=Math.max(0,efforts.indexOf(selection?.effort||chosen?.defaultEffort||''));
  const changed=selection&&current&&(modelKey(selection)!==modelKey(current)||selection.effort!==current.effort);

  // Escape the editor's scroll clipping while staying anchored to its button.
  // Near the viewport bottom, open upwards as native composer menus do.
  useLayoutEffect(()=>{
    if(!open)return;
    const position=()=>{
      if(!trigger.current||!panel.current)return;
      const anchor=trigger.current.getBoundingClientRect(),gap=6,margin=12;
      const width=Math.min(460,Math.max(320,anchor.width),innerWidth-margin*2);
      const below=innerHeight-anchor.bottom-gap-margin,above=anchor.top-gap-margin;
      const upwards=below<320&&above>below;
      const maxHeight=Math.max(0,Math.min(520,upwards?above:below));
      const height=Math.min(panel.current.getBoundingClientRect().height,maxHeight);
      const next={width,maxHeight,left:Math.max(margin,Math.min(anchor.left,innerWidth-width-margin)),top:upwards?Math.max(margin,anchor.top-gap-height):anchor.bottom+gap,ready:true};
      setPlacement(old=>Object.keys(next).every(k=>old[k as keyof typeof old]===next[k as keyof typeof next])?old:next);
    };
    position();const observer=new ResizeObserver(position);if(trigger.current)observer.observe(trigger.current);if(panel.current)observer.observe(panel.current);
    window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true);};
  },[open]);

  async function finish() {
    if(saving.current)return;
    if(!changed){setOpen(false);return;}
    if(!selection||!chosen)return;
    if(disabled){setError('会话正在运行，结束后再切换模型');return;}
    saving.current=true;requestVersion.current++;setBusy(true);setError('');
    try{const result=await api<ModelCatalog>('/api/model',{...ref,selection});setCatalog(result);callback.current(result.conversation);setOpen(false);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{saving.current=false;setBusy(false);}
  }
  useEffect(()=>{
    if(!open)return;
    const outside=(e:MouseEvent)=>{
      const target=e.target as Node;
      if(root.current?.contains(target)||panel.current?.contains(target))return;
      // Consume a changed selection's dismissal click: another action must not
      // start a task until the native configuration has been committed.
      if(changed||saving.current){e.preventDefault();e.stopPropagation();}
      void finish();
    };
    const keyboard=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void finish().then(()=>{if(!saving.current)trigger.current?.focus();});}};
    document.addEventListener('click',outside,true);document.addEventListener('keydown',keyboard,true);
    return()=>{document.removeEventListener('click',outside,true);document.removeEventListener('keydown',keyboard,true);};
  },[open,selection,current,disabled]);
  function pickModel(model:ModelOption) {
    edited.current=true;setError('');setSelection(old=>{
      if(old&&modelKey(old)===modelKey(model))return old;
      const effort=old?.effort&&model.efforts.includes(old.effort)?old.effort:current&&modelKey(current)===modelKey(model)&&model.efforts.includes(current.effort||'')?current.effort:model.defaultEffort;
      return {id:model.id,providerID:model.providerID,effort};
    });
  }
  function pickEffort(index:number){const effort=efforts[index];if(!effort||busy)return;edited.current=true;setError('');setSelection(s=>s&&({...s,effort}));}
  function navigateModels(e:KeyboardEvent<HTMLDivElement>) {
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const options=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];if(!options.length)return;
    e.preventDefault();const index=options.indexOf(document.activeElement as HTMLButtonElement);
    options[e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();
  }
  return <div className="model-picker" ref={root}><button ref={trigger} className="model-picker-trigger" disabled={disabled||busy} onClick={()=>open?void finish():show()} aria-expanded={open} aria-controls={open?panelId:undefined} title="选择模型和思考档位，点击外部完成选择"><span><small>{currentOption?.providerName||conversation.harness} · {catalog?.source==='preset'?'CLI 预设':'当前会话'}</small><strong>{currentOption?.name||conversation.model||'读取模型…'}</strong></span><span className="model-effort">{effortLabel(current?.effort||conversation.effort||'default')}</span><ChevronDown size={16} className={open?'expanded':''}/></button>
    {error&&!open&&<p className="inline-error model-error">模型配置：{error} <button onClick={()=>void refresh()}>重试</button></p>}
    {open&&createPortal(<section ref={panel} id={panelId} className="model-popover" role="region" aria-label="模型选择下拉" aria-busy={busy} style={{left:placement.left,top:placement.top,width:placement.width,maxHeight:placement.maxHeight,visibility:placement.ready?'visible':'hidden'}}>
      <label className="search-field"><Search size={16}/><input autoFocus aria-label="搜索模型或提供商" placeholder="搜索模型或提供商" disabled={busy} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();panel.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();}}}/><button className="icon-button" disabled={busy} onClick={()=>void refresh()} aria-label="刷新模型目录"><RefreshCw size={15}/></button></label>
      <div className="model-options" role="listbox" aria-label="模型列表" onKeyDown={navigateModels}>{!catalog&&!error?<p><LoaderCircle className="spin" size={16}/>读取原生模型目录…</p>:groups.map(provider=><div key={provider} role="group" aria-label={provider}><h3>{provider}</h3>{filtered.filter(m=>m.providerName===provider).map(m=><button key={modelKey(m)} role="option" aria-selected={!!selection&&modelKey(selection)===modelKey(m)} tabIndex={selection&&modelKey(selection)===modelKey(m)||m===filtered[0]?0:-1} disabled={busy} onClick={()=>pickModel(m)}><span><strong>{m.name}</strong><small>{m.id}</small></span>{selection&&modelKey(selection)===modelKey(m)&&<Check size={17}/>}</button>)}</div>)}{catalog&&!filtered.length&&<p>没有匹配的可用模型</p>}</div>
      <footer><div className="effort-heading"><span>思考档位</span><strong>{efforts.length?effortLabel(efforts[effortIndex]):'不可调节'}</strong></div>
        {efforts.length>0&&<><input className="effort-slider" type="range" aria-label="模型思考档位" aria-valuetext={effortLabel(efforts[effortIndex])} min={0} max={Math.max(0,efforts.length-1)} step={1} value={effortIndex} disabled={busy||efforts.length<2} onChange={e=>pickEffort(Number(e.target.value))} style={{'--effort-progress':`${efforts.length>1?effortIndex/(efforts.length-1)*100:0}%`} as CSSProperties}/><div className={`effort-ticks ${efforts.length===1?'single':''}`}>{efforts.map((effort,index)=><button key={effort} disabled={busy||efforts.length<2} aria-label={`思考档位 ${effortLabel(effort)}`} aria-pressed={index===effortIndex} onClick={()=>pickEffort(index)}><i/>{effortLabel(effort)}</button>)}</div></>}
        {efforts.length===0&&<p className="effort-empty">该模型没有提供可调思考档位。</p>}
        {error&&<p role="alert" className="inline-error">{error}</p>}
        <div className="model-selection-note" aria-live="polite">{busy?<><LoaderCircle className="spin" size={13}/>正在保存到会话…</>:<>点击面板外完成选择{changed&&<span>待保存</span>}</>}</div>
      </footer>
    </section>,document.body)}
  </div>;
}
