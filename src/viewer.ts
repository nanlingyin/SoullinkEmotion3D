import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { computeMorphWeights, resolveProfile, vroidProfile, type ModelProfile, type ResolvedBinding } from './profile';
import { clamp, type FrameState, type FACSActionUnitKey } from './engine';
import { normalizeLegacyMorphNames, canonicalMorphName } from './model-utils';
import { directShapeChannel } from './arkit';

type MorphMesh = THREE.Mesh & { morphTargetDictionary: Record<string, number>; morphTargetInfluences: number[] };
export interface ModelInfo { name: string; morphs: number; triangles: number; bindings: ResolvedBinding[]; fallback: boolean; meta: unknown;directChannels:number }

export class FaceViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private controls: OrbitControls;
  private loader = new GLTFLoader();
  private vrm: VRM | null = null;
  private morphs: MorphMesh[] = [];
  private baseline = new Map<MorphMesh, number[]>();
  private originalInfluences: Set<string> = new Set();
  private head = new THREE.Vector3(0, 1.4, 0);
  private height = 1.6;
  private loadGeneration = 0;
  private profile: ModelProfile = vroidProfile;
  private resolved: ResolvedBinding[] = [];
  private gains: Partial<Record<FACSActionUnitKey, number>> = {};
  private fallback = false;
  private info: ModelInfo | null = null;
  private wireframe = false;
  private zoom: 'face' | 'bust' | 'full' = 'face';
  private lastWeights: Record<string, number> = {};
  private frames = 0;
  private frameTimer = 0;
  fps = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-label', '可旋转和缩放的 3D 角色视图');
    this.container.append(this.renderer.domElement);
    this.camera.position.set(0, 1.45, 0.85);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.head);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.18; this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.75;
    this.scene.add(new THREE.HemisphereLight(0xfffcf6, 0xc0b8d2, 2));
    const key = new THREE.DirectionalLight(0xfffcf4, 2.2); key.position.set(-1, 2, 3); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9c3ff, 0.65); fill.position.set(2, 1.6, -1); this.scene.add(fill);
    this.loader.register(parser=>({name:'SOULLINK_legacy_morph_names',beforeRoot:async()=>{normalizeLegacyMorphNames(parser.json);}}));
    this.loader.register(parser => new VRMLoaderPlugin(parser));
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
  }
  private resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  async load(url: string, onProgress: (p: number) => void): Promise<ModelInfo | null> {
    const generation = ++this.loadGeneration;
    const gltf = await this.loader.loadAsync(url, progress => onProgress(progress.total ? progress.loaded / progress.total : 0));
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('该文件不是有效的 VRM 0.x / 1.0 模型。'); }
    if (generation !== this.loadGeneration) { VRMUtils.deepDispose(vrm.scene); return null; }
    VRMUtils.rotateVRM0(vrm);
    if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
    this.lastWeights={};this.vrm = vrm; this.scene.add(vrm.scene);
    this.morphs = []; this.baseline.clear();
    let triangles = 0; const names = new Set<string>();
    vrm.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          const m = mesh as MorphMesh; this.morphs.push(m); this.baseline.set(m, [...m.morphTargetInfluences]);
          Object.keys(m.morphTargetDictionary).forEach(n => names.add(n));
        }
      }
    });
    this.originalInfluences = names;
    this.resolved = resolveProfile(this.profile, names);
    this.fallback = this.resolved.filter(b => b.supported).length < 4;
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (left) left.rotation.z = -1.22;
    if (right) right.rotation.z = 1.22;
    vrm.update(0); vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    this.height = Math.max(0.5, box.max.y - box.min.y);
    const headNode = vrm.humanoid.getNormalizedBoneNode('head');
    if (headNode) headNode.getWorldPosition(this.head);
    else this.head.set(0, box.max.y - this.height * 0.1, 0);
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
    this.setWireframe(this.wireframe); this.frame(this.zoom);
    this.info = { name: vrm.meta?.metaVersion === '1' ? vrm.meta.name : vrm.meta?.title ?? 'Imported VRM', morphs: names.size, triangles: Math.round(triangles), bindings: this.resolved, fallback: this.fallback, meta: vrm.meta,directChannels:new Set([...names].map(directShapeChannel).filter(Boolean)).size };
    return this.info;
  }
  setProfile(profile: ModelProfile) {
    // Return only previously owned targets to their captured default, preserving all other channels.
    this.restoreManaged(); this.profile = profile;
    this.resolved = resolveProfile(profile, this.originalInfluences);
    this.fallback = this.resolved.filter(b => b.supported).length < 4;
    if (this.info) { this.info.bindings = this.resolved; this.info.fallback = this.fallback; }
    return this.resolved;
  }
  getProfile() { return structuredClone(this.profile); }
  getMorphNames() { return [...this.originalInfluences].sort(); }
  setGains(gains: Partial<Record<FACSActionUnitKey, number>>) { this.gains = gains; }
  frame(mode: 'face' | 'bust' | 'full') {
    this.zoom = mode;
    const target = this.head.clone();
    if (mode === 'face') target.y += this.height * 0.04;
    if (mode === 'bust') target.y -= this.height * 0.10;
    if (mode === 'full') target.y = this.height * 0.48;
    const distance = this.height * (mode === 'face' ? 0.47 : mode === 'bust' ? 0.9 : 2.25);
    this.camera.position.copy(target).add(new THREE.Vector3(0, 0, distance));
    this.controls.target.copy(target); this.controls.update();
  }
  setWireframe(value: boolean) {
    this.wireframe = value;
    this.vrm?.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const material of (Array.isArray(m.material) ? m.material : [m.material])) if ('wireframe' in material) (material as THREE.MeshStandardMaterial).wireframe = value;
    });
  }
  private restoreManaged() {
    for (const m of this.morphs) for (const name of Object.keys(this.lastWeights)) {
      const index = m.morphTargetDictionary[name];
      if (index !== undefined) m.morphTargetInfluences[index] = this.baseline.get(m)?.[index] ?? 0;
    }
    this.lastWeights = {};
  }
  render(frame: FrameState, realDelta: number) {
    this.frames++; this.frameTimer += realDelta;
    if (this.frameTimer >= 0.5) { this.fps = Math.round(this.frames / this.frameTimer); this.frames = 0; this.frameTimer = 0; }
    if (this.vrm) {
      const vrm = this.vrm;
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      const chest = vrm.humanoid.getNormalizedBoneNode('chest');
      if (head) head.rotation.set(-frame.pose.x * 0.25, frame.pose.y * 0.32, frame.pose.z * 0.21);
      if (chest) chest.rotation.x = Math.sin(frame.time * 1.4) * 0.007;
      if (vrm.lookAt) { vrm.lookAt.yaw = frame.gaze.x * 45; vrm.lookAt.pitch = -frame.gaze.y * 35; }
      const manager = vrm.expressionManager;
      if (manager) for (const key of Object.keys(manager.expressionMap)) manager.setValue(key, 0);
      if (this.fallback && manager) {
        manager.setValue('happy', clamp(frame.aus.au12LipCornerPuller * 1.2));
        manager.setValue('angry', clamp(frame.aus.au04BrowLowerer));
        manager.setValue('sad', clamp(Math.max(frame.aus.au01InnerBrowRaiser, frame.aus.au15LipCornerDepressor)));
        manager.setValue('surprised', clamp(frame.aus.au05UpperLidRaiser));
        manager.setValue('blink', clamp(frame.aus.au45Blink));
        manager.setValue('aa', clamp(frame.aus.au26JawDrop));
      }
      // Let VRM update spring bones / normalized skeleton and clear preset morphs first.
      vrm.update(Math.min(Math.max(realDelta, 0), 0.05));
      const weights = computeMorphWeights(frame.aus, this.resolved, this.gains);
      // Low arousal adds a partial relaxed lid shape, independently of AU45 blinks.
      const relaxed=[...this.originalInfluences].find(name=>canonicalMorphName(name)==='Fcl_EYE_Sorrow');
      if(relaxed&&frame.source==='emotion')weights[relaxed]=clamp(frame.details.eyelidRelaxation*(1-frame.aus.au45Blink));
      // Direct ARKit / ICT shapes take precedence over stylized AU proxies when they exist.
      for(const name of this.originalInfluences){const channel=directShapeChannel(name);if(channel&&(frame.source==='arkit52'||!(name in weights)))weights[name]=frame.blendshapes[channel];}
      if(frame.source==='arkit52'){
        const full=[...this.originalInfluences].find(name=>canonicalMorphName(name)==='Fcl_EYE_Close');
        const left=[...this.originalInfluences].find(name=>canonicalMorphName(name)==='Fcl_EYE_Close_L');
        const right=[...this.originalInfluences].find(name=>canonicalMorphName(name)==='Fcl_EYE_Close_R');
        if(left&&right){if(full)weights[full]=0;weights[left]=frame.blendshapes.eyeBlinkLeft;weights[right]=frame.blendshapes.eyeBlinkRight;}
      }
      this.restoreManaged();
      for (const m of this.morphs) for (const [name, value] of Object.entries(weights)) {
        const index = m.morphTargetDictionary[name];
        if (index !== undefined) m.morphTargetInfluences[index] = value;
      }
      this.lastWeights = weights;
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
  getWeights() { return { ...this.lastWeights }; }
  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
