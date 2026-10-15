import './style.css';
import { FaceEngine, defaultSettings, clamp, actionUnitDefinitions, type FACSActionUnitKey, type FrameState, type VADVector, type LabSettings } from './engine';
import { FaceViewer, type ModelInfo } from './viewer';
import { vroidProfile, parseProfile, type ResolvedBinding } from './profile';
import { emotionCatalog, emotionByName, commonEmotions } from './emotions';
import { modelCatalog, type CatalogModel } from './models';
import { EmotionSpace, planeAxes, planePosition, editPlane, type Plane } from './space';
import { parseSignal, arkitKeys, facsToARKit } from './arkit';
import { mountSemanticUI } from './semantic-ui';
import type { SemanticMode } from './semantic-types';
import { mountMotionUI } from './motion-ui';
import type { ActionName, ActionOptions, GazeOptions } from './motion';
import { mountDirectionUI } from './direction-ui';
import type { Direction, HeadAngles, EyeAngles } from './directions';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const settingsKey = 'soullinkFace.settings.v1';
function loadSettings(): Partial<LabSettings> {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(defaultSettings).filter(([key, sample]) => typeof value[key] === typeof sample && (typeof sample !== 'number' || Number.isFinite(value[key]))).map(([key]) => [key, value[key]])) as Partial<LabSettings>;
  } catch { return {}; }
}
const engine = new FaceEngine(loadSettings());
function saveSettings() { try { localStorage.setItem(settingsKey, JSON.stringify(engine.settings)); } catch { /* Manual controls also work when browser storage is unavailable. */ } }
function configureSettings(settings: Partial<LabSettings>) { engine.configure(settings); saveSettings(); if (paused) { paused = false; updatePause(); } renderUI(engine.snapshot()); }
let viewer: FaceViewer | null = null;
let paused = false;
let frame = engine.snapshot();
let history: {time: number; v: number; a: number; d: number}[] = [];
let lastTraceAt = 0;
let modelInfo: ModelInfo | null = null;
let toastTimer = 0;
let loadId = 0;
let activeView: 'face' | 'bust' | 'full' = 'face';
let selectedModel:CatalogModel|undefined=modelCatalog[0];
let coordinateMode:'3d'|Plane='3d';
const auInputs = new Map<FACSActionUnitKey, HTMLInputElement>();
const auOutputs = new Map<FACSActionUnitKey, HTMLElement>();
const settingBindings = new Map<string, { key: keyof LabSettings; format: (n: number) => string }>();
const gains: Partial<Record<FACSActionUnitKey, number>> = {};
const presets=emotionCatalog.filter(p=>p.name!=='neutral');
let selectedEmotion='';
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const semantic = mountSemanticUI($('semantic-root'), engine, result => {
  if (result.kind === 'emotion' || result.kind === 'emotion_action') {
    selectedEmotion = result.emotion;
    document.querySelectorAll<HTMLButtonElement>('.preset').forEach(b => b.classList.toggle('active', b.dataset.emotion === selectedEmotion));
    $('emotion-description').textContent = `文本驱动 · ${emotionByName.get(result.emotion)?.label ?? result.emotion} · 影响强度 ${Math.round(result.intensity * 100)}%`;
  }
  if (paused) { paused = false; updatePause(); }
  renderUI(engine.snapshot());
});
const motionControls = mountMotionUI($('motion-controls'), engine, () => {
  semantic.cancelPending();
  if (paused) { paused = false; updatePause(); }
  queueMicrotask(saveSettings);
});
const directionControls = mountDirectionUI($('direction-controls'), engine, () => {
  semantic.cancelPending(); if (paused) { paused = false; updatePause(); }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && /^(vad-|pose-|au-)/.test(target.id)) semantic.cancelPending();
}, true);
document.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && ['model-file','profile-file','signals-file'].includes(event.target.id)) semantic.cancelPending();
}, true);
document.addEventListener('click', event => {
  const target = event.target;
  if (target instanceof Element && target.closest('.preset, #center-vad, #clear-aus, #release-signals, #pause, [data-action]')) semantic.cancelPending();
}, true);
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('show'); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 4200); }
function downloadJSON(name: string, data: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function selectTab(tab: string) {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => { const active = b.dataset.tab === tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
  for (const name of ['emotion','facs','direction','model']) $( `pane-${name}`).hidden = name !== tab;
}
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b, index, buttons) => {
  b.onclick = () => selectTab(b.dataset.tab!);
  b.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = buttons[(index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; selectTab(next.dataset.tab!); next.focus(); } };
});
selectTab('emotion');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) { engine.configure({idle:false}); $<HTMLInputElement>('idle').checked = false; }
function renderPresets(group='common'){
  $('presets').replaceChildren();
  for(const p of presets.filter(p=>group==='common'?commonEmotions.includes(p.name):group==='all'||p.group===group)){
  const b = document.createElement('button'); b.className='preset'; b.dataset.emotion=p.name; b.innerHTML=`<span class="preset-symbol">${p.icon}</span><span>${p.label}</span>`;
  b.classList.toggle('active',selectedEmotion===p.name);b.title=p.description;
  b.onclick=()=> { selectedEmotion=p.name;engine.triggerEmotion(p.name, Number($<HTMLInputElement>('pulse-strength').value));document.querySelectorAll('.preset').forEach(x=>x.classList.toggle('active', x===b));$('emotion-description').textContent=p.description;if(paused) { paused=false; updatePause(); }toast(`已触发${p.label}情绪`); };
  $('presets').append(b);
  }
}
renderPresets();
document.querySelectorAll<HTMLButtonElement>('[data-emotion-group]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-emotion-group]').forEach(x=>x.classList.toggle('active',x===b));renderPresets(b.dataset.emotionGroup);});
$<HTMLInputElement>('pulse-strength').oninput=e=>{ $('pulse-strength-value').textContent=`${Math.round(Number((e.target as HTMLInputElement).value)*100)}%`; };

const axes = [{key:'valence',letter:'V',label:'愉悦度',ends:'消极 / 积极'}, {key:'arousal',letter:'A',label:'唤醒度',ends:'舒缓 / 激动'}, {key:'dominance',letter:'D',label:'支配度',ends:'退让 / 主导'}] as const;
for (const axis of axes) {
  const row=document.createElement('div'); row.className='control-row';
  row.innerHTML=`<label for="vad-${axis.key}"><span class="axis-label">${axis.letter}</span>${axis.label}<small>${axis.ends}</small></label><output id="vad-${axis.key}-value">+0.00</output><input id="vad-${axis.key}" type="range" min="-1" max="1" step="0.01" value="0" />`;
  row.querySelector('input')!.oninput=e=>{ engine.setVAD({[axis.key]:Number((e.target as HTMLInputElement).value)}); clearEmotionIntent();renderUI(engine.snapshot()); };
  $('vad-sliders').append(row);
}
const field=$('vad-field'); const space=new EmotionSpace($<HTMLCanvasElement>('vad-space'));let fieldDragging=false;
function clearEmotionIntent(){selectedEmotion='';document.querySelectorAll('.preset').forEach(p=>p.classList.remove('active'));$('emotion-description').textContent='连续坐标会平滑混合相邻情绪，不依赖单一标签切换。';}
function fieldMove(event: PointerEvent) {if(coordinateMode==='3d')return;semantic.cancelPending();const rect=field.getBoundingClientRect();engine.setVAD(editPlane(engine.snapshot().vad.target,coordinateMode,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height));clearEmotionIntent();renderUI(engine.snapshot());}
field.onpointerdown=e=>{fieldDragging=true;field.setPointerCapture(e.pointerId);fieldMove(e);};
field.onpointermove=e=>{if(fieldDragging)fieldMove(e);};
field.onpointerup=()=>{fieldDragging=false;};field.onpointercancel=()=>{fieldDragging=false;};
field.onkeydown=e=>{if(coordinateMode==='3d'||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;semantic.cancelPending();e.preventDefault();const current=engine.snapshot().vad.target,axes=planeAxes[coordinateMode];engine.setVAD({[axes.x]:current[axes.x]+(e.key==='ArrowRight'?.05:e.key==='ArrowLeft'?-.05:0),[axes.y]:current[axes.y]+(e.key==='ArrowUp'?.05:e.key==='ArrowDown'?-.05:0)});clearEmotionIntent();renderUI(engine.snapshot());};
function switchCoordinates(mode:'3d'|Plane){coordinateMode=mode;$('vad-space').hidden=mode!=='3d';field.hidden=mode==='3d';document.querySelectorAll<HTMLButtonElement>('[data-coordinates]').forEach(b=>{b.classList.toggle('active',b.dataset.coordinates===mode);b.setAttribute('aria-pressed',String(b.dataset.coordinates===mode));});if(mode!=='3d'){const axes=planeAxes[mode];field.querySelector('.field-label.top')!.textContent=axes.top;field.querySelector('.field-label.bottom')!.textContent=axes.bottom;field.querySelector('.field-label.left')!.textContent=axes.left;field.querySelector('.field-label.right')!.textContent=axes.right;field.querySelectorAll('.quadrant').forEach((q,i)=>q.textContent=axes.quadrants[i]);field.setAttribute('aria-label',`${axes.xLabel} 与 ${axes.yLabel} 情绪投影，拖动或方向键编辑`);}$('coordinate-note').textContent=mode==='3d'?'三轴同时可见；拖动旋转，用下方滑块精确编辑。':`${planeAxes[mode].xLabel}–${planeAxes[mode].yLabel} 投影；未显示的第三轴保持当前值。`;renderUI(engine.snapshot());}
document.querySelectorAll<HTMLButtonElement>('[data-coordinates]').forEach(b=>b.onclick=()=>switchCoordinates(b.dataset.coordinates as '3d'|Plane));
switchCoordinates('3d');
$('center-vad').onclick=()=>{engine.setVAD({valence:0,arousal:0,dominance:0});clearEmotionIntent();renderUI(engine.snapshot());};
function settingSlider(id: string, key: keyof LabSettings, format:(n:number)=>string) {const input=$<HTMLInputElement>(id);settingBindings.set(id,{key,format});input.oninput=()=>configureSettings({[key]:Number(input.value)});}
settingSlider('hold','hold',n=>`${n.toFixed(0)} s`);settingSlider('half-life','halfLife',n=>`${n.toFixed(0)} s`);settingSlider('gain','gain',n=>`${n.toFixed(1)}×`);
settingSlider('detail-mix','detailMix',n=>`${Math.round(n*100)}%`);
settingSlider('brow-gain','browGain',n=>`${n.toFixed(1)}×`);settingSlider('eye-gain','eyeGain',n=>`${n.toFixed(1)}×`);settingSlider('mouth-gain','mouthGain',n=>`${n.toFixed(1)}×`);
for(const [id,key] of [['auto-decay','autoDecay'],['auto-blink','autoBlink'],['idle','idle']] as const) $<HTMLInputElement>(id).onchange=e=>configureSettings({[key]:(e.target as HTMLInputElement).checked});
$<HTMLSelectElement>('time-speed').onchange=e=>configureSettings({speed:Number((e.target as HTMLSelectElement).value)});
$('expression-natural').onclick=()=>configureSettings({gain:1.4,detailMix:.65,browGain:1,eyeGain:1,mouthGain:1,faceSmoothing:.28});
$('expression-bold').onclick=()=>configureSettings({gain:4,detailMix:1,browGain:2,eyeGain:2,mouthGain:2,faceSmoothing:.28});

function renderAUControls(bindings: ResolvedBinding[]) {
  const root=$('au-controls');root.replaceChildren();auInputs.clear();auOutputs.clear();
  const grouped=[['眉部',bindings.filter(b=>/au0[124]/.test(b.au))],['眼部',bindings.filter(b=>/au0[567]|au45/.test(b.au))],['嘴部与中面部',bindings.filter(b=>! /au0[124567]|au45/.test(b.au))]] as const;
  for(const [label, rows] of grouped){const title=document.createElement('div');title.className='au-group-title';title.textContent=label;root.append(title);
    for(const b of rows){const d=actionUnitDefinitions.find(d=>d.key===b.au)!;const row=document.createElement('div');row.className=`au-row${b.supported?'':' unsupported'}`;row.dataset.au=b.au;
      const pin=document.createElement('button');pin.className='pin-button';pin.textContent='○';pin.setAttribute('aria-label',`锁定或释放 ${d.code}`);pin.title='点亮锁定，点击释放';pin.disabled=!b.supported;
      const desc=document.createElement('label');desc.className='au-description';desc.htmlFor=`au-${b.au}`;desc.innerHTML=`<span class="au-code">${d.code}</span>`;desc.append(document.createTextNode(b.label));
      const output=document.createElement('output');output.className='au-value';output.textContent='0.00';
      const input=document.createElement('input');input.id=`au-${b.au}`;input.type='range';input.min='0';input.max='1';input.step='0.01';input.value='0';input.disabled=!b.supported;input.setAttribute('aria-label',`${d.code} ${b.label}`);
      pin.onclick=()=>{if(engine.isPinned(b.au))engine.setAU(b.au,null);else engine.setAU(b.au,frame.aus[b.au]);renderUI(engine.snapshot());};
      input.oninput=()=>{engine.setAU(b.au,Number(input.value));pin.classList.add('pinned');pin.textContent='●';output.textContent=Number(input.value).toFixed(2);};
      row.append(pin,desc,output,input);root.append(row);auInputs.set(b.au,input);auOutputs.set(b.au,output);
    }
  }
}
// Controls exist before the model loads; unsupported channels become disabled after capability discovery.
renderAUControls(vroidProfile.bindings.map(b=>({...b,supported:false,resolved:[]})));
$('clear-aus').onclick=()=>{engine.clearAU();toast('已释放全部动作单元');renderUI(engine.snapshot());};
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>{ if(paused){paused=false;updatePause();} engine.playAction(b.dataset.action as ActionName); });

function renderMappings(bindings: ResolvedBinding[]) {
  $('mapping-list').replaceChildren();
  for(const b of bindings){const row=document.createElement('div');row.className='mapping-row';const strong=document.createElement('strong');strong.textContent=`${b.au.slice(0,4).toUpperCase()} · ${b.label}`;const status=document.createElement('span');status.textContent=b.supported?(b.kind==='proxy'?'风格化代理':'对应形变'):'未支持';const code=document.createElement('code');code.textContent=b.resolved.map(x=>`${x.name} × ${x.weight}`).join(' + ')||'— 模型缺少候选形变';const gain=document.createElement('input');gain.type='number';gain.min='0';gain.max='3';gain.step='0.1';gain.value=String(gains[b.au]??1);gain.title='该 AU 的映射增益';gain.setAttribute('aria-label',`${b.label} 映射增益`);gain.disabled=!b.supported;gain.onchange=()=>{gains[b.au]=clamp(Number(gain.value),0,3);gain.value=String(gains[b.au]);viewer?.setGains(gains);};row.append(strong,status,code,gain);$('mapping-list').append(row);}
  const count=bindings.filter(b=>b.supported).length;$('model-coverage').textContent=`${count} / ${bindings.length} AU 已映射`;
  renderAUControls(bindings);
}
async function loadModel(url: string, localName?: string) {
  semantic.cancelPending();
  if(!viewer)return;const requestId=++loadId;
  const loading=$('loading');loading.hidden=false;loading.classList.remove('error');loading.querySelector('strong')!.textContent='正在准备角色';$('reload-model').hidden=true;$('loading-text').textContent='加载模型与纹理…';
  try {const info=await viewer.load(url,p=>{if(requestId===loadId)$('loading-text').textContent=`加载模型 ${Math.round(p*100)}%`;});if(!info||requestId!==loadId)return;modelInfo=info;engine.clearAU();
    $('model-name').textContent=info.name||localName||'Imported VRM';$('model-info-name').textContent=info.name||localName||'Imported VRM';$('morph-count').textContent=String(info.morphs);
    const metadata=info.meta as {metaVersion?:string};document.querySelector('.stage-label .pill')!.textContent=metadata?.metaVersion==='0'?'VRM 0.x':'VRM 1.0';
    $('model-info-text').textContent=`${info.morphs} 个形变目标 · ${info.triangles.toLocaleString()} 个三角面${info.fallback?' · 标准表情降级模式':''}`;
    $('direct-coverage').textContent=`${info.directChannels} / 52 直接通道`;
    renderMappings(info.bindings);directionControls.setCapabilities(info.rig);$('model-license').textContent=selectedModel?`${selectedModel.name} · ${selectedModel.license}`:'自定义 VRM · 查看导出元数据';$<HTMLAnchorElement>('model-terms').href=selectedModel?.terms??'https://vrm.dev/licenses/1.0/';document.querySelector('.stage-caption span:last-child')!.textContent=selectedModel?.id==='Sendagaya_Shino'?'VRoid Project · CC0':'pixiv / VRoid Project';loading.hidden=true;toast(info.fallback?'已加载。该模型使用标准表情降级模式。':'模型就绪，试着触发一个情绪。');
  } catch(error) {if(requestId!==loadId)return;loading.classList.add('error');loading.querySelector('strong')!.textContent='模型加载失败';$('loading-text').textContent=error instanceof Error?error.message:'无法解析模型';$('reload-model').hidden=false;toast('模型加载失败，可重试或导入其他 VRM。');}
}
function loadBuiltin(model:CatalogModel){selectedModel=model;for(const key of Object.keys(gains))delete gains[key as FACSActionUnitKey];viewer?.setGains(gains);viewer?.setProfile(vroidProfile);document.querySelectorAll('[data-model]').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.model===model.id));return loadModel(model.path,model.name);}
try {viewer=new FaceViewer($('viewer'));loadBuiltin(modelCatalog[0]);}catch(error){$('loading').classList.add('error');$('loading').querySelector('strong')!.textContent='WebGL 不可用';$('loading-text').textContent='请在支持 WebGL 的浏览器中打开，并启用硬件加速。';}
const modelDialog=$<HTMLDialogElement>('models-dialog');$('model-library').onclick=()=>modelDialog.showModal();$('close-models').onclick=()=>modelDialog.close();
for(const model of modelCatalog){const button=document.createElement('button');button.className='model-card';button.dataset.model=model.id;button.classList.toggle('active',model.id===selectedModel?.id);const image=document.createElement('img');image.src=model.thumbnail;image.alt=model.name;image.loading='lazy';const content=document.createElement('span');const name=document.createElement('strong');name.textContent=model.name;const subtitle=document.createElement('small');subtitle.textContent=model.subtitle;const stats=document.createElement('small');stats.textContent=`${model.morphs} 形变 · VRM ${model.format} · ${model.license}`;content.append(name,subtitle,stats);button.append(image,content);button.onclick=()=>{modelDialog.close();loadBuiltin(model);};$('model-catalog').append(button);}
$('import-model').onclick=()=>$<HTMLInputElement>('model-file').click();
$<HTMLInputElement>('model-file').onchange=async e=>{const input=e.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;if(file.size>64*1024*1024){toast('请选择 64 MB 以内的 VRM 模型。');input.value='';return;}const url=URL.createObjectURL(file);selectedModel=undefined;try{await loadModel(url,file.name);}finally{URL.revokeObjectURL(url);input.value='';}};
$('reload-model').onclick=()=>loadBuiltin(selectedModel??modelCatalog[0]);
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>{activeView=b.dataset.view as typeof activeView;viewer?.frame(activeView);document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));});
$('reset-camera').onclick=()=>viewer?.frame(activeView);
$('wireframe').onclick=()=>{const b=$('wireframe');const active=b.classList.toggle('active');b.setAttribute('aria-pressed',String(active));viewer?.setWireframe(active);};
$('screenshot').onclick=()=>{if(!viewer||!modelInfo){toast('请等待模型加载。');return;}const a=document.createElement('a');a.href=viewer.screenshot();a.download='soullink-face.png';a.click();toast('截图已保存');};
$('export-profile').onclick=()=>{if(!viewer)return;const p=viewer.getProfile();for(const b of p.bindings){const gain=gains[b.au]??1;for(const t of b.targets)t.weight*=gain;}downloadJSON('soullink.vrm.profile.json',p);};
$('download-morphs').onclick=()=>downloadJSON('model-morph-targets.json',{model:modelInfo?.name,morphs:viewer?.getMorphNames(),meta:modelInfo?.meta});
$('import-profile').onclick=()=>$<HTMLInputElement>('profile-file').click();
$<HTMLInputElement>('profile-file').onchange=async e=>{const input=e.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('Profile 应小于 1 MB。');const p=parseProfile(JSON.parse(await file.text()));engine.clearAU();for(const key of Object.keys(gains))delete gains[key as FACSActionUnitKey];if(viewer){viewer.setGains(gains);renderMappings(viewer.setProfile(p));toast('已应用模型映射');}}catch(error){toast(error instanceof Error?error.message:'Profile 无效');}finally{input.value='';}};
$('default-profile').onclick=()=>{engine.clearAU();for(const key of Object.keys(gains))delete gains[key as FACSActionUnitKey];if(viewer){viewer.setGains(gains);renderMappings(viewer.setProfile(vroidProfile));toast('已恢复 VRoid 默认映射');}};
$('export-state').onclick=()=>downloadJSON('soullink-face-state.json',{schema:1,time:new Date().toISOString(),model:modelInfo?.name,settings:engine.settings,state:engine.snapshot(),morphWeights:viewer?.getWeights(),history});
$('export-signals').onclick=()=>downloadJSON('soullink-arkit52.json',{protocol:'arkit52',basis:'ICT-FaceKit closest AU correspondences with approximate AU23/25/26 bridges',blendshapes:engine.snapshot().blendshapes});
$('import-signals').onclick=()=>$<HTMLInputElement>('signals-file').click();
$<HTMLInputElement>('signals-file').onchange=async e=>{const input=e.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('信号文件应小于 1 MB');engine.clearAU();engine.setBlendshapes(parseSignal(JSON.parse(await file.text())));renderUI(engine.snapshot());toast('外部表情输入已接管；点击情绪或释放输入可恢复');}catch(error){toast(error instanceof Error?error.message:'信号格式无效');}finally{input.value='';}};
$('release-signals').onclick=()=>{engine.setBlendshapes(null);toast('已释放外部表情输入');};
$('reset-all').onclick=()=>{semantic.clearHistory();engine.reset();frame=engine.snapshot();history=[];lastTraceAt=0;clearEmotionIntent();renderUI(frame);toast('情绪、AU、姿态与语义上下文已归零');};
function updatePause(){$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'恢复情绪时间':'暂停情绪时间');$('pause').setAttribute('aria-pressed',String(paused));}
$('pause').onclick=()=>{paused=!paused;updatePause();};
const guide=$<HTMLDialogElement>('guide');$('guide-button').onclick=()=>guide.showModal();$('close-guide').onclick=()=>guide.close();guide.onclick=e=>{if(e.target===guide){const r=guide.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)guide.close();}};

function renderUI(state: FrameState) {
  motionControls.render(state);
  directionControls.render(state);
  for (const [id, binding] of settingBindings) { const input=$<HTMLInputElement>(id), value=Number(engine.settings[binding.key]); if(document.activeElement!==input)input.value=String(value); $(`${id}-value`).textContent=binding.format(value); }
  for (const [id,key] of [['auto-decay','autoDecay'],['auto-blink','autoBlink'],['idle','idle']] as const) $<HTMLInputElement>(id).checked=engine.settings[key];
  $('expression-bold').setAttribute('aria-pressed', String(engine.settings.gain===4&&engine.settings.detailMix===1&&engine.settings.browGain===2&&engine.settings.eyeGain===2&&engine.settings.mouthGain===2));
  $('expression-natural').setAttribute('aria-pressed', String(engine.settings.gain===1.4&&engine.settings.detailMix===.65&&engine.settings.browGain===1&&engine.settings.eyeGain===1&&engine.settings.mouthGain===1));
  const lockedFaceAUs = state.pinnedAUs.filter(key => key.startsWith('au')).length;
  $('expression-lock-note').hidden = !lockedFaceAUs && state.source !== 'arkit52';
  $('expression-lock-note').textContent = state.source === 'arkit52' ? '外部表情输入正在接管；释放输入后可恢复情绪表情。' : `${lockedFaceAUs} 个 AU 正被手动锁定，会覆盖对应的情绪表情；可在 FACS / AU 中释放。`;
  const {vad}=state;const name=vad.dominantEmotion;$('emotion-label').textContent=emotionByName.get(name)?.label??'平静中性';$('emotion-icon').textContent=emotionByName.get(name)?.icon??'◌';
  $('intensity-value').textContent=`${Math.round(vad.intensity*100)}%`;$('intensity-bar').style.width=`${vad.intensity*100}%`;
  const remaining=vad.holdSeconds??0;const phase=state.source==='arkit52'?'ARKit 输入接管':paused?'时间已暂停':!engine.settings.autoDecay?'目标已锁定':remaining>0?`保持 ${remaining.toFixed(1)}s`:vad.intensity>.015?'自然回落':'平静基线';$('phase-label').textContent=phase;
  $('signal-source').textContent=state.source==='arkit52'?'外部 FACS / ARKit / MediaPipe 输入':'Soullink VAD 情绪驱动';$('active-signals').textContent=`${Object.values(state.blendshapes).filter(v=>v>.01).length} / ${arkitKeys.length} 通道活跃`;
  $('v-live').textContent=signed(vad.current.valence);$('a-live').textContent=signed(vad.current.arousal);$('d-live').textContent=signed(vad.current.dominance);$('fps').textContent=String(viewer?.fps??'—');
  for(const axis of axes){const input=$<HTMLInputElement>(`vad-${axis.key}`);if(document.activeElement!==input)input.value=String(vad.target[axis.key]);$( `vad-${axis.key}-value`).textContent=signed(vad.target[axis.key]);}
  if(coordinateMode!=='3d'){const axes=planeAxes[coordinateMode];for(const [id,value] of [['vad-current',vad.current],['vad-target',vad.target]] as [string,VADVector][]){const p=planePosition(value,coordinateMode);$(id).style.left=`${5+p.x*90}%`;$(id).style.top=`${5+p.y*90}%`;}field.setAttribute('aria-valuenow',String(vad.target[axes.x]));field.setAttribute('aria-valuetext',`${axes.xLabel} ${vad.target[axes.x].toFixed(2)}，${axes.yLabel} ${vad.target[axes.y].toFixed(2)}`);}else space.update(vad.current,vad.target);
  $('dominance-status').textContent=`D ${signed(vad.current.dominance)} · ${vad.current.dominance>.12?'偏向主导':vad.current.dominance<-.12?'偏向退让':'相对中性'}`;
  $('blend-values').replaceChildren();for(const contribution of state.details.blend){const chip=document.createElement('span');chip.textContent=`${contribution.label} ${Math.round(contribution.weight*100)}%`;$('blend-values').append(chip);}if(!state.details.blend.length)$('blend-values').textContent='平静基线';
  for(const key of ['brow','eyes','mouth'] as const)$( `region-${key}`).style.width=`${state.details.regions[key]*100}%`;
  for(const [key,input] of auInputs){const pinned=engine.isPinned(key);if(document.activeElement!==input&&!pinned)input.value=String(state.aus[key]);auOutputs.get(key)!.textContent=state.aus[key].toFixed(2);const pin=input.parentElement!.querySelector('button')!;pin.classList.toggle('pinned',pinned);pin.textContent=pinned?'●':'○';pin.setAttribute('aria-pressed',String(pinned));}
}
const canvas=$<HTMLCanvasElement>('trace');const context=canvas.getContext('2d');
function drawTrace() {
  if(!context)return;const width=canvas.clientWidth,height=canvas.clientHeight;const ratio=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  const ctx=context;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);const left=22,right=width-10,top=8,bottom=height-20;
  ctx.font='8px monospace';ctx.fillStyle='#c0b4ca';ctx.strokeStyle='#eee8f4';ctx.lineWidth=1;
  for(const val of [-1,0,1]){const y=top+(1-val)/2*(bottom-top);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText(val===1?'+1':String(val),0,y+3);}
  for(let i=0;i<=6;i++){const x=left+(right-left)*i/6;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();if(i<6)ctx.fillText(`${-30+i*5}s`,x,bottom+14);}
  const now=frame.time;for(const [key,color] of [['v','#9571c3'],['a','#dca37f'],['d','#88afa6']] as const){ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();let first=true;for(const point of history){const x=left+(point.time-(now-30))/30*(right-left),y=top+(1-point[key])/2*(bottom-top);if(x<left)continue;if(first){ctx.moveTo(x,y);first=false;}else ctx.lineTo(x,y);}ctx.stroke();}
}
let prev=performance.now(),lastUI=0;
function tick(now:number){const delta=Math.min((now-prev)/1000,0.1);prev=now;frame=engine.update(paused?0:delta);viewer?.render(frame,paused?0:delta);
  if(frame.time-lastTraceAt>=0.1){lastTraceAt=frame.time;history.push({time:frame.time,v:frame.vad.current.valence,a:frame.vad.current.arousal,d:frame.vad.current.dominance});history=history.filter(p=>p.time>=frame.time-31);}
  if(now-lastUI>80){lastUI=now;renderUI(frame);drawTrace();}requestAnimationFrame(tick);}
document.addEventListener('visibilitychange',()=>{prev=performance.now();});requestAnimationFrame(tick);renderUI(frame);

/** For LLM planners and app integrations: direct local parameter API, no credentials needed. */
function override<T>(action: () => T): T { semantic.cancelPending(); return action(); }
const api={
  triggerEmotion:(emotion:string,intensity=1)=>override(()=>engine.triggerEmotion(emotion,intensity)),
  setVAD:(vad:Partial<VADVector>)=>override(()=>engine.setVAD(vad)),
  setAU:(key:FACSActionUnitKey,value:number|null)=>override(()=>engine.setAU(key,value)),
  setGaze:(x:number,y:number)=>override(()=>engine.setGaze(x,y)),
  setPose:(x:number,y:number,z:number)=>override(()=>engine.setPose(x,y,z)),
  setHeadAngles:(angles:Partial<HeadAngles>)=>override(()=>engine.setHeadAngles(angles)),
  setGazeDegrees:(angles:Partial<EyeAngles>)=>override(()=>engine.setGazeDegrees(angles)),
  headDirection:(direction:Direction,degrees=20)=>override(()=>engine.headDirection(direction,degrees)),
  gazeDirection:(direction:Direction,degrees=15)=>override(()=>engine.gazeDirection(direction,degrees)),
  releaseHeadControl:()=>override(()=>engine.releaseHeadControl()),
  releaseGazeControl:()=>override(()=>engine.releaseGazeControl()),
  getRigState:()=>viewer?.getRigState()??null,
  glance:(x:number,y:number,seconds?:number,options:GazeOptions={})=>override(()=>engine.glance(x,y,seconds,options)),
  playAction:(name:ActionName,options:ActionOptions={})=>override(()=>engine.playAction(name,options)),
  stopActions:()=>override(()=>engine.stopActions()),
  configure:(settings:Partial<LabSettings>)=>configureSettings(settings),getSettings:()=>({...engine.settings}),getState:()=>engine.snapshot(),getMorphWeights:()=>viewer?.getWeights(),
  setBlendshapes:(weights:Record<string,unknown>|null)=>override(()=>engine.setBlendshapes(weights)),
  setFACS:(aus:Record<string,unknown>)=>override(()=>engine.setBlendshapes(facsToARKit(aus))),
  setMediaPipeResult:(result:unknown)=>override(()=>engine.setBlendshapes(parseSignal(result))),
  getBlendshapes:()=>({...engine.snapshot().blendshapes}),getModels:()=>modelCatalog.map(m=>({id:m.id,name:m.name,morphs:m.morphs})),
  loadModel:(id:string)=>{const model=modelCatalog.find(m=>m.id===id);if(!model)throw new Error('Unknown model');return loadBuiltin(model);},
  reactToText:(text:string,options:{mode?:SemanticMode;persona?:string}={})=>semantic.analyze(text,options),
  analyzeText:(text:string,options:{mode?:SemanticMode;persona?:string}={})=>semantic.analyze(text,{...options,apply:false}),
  getSemanticState:()=>structuredClone(semantic.state),clearSemanticHistory:()=>semantic.clearHistory(),cancelSemantic:()=>semantic.cancelPending(),
  reset:()=>{ $('reset-all').click(); }
};
Object.assign(window,{soullinkFace:api});
