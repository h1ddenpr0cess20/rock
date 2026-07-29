const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

const noise = (x, y, z) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), L(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    L(L(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), L(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w) * 2 - 1;
};

function cuttingPlanes(THREE) {
  const planes = [];
  for (let i = 0; i < 13; i++) {
    const a = i * 2.399963;
    const y = 1 - 2 * (i + 0.5) / 13;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    planes.push({
      n: new THREE.Vector3(Math.cos(a) * r, y * 0.75, Math.sin(a) * r).normalize(),
      d: 0.74 + hash(i, i * 3, 7) * 0.2,
    });
  }
  return planes;
}

export function createRock(THREE) {
  const geometry = new THREE.IcosahedronGeometry(1, 6).toNonIndexed();
  const planes = cuttingPlanes(THREE);

  const p = geometry.attributes.position.array;
  const v = new THREE.Vector3();
  const colors = new Float32Array(p.length);
  const base = new THREE.Color('#8a8278');
  const dark = new THREE.Color('#453f39');
  const pale = new THREE.Color('#b8b0a2');
  const tc = new THREE.Color();

  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i + 1], p[i + 2]).normalize();

    const d = 1
      + noise(v.x * 2.1 + 11, v.y * 2.1, v.z * 2.1) * 0.19
      + noise(v.x * 4.7, v.y * 4.7 + 5, v.z * 4.7) * 0.085
      + noise(v.x * 11, v.y * 11, v.z * 11 + 3) * 0.03;
    v.multiplyScalar(d);

    for (const pl of planes) {
      const t = v.dot(pl.n);
      if (t > pl.d) v.addScaledVector(pl.n, -(t - pl.d) * 0.92);
    }

    if (v.y < -0.87) v.y = -0.87 + (v.y + 0.87) * 0.18;

    p[i] = v.x; p[i + 1] = v.y * 0.94; p[i + 2] = v.z;

    const m = noise(v.x * 6, v.y * 6, v.z * 6) * 0.5 + 0.5;
    const grit = hash(Math.round(v.x * 90), Math.round(v.y * 90), Math.round(v.z * 90));
    tc.copy(base).lerp(dark, Math.pow(m, 1.6) * 0.75).lerp(pale, grit > 0.93 ? 0.6 : 0);
    colors[i] = tc.r; colors[i + 1] = tc.g; colors[i + 2] = tc.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    name: 'granite',
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.06,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rock_body';

  return { mesh, geometry, material };
}
