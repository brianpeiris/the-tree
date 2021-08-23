import { Project, Scene3D, PhysicsLoader, THREE } from "enable3d";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes";
import Stats from "three/examples/jsm/libs/stats.module";
import SimplexNoise from "simplex-noise";
window.THREE = THREE;

function map(v, a, b, c, d) {
  return ((v - a) / (b - a)) * (d - c) + c;
}

function deadzone(v, z = 0.1) {
  const s = Math.sign(v);
  const av = Math.abs(v);
  v = av < z ? z : av;
  return s * map(v, z, 1, 0, 1);
}

const collisionFlags = {
  dynamic: 0,
  static: 1,
  kinematic: 2,
  ghost: 4,
};

const loadTexture = (() => {
  const textureLoader = new THREE.TextureLoader();
  return (texture) => {
    return textureLoader.load(texture);
  };
})();

const loadModel = (() => {
  const gltfLoader = new GLTFLoader();
  return (model) => {
    return new Promise((resolve) => {
      gltfLoader.load(model, (gltf) => {
        if (gltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          gltf.scene.userData.mixer = mixer;
          gltf.scene.userData.action = mixer.clipAction(gltf.animations[0]);
        }
        resolve(gltf.scene);
      });
    });
  };
})();

class Clip {
  constructor(startTime, endTime, action, mixer) {
    this.enabled = false;
    this.startTime = startTime;
    this.endTime = endTime;
    this.action = action;
    this.mixer = mixer;
  }
  update(deltaSecs) {
    if (!this.enabled) return;
    if (this.action.time >= this.endTime) {
      this.stop();
      return;
    }
    this.mixer.update(deltaSecs);
  }
  start() {
    this.action.time = this.startTime;
    this.action.play();
    this.enabled = true;
  }
  stop() {
    this.enabled = false;
  }
}

const stats = new Stats();
document.body.append(stats.dom);

class MainScene extends Scene3D {
  async preload() {
    this.assets = {
      textures: {
        grain: loadTexture("grain.png"),
      },
      models: {
        sphere: await loadModel("sphere.glb"),
        tree: await loadModel("tree.glb"),
      },
    };
  }

  async init() {
    this.state = window.state = Object.preventExtensions({
      player: null,
      sphere: null,
      tree: null,
      marchingCubes: null,
      spheres: [],
      heightMap: null,
      directionalLight: null,
      clips: [],
    });
    // this.physics.debug.enable();
  }

  makePlayer() {
    const playerY = -3;
    const player = new THREE.Object3D();
    player.position.y = playerY;

    const sphere = this.assets.models.sphere.getObjectByProperty("type", "Mesh");
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    sphere.material.metalness = 0.9;
    sphere.material.roughness = 0;
    sphere.material.color.setStyle("white");
    sphere.position.y = playerY;
    this.physics.addExisting(sphere, {
      collisionFlags: collisionFlags.kinematic,
      shape: "concave",
      collisionGroup: 8,
      collisionMask: 8,
    });
    this.scene.add(sphere);
    this.state.sphere = sphere;
    this.state.sphere.body.setFriction(0);

    this.physics.addExisting(player, { shape: "sphere", radius: 1 });
    player.body.setDamping(0.9, 0.3);

    this.state.marchingCubes = new MarchingCubes(
      16,
      new THREE.MeshStandardMaterial({
        color: "white",
        roughness: 0,
        metalness: 1,
      }),
      false,
      false
    );
    this.state.marchingCubes.castShadow = false;
    this.state.marchingCubes.receiveShadow = false;
    this.state.marchingCubes.scale.multiplyScalar(1.3);
    sphere.add(this.state.marchingCubes);

    this.scene.add(player);

    const n = 1;
    const xn = n;
    const yn = n;
    const zn = n;
    for (let x = 0; x < xn; x++) {
      for (let y = 0; y < yn; y++) {
        for (let z = 0; z < zn; z++) {
          const sphere = this.physics.add.sphere(
            {
              radius: 0.19,
              x: (x / xn - 0.5) * 0.2 + 0.1,
              y: (y / yn - 0.5) * 0.2 + 0.1 + playerY,
              z: (z / zn - 0.5) * 0.2 + 0.1,
              widthSegments: 4,
              heightSegments: 4,
              mass: 0.0001,
              collisionGroup: 8,
              collisionMask: 8,
            },
            { lambert: { color: "red", visible: false } }
          );
          sphere.body.setDamping(0.9, 0.9);
          sphere.body.setFriction(0);
          sphere.body.setRestitution(0);
          this.state.spheres.push(sphere);
        }
      }
    }

    return player;
  }

  async create() {
    window.scene = this;

    const warp = await this.warpSpeed("-ground", "-orbitControls");
    this.state.directionalLight = warp.lights.directionalLight;

    // this.scene.fog = new THREE.Fog(0xedf5ff, 10, 30);

    this.physics.add.box(
      { collisionFlags: collisionFlags.static, width: 100, height: 10, z: -50, y: -5 },
      { lambert: { visible: false } }
    );
    this.physics.add.box(
      { collisionFlags: collisionFlags.static, width: 100, height: 10, z: 50, y: -5 },
      { lambert: { visible: false } }
    );
    this.physics.add.box(
      { collisionFlags: collisionFlags.static, depth: 100, height: 10, x: -50, y: -5 },
      { lambert: { visible: false } }
    );
    this.physics.add.box(
      { collisionFlags: collisionFlags.static, depth: 100, height: 10, x: 50, y: -5 },
      { lambert: { visible: false } }
    );

    const tree = this.assets.models.tree;
    const treeMesh = tree.getObjectByProperty("type", "SkinnedMesh");
    treeMesh.pose();
    treeMesh.castShadow = true;
    tree.scale.setScalar(1.5);
    tree.position.y = -6.5;
    window.tree = tree;
    this.state.tree = tree;
    this.scene.add(tree);
    tree.userData.action.play();
    tree.userData.mixer.update(0);
    this.state.clips.push(new Clip(0, 1.5, tree.userData.action, tree.userData.mixer));
    this.state.clips.push(new Clip(1.5, 2, tree.userData.action, tree.userData.mixer));
    this.state.clips.push(new Clip(2, 2.5, tree.userData.action, tree.userData.mixer));
    this.state.clips.push(new Clip(2.5, 3.3, tree.userData.action, tree.userData.mixer));
    this.physics.add.cylinder(
      { collisionFlags: collisionFlags.static, y: -6, z: 13.5, height: 5, radiusTop: 0.2, radiusBottom: 0.2 },
      { lambert: { visible: false } }
    );

    this.state.player = this.makePlayer();

    const noise = new SimplexNoise("seeds");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    Object.assign(canvas.style, { position: "absolute", top: 0, zIndex: 100, right: 0 });
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const scale = 1 / 16;
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height; y++) {
        const v = ((noise.noise2D(x * scale, y * scale) + 1) / 2) * 64;
        data.data[y * canvas.width * 4 + x * 4 + 0] = v;
        data.data[y * canvas.width * 4 + x * 4 + 1] = v;
        data.data[y * canvas.width * 4 + x * 4 + 2] = v;
        data.data[y * canvas.width * 4 + x * 4 + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    document.body.append(canvas);
    this.state.heightMap = this.heightMap.add(new THREE.CanvasTexture(canvas));
    //this.state.heightMap.material = new THREE.MeshStandardMaterial();
    this.state.heightMap.scale.multiplyScalar(10);
    this.state.heightMap.castShadow = false;
    this.state.heightMap.receiveShadow = true;
    this.state.heightMap.material.wireframe = false;
    this.state.heightMap.material.color.setHex(0xf2dfb1);
    this.state.heightMap.material.map = this.assets.textures.grain;
    this.state.heightMap.material.bumpMap = this.assets.textures.grain;
    this.state.heightMap.material.map.wrapS = this.state.heightMap.material.map.wrapT = THREE.RepeatWrapping;
    this.state.heightMap.material.map.repeat.setScalar(20);
    this.state.heightMap.position.y = -10;
    this.physics.add.existing(this.state.heightMap, { collisionFlags: collisionFlags.static });
  }

  getGamepad(i) {
    const gamepads = navigator.getGamepads();
    if (gamepads.length && gamepads[i]) return gamepads[i];
  }

  update = (() => {
    let aWasUp = true;
    const vec = new THREE.Vector3();
    return (time, delta) => {
      stats.update();

      const deltaSecs = delta / 1000;

      for (const clip of this.state.clips) {
        clip.update(deltaSecs);
      }

      this.state.sphere.position.copy(this.state.player.position);
      this.state.sphere.quaternion.copy(this.state.player.quaternion);
      this.state.sphere.body.needUpdate = true;

      this.camera.position.copy(this.state.player.position);
      vec.set(0, 10, 10);
      this.camera.position.add(vec);
      this.camera.lookAt(this.state.player.position);

      this.state.directionalLight.target = this.state.player;
      this.state.directionalLight.position.copy(this.state.player.position);
      vec.set(100, 50, 50);
      this.state.directionalLight.position.add(vec);

      const gamepad = this.getGamepad(0);
      if (gamepad) {
        const ax = deadzone(gamepad.axes[0]);
        const ay = deadzone(gamepad.axes[1]);
        const scale = 20;
        this.state.player.body.applyCentralForce(scale * ax, 0, scale * ay);

        if (aWasUp && gamepad.buttons[0].pressed) {
          this.state.player.body.applyCentralImpulse(0, 6, 0);
        }
        aWasUp = !gamepad.buttons[0].pressed;
      }

      this.state.marchingCubes.reset();
      for (const sphere of this.state.spheres) {
        vec.copy(sphere.position);
        this.state.marchingCubes.worldToLocal(vec);
        vec.addScalar(1.1);
        vec.multiplyScalar(0.45);
        this.state.marchingCubes.addBall(vec.x, vec.y, vec.z, 0.5, 12);
      }
      if (!this.scene.environment && time > 0.1) {
        const pmremGen = new THREE.PMREMGenerator(this.renderer);
        this.state.marchingCubes.visible = this.state.sphere.visible = false;
        this.scene.environment = pmremGen.fromScene(this.scene, 0, 0.1, 2000).texture;
        this.scene.environment.encoding = THREE.LinearEncoding;
        this.state.marchingCubes.visible = this.state.sphere.visible = true;
        //const plane = this.add.plane({}, {basic: {map: this.scene.environment}});
        //plane.scale.setScalar(4);
      }
    };
  })();
}

PhysicsLoader(
  "lib",
  () =>
    new Project({
      antialias: true,
      gravity: { x: 0, y: -9.8, z: 0 },
      // gravity: { x: 0, y: 0, z: 0 },
      scenes: [MainScene],
    })
);
