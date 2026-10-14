import type { FACSActionUnitState, FACSActionUnitKey, PartialFACSActionUnitState } from '../vendor/soullink/facs/FACSActionUnitState';
import { createDefaultActionUnitState } from '../vendor/soullink/facs/defaultActionUnitState';
/** Apple ARKit names. MediaPipe's _neutral is not a face shape; its list lacks tongueOut. */
export const arkitKeys=[
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight','cheekPuff','cheekSquintLeft','cheekSquintRight',
  'eyeBlinkLeft','eyeBlinkRight','eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight',
  'jawForward','jawLeft','jawOpen','jawRight','mouthClose','mouthDimpleLeft','mouthDimpleRight','mouthFrownLeft','mouthFrownRight','mouthFunnel','mouthLeft','mouthLowerDownLeft','mouthLowerDownRight','mouthPressLeft','mouthPressRight','mouthPucker','mouthRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper','mouthSmileLeft','mouthSmileRight','mouthStretchLeft','mouthStretchRight','mouthUpperUpLeft','mouthUpperUpRight','noseSneerLeft','noseSneerRight','tongueOut'
] as const;
export type ARKitKey=typeof arkitKeys[number];export type ARKitState=Record<ARKitKey,number>;
const clamp=(v:number)=>Math.min(1,Math.max(0,Number.isFinite(v)?v:0));
export const auChannels:Partial<Record<FACSActionUnitKey,ARKitKey[]>>={
  au01InnerBrowRaiser:['browInnerUp'],au02OuterBrowRaiser:['browOuterUpLeft','browOuterUpRight'],au04BrowLowerer:['browDownLeft','browDownRight'],au05UpperLidRaiser:['eyeWideLeft','eyeWideRight'],au06CheekRaiser:['cheekSquintLeft','cheekSquintRight'],au07LidTightener:['eyeSquintLeft','eyeSquintRight'],au09NoseWrinkler:['noseSneerLeft','noseSneerRight'],au10UpperLipRaiser:['mouthShrugUpper'],au12LipCornerPuller:['mouthSmileLeft','mouthSmileRight'],au14Dimpler:['mouthDimpleLeft','mouthDimpleRight'],au15LipCornerDepressor:['mouthFrownLeft','mouthFrownRight'],au17ChinRaiser:['mouthShrugLower'],au18LipPucker:['mouthPucker'],au20LipStretcher:['mouthStretchLeft','mouthStretchRight'],au23LipTightener:['mouthPressLeft','mouthPressRight'],au24LipPressor:['mouthPressLeft','mouthPressRight'],au25LipsPart:['jawOpen'],au26JawDrop:['jawOpen'],au27MouthStretch:['jawOpen'],au45Blink:['eyeBlinkLeft','eyeBlinkRight']
};
/** ICT-FaceKit's published closest correspondences, plus explicitly approximate AU23/25/26 bridges. */
export function ausToARKit(au:FACSActionUnitState):ARKitState {
  const result=Object.fromEntries(arkitKeys.map(key=>[key,0])) as ARKitState;
  for(const [key,channels] of Object.entries(auChannels))for(const channel of channels)result[channel]=Math.max(result[channel],clamp(au[key as FACSActionUnitKey]));
  result.jawOpen=clamp(au.au25LipsPart*.2+au.au26JawDrop*.75+au.au27MouthStretch);
  result.mouthPressLeft=result.mouthPressRight=clamp(Math.max(au.au24LipPressor,au.au23LipTightener*.7));
  const x=Math.max(-1,Math.min(1,au.gazeX)),y=Math.max(-1,Math.min(1,au.gazeY));
  // Left/right are the character's anatomical sides, as defined by Apple and ICT.
  result.eyeLookOutLeft=result.eyeLookInRight=Math.max(0,x);result.eyeLookOutRight=result.eyeLookInLeft=Math.max(0,-x);
  result.eyeLookUpLeft=result.eyeLookUpRight=Math.max(0,y);result.eyeLookDownLeft=result.eyeLookDownRight=Math.max(0,-y);
  return result;
}
export function arkitToAUs(state:ARKitState):FACSActionUnitState {
  const au=createDefaultActionUnitState();
  for(const [key,channels] of Object.entries(auChannels))au[key as FACSActionUnitKey]=Math.max(...channels.map(channel=>state[channel]));
  au.au25LipsPart=state.jawOpen*.35;au.au26JawDrop=state.jawOpen;au.au27MouthStretch=state.jawOpen*.25;
  au.au23LipTightener=0; // AU23 is not independently observed by an ARKit mouthPress coefficient.
  au.gazeX=Math.max(state.eyeLookOutLeft,state.eyeLookInRight)-Math.max(state.eyeLookOutRight,state.eyeLookInLeft);
  au.gazeY=Math.max(state.eyeLookUpLeft,state.eyeLookUpRight)-Math.max(state.eyeLookDownLeft,state.eyeLookDownRight);
  return au;
}
export function normalizeARKit(input:Record<string,unknown>):ARKitState {
  const result=Object.fromEntries(arkitKeys.map(key=>[key,0])) as ARKitState;const allowed=new Set<string>(arkitKeys);
  for(const [name,value] of Object.entries(input)){
    if(name==='_neutral')continue;
    if(!allowed.has(name))throw new Error(`未知 ARKit 通道：${name}`);
    if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`${name} 必须是有限数值`);
    result[name as ARKitKey]=clamp(value);
  }
  return result;
}
/** Match direct ARKit and ICT _L/_R morph names without guessing VRoid proxies. */
export function directShapeChannel(name:string):ARKitKey|null {
  if((arkitKeys as readonly string[]).includes(name))return name as ARKitKey;
  const normalized=name.replace(/_L$/,'Left').replace(/_R$/,'Right');
  if(normalized==='browInnerUpLeft'||normalized==='browInnerUpRight')return 'browInnerUp';
  if(normalized==='cheekPuffLeft'||normalized==='cheekPuffRight')return 'cheekPuff';
  return (arkitKeys as readonly string[]).includes(normalized)?normalized as ARKitKey:null;
}
const ictFACS:Record<number,ARKitKey[]>={1:['browInnerUp'],2:['browOuterUpLeft','browOuterUpRight'],4:['browDownLeft','browDownRight'],5:['eyeWideLeft','eyeWideRight'],6:['cheekSquintLeft','cheekSquintRight'],7:['eyeSquintLeft','eyeSquintRight'],9:['noseSneerLeft','noseSneerRight'],10:['mouthShrugUpper'],11:['mouthUpperUpLeft','mouthUpperUpRight'],12:['mouthSmileLeft','mouthSmileRight'],14:['mouthDimpleLeft','mouthDimpleRight'],15:['mouthFrownLeft','mouthFrownRight'],16:['mouthLowerDownLeft','mouthLowerDownRight'],17:['mouthShrugLower'],18:['mouthPucker'],20:['mouthStretchLeft','mouthStretchRight'],22:['mouthFunnel'],23:['mouthPressLeft','mouthPressRight'],24:['mouthPressLeft','mouthPressRight'],25:['jawOpen'],26:['jawOpen'],27:['jawOpen'],28:['mouthRollLower','mouthRollUpper'],29:['jawForward'],30:['jawLeft'],33:['cheekPuff'],45:['eyeBlinkLeft','eyeBlinkRight'],61:['eyeLookOutLeft','eyeLookInRight'],62:['eyeLookOutRight','eyeLookInLeft'],63:['eyeLookUpLeft','eyeLookUpRight'],64:['eyeLookDownLeft','eyeLookDownRight']};
export function facsToARKit(input:Record<string,unknown>):ARKitState {
  const output=normalizeARKit({});
  for(const [code,value] of Object.entries(input)){
    const match=code.match(/^(?:AU)?(\d{1,2})([LR])?$/i);const number=match?Number(match[1]):NaN;
    if(!ictFACS[number])throw new Error(`未支持的 FACS 通道：${code}`);
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new Error(`${code} 需要归一化到 0–1；OpenFace 0–5 数据应先除以 5`);
    let channels=ictFACS[number];const side=match![2]?.toUpperCase();
    if(number===30&&side==='R')channels=['jawRight'];
    else if(side){const suffix=side==='L'?'Left':'Right';channels=channels.filter(channel=>channel.endsWith(suffix));if(!channels.length)throw new Error(`${code} 不能在 ARKit 52 中独立分侧`);}
    const gain=number===23?.7:number===25?.2:number===26?.75:1;
    for(const channel of channels)output[channel]=Math.max(output[channel],clamp(value*gain));
  }
  return output;
}
export function parseSignal(data:unknown):ARKitState {
  if(typeof data!=='object'||data===null||Array.isArray(data))throw new Error('信号必须是 JSON 对象');
  const packet=data as {protocol?:string;aus?:Record<string,unknown>;blendshapes?:Record<string,unknown>;faceBlendshapes?:{categories:{categoryName:string;score:number}[]}[]};
  if(packet.faceBlendshapes?.[0]?.categories){const categories=packet.faceBlendshapes[0].categories;if(!Array.isArray(categories)||categories.length>100)throw new Error('MediaPipe categories 无效');return normalizeARKit(Object.fromEntries(categories.map(category=>[category.categoryName,category.score])));}
  if(packet.protocol==='arkit52'&&packet.blendshapes&&typeof packet.blendshapes==='object'&&!Array.isArray(packet.blendshapes))return normalizeARKit(packet.blendshapes);
  if(packet.protocol==='facs'&&packet.aus&&typeof packet.aus==='object'&&!Array.isArray(packet.aus))return facsToARKit(packet.aus);
  throw new Error('请提供 FACS / ARKit 52 参数或 MediaPipe faceBlendshapes 结果');
}
