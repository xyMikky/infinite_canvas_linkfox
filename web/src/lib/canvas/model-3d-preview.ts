/** 与 Eagle「3D 格式扩展」对齐、且浏览器能用 three.js 真预览的格式（不含 usdz/ifc/3dm 等需额外 wasm 的） */
const MODEL_3D_EXT = /\.(glb|gltf|obj|stl|ply|fbx|dae|3mf|pcd|vtk)$/i;

export function isModel3dFileName(name: string) {
    return MODEL_3D_EXT.test((name || "").trim());
}

export function model3dExt(name: string) {
    return (name.split(".").pop() || "").toLowerCase();
}

export function model3dMimeType(name: string) {
    const ext = model3dExt(name);
    if (ext === "glb") return "model/gltf-binary";
    if (ext === "gltf") return "model/gltf+json";
    if (ext === "obj") return "model/obj";
    if (ext === "stl") return "model/stl";
    return "application/octet-stream";
}
