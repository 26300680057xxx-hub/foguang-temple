import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Batch only siblings: layer visibility and moving door parents keep working.
// The source objects remain named and selectable, but skip the render camera.
export async function batchStaticMeshes(root) {
  const parents = [];
  root.traverse(o => { if (o.children.length) parents.push(o); });
  let sourceMeshes = 0, batches = 0;
  for (let pi = 0; pi < parents.length; pi++) {
    const parent = parents[pi], groups = new Map();
    for (const mesh of [...parent.children]) {
      if (!mesh.isMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material) ||
          mesh.material.transparent || Object.keys(mesh.geometry.morphAttributes).length ||
          mesh.geometry.groups.length > 1) continue;
      const attributes = Object.keys(mesh.geometry.attributes).sort().map(k => {
        const a = mesh.geometry.attributes[k]; return `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`;
      }).join(',');
      const roofPart = mesh.name.includes('FGS_Pingan_');
      const key = `${roofPart}:${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${!!mesh.geometry.index}:${attributes}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    }
    for (const group of groups.values()) {
      if (group.length < 3) continue;
      let members = [], vertexCount = 0;
      const flush = () => {
        if (members.length < 2) { members = []; vertexCount = 0; return; }
        const geometries = [], ranges = [];
        let faces = 0;
        for (const mesh of members) {
          mesh.updateMatrix();
          const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
          geometries.push(geometry);
          faces += (geometry.index?.count || geometry.attributes.position.count) / 3;
          ranges.push({ end: faces, mesh });
        }
        const merged = mergeGeometries(geometries, false);
        geometries.forEach(g => g.dispose());
        if (!merged) throw new Error('Static geometry batch failed');
        const batch = new THREE.Mesh(merged, members[0].material);
        batch.name = `${members[0].name.includes('FGS_Pingan_') ? 'FGS_Pingan_' : ''}展示合批_${batches}`;
        batch.castShadow = members[0].castShadow; batch.receiveShadow = members[0].receiveShadow;
        batch.matrixAutoUpdate = false;
        // Retain per-component picking after merging draw calls.
        batch.raycast = function(raycaster, intersections) {
          const hits = [];
          THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
          for (const hit of hits) {
            let lo = 0, hi = ranges.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (hit.faceIndex < ranges[mid].end) hi = mid; else lo = mid + 1; }
            hit.object = ranges[lo].mesh; intersections.push(hit);
          }
        };
        for (const mesh of members) { mesh.layers.set(1); mesh.userData.staticBatched = true; }
        parent.add(batch); sourceMeshes += members.length; batches++;
        members = []; vertexCount = 0;
      };
      for (const mesh of group) {
        const count = mesh.geometry.attributes.position.count;
        if (vertexCount + count > 65000) flush();
        members.push(mesh); vertexCount += count;
      }
      flush();
    }
    // Let progress UI paint during preparation on slower phones.
    if (pi % 60 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { sourceMeshes, batches };
}
