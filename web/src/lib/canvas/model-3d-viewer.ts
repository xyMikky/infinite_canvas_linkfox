import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { PCDLoader } from "three/addons/loaders/PCDLoader.js";
import { VTKLoader } from "three/addons/loaders/VTKLoader.js";

import { model3dExt } from "@/lib/canvas/model-3d-preview";

const DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

export type Model3dCameraPose = {
    position: [number, number, number];
    target: [number, number, number];
    near: number;
    far: number;
    fov: number;
};

export type Model3dViewOffsets = {
    /** 相对原角度：向右为正（度） */
    horizontalAngle: number;
    /** 相对原角度：俯视为正（度） */
    pitchAngle: number;
    /** 相对原距离倍率，1 为不变 */
    distanceScale: number;
    /** 相机视场角（度），默认 45；越大越广角、透视越强 */
    fov: number;
    /** 水平平移（相对原距离，不写入提示词） */
    panX: number;
    /** 垂直平移（相对原距离，不写入提示词） */
    panY: number;
};

export type Model3dViewerHandle = {
    dispose: () => void;
    setInteractive: (value: boolean) => void;
    setBackground: (color: string | null) => void;
    getPose: () => Model3dCameraPose;
    setPose: (pose: Model3dCameraPose) => void;
    applyOffsets: (base: Model3dCameraPose, offsets: Model3dViewOffsets) => void;
    /** 导出当前视角预览图；可指定输出像素尺寸 */
    captureImage: (options?: { width?: number; height?: number }) => Promise<Blob>;
    /** 还原到加载后的初始视角 */
    resetCamera: () => void;
};

export async function mountModel3dViewer({
    canvas,
    buffer,
    fileName,
    interactive,
    background,
    showTextures = false,
    initialPose,
}: {
    canvas: HTMLCanvasElement;
    buffer: ArrayBuffer;
    fileName: string;
    interactive: boolean;
    background: string;
    /** 为 false 时用白膜材质，忽略模型贴图（默认） */
    showTextures?: boolean;
    initialPose?: Model3dCameraPose | null;
}): Promise<Model3dViewerHandle> {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 4000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.autoRotate = false;
    const applyInteractive = (value: boolean) => {
        controls.enablePan = value;
        controls.enableZoom = value;
        controls.enableRotate = value;
        canvas.style.pointerEvents = value ? "auto" : "none";
    };
    applyInteractive(interactive);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, showTextures ? 1.1 : 1.35));
    const key = new THREE.DirectionalLight(0xffffff, showTextures ? 1.15 : 1.4);
    key.position.set(2.4, 3.2, 2.8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, showTextures ? 0.35 : 0.55);
    fill.position.set(-2.2, 1.4, -1.8);
    scene.add(fill);

    const object = await loadModelObject(buffer, fileName);
    if (!showTextures) applyClayMaterials(object);
    scene.add(object);
    frameObject(object, camera, controls);
    if (initialPose) applyPose(camera, controls, initialPose);
    const initialPosition = camera.position.clone();
    const initialTarget = controls.target.clone();
    const initialNear = camera.near;
    const initialFar = camera.far;
    const initialFov = camera.fov;

    let frame = 0;
    const resize = () => {
        const width = canvas.clientWidth || 1;
        const height = canvas.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const tick = () => {
        frame = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
    };
    tick();

    const readPose = (): Model3dCameraPose => ({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        near: camera.near,
        far: camera.far,
        fov: camera.fov,
    });

    return {
        setInteractive: applyInteractive,
        setBackground: (color) => {
            scene.background = color ? new THREE.Color(color) : null;
        },
        getPose: readPose,
        setPose: (pose) => applyPose(camera, controls, pose),
        applyOffsets: (base, offsets) => applyViewOffsets(camera, controls, base, offsets),
        captureImage: ({ width, height } = {}) =>
            new Promise<Blob>((resolve, reject) => {
                const prevRatio = renderer.getPixelRatio();
                const prevAspect = camera.aspect;
                const outW = Math.max(1, Math.round(width || canvas.clientWidth || canvas.width || 1));
                const outH = Math.max(1, Math.round(height || canvas.clientHeight || canvas.height || 1));
                renderer.setPixelRatio(1);
                renderer.setSize(outW, outH, false);
                camera.aspect = outW / outH;
                camera.updateProjectionMatrix();
                controls.update();
                renderer.render(scene, camera);
                canvas.toBlob(
                    (blob) => {
                        renderer.setPixelRatio(prevRatio);
                        camera.aspect = prevAspect;
                        camera.updateProjectionMatrix();
                        resize();
                        if (blob) resolve(blob);
                        else reject(new Error("capture failed"));
                    },
                    "image/png",
                );
            }),
        resetCamera: () => {
            camera.position.copy(initialPosition);
            camera.near = initialNear;
            camera.far = initialFar;
            camera.fov = initialFov;
            camera.updateProjectionMatrix();
            controls.target.copy(initialTarget);
            controls.update();
        },
        dispose: () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            controls.dispose();
            renderer.dispose();
            scene.traverse((item) => {
                const mesh = item as THREE.Mesh;
                mesh.geometry?.dispose?.();
                const material = mesh.material;
                if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.());
                else material?.dispose?.();
            });
        },
    };
}

export function applyViewOffsets(camera: THREE.PerspectiveCamera, controls: OrbitControls, base: Model3dCameraPose, offsets: Model3dViewOffsets) {
    const basePos = new THREE.Vector3(...base.position);
    const baseTarget = new THREE.Vector3(...base.target);
    const offset = basePos.clone().sub(baseTarget);
    const baseRadius = Math.max(offset.length(), 0.01);
    const baseFov = base.fov;
    const fov = THREE.MathUtils.clamp(Number.isFinite(offsets.fov) ? offsets.fov : baseFov, 10, 150);
    // 滑动变焦：改 FOV 时按 tan(fov/2) 反比补偿距离，主体大小基本不变，只变透视强弱
    const dolly =
        Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) / Math.max(1e-4, Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= THREE.MathUtils.degToRad(offsets.horizontalAngle);
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - THREE.MathUtils.degToRad(offsets.pitchAngle), 0.05, Math.PI - 0.05);
    spherical.radius = Math.max(0.01, baseRadius * Math.max(0.05, offsets.distanceScale) * dolly);
    // 显式参数可以超出鼠标缩放边界，避免透视补偿被 OrbitControls 截断。
    controls.minDistance = Math.min(controls.minDistance, spherical.radius);
    controls.maxDistance = Math.max(controls.maxDistance, spherical.radius);

    const baseDir = offset.clone().normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, baseDir);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();
    const camUp = new THREE.Vector3().crossVectors(baseDir, right).normalize();
    const newTarget = baseTarget
        .clone()
        .addScaledVector(right, offsets.panX * baseRadius * 0.4)
        .addScaledVector(camUp, offsets.panY * baseRadius * 0.4);
    const newPos = new THREE.Vector3().setFromSpherical(spherical).add(newTarget);

    camera.position.copy(newPos);
    camera.near = base.near;
    camera.far = Math.max(base.far, spherical.radius + baseRadius * 2);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.target.copy(newTarget);
    controls.update();
}

function applyPose(camera: THREE.PerspectiveCamera, controls: OrbitControls, pose: Model3dCameraPose) {
    camera.position.set(...pose.position);
    camera.near = pose.near;
    camera.far = pose.far;
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    controls.target.set(...pose.target);
    controls.update();
}

async function loadModelObject(buffer: ArrayBuffer, fileName: string) {
    const ext = model3dExt(fileName);
    if (ext === "glb" || ext === "gltf") {
        const draco = new DRACOLoader();
        draco.setDecoderPath(DRACO_DECODER);
        const loader = new GLTFLoader();
        loader.setDRACOLoader(draco);
        const gltf = await loader.parseAsync(buffer, "");
        draco.dispose();
        return gltf.scene;
    }
    if (ext === "obj") return new OBJLoader().parse(new TextDecoder().decode(buffer));
    if (ext === "stl") return meshFromGeometry(new STLLoader().parse(buffer));
    if (ext === "ply") return meshFromGeometry(new PLYLoader().parse(buffer));
    if (ext === "fbx") return new FBXLoader().parse(buffer, "");
    if (ext === "dae") {
        const dae = new ColladaLoader().parse(new TextDecoder().decode(buffer), "");
        if (!dae?.scene) throw new Error("unsupported");
        return dae.scene;
    }
    if (ext === "3mf") return new ThreeMFLoader().parse(buffer);
    if (ext === "pcd") return new PCDLoader().parse(buffer);
    if (ext === "vtk") return meshFromGeometry(new VTKLoader().parse(buffer));
    throw new Error("unsupported");
}

function meshFromGeometry(geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, clayMaterial());
}

function clayMaterial() {
    return new THREE.MeshStandardMaterial({ color: 0xf2f0ea, metalness: 0.04, roughness: 0.52 });
}

function applyClayMaterials(root: THREE.Object3D) {
    root.traverse((item) => {
        const mesh = item as THREE.Mesh;
        if (!mesh.isMesh) return;
        const prev = mesh.material;
        if (Array.isArray(prev)) prev.forEach((entry) => entry.dispose?.());
        else prev?.dispose?.();
        mesh.material = clayMaterial();
    });
}

function frameObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const radius = Math.max(size.length() / 2, 0.01);
    camera.position.set(radius * 1.6, radius * 1.1, radius * 1.8);
    camera.near = radius / 100;
    camera.far = radius * 40;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.4;
    controls.maxDistance = radius * 12;
    controls.update();
}
