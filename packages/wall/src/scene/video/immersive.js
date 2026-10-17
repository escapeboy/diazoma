import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';

/**
 * 360° and 180° video around the viewer: an inverted sphere (or half sphere) textured with the
 * video. Stereo (`sbs` left|right, `tb` top|bottom) is two meshes on one texture, each with its
 * half of the picture, on layers 1 (left eye) and 2 (right eye) — three's WebXRManager renders
 * layer 1 only for the left eye and layer 2 only for the right. Outside XR the main camera
 * enables layer 1, so the page shows the left eye.
 */
export const IMMERSIVE_RADIUS = 20;

export function isImmersive(item) {
    return !!item && (item.projection === 'equirect360' || item.projection === 'equirect180');
}

export function isStereo(stereo) {
    return stereo === 'sbs' || stereo === 'tb';
}

/**
 * Sphere geometry seen from inside, picture centre straight ahead once the mesh is turned by
 * −90° (see createImmersive). `eye`: 'mono' | 'left' | 'right'.
 */
export function immersiveGeometry(projection, stereo, eye = 'mono', radius = IMMERSIVE_RADIUS) {
    // 180°: the half from phi = π/2 to 3π/2 carries the whole picture, its centre at phi = π.
    const g = projection === 'equirect180'
        ? new SphereGeometry(radius, 64, 32, Math.PI / 2, Math.PI)
        : new SphereGeometry(radius, 64, 32);
    // Seen from inside: mirror it so the picture is not reversed.
    g.scale(-1, 1, 1);
    if (eye !== 'mono' && isStereo(stereo)) {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            // Pole vertices carry a half-segment u offset; clamped, so no eye samples the other half.
            let u = Math.min(1, Math.max(0, uv.getX(i)));
            let v = Math.min(1, Math.max(0, uv.getY(i)));
            if (stereo === 'sbs') u = u * 0.5 + (eye === 'right' ? 0.5 : 0);
            else v = v * 0.5 + (eye === 'left' ? 0.5 : 0); // top half is the left eye
            uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
    }
    return g;
}

/**
 * Builds the meshes for `texture`. Returns `{ group, meshes, update(camera, presenting, headPos),
 * lookBy(camera, dx, dy), dispose(camera) }`. The group follows the head's position (not its
 * rotation) every update, so the picture has no parallax.
 */
export function createImmersive({ texture, projection, stereo, yaw = 0, radius = IMMERSIVE_RADIUS }) {
    const group = new Group();
    group.rotation.y = yaw;
    const eyes = isStereo(stereo) ? ['left', 'right'] : ['mono'];
    const meshes = eyes.map((eye) => {
        const mesh = new Mesh(immersiveGeometry(projection, stereo, eye, radius), new MeshBasicMaterial({ map: texture, fog: false, depthWrite: false }));
        mesh.rotation.y = -Math.PI / 2;
        mesh.renderOrder = -10;
        mesh.userData.eye = eye;
        if (eye === 'left') mesh.layers.set(1);
        if (eye === 'right') mesh.layers.set(2);
        group.add(mesh);
        return mesh;
    });
    const stereoOn = eyes.length === 2;
    let layerOn = false;
    const look = { yaw: 0, pitch: 0 };

    return {
        group,
        meshes,
        look,
        /** Keeps the sphere on the head and the page camera on the left eye (never in XR: the eye cameras add layers 1/2 themselves). */
        update(camera, presenting, headPos) {
            if (headPos) group.position.copy(headPos);
            const want = stereoOn && !presenting;
            if (want !== layerOn) {
                if (want) camera.layers.enable(1);
                else camera.layers.disable(1);
                layerOn = want;
            }
        },
        /** Drag to look around outside XR: pixels of pointer movement turn the page camera. */
        lookBy(camera, dx, dy, radPerPx = 0.0035) {
            look.yaw += dx * radPerPx;
            look.pitch = Math.max(-1.4, Math.min(1.4, look.pitch + dy * radPerPx));
            camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
        },
        dispose(camera) {
            if (layerOn && camera) camera.layers.disable(1);
            layerOn = false;
            if (group.parent) group.parent.remove(group);
            for (const m of meshes) {
                m.geometry.dispose();
                m.material.dispose();
            }
        },
    };
}
