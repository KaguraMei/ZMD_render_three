import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'

const gtToneMapShader = {
  name: 'ZhuangFangyiGTToneMap',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    float gtCurve(float x) {
      const float m = 0.22;
      const float a = 1.0;
      const float c = 1.33;
      const float P = 1.0;
      const float l = 0.4;
      float l0 = ((P - m) * l) / a;
      float S0 = m + l0;
      float S1 = m + a * l0;
      float C2 = (a * P) / (P - S1);
      float L = m + a * (x - m);
      float T = m * pow(max(x / m, 0.0), c);
      float S = P - (P - S1) * exp(-C2 * (x - S0) / P);
      float w0 = 1.0 - smoothstep(0.0, m, x);
      float w2 = step(m + 1.0, x);
      float w1 = 1.0 - w0 - w2;
      return T * w0 + L * w1 + S * w2;
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 mapped = vec3(gtCurve(source.r), gtCurve(source.g), gtCurve(source.b));
      gl_FragColor = vec4(max(mapped, vec3(0.0)), source.a);
      #include <colorspace_fragment>
    }
  `,
}

export function createCharacterComposer(renderer, scene, camera, size, bloomEnabled, characterRoot) {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const outlinePass = new OutlinePass(new THREE.Vector2(size.width, size.height), scene, camera)
  outlinePass.selectedObjects = characterRoot ? [characterRoot] : []
  outlinePass.edgeStrength = 1.45
  outlinePass.edgeGlow = 0
  outlinePass.edgeThickness = 1.8
  outlinePass.pulsePeriod = 0
  outlinePass.visibleEdgeColor.set('#15171d')
  outlinePass.hiddenEdgeColor.set('#232630')
  composer.addPass(outlinePass)
  composer.outlinePass = outlinePass
  if (bloomEnabled) {
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.32, 0.42, 0.9))
  }
  composer.addPass(new ShaderPass(gtToneMapShader))
  composer.setSize(size.width, size.height)
  return composer
}
