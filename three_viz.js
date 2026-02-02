import * as THREE from "three";

export function makeViz(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 2.35, 5.35);
  camera.lookAt(0, 0.35, 0);

  // root
  const root = new THREE.Group();
  scene.add(root);

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(3, 6, 2);
  scene.add(key);

  // plane
  const planeSize = 5.6;
  const half = planeSize / 2;

  const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0x0f1b27,
    roughness: 0.92,
    metalness: 0.06,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  root.add(plane);

  // grid
  const grid = new THREE.GridHelper(planeSize, 28, 0x67d1ff, 0x1c2a3a);
  grid.position.y = 0.001;
  root.add(grid);

  // axis lines
  const axisMat = new THREE.LineBasicMaterial({ color: 0x9bffa3 });
  root.add(makeLine([-half,0.012,0],[half,0.012,0],axisMat));
  root.add(makeLine([0,0.012,-half],[0,0.012,half],axisMat));

  // quadrant corner labels (ke/kp/we/wp), lifted so they do not clip
  const cornerY = 0.18;
  const cornerLabels = new THREE.Group();
  cornerLabels.position.y = cornerY;
  root.add(cornerLabels);

  cornerLabels.add(makeSpriteLabel("WE", -half*0.78, -half*0.78));
  cornerLabels.add(makeSpriteLabel("WP",  half*0.78, -half*0.78));
  cornerLabels.add(makeSpriteLabel("KE", -half*0.78,  half*0.78));
  cornerLabels.add(makeSpriteLabel("KP",  half*0.78,  half*0.78));

  // side axis labels lying on plane, rotated so the bottom of text faces center
  const sideY = 0.02;
  root.add(makeFlatSideLabel("Practicality",  half*0.92,  0, sideY, Math.PI));          // right, face center
  root.add(makeFlatSideLabel("Empathy",      -half*0.92,  0, sideY, 0));                 // left
  root.add(makeFlatSideLabel("Wisdom",        0, -half*0.92, sideY, Math.PI/2));          // top (far)
  root.add(makeFlatSideLabel("Knowledge",     0,  half*0.92, sideY, -Math.PI/2));         // bottom (near)

  // drop pin marker
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
  head.position.y = 0.42;
  pin.add(head);

  const bodyGeo = new THREE.ConeGeometry(0.10, 0.34, 24);
  const body = new THREE.Mesh(bodyGeo, headMat);
  body.position.y = 0.22;
  pin.add(body);

  // subtle particles
  const pCount = 260;
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(pCount * 3);
  for(let i=0;i<pCount;i++){
    const r = 3.2 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    pos[i*3+0] = Math.cos(a) * r;
    pos[i*3+1] = 0.35 + Math.random() * 2.0;
    pos[i*3+2] = Math.sin(a) * r;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x67d1ff, size: 0.016, transparent:true, opacity:0.45 });
  const pts = new THREE.Points(pGeo, pMat);
  root.add(pts);

  // drag rotation via plane raycast + inertia
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const rot = {
    y: 0,
    vy: 0,
    dragging: false,
    lastX: 0,
    sideSign: 1,
    spinDir: 1
  };

  const baseSpinMag = 0.10; // rad/sec, sign comes from rot.spinDir

  function setNDCFromEvent(e){
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  function raycastPlane(e){
    setNDCFromEvent(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(plane, false);
    return hits[0] || null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const hit = raycastPlane(e);
    if(!hit) return;

    rot.dragging = true;
    rot.lastX = e.clientX;

    // near side for camera at +Z is z > 0
    rot.sideSign = (hit.point.z > 0) ? 1 : -1;

    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointerup", (e) => {
    rot.dragging = false;
    try{ canvas.releasePointerCapture(e.pointerId); }catch{}
  });

  canvas.addEventListener("pointermove", (e) => {
    if(!rot.dragging) return;
    const dx = e.clientX - rot.lastX;
    rot.lastX = e.clientX;

    const delta = dx * 0.008 * rot.sideSign;
    rot.vy = delta * 60; // convert to per-second-ish velocity
    rot.y += delta;

    if(Math.abs(rot.vy) > 0.01){
      rot.spinDir = Math.sign(rot.vy) || rot.spinDir;
    }
  });

  // state for pin coords
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

    if(!rot.dragging){
      // decay inertia
      rot.vy *= Math.pow(0.001, dt);
      if(Math.abs(rot.vy) < 0.01){
        rot.y += rot.spinDir * baseSpinMag * dt;
      }else{
        rot.y += rot.vy * dt;
      }
    }

    root.rotation.y = rot.y;

    // smooth-follow pin
    pin.position.x += (state.targetX - pin.position.x) * (1 - Math.pow(0.001, dt));
    pin.position.z += (state.targetZ - pin.position.z) * (1 - Math.pow(0.001, dt));
    pin.position.y = 0.02 + Math.sin(t1 * 0.0022) * 0.02;

    pts.rotation.y -= dt * 0.04;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  tick();

  return {
    setQuadrantXY(x, y){
      const nx = clamp(x / 100, -1, 1);
      const ny = clamp(y / 100, -1, 1);
      state.targetX = nx * (half * 0.86);
      state.targetZ = -ny * (half * 0.86);
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

function makeSpriteLabel(text, x, z){
  const sprite = textSprite(text);
  sprite.position.set(x, 0.0, z);
  sprite.scale.set(0.9, 0.45, 1);
  return sprite;
}

function textSprite(text){
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0,0,256,128);
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  roundRect(ctx, 20, 28, 216, 72, 16);
  ctx.fill();

  ctx.font = "900 56px ui-sans-serif, system-ui, Arial";
  ctx.fillStyle = "rgba(207,226,255,0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent:true,
    depthTest: false,
    depthWrite:false
  });

  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 50;
  return sprite;
}

function makeFlatSideLabel(text, x, z, y, yaw){
  const mesh = textPlane(text);
  mesh.position.set(x, y, z);
  mesh.rotation.x = -Math.PI / 2; // lie flat
  mesh.rotation.z = yaw;          // rotate around up-axis (because it is flat)
  return mesh;
}

function textPlane(text){
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0,0,512,128);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, 18, 18, 476, 92, 18);
  ctx.fill();

  ctx.font = "900 54px ui-sans-serif, system-ui, Arial";
  ctx.fillStyle = "rgba(207,226,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const geo = new THREE.PlaneGeometry(1.75, 0.42);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent:true,
    depthTest:false,
    depthWrite:false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 60;
  return mesh;
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
