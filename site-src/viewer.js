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
    this.current = null;
    this._running = false;
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
    // frame it
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) { box.set(new THREE.Vector3(-8, -8, -8), new THREE.Vector3(8, 8, 8)); }
    const size = box.getSize(new THREE.Vector3()).length() || 16;
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    const d = size * 0.9;
    this.camera.position.set(center.x + d * 0.75, center.y + d * 0.55, center.z + d * 0.75);
    this.camera.near = size / 100;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.start();
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
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
