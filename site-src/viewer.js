// Three.js scene wrapper for model previews.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.6;
    // stop the showcase spin as soon as the user takes over
    this.controls.addEventListener('start', () => {
      if (this.controls.autoRotate) { this.controls.autoRotate = false; this.onAutoRotateChange?.(false); }
    });
    this.current = null;
    this.grid = null;
    this.onTick = null;
    this.onAutoRotateChange = null;
    this._running = false;
    this._fit = null;
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  _resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = el.clientWidth || 300, h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(group) {
    if (this.current) this.scene.remove(this.current);
    this.current = group;
    this.scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) { box.set(new THREE.Vector3(-8, -8, -8), new THREE.Vector3(8, 8, 8)); }
    const size = box.getSize(new THREE.Vector3()).length() || 16;
    const center = box.getCenter(new THREE.Vector3());
    this._fit = { center, size, bottom: box.min.y };
    this._placeGrid();
    this.resetView();
    this.camera.near = size / 100;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.start();
  }

  resetView() {
    if (!this._fit) return;
    const { center, size } = this._fit;
    this.controls.target.copy(center);
    const d = size * 0.9;
    this.camera.position.set(center.x + d * 0.75, center.y + d * 0.55, center.z + d * 0.75);
    this.controls.update();
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
    this.onAutoRotateChange?.(on);
  }

  zoom(factor) {
    // move the camera toward/away from the target
    const t = this.controls.target;
    this.camera.position.sub(t).multiplyScalar(factor).add(t);
    this.controls.update();
  }

  setGrid(on) {
    if (this.grid) { this.scene.remove(this.grid); this.grid = null; }
    if (on) {
      this.grid = new THREE.GridHelper(64, 16, 0x3a4a6a, 0x252d42);
      this._placeGrid();
      this.scene.add(this.grid);
    }
  }

  _placeGrid() {
    if (this.grid && this._fit) {
      this.grid.position.y = this._fit.bottom - 0.01;
      this.grid.position.x = this._fit.center.x;
      this.grid.position.z = this._fit.center.z;
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const dt = now - last; last = now;
      this.controls.update();
      this.onTick?.(dt);
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
  }
}
