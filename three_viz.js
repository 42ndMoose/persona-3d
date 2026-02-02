import * as THREE from "three";

export function makeViz(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 2.2, 4.6);

  const root = new THREE.Group();
  scene.add(root);

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 4, 2);
  scene.add(key);

  // plane + grid
  const planeGeo = new THREE.PlaneGeometry(4.2, 4.2, 1, 1);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0x0f1b27,
    roughness: 0.85,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  root.add(plane);

  const grid = new THREE.GridHelper(4.2, 21, 0x67d1ff, 0x1c2a3a);
  grid.position.y = 0.001;
  root.add(grid);

  // axis lines
  const axisMat = new THREE.LineBasicMaterial({ color: 0x9bffa3 });
  const xLine = makeLine([-2.1,0.01,0], [2.1,0.01,0], axisMat);
  const zLine = makeLine([0,0.01,-2.1], [0,0.01,2.1], axisMat);
  root.add(xLine, zLine);

  // orb that represents current quadrant point
  const orbGeo = new THREE.SphereGeometry(0.12, 32, 32);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x67d1ff,
    emissive: 0x103b4a,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.2
  });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.set(0, 0.16, 0);
  root.add(orb);

  // subtle particles
  const pCount = 240;
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(pCount * 3);
  for(let i=0;i<pCount;i++){
    const r = 2.3 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    pos[i*3+0] = Math.cos(a) * r;
    pos[i*3+1] = 0.05 + Math.random() * 1.3;
    pos[i*3+2] = Math.sin(a) * r;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x67d1ff, size: 0.015, transparent:true, opacity:0.55 });
  const pts = new THREE.Points(pGeo, pMat);
  root.add(pts);

  // state
  const state = {
    targetX: 0,
    targetZ: 0
  };

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

    // orbit drift
    root.rotation.y += dt * 0.12;

    // smooth-follow orb
    orb.position.x += (state.targetX - orb.position.x) * (1 - Math.pow(0.001, dt));
    orb.position.z += (state.targetZ - orb.position.z) * (1 - Math.pow(0.001, dt));

    orb.position.y = 0.16 + Math.sin(t1 * 0.0022) * 0.03;
    pts.rotation.y -= dt * 0.04;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  tick();

  return {
    setQuadrantXY(x, y){
      // map x,y in [-100,100] to plane coordinates [-2.0,2.0]
      const nx = clamp(x / 100, -1, 1);
      const ny = clamp(y / 100, -1, 1);

      // x axis -> X, y axis -> Z
      state.targetX = nx * 2.0;
      state.targetZ = -ny * 2.0; // invert so "up" shows toward camera nicely
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
