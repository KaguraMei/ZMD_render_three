import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Bounds, Center, OrbitControls, useGLTF } from '@react-three/drei'
import { Box, CircleHelp, ChevronDown, Eye, EyeOff, Focus, Gauge, Grid2X2, Layers3, Lightbulb, LoaderCircle, Maximize2, RotateCcw, Scan, Sun, X } from 'lucide-react'
import * as THREE from 'three'
import { TextureLoader } from 'three'
import { configureCharacterMaterial } from './shaders/characterToon.js'
import { createCharacterComposer } from './shaders/endfieldPost.js'

const MODEL_URL = '/models/ZhuangFangyi_render_tangent.glb'
const auxiliaryTexturePaths = [
  '/textures/T_actor_common_female_face_01_SDF.png',
  '/textures/T_actor_zhuangfy_face_01_Refine_Proxy.png',
  '/textures/T_actor_zhuangfy_face_01_Trick_Proxy.png',
  '/textures/T_actor_zhuangfy_hair_01_P.png',
  '/textures/T_actor_zhuangfy_hair_01_SpecMask_Proxy.png',
  '/textures/T_actor_zhuangfy_cloth_01_P.png',
  '/textures/Copper_Matcap.png',
  '/textures/T_actor_zhuangfy_cloth_01_E.png',
  '/textures/toon_character_ramp.png',
  '/textures/toon_skin_lut.png',
  '/textures/T_actor_zhuangfy_body_01_Thickness_Proxy.png',
]
const labels = {
  Armor: '装甲', Clothing: '服装', Eye_HL: '眼部高光', Face: '面部', Gloves: '手套',
  Hair: '头发', HeadAcc: '头部配饰', Horn: '角饰', LowerArmour: '下装护甲',
  Shoes: '鞋靴', Tail: '尾饰', TopClothing: '上装', ZhuangFangyi_Body: '身体',
}

const environmentPresets = {
  studio: { label: '摄影棚', sky: '#737c8a', horizon: '#b1a99d', ground: '#37333a', lights: ['#fff3dc', '#d9e6ff'] },
  warm: { label: '暖色室内', sky: '#74544a', horizon: '#d69d70', ground: '#3d2929', lights: ['#ffd2a0', '#fff0d2'] },
  cool: { label: '冷色展厅', sky: '#3b596e', horizon: '#91bdc9', ground: '#242f43', lights: ['#d5f4ff', '#9ec7ff'] },
  sunset: { label: '黄昏', sky: '#443c62', horizon: '#e38c72', ground: '#342b46', lights: ['#ffd0a2', '#f5a9bd'] },
}

function createProceduralEnvironment(presetName) {
  const preset = environmentPresets[presetName] || environmentPresets.studio
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, preset.sky)
  gradient.addColorStop(0.47, preset.horizon)
  gradient.addColorStop(0.53, preset.horizon)
  gradient.addColorStop(1, preset.ground)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  preset.lights.forEach((color, index) => {
    const x = canvas.width * (0.29 + index * 0.42)
    const y = canvas.height * (0.22 + index * 0.09)
    const glow = ctx.createRadialGradient(x, y, 5, x, y, 170)
    glow.addColorStop(0, `${color}d9`)
    glow.addColorStop(0.22, `${color}72`)
    glow.addColorStop(1, `${color}00`)
    ctx.fillStyle = glow
    ctx.fillRect(x - 180, y - 180, 360, 360)
    ctx.fillStyle = `${color}aa`
    ctx.fillRect(x - 70, y - 20, 140, 38)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
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

function createCorneaShellGeometries(mesh, materialIndex) {
  const source = mesh.geometry
  const position = source?.getAttribute('position')
  if (!position) return []

  const group = source.groups?.find((item) => item.materialIndex === materialIndex)
  const range = group || (!source.groups?.length && materialIndex === 0
    ? { start: 0, count: source.index?.count ?? position.count }
    : null)
  if (!range || range.count < 3) return []
  const sourceIndex = source.index?.array
  const triangleIndices = []
  for (let i = range.start; i + 2 < range.start + range.count; i += 3) {
    triangleIndices.push(sourceIndex ? [sourceIndex[i], sourceIndex[i + 1], sourceIndex[i + 2]] : [i, i + 1, i + 2])
  }

  const parent = new Map()
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)))
    return parent.get(x)
  }
  const join = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }
  triangleIndices.forEach(([a, b, c]) => { join(a, b); join(b, c) })
  const islands = new Map()
  triangleIndices.forEach((triangle) => {
    const root = find(triangle[0])
    const island = islands.get(root) || []
    island.push(triangle)
    islands.set(root, island)
  })

  const uv = source.getAttribute('uv')
  const result = []
  for (const [islandNumber, triangles] of [...islands.values()].entries()) {
    const vertexIds = [...new Set(triangles.flat())]
    if (vertexIds.length < 12) continue
    const indexBySource = new Map(vertexIds.map((id, index) => [id, index]))
    const positions = new Float32Array(vertexIds.length * 3)
    const uvs = uv ? new Float32Array(vertexIds.length * 2) : null
    const skinIndex = mesh.isSkinnedMesh ? source.getAttribute('skinIndex') : null
    const skinWeight = mesh.isSkinnedMesh ? source.getAttribute('skinWeight') : null
    const skinIndices = skinIndex ? new Uint16Array(vertexIds.length * skinIndex.itemSize) : null
    const skinWeights = skinWeight ? new Float32Array(vertexIds.length * skinWeight.itemSize) : null
    vertexIds.forEach((sourceId, index) => {
      const point = new THREE.Vector3().fromBufferAttribute(position, sourceId)
      positions.set(point.toArray(), index * 3)
      if (uv) uvs.set([uv.getX(sourceId), uv.getY(sourceId)], index * 2)
      if (skinIndex) for (let c = 0; c < skinIndex.itemSize; c++) skinIndices[index * skinIndex.itemSize + c] = skinIndex.getComponent(sourceId, c)
      if (skinWeight) for (let c = 0; c < skinWeight.itemSize; c++) skinWeights[index * skinWeight.itemSize + c] = skinWeight.getComponent(sourceId, c)
    })

    const indices = new Uint32Array(triangles.flatMap((triangle) => triangle.map((id) => indexBySource.get(id))))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    if (skinIndices) geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, skinIndex.itemSize))
    if (skinWeights) geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, skinWeight.itemSize))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeVertexNormals()

    const points = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    const center = new THREE.Vector3()
    const averageNormal = new THREE.Vector3()
    for (let i = 0; i < points.count; i++) {
      center.add(new THREE.Vector3().fromBufferAttribute(points, i))
      averageNormal.add(new THREE.Vector3().fromBufferAttribute(normals, i))
    }
    center.multiplyScalar(1 / points.count)
    averageNormal.normalize()
    let radius = 0
    const planarOffsets = []
    for (let i = 0; i < points.count; i++) {
      const offset = new THREE.Vector3().fromBufferAttribute(points, i).sub(center)
      offset.addScaledVector(averageNormal, -offset.dot(averageNormal))
      planarOffsets.push(offset)
      radius = Math.max(radius, offset.length())
    }
    if (radius < 1e-5) { geometry.dispose(); continue }

    const domeHeight = radius * 0.075
    for (let i = 0; i < points.count; i++) {
      const radial = Math.min(planarOffsets[i].length() / radius, 1)
      const lift = domeHeight * Math.pow(Math.max(1 - radial * radial, 0), 1.6)
      const point = new THREE.Vector3().fromBufferAttribute(points, i).addScaledVector(averageNormal, lift)
      points.setXYZ(i, point.x, point.y, point.z)
    }
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    result.push({ geometry, islandNumber, radius })
  }
  return result
}

function Model({ showMeshes, wireframe, toon, faceSdfEnabled, faceRefineStrength, faceTrickStrength, corneaStrength, hairSpecular, hairSpecularStrength, dayStrength, fillStrength, rimStrength, scatterStrength, outlinePixels, castShadows, windEnabled, windStrength, windSpeed, windDirection, onReady, onSelect }) {
  const { scene } = useGLTF(MODEL_URL)
  const windDirectionVector = useRef(new THREE.Vector2())
  const [faceSdf, faceRefineMap, faceTrickMap, hairParams, hairSpecMaskMap, cloth01Params, eyeMatcap, clothEmission, rampAtlas, skinLut, skinThicknessMap] = useLoader(TextureLoader, auxiliaryTexturePaths)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    const corneaSources = []
    ;[faceSdf, faceRefineMap, hairParams, hairSpecMaskMap, cloth01Params, skinThicknessMap].forEach((texture) => {
      texture.flipY = false
      texture.colorSpace = THREE.NoColorSpace
      texture.needsUpdate = true
    })
    ;[faceTrickMap, eyeMatcap, clothEmission, rampAtlas, skinLut].forEach((texture) => {
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
    })
    clone.traverse((object) => {
      if (!object.isMesh) return
      const original = Array.isArray(object.material) ? object.material : [object.material]
      const irisMaterialIndex = original.findIndex((material) => material?.name?.toLowerCase().includes('iris'))
      if (findPartName(object, clone) === 'Eye_HL' && irisMaterialIndex >= 0) {
        corneaSources.push({ object, irisMaterialIndex })
      }
      const partName = findPartName(object, clone)
      let windProfile = null
      if (['Hair', 'Clothing', 'Tail'].includes(partName)) {
        object.geometry.computeBoundingBox()
        const bounds = object.geometry.boundingBox
        windProfile = {
          anchorY: bounds.max.y,
          height: Math.max(bounds.max.y - bounds.min.y, 0.01),
          phase: partName === 'Hair' ? 0.7 : partName === 'Tail' ? 2.1 : 1.4,
          amplitude: partName === 'Hair' ? 0.58 : partName === 'Tail' ? 1.35 : 1.0,
        }
      }
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
        const clothParams = name.includes('zhuangfy_cloth_01') ? cloth01Params : null

        // The render GLB contains the matching albedo and normal maps. Keep
        // those authored material bindings; only attach the two external maps
        // that are not part of the export.
        if (isFace) {
          material.userData.faceSdfMap = faceSdf
          material.userData.faceRefineMap = faceRefineMap
          material.userData.faceTrickMap = faceTrickMap
        }
        if (isHair) {
          // The Blender source wires ST as a detail-normal input. It is not a
          // high-spec mask, so the hair lobe uses the mesh TANGENT and P map.
          material.userData.hairParamsMap = hairParams
          material.userData.hairSpecMaskMap = hairSpecMaskMap
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
          material.userData.skinThicknessMap = skinThicknessMap
        }
        if (isHair) {
          material.roughness = Math.max(material.roughness ?? 0.5, 0.84)
          material.metalness = 0
          if ('clearcoat' in material) material.clearcoat = 0
        }
        if (irisMaterial) {
          material.dispose()
          const iris = new THREE.MeshPhysicalMaterial({
            name: source.name, map: source.map || source.emissiveMap, color: '#ffffff',
            roughness: 0.16, metalness: 0, clearcoat: 0.82, clearcoatRoughness: 0.08,
            ior: 1.34, side: source.side, stencilWrite: true,
            stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
          })
          return configureCharacterMaterial(iris, {
            toon, faceSdfEnabled, hairSpecular, hairSpecularStrength, faceSdf, faceRefineMap, faceTrickMap, faceTrickStrength, hairParams, hairSpecMaskMap,
            eyeMatcap, skinLut, skinThicknessMap, rampAtlas, outlinePixels, dayStrength, fillStrength, rimStrength,
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
          toon: toon && !isOutline, faceSdfEnabled, faceRefineStrength, faceTrickStrength, hairSpecular, hairSpecularStrength, faceSdf, faceRefineMap, faceTrickMap, hairParams, hairSpecMaskMap,
          eyeMatcap, skinLut, skinThicknessMap, rampAtlas, outlinePixels,
          clothParams,
          dayStrength, fillStrength, rimStrength, scatterStrength,
          isFace, isHair, isSkin, isOutline, windProfile,
        })
      })
      object.material = Array.isArray(object.material) ? repaired : repaired[0]
    })
    clone.updateMatrixWorld(true)
    for (const { object, irisMaterialIndex } of corneaSources) {
      if (object.isSkinnedMesh) object.skeleton.update()
      const shells = createCorneaShellGeometries(object, irisMaterialIndex)
      for (const { geometry, islandNumber } of shells) {
        const cornea = new THREE.MeshPhysicalMaterial({
          name: `GeneratedCornea_${islandNumber + 1}`,
          color: '#e8f8ff', roughness: 0.055, metalness: 0,
          transmission: 0.035, thickness: 0.35, ior: 1.376,
          clearcoat: 0.96, clearcoatRoughness: 0.025,
          transparent: true, opacity: 0.163, depthWrite: false,
          side: THREE.DoubleSide, toneMapped: false,
          stencilWrite: true, stencilRef: 1,
          stencilFunc: THREE.EqualStencilFunc,
          stencilZPass: THREE.KeepStencilOp,
        })
        const shell = object.isSkinnedMesh ? object.clone(false) : new THREE.Mesh()
        shell.geometry = geometry
        shell.material = cornea
        shell.name = `GeneratedCornea_${islandNumber + 1}`
        shell.userData.viewerGeneratedCornea = true
        shell.userData.viewerGeneratedCorneaMaterial = cornea
        shell.castShadow = false
        shell.renderOrder = 3
        shell.matrix.copy(object.matrix)
        shell.matrixAutoUpdate = object.matrixAutoUpdate
        object.parent?.add(shell)
      }
    }
    return clone
  }, [scene, faceSdf, faceRefineMap, faceTrickMap, hairParams, hairSpecMaskMap, cloth01Params, eyeMatcap, clothEmission, rampAtlas, skinLut, skinThicknessMap, wireframe, toon, faceSdfEnabled, faceRefineStrength, faceTrickStrength, hairSpecular, dayStrength, fillStrength, rimStrength, scatterStrength])

  useEffect(() => {
    model.traverse((object) => {
      if (!object.userData.viewerGeneratedCornea) return
      object.userData.viewerGeneratedCorneaMaterial.opacity = corneaStrength * 0.0034
    })
  }, [model, corneaStrength])

  useEffect(() => {
    model.traverse((object) => {
      if (!object.isMesh) return
      const original = object.userData.viewerOriginalMaterial ?? object.material
      for (const material of Array.isArray(original) ? original : [original]) {
        if (material?.name?.toLowerCase().includes('hair')) material.userData.zfHairSpecularStrength = hairSpecularStrength
        const shader = material?.userData?.zfHairShader
        if (shader?.uniforms?.zfHairSpecularStrength) shader.uniforms.zfHairSpecularStrength.value = hairSpecularStrength
      }
    })
  }, [model, hairSpecularStrength])

  useFrame(({ clock }) => {
    const radians = THREE.MathUtils.degToRad(windDirection)
    const direction = windDirectionVector.current.set(Math.sin(radians), Math.cos(radians)).normalize()
    model.traverse((object) => {
      if (!object.isMesh) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const shader = material?.userData?.zfWindShader
        if (!shader) continue
        shader.uniforms.zfWindTime.value = clock.elapsedTime
        shader.uniforms.zfWindStrength.value = windEnabled ? windStrength / 100 * 0.11 : 0
        shader.uniforms.zfWindSpeed.value = windSpeed / 100
        shader.uniforms.zfWindDirection.value.copy(direction)
      }
    })
  })

  useEffect(() => () => {
    model.traverse((object) => {
      if (!object.userData.viewerGeneratedCornea) return
      object.geometry.dispose()
      object.userData.viewerGeneratedCorneaMaterial.dispose()
    })
  }, [model])

  const meshRows = useMemo(() => {
    const groups = new Map()
    model.traverse((object) => {
      if (!object.isMesh || object.userData.viewerGeneratedCornea || isExcludedSourceMesh(object, model)) return
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
      object.castShadow = object.userData.viewerGeneratedCornea ? false : castShadows
      object.renderOrder = object.userData.viewerGeneratedCornea ? 3 : partName === 'Eye_HL' ? 2 : partName === 'Face' ? 1 : 0
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

function StageContents({ showMeshes, wireframe, toon, faceSdfEnabled, faceRefineStrength, faceTrickStrength, corneaStrength, hairSpecular, hairSpecularStrength, dayStrength, fillStrength, rimStrength, scatterStrength, outlinePixels, iblStrength, environmentPreset, bloom, shadows, showGrid, lightLevel, mainLightAzimuth, mainLightElevation, windEnabled, windStrength, windSpeed, windDirection, modelRoot, onReady, onSelect, orbitRef, stageTint }) {
  const lightRef = useRef()
  const composerRef = useRef(null)
  const { gl, scene, camera, size } = useThree()
  const lightScale = lightLevel / 72
  const lightAzimuth = THREE.MathUtils.degToRad(mainLightAzimuth)
  const lightElevation = THREE.MathUtils.degToRad(mainLightElevation)
  const mainLightPosition = [
    10 * Math.cos(lightElevation) * Math.sin(lightAzimuth),
    10 * Math.sin(lightElevation),
    10 * Math.cos(lightElevation) * Math.cos(lightAzimuth),
  ]
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
    const source = createProceduralEnvironment(environmentPreset)
    const environmentTarget = pmrem.fromEquirectangular(source)
    scene.environment = environmentTarget.texture
    scene.environmentIntensity = iblStrength / 100
    return () => {
      if (scene.environment === environmentTarget.texture) scene.environment = null
      environmentTarget.dispose()
      source.dispose()
      pmrem.dispose()
    }
  }, [gl, scene, environmentPreset])
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
      <directionalLight ref={lightRef} position={mainLightPosition} intensity={2.2 * lightScale} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-near={0.5} shadow-camera-far={25} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={8} shadow-camera-bottom={-4} shadow-bias={-0.0001} shadow-normalBias={0.035} />
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
          <Model showMeshes={showMeshes} wireframe={wireframe} toon={toon} faceSdfEnabled={faceSdfEnabled} faceRefineStrength={faceRefineStrength} faceTrickStrength={faceTrickStrength} corneaStrength={corneaStrength} hairSpecular={hairSpecular} hairSpecularStrength={hairSpecularStrength} dayStrength={dayStrength / 100} fillStrength={fillStrength / 100} rimStrength={rimStrength / 100} scatterStrength={scatterStrength / 100} outlinePixels={outlinePixels} castShadows={shadows} windEnabled={windEnabled} windStrength={windStrength} windSpeed={windSpeed} windDirection={windDirection} onReady={onReady} onSelect={onSelect} />
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
  const [faceRefineStrength, setFaceRefineStrength] = useState(45)
  const [faceTrickStrength, setFaceTrickStrength] = useState(38)
  const [corneaStrength, setCorneaStrength] = useState(48)
  const [hairSpecular, setHairSpecular] = useState(true)
  const [hairSpecularStrength, setHairSpecularStrength] = useState(32)
  const [dayStrength, setDayStrength] = useState(78)
  const [fillStrength, setFillStrength] = useState(34)
  const [rimStrength, setRimStrength] = useState(12)
  const [scatterStrength, setScatterStrength] = useState(18)
  const [outlinePixels, setOutlinePixels] = useState(1.8)
  const [iblStrength, setIblStrength] = useState(42)
  const [environmentPreset, setEnvironmentPreset] = useState('studio')
  const [mainLightAzimuth, setMainLightAzimuth] = useState(50)
  const [mainLightElevation, setMainLightElevation] = useState(50)
  const [windEnabled, setWindEnabled] = useState(true)
  const [windStrength, setWindStrength] = useState(38)
  const [windSpeed, setWindSpeed] = useState(42)
  const [windDirection, setWindDirection] = useState(35)
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
    ['皮肤厚度候选代理（命中率 13.6%）', 'T_actor_zhuangfy_body_01_Thickness_Proxy.png'],
    ['服装底色', 'T_actor_zhuangfy_cloth_01_D.png'],
    ['服装法线', 'T_actor_zhuangfy_cloth_01_N.png'],
    ['脸部底色', 'T_actor_zhuangfy_face_01_D.png'],
    ['Trick 腮红代理', 'T_actor_zhuangfy_face_01_Trick_Proxy.png'],
    ['头发底色', 'T_actor_zhuangfy_hair_01_D.png'],
    ['头发法线', 'T_actor_laevat_hair_01_HN.png'],
    ['虹膜底色', 'T_actor_zhuangfy_iris_01_D.png'],
    ['眼部高光底色', 'T_actor_laevat_face_01_D.png'],
    ['头发参数 P', 'T_actor_zhuangfy_hair_01_P.png'],
    ['头发高光响应代理', 'T_actor_zhuangfy_hair_01_SpecMask_Proxy.png'],
    ['头发源 ST（细节法线）', 'T_actor_laevat_hair_01_ST.png'],
    ['服装参数 P（01）', 'T_actor_zhuangfy_cloth_01_P.png'],
    ['候选服装参数 P（02，未分配）', 'T_actor_zhuangfy_cloth_02_P.png'],
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
          <div className="stage-canvas"><Stage showMeshes={showMeshes} wireframe={wireframe} toon={toon} faceSdfEnabled={faceSdfEnabled} faceRefineStrength={faceRefineStrength / 100} faceTrickStrength={faceTrickStrength / 100} corneaStrength={corneaStrength} hairSpecular={hairSpecular} hairSpecularStrength={hairSpecularStrength / 100} dayStrength={dayStrength} fillStrength={fillStrength} rimStrength={rimStrength} scatterStrength={scatterStrength} outlinePixels={outlinePixels} iblStrength={iblStrength} environmentPreset={environmentPreset} bloom={bloom} shadows={shadows} showGrid={showGrid} lightLevel={lightLevel} mainLightAzimuth={mainLightAzimuth} mainLightElevation={mainLightElevation} windEnabled={windEnabled} windStrength={windStrength} windSpeed={windSpeed} windDirection={windDirection} modelRoot={modelRoot} onReady={readyCallback} onSelect={onSelect} orbitRef={orbitRef} stageTint={stageTint} /></div>
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
            <label className="setting-select"><span>环境预设</span><select aria-label="环境预设" value={environmentPreset} onChange={(e) => setEnvironmentPreset(e.target.value)}>{Object.entries(environmentPresets).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>
            <label className="setting-range"><span>主光方位</span><input aria-label="主光方位" type="range" min="0" max="360" value={mainLightAzimuth} onChange={(e) => setMainLightAzimuth(Number(e.target.value))} /><output>{mainLightAzimuth}°</output></label>
            <label className="setting-range"><span>主光高度</span><input aria-label="主光高度" type="range" min="10" max="85" value={mainLightElevation} onChange={(e) => setMainLightElevation(Number(e.target.value))} /><output>{mainLightElevation}°</output></label>
            <label className="setting-row"><span><Scan size={15} />风动与柔软感</span><button className={`switch ${windEnabled ? 'on' : ''}`} role="switch" aria-checked={windEnabled} onClick={() => setWindEnabled((v) => !v)}><i /></button></label>
            <label className="setting-range"><span>风向</span><input aria-label="风向" type="range" min="0" max="359" value={windDirection} onChange={(e) => setWindDirection(Number(e.target.value))} /><output>{windDirection}°</output></label>
            <label className="setting-range"><span>风力</span><input aria-label="风力" type="range" min="0" max="100" value={windStrength} onChange={(e) => setWindStrength(Number(e.target.value))} /><output>{windStrength}%</output></label>
            <label className="setting-range"><span>风速</span><input aria-label="风速" type="range" min="0" max="100" value={windSpeed} onChange={(e) => setWindSpeed(Number(e.target.value))} /><output>{windSpeed}%</output></label>
            <label className="setting-row"><span><Sun size={15} />投射阴影</span><button className={`switch ${shadows ? 'on' : ''}`} role="switch" aria-checked={shadows} onClick={() => setShadows((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Grid2X2 size={15} />线框模式</span><button className={`switch ${wireframe ? 'on' : ''}`} role="switch" aria-checked={wireframe} onClick={() => setWireframe((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />Ramp 分层光照</span><button className={`switch ${toon ? 'on' : ''}`} role="switch" aria-checked={toon} onClick={() => setToon((v) => !v)}><i /></button></label>
            <label className="setting-row"><span><Scan size={15} />面部 SDF 阴影</span><button className={`switch ${faceSdfEnabled ? 'on' : ''}`} role="switch" aria-checked={faceSdfEnabled} onClick={() => setFaceSdfEnabled((v) => !v)}><i /></button></label>
            <label className="setting-range"><span title="R/B/A 来自当前 Face UV 几何派生；不是原始手绘 SdfRefineTex">脸部 refine 代理</span><input aria-label="脸部 refine 代理强度" type="range" min="0" max="100" value={faceRefineStrength} onChange={(e) => setFaceRefineStrength(Number(e.target.value))} /><output>{faceRefineStrength}%</output></label>
            <label className="setting-range"><span title="手工 UV 腮红代理，模拟 TrickTex 颜色叠加；不含原作表情贴纸动画">Trick 腮红代理</span><input aria-label="Trick 腮红代理强度" type="range" min="0" max="100" value={faceTrickStrength} onChange={(e) => setFaceTrickStrength(Number(e.target.value))} /><output>{faceTrickStrength}%</output></label>
            <label className="setting-range"><span title="从模型虹膜网格派生并复用蒙皮权重的透明凸面壳；只近似角膜，不包含独立角膜结构与真实折射">角膜壳代理</span><input aria-label="角膜壳代理强度" type="range" min="0" max="100" value={corneaStrength} onChange={(e) => setCorneaStrength(Number(e.target.value))} /><output>{corneaStrength}%</output></label>
            <label className="setting-row"><span><Scan size={15} />头发各向异性高光</span><button className={`switch ${hairSpecular ? 'on' : ''}`} role="switch" aria-checked={hairSpecular} onClick={() => setHairSpecular((v) => !v)}><i /></button></label>
            <label className="setting-range"><span title="降低手工各向异性高光层的贡献；头发底材同时使用较高粗糙度">头发高光强度</span><input aria-label="头发高光强度" type="range" min="0" max="100" value={hairSpecularStrength} onChange={(e) => setHairSpecularStrength(Number(e.target.value))} /><output>{hairSpecularStrength}%</output></label>
            <label className="setting-row"><span><Scan size={15} />Bloom 后处理</span><button className={`switch ${bloom ? 'on' : ''}`} role="switch" aria-checked={bloom} onClick={() => setBloom((v) => !v)}><i /></button></label>
            <label className="setting-range"><span>日光直射</span><input aria-label="日光直射强度" type="range" min="0" max="100" value={dayStrength} onChange={(e) => setDayStrength(Number(e.target.value))} /><output>{dayStrength}%</output></label>
            <label className="setting-range"><span>顶光补色</span><input aria-label="顶光补色强度" type="range" min="0" max="100" value={fillStrength} onChange={(e) => setFillStrength(Number(e.target.value))} /><output>{fillStrength}%</output></label>
            <label className="setting-range"><span title="背光散射由几何射线厚度候选图作弱调制；射线仅命中 13.6%，不等同于完整 SSS 厚度">皮肤散射（厚度代理）</span><input aria-label="皮肤散射强度" type="range" min="0" max="100" value={scatterStrength} onChange={(e) => setScatterStrength(Number(e.target.value))} /><output>{scatterStrength}%</output></label>
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
