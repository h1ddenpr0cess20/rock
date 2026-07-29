export function buildEnvironment({ stage, THREE }) {
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const ctx = c.getContext('2d');

    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#cdd6e6');
    g.addColorStop(0.45, '#7c8493');
    g.addColorStop(0.52, '#3a342e');
    g.addColorStop(1, '#100e0c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 32);

    ctx.fillStyle = 'rgba(255,240,214,0.95)';
    ctx.beginPath(); ctx.ellipse(18, 7, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,180,220,0.55)';
    ctx.beginPath(); ctx.ellipse(48, 13, 7, 4, 0, 0, Math.PI * 2); ctx.fill();

    const tex = new THREE.Texture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(stage._renderer);
    stage._scene.environment = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
  } catch {
  }
}
