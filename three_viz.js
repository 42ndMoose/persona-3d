import * as THREE from "https://cdn.jsdelivr.net/npm/[email protected]/build/three.module.js";

function makeTextTexture(text, {
  font = "bold 48px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
  padding = 24
} = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width + padding * 2);
  const h = 96;

  canvas.width = w;
  canvas.height = h;

  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.clearRect(0, 0, w, h);
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeLabelMesh(text, pos, rotY) {
  const tex = makeTextTexture(text);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const geo = new THREE.PlaneGeometry(22, 4.2);
  const mesh = new THREE.Mesh(geo, mat);

  // Lie down with the plane
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = rotY;
  mesh.position.set(pos.x, pos.y, pos.z);

  return mesh;
}

export function createThreeViz(canvas, onBackgroundInteract) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  camera.position.set(0, 62, 86);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(40, 80, 30);
  scene.add(dir);

  // Plane
  const planeSize = 70;
  const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0x121a25,
    roughness: 0.85,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  scene.add(plane);

  // Border
  const edges = new THREE.EdgesGeometry(planeGeo);
  const edgeLine = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2b3d54, transparent: true, opacity: 0.9 }));
  edgeLine.rotation.copy(plane.rotation);
  scene.add(edgeLine);

  // Labels OUTSIDE edges, consistently rotated
  const edge = planeSize / 2;
  const yLift = 0.20;
  const out = 1.14;

  // Mapping:
  // +Z => Practicality (top)
  // -Z => Empathy (bottom)
  // -X => Knowledge (left)
  // +X => Wisdom (right)
  const labels = new THREE.Group();
  labels.add(makeLabelMesh("Practicality", new THREE.Vector3(0, yLift, edge * out), Math.PI));        // bottom of text faces center
  labels.add(makeLabelMesh("Empathy", new THREE.Vector3(0, yLift, -edge * out), 0));
  labels.add(makeLabelMesh("Knowledge", new THREE.Vector3(-edge * out, yLift, 0), -Math.PI / 2));
  labels.add(makeLabelMesh("Wisdom", new THREE.Vector3(edge * out, yLift, 0), Math.PI / 2));
  scene.add(labels);

  // Pins
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);

  function makePin(colorHex) {
    const g = new THREE.Group();

    const coneGeo = new THREE.ConeGeometry(1.15, 3.8, 24);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.05 });
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.position.y = 2.0;

    // Make it point DOWN into the plane
    cone.rotation.x = Math.PI;

    const capGeo = new THREE.SphereGeometry(1.15, 18, 18);
    const cap = new THREE.Mesh(capGeo, mat);
    cap.position.y = 4.2;

    g.add(cone);
    g.add(cap);

    return g;
  }

  const pinMap = new Map();

  function setPins(personas) {
    // remove missing
    for (const [id, obj] of pinMap.entries()) {
      if (!personas.find(p => p.id === id)) {
        pinGroup.remove(obj);
        pinMap.delete(id);
      }
    }

    // add/update
    for (const p of personas) {
      let pin = pinMap.get(p.id);
      if (!pin) {
        pin = makePin(p.color);
        pinGroup.add(pin);
        pinMap.set(p.id, pin);
      }
      pin.position.set(p.coords.x, 0.01, p.coords.y);
    }
  }

  // Interaction: spin with inertia, direction follows last spin
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let dragging = false;
  let lastX = 0;
  let rotVel = 0;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function setPointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function getPlaneLocalHit(e) {
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(plane, true);
    if (!hits.length) return null;

    const hit = hits[0].point.clone();
    // world -> plane local
    plane.worldToLocal(hit);
    return hit;
  }

  canvas.addEventListener("pointerdown", (e) => {
    // background interaction
    if (typeof onBackgroundInteract === "function") onBackgroundInteract();

    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    rotVel = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;

    const dx = e.clientX - lastX;
    lastX = e.clientX;

    const hitLocal = getPlaneLocalHit(e);
    // if cursor is on near side (toward camera), dx left spins one way; far side flips direction
    let flip = 1;
    if (hitLocal) {
      // camera is in +Z world, after plane rotation the near-side in plane local tends to be +Z local
      flip = hitLocal.z >= 0 ? 1 : -1;
    }

    const delta = (dx * 0.0055) * flip;
    plane.rotation.y += delta;
    edgeLine.rotation.y = plane.rotation.y;
    labels.rotation.y = plane.rotation.y;
    pinGroup.rotation.y = plane.rotation.y;

    rotVel = delta;
  });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });

  function tick() {
    // inertia
    if (!dragging) {
      if (Math.abs(rotVel) > 0.00001) {
        plane.rotation.y += rotVel;
        edgeLine.rotation.y = plane.rotation.y;
        labels.rotation.y = plane.rotation.y;
        pinGroup.rotation.y = plane.rotation.y;
        rotVel *= 0.965;
      } else {
        rotVel = 0;
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  resize();
  tick();

  return {
    setPins
  };
}
