import * as THREE from 'three';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

// --- CONFIG ---
const PARTICLE_COUNT = 10000;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- SHAPE GENERATORS ---
const getPositions = (type) => {
  const arr = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    let x, y, z;
    if (type === 'heart') {
      const t = Math.random() * Math.PI * 2;
      x = 16 * Math.pow(Math.sin(t), 3);
      y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      z = (Math.random() - 0.5) * 5;
    } else if (type === 'saturn') {
      const isRing = Math.random() > 0.4;
      if (isRing) {
        const r = 15 + Math.random() * 5;
        const theta = Math.random() * Math.PI * 2;
        x = r * Math.cos(theta);
        y = (Math.random() - 0.5) * 2;
        z = r * Math.sin(theta);
      } else {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        x = 8 * Math.sin(phi) * Math.cos(theta);
        y = 8 * Math.sin(phi) * Math.sin(theta);
        z = 8 * Math.cos(phi);
      }
    } else { // Default Sphere / Explosion
      const r = 20 * Math.pow(Math.random(), 0.5);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta);
      z = r * Math.cos(phi);
    }
    arr.set([x, y, z], i * 3);
  }
  return arr;
};

// --- SHADER MATERIAL ---
const particleMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uTransition: { value: 0 },
    uColor: { value: new THREE.Color(0x00ffcc) }
  },
  vertexShader: `
    uniform float uTime;
    uniform float uTransition;
    attribute vec3 targetPosition;
    varying vec3 vColor;
    void main() {
      vec3 pos = mix(position, targetPosition, uTransition);
      pos.x += sin(uTime + pos.y * 0.5) * 0.2; // Gentle sway
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = 4.0 * (10.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      if (d > 0.5) discard; // Make points circular
      gl_FragColor = vec4(uColor, 1.0 - (d * 2.0));
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthTest: false
});

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(getPositions('sphere'), 3));
geometry.setAttribute('targetPosition', new THREE.BufferAttribute(getPositions('saturn'), 3));

const points = new THREE.Points(geometry, particleMaterial);
scene.add(points);
camera.position.z = 50;

// --- HAND TRACKING ---
const videoElement = document.getElementById('input_video') || document.getElementsByClassName('input_video')[0];
videoElement.style.display = 'none';

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
  selfieMode: true
});

// landmark canvas for debug / visual feedback
const landmarkCanvas = document.getElementById('landmarkCanvas');
const lctx = landmarkCanvas ? landmarkCanvas.getContext('2d') : null;

function resizeLandmarkCanvas() {
  if (!landmarkCanvas || !videoElement) return;
  const vw = videoElement.videoWidth || 640;
  const vh = videoElement.videoHeight || 480;
  // set backing store size to video resolution but CSS keeps preview small
  landmarkCanvas.width = vw;
  landmarkCanvas.height = vh;
  landmarkCanvas.style.width = videoElement.style.width || '200px';
  landmarkCanvas.style.height = videoElement.style.height || 'auto';
}

function drawLandmarks(landmarks) {
  if (!lctx || !landmarkCanvas) return;
  lctx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
  lctx.fillStyle = 'rgba(0,255,200,0.9)';
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const x = lm.x * landmarkCanvas.width;
    const y = lm.y * landmarkCanvas.height;
    lctx.beginPath();
    lctx.arc(x, y, 6, 0, Math.PI * 2);
    lctx.fill();
  }
}

hands.onResults((results) => {
  if (results.multiHandLandmarks && results.multiHandLandmarks[0]) {
    const landmarks = results.multiHandLandmarks[0];
    // draw landmarks for feedback
    drawLandmarks(landmarks);

    // Pinch logic (Index tip to Thumb tip) using normalized landmarks
    const dx = landmarks[8].x - landmarks[4].x;
    const dy = landmarks[8].y - landmarks[4].y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // debug log for visibility
    console.debug('hand detected - pinch distance:', distance.toFixed(3));

    // Adjust threshold to be more forgiving; map to transition
    const THRESH = 0.12;
    const targetVal = distance < THRESH ? 1.0 : 0.0;
    particleMaterial.uniforms.uTransition.value = THREE.MathUtils.lerp(
      particleMaterial.uniforms.uTransition.value, targetVal, 0.15
    );

    // Map hand position to rotation (use palm base x/y if available)
    points.rotation.y = (landmarks[0].x - 0.5) * Math.PI * 2; // center offset
    points.rotation.x = (landmarks[0].y - 0.5) * Math.PI * 2;
  } else {
    // clear canvas when no hand
    if (lctx && landmarkCanvas) lctx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
  }
});

// Camera control (created lazily so user can toggle)
let mediapipeCamera = null;
let isCameraRunning = false;

function createMediapipeCamera() {
  if (!videoElement) throw new Error('Video element not found');
  // ensure video element will autoplay and play inline (mobile)
  videoElement.playsInline = true;
  videoElement.muted = true;
  videoElement.autoplay = true;

  mediapipeCamera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640,
    height: 480,
    facingMode: 'user'
  });
}

async function startCamera() {
  try {
    if (!mediapipeCamera) createMediapipeCamera();
    await mediapipeCamera.start();
    isCameraRunning = true;
    videoElement.style.display = 'block';
    // ensure landmark canvas matches video resolution
    if (videoElement) {
      videoElement.onloadedmetadata = () => resizeLandmarkCanvas();
      resizeLandmarkCanvas();
    }
    document.getElementById('cameraBtn').textContent = 'Disable Camera';
    document.getElementById('status').textContent = 'Camera on';
  } catch (err) {
    console.error('Camera start failed:', err);
    document.getElementById('status').textContent = 'Camera error';
  }
}

function stopCamera() {
  try {
    if (mediapipeCamera && typeof mediapipeCamera.stop === 'function') {
      mediapipeCamera.stop();
    }
    // also stop tracks if present
    if (videoElement && videoElement.srcObject) {
      const s = videoElement.srcObject;
      if (s.getTracks) s.getTracks().forEach(t => t.stop());
      videoElement.srcObject = null;
    }
  } catch (err) {
    console.warn('Error stopping camera', err);
  }
  isCameraRunning = false;
  videoElement.style.display = 'none';
  if (lctx && landmarkCanvas) lctx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
  const btn = document.getElementById('cameraBtn');
  if (btn) btn.textContent = 'Enable Camera';
  const st = document.getElementById('status');
  if (st) st.textContent = 'Camera off';
}

// Wire up UI button
const cameraBtn = document.getElementById('cameraBtn');
if (cameraBtn) {
  cameraBtn.addEventListener('click', async () => {
    if (isCameraRunning) stopCamera(); else await startCamera();
  });
}

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);
  particleMaterial.uniforms.uTime.value += 0.05;
  renderer.render(scene, camera);
}
animate();

// Resize Handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});