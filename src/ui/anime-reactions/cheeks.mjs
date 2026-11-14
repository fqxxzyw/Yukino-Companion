import {BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial} from 'three';

function cheekGeometry(project, point, width, height, color, feather) {
  const positions = [], colors = [], indices = [];
  const rgb = new Color(color);
  const rings = feather ? 4 : 1, segments = 24;
  const centerDepth = project(...point(0, 0));
  const vertex = (radius, angle) => {
    const [x, y] = point(width * radius * Math.cos(angle), height * radius * Math.sin(angle));
    const z = project(x, y);
    positions.push(x, y, z ?? centerDepth ?? 0);
    colors.push(rgb.r, rgb.g, rgb.b, z === null ? 0 : feather ? (1 - radius * radius) ** 2 : 1);
  };
  vertex(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    const start = 1 + (ring - 1) * segments;
    for (let segment = 0; segment < segments; segment++) {
      vertex(ring / rings, segment / segments * Math.PI * 2);
      const current = start + segment, next = start + (segment + 1) % segments;
      if (ring === 1) indices.push(0, current, next);
      else indices.push(current - segments, current, next, current - segments, next, next - segments);
    }
  }
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colors, 4))
    .setIndex(indices);
}

export function createCheekEffects({anchor, headWidth, headHeight, cheekHeight, cheekWidth, projectToCheek}) {
  const group = new Group();
  group.name = 'anime-reactions:cheeks';
  anchor.add(group);
  const blush = new MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false,
  });
  const hatches = blush.clone();
  const centerY = cheekHeight * headHeight;
  const add = (material, point, width, height, color, feather) => {
    const mesh = new Mesh(cheekGeometry(projectToCheek, point, width, height, color, feather), material);
    mesh.name = feather ? 'anime-reactions:blush' : 'anime-reactions:cheek-line';
    mesh.raycast = () => {};
    mesh.renderOrder = feather ? 1 : 2;
    group.add(mesh);
  };
  for (const side of [-1, 1]) {
    const centerX = side * .235 * headWidth;
    add(blush, (x, y) => [centerX + x, centerY + y], cheekWidth * headWidth, .058 * headHeight, '#F87897', true);
    for (const offset of [-.037, 0, .037]) {
      const x0 = centerX + offset * headWidth;
      add(hatches, (x, y) => [x0 + x + .42 * y, centerY + y], .005 * headWidth, .026 * headHeight, '#E96786', false);
    }
  }
  return {
    update(blushWeight, hatchWeight) {
      blush.visible = blushWeight > 0;
      hatches.visible = hatchWeight > 0;
      blush.opacity = blushWeight;
      hatches.opacity = hatchWeight;
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of group.children) mesh.geometry.dispose();
      blush.dispose();
      hatches.dispose();
    },
  };
}
