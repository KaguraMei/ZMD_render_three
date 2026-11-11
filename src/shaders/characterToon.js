import * as THREE from 'three'

let skinLut

function getSkinLut() {
  if (skinLut) return skinLut
  const stops = [[104, 63, 70], [164, 101, 97], [204, 151, 132], [239, 203, 177], [255, 238, 216]]
  const pixels = new Uint8Array(256 * 4)
  for (let x = 0; x < 256; x++) {
    const t = x / 255
    const band = Math.min(Math.floor(t * (stops.length - 1)), stops.length - 2)
    const mix = t * (stops.length - 1) - band
    pixels.set([
      Math.round(THREE.MathUtils.lerp(stops[band][0], stops[band + 1][0], mix)),
      Math.round(THREE.MathUtils.lerp(stops[band][1], stops[band + 1][1], mix)),
      Math.round(THREE.MathUtils.lerp(stops[band][2], stops[band + 1][2], mix)), 255,
    ], x * 4)
  }
  skinLut = new THREE.DataTexture(pixels, 256, 1, THREE.RGBAFormat)
  skinLut.colorSpace = THREE.SRGBColorSpace
  skinLut.magFilter = THREE.LinearFilter
  skinLut.minFilter = THREE.LinearFilter
  skinLut.generateMipmaps = false
  skinLut.needsUpdate = true
  return skinLut
}

/** Patch a GLTF PBR material with the character-specific NPR lighting model. */
export function configureCharacterMaterial(material, {
  toon,
  faceSdfEnabled,
  faceRefineStrength = 0.45,
  hairSpecular,
  dayStrength,
  fillStrength,
  rimStrength,
  scatterStrength,
  faceSdf,
  hairParams,
  hairSpecMask,
  clothParams,
  eyeMatcap,
  rampAtlas,
  isFace,
  isHair,
  isSkin,
  isIris,
  isOutline,
}) {
  const usesShader = material.isMeshStandardMaterial && (
    toon || (isFace && faceSdfEnabled) || (isHair && hairSpecular) || ((isSkin || isFace) && scatterStrength > 0) || isIris || isOutline
  )
  if (!usesShader) {
    material.needsUpdate = true
    return material
  }

  const ramp = rampAtlas
  const rampRow = isHair ? 2 : (isSkin || isFace) ? 1 : 0
  material.onBeforeCompile = (shader) => {
    const declarations = isFace && faceSdfEnabled
      ? ['uniform mat4 modelMatrix;']
      : []
    const effects = []

    if (toon) {
      shader.uniforms.zfToonRamp = { value: ramp }
      shader.uniforms.zfRampRow = { value: rampRow }
      shader.uniforms.zfDayStrength = { value: dayStrength }
      shader.uniforms.zfFillStrength = { value: fillStrength }
      shader.uniforms.zfRimStrength = { value: rimStrength }
      declarations.push(
        'uniform sampler2D zfToonRamp;',
        'uniform float zfRampRow;',
        'uniform float zfDayStrength;',
        'uniform float zfFillStrength;',
        'uniform float zfRimStrength;',
      )
      const lightBegin = '#include <lights_fragment_begin>'
      const directLightCall = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'
      const perLightRamp = `
        {
        vec3 zfDiffuseBeforeRamp = reflectedLight.directDiffuse;
        ${directLightCall}
        vec3 zfThisLightDiffuse = reflectedLight.directDiffuse - zfDiffuseBeforeRamp;
        float zfThisLightNoL = dot(geometryNormal, directLight.direction);
        vec4 zfThisLightRamp = texture2D(zfToonRamp, vec2(clamp(zfThisLightNoL * 0.5 + 0.5, 0.0, 1.0), (zfRampRow + 0.5) * 0.25));
        float zfThisLightAux = mix(0.62, 1.0, zfThisLightRamp.a);
        reflectedLight.directDiffuse = zfDiffuseBeforeRamp + zfThisLightDiffuse * zfThisLightRamp.rgb * zfThisLightAux * mix(0.12, 1.0, zfDayStrength);
        }`
      const lightChunk = THREE.ShaderChunk.lights_fragment_begin
      if (lightChunk?.includes(directLightCall)) {
        shader.fragmentShader = shader.fragmentShader.replace(
          lightBegin,
          lightChunk.replaceAll(directLightCall, perLightRamp),
        )
      }
      effects.push(`
        vec3 zfL = normalize(directionalLights[0].direction);

        vec3 zfN = normalize(normal);
        float zfNoL = dot(zfN, zfL);
        vec3 zfTopLight = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
        float zfTopNoL = max(dot(zfN, zfTopLight) + 0.22, 0.0);
        float zfTopFill = zfTopNoL * zfFillStrength * mix(1.15, 0.38, zfDayStrength);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.88, 0.78) * zfTopFill;

        vec3 zfV = normalize(vViewPosition);
        float zfNoV = max(dot(zfN, zfV), 0.0);
        float zfRim = smoothstep(0.48, 0.9, 1.0 - zfNoV) * zfRimStrength;
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.68, 0.82, 1.0) * zfRim * (0.25 + 0.75 * max(zfNoL, 0.0));`)
    }

    if ((isSkin || isFace) && scatterStrength > 0) {
      shader.uniforms.zfScatterStrength = { value: scatterStrength }
      shader.uniforms.zfSkinLut = { value: getSkinLut() }
      declarations.push('uniform float zfScatterStrength;', 'uniform sampler2D zfSkinLut;')
      effects.push(`
        vec3 zfSkinN = normalize(normal);
        vec3 zfSkinV = normalize(vViewPosition);
        float zfSkinLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 zfSkinLutColor = texture2D(zfSkinLut, vec2(zfSkinLum, 0.5)).rgb;
        float zfSkinRim = pow(1.0 - max(dot(zfSkinN, zfSkinV), 0.0), 2.0);
        float zfSkinBack = 0.0;
        #if NUM_DIR_LIGHTS > 0
          zfSkinBack = pow(max(dot(-zfSkinN, normalize(directionalLights[0].direction)) + 0.18, 0.0), 1.7);
        #endif
        float zfSkinScatter = (zfSkinRim * 0.32 + zfSkinBack * 0.68) * zfScatterStrength;
        reflectedLight.indirectDiffuse += mix(diffuseColor.rgb, zfSkinLutColor, 0.38) * vec3(1.0, 0.5, 0.42) * zfSkinScatter * 0.42;`)
    }

    if (isFace && faceSdfEnabled && faceSdf) {
      shader.uniforms.zfFaceSdfMap = { value: faceSdf }
      shader.uniforms.zfFaceShadowColor = { value: new THREE.Color('#788095') }
      shader.uniforms.zfFaceRefineStrength = { value: faceRefineStrength }
      declarations.push('uniform sampler2D zfFaceSdfMap;', 'uniform vec3 zfFaceShadowColor;', 'uniform float zfFaceRefineStrength;')
      effects.push(`
        vec3 zfFaceL = normalize(directionalLights[0].direction);
        mat3 zfFaceModelView = mat3(viewMatrix) * mat3(modelMatrix);
        vec3 zfFaceForward = normalize(zfFaceModelView * vec3(0.0, 0.0, 1.0));
        vec3 zfFaceRight = normalize(zfFaceModelView * vec3(1.0, 0.0, 0.0));
        float zfFaceNoL = dot(zfFaceForward, zfFaceL);
        float zfFaceBackLight = max(-zfFaceNoL, 0.0);
        zfFaceNoL += zfFaceBackLight * (-0.5 * zfFaceNoL * zfFaceNoL + 0.5);
        float zfFaceThreshold = clamp(0.5 - 0.5 * zfFaceNoL, 0.0, 1.0);
        float zfFaceU = dot(zfFaceL, zfFaceRight) > 0.0 ? 1.0 - vMapUv.x : vMapUv.x;
        vec4 zfFaceSdfSample = texture2D(zfFaceSdfMap, vec2(zfFaceU, vMapUv.y));
        vec2 zfFaceRG = zfFaceSdfSample.rg;
        float zfFaceValue = (zfFaceRG.r + zfFaceRG.g) * 0.5;
        float zfFaceMin = max(2.0 * zfFaceThreshold - 1.0, 0.0);
        float zfFaceMax = min(2.0 * zfFaceThreshold, 1.0);
        float zfFaceSdf = smoothstep(zfFaceMin, max(zfFaceMax, zfFaceMin + 0.0001), zfFaceValue);
        float zfFaceLit = smoothstep(0.38, 0.62, zfFaceSdf);
        float zfFaceRefine = smoothstep(0.22, 0.82, zfFaceSdfSample.b);
        float zfFaceTrick = smoothstep(0.08, 0.74, zfFaceSdfSample.a);
        float zfFaceShadow = (1.0 - zfFaceLit) * mix(1.0, 0.55, zfFaceRefine * zfFaceRefineStrength);
        zfFaceShadow *= mix(1.0, 0.78, zfFaceTrick * zfFaceRefineStrength);
        reflectedLight.directDiffuse *= mix(1.0, 0.28, zfFaceShadow);
        reflectedLight.indirectDiffuse *= mix(1.0, 0.76, zfFaceShadow);
        reflectedLight.directDiffuse *= mix(vec3(1.0), zfFaceShadowColor, 0.58 * zfFaceShadow);
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), zfFaceShadowColor, 0.2 * zfFaceShadow);`)
    }

    if (isHair && hairSpecular && hairParams) {
      shader.uniforms.zfHairTint = { value: new THREE.Color('#c5edf0') }
      shader.uniforms.zfHairParams = { value: hairParams }
      shader.uniforms.zfHairSpecMask = { value: hairSpecMask || hairParams }
      declarations.push('uniform vec3 zfHairTint;', 'uniform sampler2D zfHairParams;', 'uniform sampler2D zfHairSpecMask;')
      effects.push(`
        vec3 zfHairL = normalize(directionalLights[0].direction);
        vec3 zfHairV = normalize(vViewPosition);
        vec3 zfHairN = normalize(normal);
        vec3 zfHairDpdx = dFdx(vViewPosition);
        vec3 zfHairDpdy = dFdy(vViewPosition);
        vec2 zfHairDuvdx = dFdx(vMapUv);
        vec2 zfHairDuvdy = dFdy(vMapUv);
        float zfHairUvDet = zfHairDuvdx.x * zfHairDuvdy.y - zfHairDuvdx.y * zfHairDuvdy.x;
        vec3 zfHairT = cross(zfHairN, zfHairV);
        if (abs(zfHairUvDet) > 0.000001) {
          zfHairT = (zfHairDpdx * zfHairDuvdy.y - zfHairDpdy * zfHairDuvdx.y) / zfHairUvDet;
        }
        zfHairT = normalize(zfHairT - zfHairN * dot(zfHairT, zfHairN));
        vec3 zfHairH = normalize(zfHairL + zfHairV);
        vec4 zfHairP = texture2D(zfHairParams, vMapUv);
        float zfHairMask = texture2D(zfHairSpecMask, vMapUv).r;
        float zfHairSmoothness = clamp(zfHairP.a, 0.12, 0.82);
        float zfHairReflectivity = clamp(zfHairP.g, 0.0, 1.0);
        float zfHairAniso = max(1.0 - pow(dot(zfHairT, zfHairH), 2.0), 0.0);
        float zfHairPrimary = pow(zfHairAniso, mix(6.0, 22.0, zfHairSmoothness));
        float zfHairSecondary = pow(zfHairAniso, mix(2.5, 7.0, zfHairSmoothness)) * 0.08;
        float zfHairFacing = max(dot(zfHairN, zfHairL), 0.0);
        reflectedLight.directSpecular += directionalLights[0].color * zfHairTint
          * (zfHairPrimary + zfHairSecondary) * zfHairFacing * zfHairReflectivity * smoothstep(0.12, 0.82, zfHairMask) * 0.38;`)
    }

    if (isIris && eyeMatcap) {
      shader.uniforms.zfEyeMatcap = { value: eyeMatcap }
      shader.uniforms.zfEyeMatcapTint = { value: new THREE.Color('#d8f2ff') }
      declarations.push('uniform sampler2D zfEyeMatcap;', 'uniform vec3 zfEyeMatcapTint;')
      effects.push(`
        vec3 zfEyeN = normalize(normal);
        vec3 zfEyeV = normalize(vViewPosition);
        vec2 zfEyeMatcapUv = zfEyeN.xy * 0.5 + 0.5;
        vec3 zfEyeMatcapColor = texture2D(zfEyeMatcap, zfEyeMatcapUv).rgb;
        float zfEyeFresnel = pow(1.0 - max(dot(zfEyeN, zfEyeV), 0.0), 4.0);
        float zfEyeHighlight = smoothstep(0.72, 0.96, dot(zfEyeMatcapColor, vec3(0.333)));
        reflectedLight.directSpecular += zfEyeMatcapTint * zfEyeMatcapColor
          * (zfEyeHighlight * 0.85 + zfEyeFresnel * 0.12);`)
    }

    if (clothParams) {
      shader.uniforms.zfClothParams = { value: clothParams }
      declarations.push('uniform sampler2D zfClothParams;')
      effects.push(`
        vec4 zfClothP = texture2D(zfClothParams, vMapUv);
        float zfClothMetal = clamp(zfClothP.r, 0.0, 1.0);
        float zfClothReflectivity = clamp(zfClothP.g, 0.0, 1.0);
        float zfClothAO = clamp(zfClothP.b, 0.0, 1.0);
        float zfClothSmoothness = clamp(zfClothP.a, 0.04, 0.96);
        vec3 zfClothN = normalize(normal);
        vec3 zfClothV = normalize(vViewPosition);
        vec3 zfClothL = normalize(directionalLights[0].direction);
        vec3 zfClothH = normalize(zfClothL + zfClothV);
        float zfClothNdotH = max(dot(zfClothN, zfClothH), 0.0);
        float zfClothExponent = mix(8.0, 96.0, zfClothSmoothness);
        float zfClothSpec = smoothstep(0.16, 0.78, pow(zfClothNdotH, zfClothExponent));
        float zfClothF0 = mix(0.045, 0.62, zfClothMetal) * zfClothReflectivity;
        reflectedLight.directSpecular += directionalLights[0].color * vec3(0.83, 0.9, 1.0)
          * zfClothSpec * zfClothF0 * max(dot(zfClothN, zfClothL), 0.0);
        reflectedLight.indirectDiffuse *= mix(1.0, zfClothAO, 0.22);`)
    }

    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${declarations.join('\n')}\nvoid main() {`)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n${effects.join('\n')}\n#endif`,
    )
  }

  material.customProgramCacheKey = () => [
    'zf-character-v2', toon ? 1 : 0, isFace && faceSdfEnabled ? 1 : 0,
    isHair && hairSpecular ? 1 : 0, isSkin && scatterStrength > 0 ? 1 : 0,
    clothParams ? 1 : 0, isIris ? 1 : 0, rampRow,
  ].join('-')
  material.needsUpdate = true
  return material
}
