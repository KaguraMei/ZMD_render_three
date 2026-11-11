import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Bounds, Center, OrbitControls, useGLTF } from '@react-three/drei'
import { Box, CircleHelp, ChevronDown, Eye, EyeOff, Focus, Gauge, Grid2X2, Layers3, Lightbulb, LoaderCircle, Maximize2, RotateCcw, Scan, Sun, X } from 'lucide-react'
import * as THREE from 'three'
import { TextureLoader } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { configureCharacterMaterial } from './shaders/characterToon.js'
import { createCharacterComposer } from './shaders/endfieldPost.js'

const MODEL_URL = '/models/ZhuangFangyi_render.glb'
const auxiliaryTexturePaths = [
  '/textures/T_actor_common_female_face_01_SDF.png',
  '/textures/T_actor_zhuangfy_hair_01_P.png',
  '/textures/T_actor_zhuangfy_cloth_01_P.png',
  '/textures/T_actor_zhuangfy_cloth_02_P.png',
  '/textures/T_actor_laevat_hair_01_ST.png',
  '/textures/Copper_Matcap.png',
  '/textures/T_actor_zhuangfy_cloth_01_E.png',
  '/textures/toon_character_ramp.png',
]
const labels = {
  Armor: '装甲', Clothing: '服装', Eye_HL: '眼部高光', Face: '面部', Gloves: '手套',
  Hair: '头发', HeadAcc: '头部配饰', Horn: '角饰', LowerArmour: '下装护甲',
  Shoes: '鞋靴', Tail: '尾饰', TopClothing: '上装', ZhuangFangyi_Body: '身体',
}

function findPartName(object, root) {
  let node = object.parent
  while (node && node !== root) {
    const candidate = node.name.replace(/^EXP_/, '')
    if (labels[candidate]) return candidate
    node = node.parent
  }
  return object.name.replace(/^EXP_/, '') || 'Mesh'
}

function isExcludedSourceMesh(object, root) {
  let node = object
  while (node && node !== root) {
    if (/futa|dick|genital|physics/i.test(node.name)) return true
    node = node.parent
  }
  return false
}

function Model({ showMeshes, wireframe, toon, faceSdfEnabled, hairSpecular, dayStrength, fillStrength, rimStrength, scatterStrength, outlinePixels, castShadows, onReady, onSelect }) {
  const { scene } = useGLTF(MODEL_URL)
  const [faceSdf, hairParams, cloth01Params, cloth02Params, hairSpecMask, eyeMatcap, clothEmission, rampAtlas] = useLoader(TextureLoader, auxiliaryTexturePaths)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    ;[faceSdf, hairParams, cloth01Params, cloth02Params, hairSpecMask].forEach((texture) => {
      texture.flipY = false
      texture.colorSpace = THREE.NoColorSpace
      texture.needsUpdate = true
    })
    ;[eyeMatcap, clothEmission, rampAtlas].forEach((texture) => {
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
    })
    clone.traverse((object) => {
      if (!object.isMesh) return
      const original = Array.isArray(object.material) ? object.material : [object.material]
      const partName = findPartName(object, clone)
      const repaired = original.map((source) => {
        const material = source.clone()
        material.wireframe = wireframe
        const name = material.name.toLowerCase()
        const eyeWhite = name.includes('eyewhite')
        const eyeHighlight = name.includes('目hl') || name.includes('eye_hl') || name.startsWith('zf_hl')
        const irisMaterial = name.includes('iris')
        const isFace = name.includes('gs_face')
        const isHair = partName === 'Hair' && name.includes('hair')
        const isSkin = name.includes('skin')
        const isOutline = name.includes('outline')
        const clothParams = name.includes('zhuangfy_cloth_01') ? cloth01Params
          : name.includes('zhuangfy_cloth_02') ? cloth02Params : null

        // The render GLB contains the matching albedo and normal maps. Keep
        // those authored material bindings; only attach the two external maps
        // that are not part of the export.
        if (isFace) material.userData.faceSdfMap = faceSdf
        if (isHair) {
          material.userData.hairParamsMap = hairParams
          material.userData.hairSpecMask = hairSpecMask
        }
        if (clothParams) material.userData.clothParamsMap = clothParams
        if (clothParams && name.includes('cloth_01')) {
          material.emissiveMap = clothEmission
          material.emissive.set('#b8a6ff')
          material.emissiveIntensity = 0.7
        }
        if (isSkin) {
          material.color.set('#ffffff')
          material.roughness = 0.76
        }
        if (irisMaterial) {
          material.dispose()
          const iris = new THREE.MeshStandardMaterial({
            name: source.name, map: source.map || source.emissiveMap, color: '#ffffff',
            roughness: 0.22, metalness: 0, side: source.side, stencilWrite: true,
            stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
          })
          return configureCharacterMaterial(iris, {
            toon, faceSdfEnabled, hairSpecular, faceSdf, hairParams, hairSpecMask,
            eyeMatcap, rampAtlas, outlinePixels, dayStrength, fillStrength, rimStrength,
            scatterStrength, isIris: true,
          })
        } else if (eyeWhite || eyeHighlight) {
          // These two eye layers store their visible color in emissive maps.
          // Keep that source map; clearing it turns the sclera/highlight black.
          const eyeMap = source.emissiveMap || source.map
          material.dispose()
          return new THREE.MeshBasicMaterial({
            name: source.name, map: eyeMap, color: '#ffffff', side: source.side,
            transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
            depthWrite: source.depthWrite, toneMapped: false,
            stencilWrite: eyeWhite, stencilRef: 1,
            stencilFunc: eyeHighlight ? THREE.EqualStencilFunc : THREE.AlwaysStencilFunc,
            stencilZPass: eyeWhite ? THREE.ReplaceStencilOp : THREE.KeepStencilOp,
          })
        }
        if (isOutline) {
          material.visible = false
          return material
        }
        return configureCharacterMaterial(material, {
          toon: toon && !isOutline, faceSdfEnabled, hairSpecular, faceSdf, hairParams, hairSpecMask,
          eyeMatcap, rampAtlas, outlinePixels,
          clothParams,
          dayStrength, fillStrength, rimStrength, scatterStrength,
          isFace, isHair, isSkin, isOutline,
        })
      })
      object.material = Array.isArray(object.material) ? repaired : repaired[0]
    })
    return clone
  }, [scene, faceSdf, hairParams, cloth01Params, cloth02Params, hairSpecMask, eyeMatcap, clothEmission, rampAtlas, wireframe, toon, faceSdfEnabled, hairSpecular, dayStrength, fillStrength, rimStrength, scatterStrength])

  const meshRows = useMemo(() => {
    const groups = new Map()
    model.traverse((object) => {
      if (!object.isMesh || isExcludedSourceMesh(object, model)) return
      const name = findPartName(object, model)
      const row = groups.get(name) || { name, ids: [], materials: new Set() }
      row.ids.push(object.uuid)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) row.materials.add(material?.name || 'Material')
      groups.set(name, row)
    })
    return [...groups.values()].map((row) => ({ ...row, materials: [...row.materials].join(', ') }))
  }, [model])

  useEffect(() => {
    model.traverse((object) => {
      if (!object.isMesh) return
      if (isExcludedSourceMesh(object, model)) {
        object.visible = false
        return
      }
      const partName = findPartName(object, model)
      object.visible = !isExcludedSourceMesh(object, model) && (showMeshes[partName] ?? partName !== 'Armor')
      object.castShadow = castShadows
      object.renderOrder = partName === 'Eye_HL' ? 2 : partName === 'Face' ? 1 : 0
      if (!object.userData.viewerOriginalMaterial) object.userData.viewerOriginalMaterial = object.material
      if (wireframe) {
        object.userData.viewerWireMaterial ||= new THREE.MeshBasicMaterial({ color: '#dce6f1', wireframe: true, side: THREE.DoubleSide })
        object.material = object.userData.viewerWireMaterial
      } else object.material = object.userData.viewerOriginalMaterial
    })
    onReady(meshRows, model)
  }, [model, showMeshes, wireframe, castShadows, meshRows, onReady])

  return (
    <primitive object={model} onPointerDown={(event) => {
      event.stopPropagation()
      const object = event.object
      onSelect({ name: findPartName(object, model), material: object.material?.name || 'Material' })
    }} />
  )
}

function StageContents({ showMeshes, wireframe, toon, faceSdfEnabled, hairSpecular, dayStrength, fillStrength, rimStrength, scatterStrength, outlinePixels, iblStrength, bloom, shadows, showGrid, lightLevel, modelRoot, onReady, onSelect, orbitRef, stageTint }) {
  const lightRef = useRef()
  const composerRef = useRef(null)
  const { gl, scene, camera, size } = useThree()
  const lightScale = lightLevel / 72
  useEffect(() => {
    const composer = createCharacterComposer(gl, scene, camera, size, bloom, modelRoot)
    composerRef.current = composer
    return () => {
      composer.dispose()
      composerRef.current = null
    }
  }, [gl, scene, camera, bloom, modelRoot])
  useEffect(() => {
    if (composerRef.current?.outlinePass) {
      composerRef.current.outlinePass.enabled = outlinePixels > 0.05
      composerRef.current.outlinePass.edgeThickness = Math.max(1, outlinePixels)
    }
  }, [outlinePixels, modelRoot])
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const environmentTarget = pmrem.fromScene(room, 0.04)
    scene.environment = environmentTarget.texture
    scene.environmentIntensity = iblStrength / 100
    return () => {
      if (scene.environment === environmentTarget.texture) scene.environment = null
      environmentTarget.dispose()
      pmrem.dispose()
      room.dispose()
    }
  }, [gl, scene])
  useEffect(() => { scene.environmentIntensity = iblStrength / 100 }, [scene, iblStrength])
  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height)
  }, [size])
  useFrame((_, delta) => composerRef.current?.render(delta), 1)
  return (
    <>
      <color attach="background" args={[stageTint]} />
      <fog attach="fog" args={[stageTint, 13, 27]} />
      <ambientLight intensity={0.38 * lightScale} />
      <hemisphereLight args={['#f5f3ef', '#77716b', 0.28 * lightScale]} />
      <directionalLight ref={lightRef} position={[4.8, 7.2, 4]} intensity={2.2 * lightScale} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-near={0.5} shadow-camera-far={25} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={8} shadow-camera-bottom={-4} shadow-bias={-0.0001} shadow-normalBias={0.035} />
      <directionalLight position={[-4, 3, -3]} intensity={0.24 * lightScale} color="#e6e8ed" />
      <spotLight position={[-2, 5, 5]} angle={0.65} penumbra={0.9} intensity={1.1 * lightScale} color="#fff3e8" castShadow={shadows} shadow-mapSize={[1024, 1024]} shadow-bias={-0.00015} shadow-normalBias={0.03} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={0.32} />
      </mesh>
      {showGrid && <gridHelper args={[14, 28, '#45454a', '#29292d']} position={[0, -0.085, 0]} />}
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={0.95}>
          <Center top>
          <Model showMeshes={showMeshes} wireframe={wireframe} toon={toon} faceSdfEnabled={faceSdfEnabled} hairSpecular={hairSpecular} dayStrength={dayStrength / 100} fillStrength={fillStrength / 100} rimStrength={rimStrength / 100} scatterStrength={scatterStrength / 100} outlinePixels={outlinePixels} castShadows={shadows} onReady={onReady} onSelect={onSelect} />
          </Center>
        </Bounds>
      </Suspense>
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.075} minDistance={1.4} maxDistance={14} maxPolarAngle={Math.PI * 0.49} target={[0, 0.95, -0.35]} />
    </>
  )
}

function Stage(props) {
  return (
    <Canvas
      shadows={props.shadows}
      dpr={[1, 1.65]}
      camera={{ position: [0.8, 1.8, 7], fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, stencil: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.NoToneMapping }}
    >
      <StageContents {...props} />
    </Canvas>
  )
}

export default function App() {
  const [showMeshes, setShowMeshes] = useState({})
  const [meshRows, setMeshRows] = useState([])
  const [selected, setSelected] = useState({ name: '庄方宜', material: '选择一个部件以查看材质' })
  const [wireframe, setWireframe] = useState(false)
  const [toon, setToon] = useState(true)
  const [faceSdfEnabled, setFaceSdfEnabled] = useState(true)
  const [hairSpecular, setHairSpecular] = useState(true)
  const [dayStrength, setDayStrength] = useState(78)
  const [fillStrength, setFillStrength] = useState(34)
  const [rimStrength, setRimStrength] = useState(12)
  const [scatterStrength, setScatterStrength] = useState(18)
  const [outlinePixels, setOutlinePixels] = useState(1.8)
  const [iblStrength, setIblStrength] = useState(42)
  const [bloom, setBloom] = useState(true)
  const [shadows, setShadows] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [lightLevel, setLightLevel] = useState(72)
  const [panelOpen, setPanelOpen] = useState(true)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [modelRoot, setModelRoot] = useState(null)
  const [stageTint, setStageTint] = useState('#38383a')
  const orbitRef = useRef()
  const modelBoundsRef = useRef(null)
  const readyCallback = useMemo(() => (rows, model) => {
    model.updateWorldMatrix(true, true)
    modelBoundsRef.current = new THREE.Box3().setFromObject(model)
    setMeshRows((current) => current.length ? current : rows)
    setModelRoot(model)
    setModelLoaded(true)
  }, [])
  const onSelect = useMemo(() => (item) => setSelected(item), [])
  const maps = [
    ['身体底色（烘焙）', 'body_skin_albedo.png'],
    ['服装底色', 'T_actor_zhuangfy_cloth_01_D.png'],
    ['服装法线', 'T_actor_zhuangfy_cloth_01_N.png'],
    ['脸部底色', 'T_actor_zhuangfy_face_01_D.png'],
    ['头发底色', 'T_actor_zhuangfy_hair_01_D.png'],
    ['头发法线', 'T_actor_laevat_hair_01_HN.png'],
    ['虹膜底色', 'T_actor_zhuangfy_iris_01_D.png'],
    ['眼部高光底色', 'T_actor_laevat_face_01_D.png'],
    ['头发参数 P', 'T_actor_zhuangfy_hair_01_P.png'],
    ['头发高光遮罩 ST', 'T_actor_laevat_hair_01_ST.png'],
    ['服装参数 P（01）', 'T_actor_zhuangfy_cloth_01_P.png'],
    ['服装参数 P（02）', 'T_actor_zhuangfy_cloth_02_P.png'],
    ['服装自发光 E', 'T_actor_zhuangfy_cloth_01_E.png'],
    ['面部 SDF', 'T_actor_common_female_face_01_SDF.png'],
    ['虹膜 MatCap', 'Copper_Matcap.png'],
    ['角色 Ramp 图集', 'toon_character_ramp.png'],
  ]

  const toggleMesh = (name) => setShowMeshes((current) => ({ ...current, [name]: (current[name] ?? name !== 'Armor') ? false : true }))
  const setPreset = (name) => {
    const controls = orbitRef.current
    const bounds = modelBoundsRef.current
    if (!controls || !bounds) return
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const portrait = name === 'portrait'
    const target = portrait ? new THREE.Vector3(center.x, bounds.min.y + size.y * 0.885, center.z) : center
    const directions = {
      front: new THREE.Vector3(0, 0.055, 1), side: new THREE.Vector3(1, 0.055, 0),
      back: new THREE.Vector3(0, 0.055, -1), portrait: new THREE.Vector3(0.04, 0.04, 1),
    }
    const direction = (directions[name] || directions.front).normalize()
    const distance = Math.max(size.y * (portrait ? 0.56 : 1.62), controls.minDistance + 0.05)
    controls.object.position.copy(target).addScaledVector(direction, distance)
    controls.target.copy(target)
    controls.update()
  }

  return (
    <main className="workbench">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="庄方宜工作台">
          <span className="brand-mark"><Scan size={19} strokeWidth={1.65} /></span>
          <span className="brand-copy"><strong>庄方宜</strong><small>角色渲染工作台</small></span>
        </a>
        <div className="file-title"><Box size={16} /><span>ZhuangFangyi_render.glb</span><span className="file-tag">GLB 2.0</span></div>
        <div className="top-actions"><span className="live-dot" />实时预览<button className="icon-button help-button" title="渲染说明" onClick={() => setSelected({ name: '渲染说明', material: '标准 glTF 材质 · Three.js WebGLRenderer' })}><CircleHelp size={17} /></button></div>
      </header>

      <section className="layout" id="top">
        <nav className="rail" aria-label="工作区">
          <button className="rail-button active" title="模型查看器"><Scan size={18} /></button>
          <button className="rail-button" title="部件列表" onClick={() => setPanelOpen(true)}><Layers3 size={18} /></button>
          <button className="rail-button" title="灯光设置" onClick={() => setPanelOpen(true)}><Lightbulb size={18} /></button>
          <span className="rail-spacer" />
          <button className="rail-button" title="帮助" onClick={() => setSelected({ name: '操作方式', material: '拖动旋转 · 滚轮缩放 · 右键平移' })}><CircleHelp size={18} /></button>
          <span className="rail-version">R3F</span>
        </nav>

        <div className="main-area">
          <div className="toolbar">
            <div className="view-tabs"><button className="view-tab selected">场景视图</button><button className="view-tab" onClick={() => setPreset('portrait')}>角色特写</button></div>
            <div className="toolbar-controls">
              <button className={`tool-control ${wireframe ? 'pressed' : ''}`} onClick={() => setWireframe((v) => !v)} title="线框"><Grid2X2 size={15} /><span>线框</span></button>
              <button className={`tool-control ${toon ? 'pressed' : ''}`} onClick={() => setToon((v) => !v)} title="切换 NPR Ramp 光照"><Scan size={15} /><span>Toon</span></button>
              <button className={`tool-control ${shadows ? 'pressed' : ''}`} onClick={() => setShadows((v) => !v)} title="阴影"><Sun size={15} /><span>阴影</span></button>
              <span className="toolbar-separator" />
              <button className="icon-button" title="正面" onClick={() => setPreset('front')}>正面</button>
              <button className="icon-button" title="侧面" onClick={() => setPreset('side')}>侧面</button>
              <button className="icon-button" title="背面" onClick={() => setPreset('back')}>背面</button>
              <button className="icon-button reset-button" title="重置视角" onClick={() => { orbitRef.current?.reset(); setPreset('front') }}><RotateCcw size={15} /></button>
              <button className="icon-button panel-toggle" title="切换属性面板" onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? <X size={15} /> : <Maximize2 size={15} />}</button>
            </div>
          </div>

          <div className="stage-wrap">
          <div className="stage-canvas"><Stage showMeshes={showMeshes} wireframe={wireframe} toon={toon} faceSdfEnabled={faceSdfEnabled} hairSpecular={hairSpecular} dayStrength={dayStrength} fillStrength={fillStrength} rimStrength={rimStrength} scatterStrength={scatterStrength} outlinePixels={outlinePixels} iblStrength={iblStrength} bloom={bloom} shadows={shadows} showGrid={showGrid} lightLevel={lightLevel} modelRoot={modelRoot} onReady={readyCallback} onSelect={onSelect} orbitRef={orbitRef} stageTint={stageTint} /></div>
            {!modelLoaded && <div className="loading-overlay"><div className="loading"><LoaderCircle size={18} className="spin" /><span>正在载入 3D 模型与贴图</span></div></div>}
            <div className="stage-heading"><h1>角色预览</h1><p>实时材质与灯光观察</p></div>
            <div className="stage-meta"><span>{meshRows.length || 13} 个模型部件</span><i /> <span>377,305 个三角面</span><i /> <span>无动画</span></div>
            <div className="stage-controls"><span>拖动旋转</span><span>滚轮缩放</span><span>右键平移</span></div>
            <button className={`grid-toggle ${showGrid ? 'selected' : ''}`} onClick={() => setShowGrid((v) => !v)} title="显示地面参考线"><Grid2X2 size={16} /></button>
            <div className="stage-light"><Sun size={15} /><input aria-label="灯光强度" type="range" min="20" max="100" value={lightLevel} onChange={(e) => setLightLevel(Number(e.target.value))} /><span>{lightLevel}%</span></div>
            <div className="stage-colors" aria-label="背景色">
              {['#38383a', '#20272a', '#292521'].map((color) => <button key={color} className={stageTint === color ? 'color-swatch active' : 'color-swatch'} style={{ background: color }} onClick={() => setStageTint(color)} aria-label={`背景色 ${color}`} />)}
            </div>
          </div>

          <footer className="statusbar"><span><span className={modelLoaded ? 'status-dot' : 'status-dot waiting'} />{modelLoaded ? '模型就绪' : '载入中'}</span><span>Three.js WebGL</span><span>2048 × 2048 阴影贴图</span><button onClick={() => setSelected({ name: '模型文件', material: '31.8 MB · 377,305 个三角面 · 无动画片段' })}>模型信息 <ChevronDown size={13} /></button></footer>
        </div>

        {panelOpen && <aside className="inspector">
          <div className="inspector-head"><div><h2>属性</h2><p>检查场景对象与材质</p></div><button className="icon-button" title="关闭面板" onClick={() => setPanelOpen(false)}><X size={16} /></button></div>

          <section className="inspect-section object-section">
            <div className="section-heading"><span>当前对象</span><button className="icon-button tiny" title="聚焦对象" onClick={() => setPreset('portrait')}><Focus size={14} /></button></div>
            <div className="object-name"><Scan size={17} /><div><strong>{labels[selected.name] || selected.name}</strong><small>{selected.material}</small></div></div>
          </section>

          <section className="inspect-section">
            <div className="section-heading"><span>渲染设置</span><Gauge size={14} /></div>
            <label className="setting-row"><span><Sun size={15} />投射阴影</span><button className={`switch ${shadows ? 'on' : ''}`} role="switch" aria-checked={shadows} onClick={() => setShadows((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Grid2X2 size={15} />线框模式</span><button className={`switch ${wireframe ? 'on' : ''}`} role="switch" aria-checked={wireframe} onClick={() => setWireframe((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />Ramp 分层光照</span><button className={`switch ${toon ? 'on' : ''}`} role="switch" aria-checked={toon} onClick={() => setToon((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />面部 SDF 阴影</span><button className={`switch ${faceSdfEnabled ? 'on' : ''}`} role="switch" aria-checked={faceSdfEnabled} onClick={() => setFaceSdfEnabled((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />头发各向异性高光</span><button className={`switch ${hairSpecular ? 'on' : ''}`} role="switch" aria-checked={hairSpecular} onClick={() => setHairSpecular((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />Bloom 后处理</span><button className={`switch ${bloom ? 'on' : ''}`} role="switch" aria-checked={bloom} onClick={() => setBloom((v) => !v)}><i /></button></label>
            <label className="setting-range"><span>日光直射</span><input aria-label="日光直射强度" type="range" min="0" max="100" value={dayStrength} onChange={(e) => setDayStrength(Number(e.target.value))} /><output>{dayStrength}%</output></label>
            <label className="setting-range"><span>顶光补色</span><input aria-label="顶光补色强度" type="range" min="0" max="100" value={fillStrength} onChange={(e) => setFillStrength(Number(e.target.value))} /><output>{fillStrength}%</output></label>
            <label className="setting-range"><span>皮肤散射</span><input aria-label="皮肤散射强度" type="range" min="0" max="100" value={scatterStrength} onChange={(e) => setScatterStrength(Number(e.target.value))} /><output>{scatterStrength}%</output></label>
            <label className="setting-range"><span>边缘光</span><input aria-label="边缘光强度" type="range" min="0" max="100" value={rimStrength} onChange={(e) => setRimStrength(Number(e.target.value))} /><output>{rimStrength}%</output></label>
            <label className="setting-range"><span>环境反射</span><input aria-label="环境反射强度" type="range" min="0" max="100" value={iblStrength} onChange={(e) => setIblStrength(Number(e.target.value))} /><output>{iblStrength}%</output></label>
            <label className="setting-range"><span>描边宽度</span><input aria-label="描边宽度" type="range" min="0" max="5" step="0.1" value={outlinePixels} onChange={(e) => setOutlinePixels(Number(e.target.value))} /><output>{outlinePixels.toFixed(1)} px</output></label>
          </section>

          <section className="inspect-section mesh-section">
            <div className="section-heading"><span>网格部件</span><span className="count">{meshRows.length || 13}</span></div>
            <div className="mesh-list">
              {meshRows.map((mesh) => {
                const visible = showMeshes[mesh.name] ?? mesh.name !== 'Armor'
                return <div key={mesh.name} className={`mesh-row ${selected.name === mesh.name ? 'current' : ''}`}>
                  <button className="mesh-select" onClick={() => setSelected({ name: mesh.name, material: mesh.materials })} title="选择部件"><span className="mesh-cube"><Box size={14} /></span><span className="mesh-label">{labels[mesh.name] || mesh.name}</span></button><button className="mesh-visibility" onClick={() => toggleMesh(mesh.name)} title={visible ? '隐藏部件' : '显示部件'}>{visible ? <Eye size={14} className="eye-icon" /> : <EyeOff size={14} className="eye-icon hidden" />}</button>
                </div>
              })}
            </div>
            <p className="hint">单击部件可切换显示</p>
          </section>

          <section className="inspect-section maps-section">
            <div className="section-heading"><span>关联贴图</span><span className="count">{maps.length}</span></div>
            <div className="map-list">{maps.map(([name, file]) => <div className="map-row" key={file}><img className="map-thumb" src={`/textures/${file}`} alt="" /><span title={file}>{name}</span></div>)}</div>
          </section>

          <div className="inspector-bottom"><span>文件大小</span><strong>31.8 MB</strong></div>
        </aside>}
      </section>
    </main>
  )
}

useGLTF.preload(MODEL_URL)
