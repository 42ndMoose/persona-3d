import * as THREE from "three";

export function makeViz(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 3.1, 6.2);

  const root = new THREE.Group();
  scene.add(root);

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.40));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(3, 6, 2);
  scene.add(key);

  // plane + grid
  const planeGeo = new THREE.PlaneGeometry(5.2, 5.2, 1, 1);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0x0f1b27,
    roughness: 0.90,
    metalness: 0.08,
    transparent: true,
    opacity: 0.92
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  root.add(plane);

  const grid = new THREE.GridHelper(5.2, 26, 0x67d1ff, 0x1c2a3a);
  grid.position.y = 0.001;
  root.add(grid);

  // axis lines
  const axisMat = new THREE.LineBasicMaterial({ color: 0x9bffa3 });
  root.add(makeLine([-2.6,0.01,0],[2.6,0.01,0],axisMat));
  root.add(makeLine([0,0.01,-2.6],[0,0.01,2.6],axisMat));

  // quadrant labels
  const labels = new THREE.Group();
  labels.position.y = 0.02;
  root.add(labels);

  labels.add(makeLabel("WE", -2.2, -2.2));
  labels.add(makeLabel("WP",  2.2, -2.2));
  labels.add(makeLabel("KE", -2.2,  2.2));
  labels.add(makeLabel("KP",  2.2,  2.2));

  // Drop pin marker
  const pin = new THREE.Group();
  root.add(pin);

  const headGeo = new THREE.SphereGeometry(0.12, 24, 24);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x67d1ff,
    emissive: 0x103b4a,
    emissiveIntensity: 1.25,
    roughness: 0.2,
    metalness: 0.2
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.38;
  pin.add(head);

  const bodyGeo = new THREE.ConeGeometry(0.10, 0.34, 24);
  const body = new THREE.Mesh(bodyGeo, headMat);
  body.position.y = 0.19;
  pin.add(body);

  // subtle particles
  const pCount = 260;
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(pCount * 3);
  for(let i=0;i<pCount;i++){
    const r = 3.1 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    pos[i*3+0] = Math.cos(a) * r;
    pos[i*3+1] = 0.25 + Math.random() * 1.9;
    pos[i*3+2] = Math.sin(a) * r;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x67d1ff, size: 0.016, transparent:true, opacity:0.50 });
  const pts = new THREE.Points(pGeo, pMat);
  root.add(pts);

  // drag rotation with inertia (horizontal only)
  const rot = { y: 0, vy: 0, dragging: false, lastX: 0 };
  const baseSpin = 0.12; // rad/sec

  canvas.addEventListener("pointerdown", (e) => {
    rot.dragging = true;
    rot.lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", (e) => {
    rot.dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if(!rot.dragging) return;
    const dx = e.clientX - rot.lastX;
    rot.lastX = e.clientX;
    rot.vy = dx * 0.008;      // inject velocity
    rot.y += dx * 0.008;
  });

  // state for pin coordinates
  const state = { targetX: 0, targetZ: 0 };

  function resize(){
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  let t0 = performance.now();
  function tick(){
    const t1 = performance.now();
    const dt = Math.min(0.033, (t1 - t0) / 1000);
    t0 = t1;

    // rotation: base spin unless user is holding
    if(!rot.dragging){
      rot.vy *= Math.pow(0.001, dt); // decay
      rot.y += (baseSpin * dt) + (rot.vy * dt);
    }
    root.rotation.y = rot.y;

    // smooth-follow pin
    pin.position.x += (state.targetX - pin.position.x) * (1 - Math.pow(0.001, dt));
    pin.position.z += (state.targetZ - pin.position.z) * (1 - Math.pow(0.001, dt));

    // pin bob
    pin.position.y = 0.02 + Math.sin(t1 * 0.0022) * 0.02;
    pts.rotation.y -= dt * 0.04;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  tick();

  return {
    setQuadrantXY(x, y){
      // x,y in [-100,100] -> plane coords [-2.4,2.4]
      const nx = clamp(x / 100, -1, 1);
      const ny = clamp(y / 100, -1, 1);
      state.targetX = nx * 2.4;
      state.targetZ = -ny * 2.4;
    }
  };
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function makeLine(a, b, mat){
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a[0],a[1],a[2]),
    new THREE.Vector3(b[0],b[1],b[2])
  ]);
  return new THREE.Line(geo, mat);
}

function makeLabel(text, x, z){
  const sprite = textSprite(text);
  sprite.position.set(x, 0.01, z);
  sprite.scale.set(0.9, 0.45, 1);
  return sprite;
}

function textSprite(text){
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0,0,256,128);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, 18, 26, 220, 76, 18);
  ctx.fill();

  ctx.font = "bold 56px ui-sans-serif, system-ui, Arial";
  ctx.fillStyle = "rgba(207,226,255,0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}
