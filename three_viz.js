import * as THREE from "three";

export function makeViz(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 2.35, 5.35);
  camera.lookAt(0, 0.35, 0);

  const root = new THREE.Group();
  scene.add(root);

  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(3, 6, 2);
  scene.add(key);

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

  const grid = new THREE.GridHelper(planeSize, 28, 0x67d1ff, 0x1c2a3a);
  grid.position.y = 0.001;
  root.add(grid);

  const axisMat = new THREE.LineBasicMaterial({ color: 0x9bffa3 });
  root.add(makeLine([-half,0.012,0],[half,0.012,0],axisMat));
  root.add(makeLine([0,0.012,-half],[0,0.012,half],axisMat));

  // Corner quadrant labels (WE/WP/KE/KP), lifted so they do not clip
  const cornerY = 0.18;
  const cornerLabels = new THREE.Group();
  cornerLabels.position.y = cornerY;
  root.add(cornerLabels);

  cornerLabels.add(makeSpriteLabel("WE", -half*0.78, -half*0.78));
  cornerLabels.add(makeSpriteLabel("WP",  half*0.78, -half*0.78));
  cornerLabels.add(makeSpriteLabel("KE", -half*0.78,  half*0.78));
  cornerLabels.add(makeSpriteLabel("KP",  half*0.78,  half*0.78));

  // Edge labels: centered on edges, not on axis line.
  // Readable from both sides by drawing text twice on the texture.
  const sideY = 0.02;
  root.add(makeFlatEdgeLabel("Practicality",  half*0.92,  0, sideY, Math.PI));     // right edge
  root.add(makeFlatEdgeLabel("Empathy",      -half*0.92,  0, sideY, 0));          // left edge
  root.add(makeFlatEdgeLabel("Wisdom",        0, -half*0.92, sideY, Math.PI/2));  // far edge
  root.add(makeFlatEdgeLabel("Knowledge",     0,  half*0.92, sideY, -Math.PI/2)); // near edge

  // Particles
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

  // Pins
  const pinGroup = new THREE.Group();
  root.add(pinGroup);
  const pins = new Map(); // id -> {group, mat}

  function makePin(colorHex){
    const g = new THREE.Group();

    // Single inverted cone: base up, tip down touching the plane
    const coneGeo = new THREE.ConeGeometry(0.14, 0.52, 32);
    coneGeo.translate(0, 0.26, 0); // move so tip is near y=0 after rotation
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.18
    });

    const cone = new THREE.Mesh(coneGeo, mat);
    // By default cone tip is down in threejs when rotated? Actually cone points up on +Y.
    // Rotate 180 so tip points down.
    cone.rotation.x = Math.PI;
    g.add(cone);

    // Lift slightly so the tip doesn’t z-fight
    g.position.y = 0.03;

    return { g, mat };
  }

  function setPins(pinList){
    // pinList: [{id, x, y, color, selected}]
    const keep = new Set(pinList.map(p => p.id));

    for(const [id, obj] of pins.entries()){
      if(!keep.has(id)){
        pinGroup.remove(obj.g);
        pins.delete(id);
      }
    }

    for(const p of pinList){
      if(!pins.has(p.id)){
        const made = makePin(p.color);
        pins.set(p.id, made);
        pinGroup.add(made.g);
      }

      const obj = pins.get(p.id);
      obj.mat.color.setHex(p.color);
      obj.mat.emissive.setHex(p.color);
      obj.mat.emissiveIntensity = p.selected ? 0.95 : 0.55;

      const nx = clamp(p.x / 100, -1, 1);
      const ny = clamp(p.y / 100, -1, 1);

      obj.g.position.x = nx * (half * 0.86);
      obj.g.position.z = -ny * (half * 0.86);

      // subtle idle motion
      obj.g.position.y = 0.03 + Math.sin(performance.now() * 0.002 + hashTo01(p.id) * 10) * 0.01;
    }
  }

  // Drag rotation using plane raycast + inertia (kept from previous)
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

  const baseSpinMag = 0.10;

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
    rot.vy = delta * 60;
    rot.y += delta;

    if(Math.abs(rot.vy) > 0.01){
      rot.spinDir = Math.sign(rot.vy) || rot.spinDir;
    }
  });

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
      rot.vy *= Math.pow(0.001, dt);
      if(Math.abs(rot.vy) < 0.01){
        rot.y += rot.spinDir * baseSpinMag * dt;
      }else{
        rot.y += rot.vy * dt;
      }
    }

    root.rotation.y = rot.y;

    pts.rotation.y -= dt * 0.04;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  tick();

  return {
    setPins
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

function makeFlatEdgeLabel(text, x, z, y, yaw){
  const mesh = textPlaneDouble(text);
  mesh.position.set(x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = yaw;
  return mesh;
}

function textPlaneDouble(text){
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0,0,512,128);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, 18, 18, 476, 92, 18);
  ctx.fill();

  // draw text normally
  ctx.font = "900 54px ui-sans-serif, system-ui, Arial";
  ctx.fillStyle = "rgba(207,226,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);

  // draw text again mirrored (so it’s readable when rotated around)
  ctx.save();
  ctx.translate(256, 64);
  ctx.rotate(Math.PI);
  ctx.translate(-256, -64);
  ctx.fillText(text, 256, 64);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const geo = new THREE.PlaneGeometry(1.90, 0.42);
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

function hashTo01(str){
  let h = 2166136261 >>> 0;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
