import * as THREE from "three";
import { GLTFLoader } from "./vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "./vendor/three/examples/jsm/controls/OrbitControls.js";
import {
	VRMLoaderPlugin,
	VRMUtils,
} from "./vendor/three-vrm/three-vrm.module.min.js";

/// The 3D display (docs/tads/vrm-viewer.md): parses a fetched .vrm
/// and shows it on its own canvas overlaying the vector canvas,
/// with orbit controls and the model's own spring-bone physics.
/// Owns nothing between show() and hide(); hide() is idempotent
/// and disposes the model, renderer, and canvas completely.
export default class VRMViewer {
	/// - Parameter rootContainer: The element to mount the canvas in
	constructor(rootContainer) {
		this.rootContainer = rootContainer;
	}

	/// Parse and display a model. Throws (mounting nothing) on a
	/// parse failure, a glTF with no VRM extension, or WebGL being
	/// unavailable.
	///
	/// - Parameter arrayBuffer: The .vrm bytes
	async show(arrayBuffer) {
		this.hide();
		// Parse first so a bad model never creates a GL context
		const gltf = await new Promise((resolve, reject) => {
			const loader = new GLTFLoader();
			loader.register((parser) => new VRMLoaderPlugin(parser));
			loader.parse(arrayBuffer, "", resolve, reject);
		});
		const vrm = gltf.userData.vrm;
		if (!vrm) {
			throw new Error("model has no VRM extension");
		}
		// Normalize VRM 0.x facing to the VRM 1 convention so the
		// camera setup below works for both
		VRMUtils.rotateVRM0(vrm);

		const canvas = document.createElement("canvas");
		canvas.setAttribute("id", "vrmCanvas");
		let renderer;
		try {
			// preserveDrawingBuffer keeps the frame readable after
			// render - screenshots and the harness's blank-canvas
			// check depend on it
			renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: true,
				alpha: true,
				preserveDrawingBuffer: true,
			});
		} catch (error) {
			VRMUtils.deepDispose(vrm.scene);
			throw new Error("WebGL is unavailable: " + error.message);
		}
		renderer.setPixelRatio(window.devicePixelRatio || 1);
		renderer.setSize(window.innerWidth, window.innerHeight);

		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
		const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
		keyLight.position.set(1, 2, 2);
		scene.add(keyLight);
		scene.add(vrm.scene);

		// Frame the model from its measured bounds: distance chosen
		// so the full height fits the vertical fov with margin
		const bounds = new THREE.Box3().setFromObject(vrm.scene);
		const center = bounds.getCenter(new THREE.Vector3());
		const size = bounds.getSize(new THREE.Vector3());
		const fov = 30;
		const distance =
			(size.y / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.35;
		const camera = new THREE.PerspectiveCamera(
			fov,
			window.innerWidth / window.innerHeight,
			0.1,
			Math.max(100, distance * 10),
		);
		camera.position.set(
			center.x,
			center.y + size.y * 0.05,
			center.z + distance,
		);

		const controls = new OrbitControls(camera, canvas);
		controls.target.copy(center);
		controls.enableDamping = true;
		controls.minDistance = distance * 0.3;
		controls.maxDistance = distance * 3;
		controls.update();

		this.vrm = vrm;
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.controls = controls;
		this.canvas = canvas;
		this.rootContainer.appendChild(canvas);

		this.boundResize = () => {
			renderer.setSize(window.innerWidth, window.innerHeight);
			camera.aspect = window.innerWidth / window.innerHeight;
			camera.updateProjectionMatrix();
		};
		window.addEventListener("resize", this.boundResize);

		const clock = new THREE.Clock();
		const loop = () => {
			this.frameRequest = requestAnimationFrame(loop);
			// Same clamp idea as the 2D loop: a background tab must
			// not integrate a giant spring-bone step on return
			const dt = Math.min(clock.getDelta(), 1 / 30);
			this.vrm.update(dt);
			this.controls.update();
			this.renderer.render(this.scene, this.camera);
		};
		loop();
	}

	/// Stop and fully dispose the current display, if any
	hide() {
		if (this.frameRequest) {
			cancelAnimationFrame(this.frameRequest);
			this.frameRequest = null;
		}
		if (this.boundResize) {
			window.removeEventListener("resize", this.boundResize);
			this.boundResize = null;
		}
		if (this.controls) {
			this.controls.dispose();
			this.controls = null;
		}
		if (this.vrm) {
			VRMUtils.deepDispose(this.vrm.scene);
			this.vrm = null;
		}
		if (this.renderer) {
			this.renderer.dispose();
			this.renderer = null;
		}
		if (this.canvas && this.canvas.parentNode) {
			this.canvas.parentNode.removeChild(this.canvas);
		}
		this.canvas = null;
		this.scene = null;
		this.camera = null;
	}
}
