import { Project, Scene3D, PhysicsLoader, THREE } from "enable3d";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes";
import Stats from "three/examples/jsm/libs/stats.module";
import SimplexNoise from "simplex-noise";
import gsap from "gsap";
window.gsap = gsap;
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

function getGamepad(i) {
  const gamepads = navigator.getGamepads();
  if (gamepads.length && gamepads[i]) return gamepads[i];
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
        arrow: await loadModel("arrow.glb"),
      },
    };
  }

  async init() {
    this.state = window.state = Object.preventExtensions({
      player: null,
      sphere: null,
      tree: null,
      arrow: null,
      marchingCubes: null,
      spheres: [],
      heightMap: null,
      directionalLight: null,
      sources: [],
      currentSourceIndex: 0,
      collecting: true,
      gameOver: false,
      treePhase: 0,
      children: [],
    });
    //this.physics.debug.enable();
  }

  addChild(x, y, z) {
    const childMesh = this.assets.models.sphere.getObjectByProperty("type", "Mesh").clone();
    childMesh.castShadow = childMesh.receiveShadow = true;
    childMesh.material = childMesh.material.clone();
    childMesh.material.metalness = 0.9;
    childMesh.material.roughness = 0;
    childMesh.position.set(x, y, z);
    childMesh.material.color.setHSL(Math.random(), 1, 0.5);
    childMesh.scale.setScalar(0.001);
    this.scene.add(childMesh);
    gsap.to(childMesh.scale, {x:0.3, y: 0.3, z: 0.3}).then(() => {
      this.physics.addExisting(childMesh, {shape: "sphere", mass: 0.01});
      childMesh.body.setDamping(0.5, 0.3)
      this.state.children.push(childMesh);
    });
    return childMesh;
  }

  makePlayer() {
    const playerY = -3;
    const player = new THREE.Object3D();
    player.position.y = playerY;

    const sphere = this.assets.models.sphere.getObjectByProperty("type", "Mesh").clone();
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

    return player;
  }

  addSphere() {
    const playerPosition = this.state.player.position;
    const sphere = this.physics.add.sphere(
      {
        radius: 0.19,
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
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

  async create() {
    window.scene = this;

    const warp = await this.warpSpeed("-ground", "orbitControls");
    this.state.directionalLight = warp.lights.directionalLight;

    // this.camera.position.set(1, 1, 1).setScalar(100);
    // this.camera.position.y = 50;
    // this.camera.position.set(0, 150, 0);
    // this.camera.lookAt(this.scene.position);

    this.scene.fog = new THREE.Fog(0xedf5ff, 25, 40);

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
    tree.position.y = -5;
    this.state.tree = tree;
    this.scene.add(tree);
    tree.userData.action.play();
    // tree.userData.action.time = 3.32;
    tree.userData.mixer.update(0);
    this.physics.add.cylinder(
      { collisionFlags: collisionFlags.static, y: -3, height: 5, radiusTop: 0.2, radiusBottom: 0.2 },
      { lambert: { visible: false } }
    );

    this.state.player = this.makePlayer();

    this.state.arrow = this.assets.models.arrow;
    this.scene.add(this.state.arrow);

    const noise = new SimplexNoise("seeds");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    //Object.assign(canvas.style, { position: "absolute", top: 0, zIndex: 100, right: 0 });
    //document.body.append(canvas);
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

    const sources = new THREE.Group();
    const centers = [
      [16, 16],
      [48, 16],
      [16, 48],
      [48, 48],
    ];
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(centers[i][0] + (Math.random() - 0.5) * 2 * 6);
      const z = Math.floor(centers[i][1] + (Math.random() - 0.5) * 2 * 6);
      const y = data.data[z * canvas.width * 4 + x * 4] / 16 - 6;
      const source = this.make.sphere(
        { x: (x - canvas.width / 2) * 1.57 + 0.5, y, z: (z - canvas.width / 2) * 1.57 + 0.5 },
        { standard: { roughness: 0, metalness: 1 } }
      );
      if (i !== 0) {
        source.scale.setScalar(0.001);
      }
      sources.add(source);
      this.state.sources.push(source);
    }
    this.scene.add(sources);
  }

  update = (() => {
    const vec = new THREE.Vector3();
    let lastSphereChange = 0;
    return (time, delta) => {
      stats.update();

      const deltaSecs = delta / 1000;

      this.state.sphere.position.copy(this.state.player.position);
      this.state.sphere.quaternion.copy(this.state.player.quaternion);
      this.state.sphere.body.needUpdate = true;

      this.camera.position.copy(this.state.player.position);
      vec.set(0, 6, 15);
      this.camera.position.add(vec);
      this.camera.lookAt(this.state.player.position);

      this.state.arrow.position.copy(this.state.player.position);
      this.state.arrow.position.y += 2;
      const currentSource = this.state.sources[this.state.currentSourceIndex];
      const destination = this.state.collecting ? currentSource.position : this.state.tree.position;
      this.state.arrow.lookAt(destination);
      const distanceToDestination = this.state.player.position.distanceTo(destination);
      this.state.arrow.children[0].material.opacity = map(distanceToDestination, 4, 32, 0, 0.5);

      this.state.directionalLight.target = this.state.player;
      this.state.directionalLight.position.copy(this.state.player.position);
      vec.set(100, 50, 50);
      this.state.directionalLight.position.add(vec);

      const gamepad = getGamepad(0);
      if (gamepad) {
        const ax = deadzone(gamepad.axes[0]);
        const ay = deadzone(gamepad.axes[1]);
        const scale = 20;
        this.state.player.body.applyCentralForce(scale * ax, 0, scale * ay);

        if (gamepad.buttons[0].pressed && distanceToDestination < 6) {
          const numSpheres = this.state.spheres.length;
          if (time - lastSphereChange > 0.1) {
            if (this.state.collecting) {
              this.addSphere();
              const s = Math.max(0.00001, 1 - numSpheres / 20);
              gsap.to(currentSource.scale, { x: s, y: s, z: s, duration: 0.2 });
              if (numSpheres === 19) {
                currentSource.visible = false;
                this.state.collecting = false;
                gsap.fromTo(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.0001}, {x: 1, y: 1, z: 1, duration: 0.5});
              }
              lastSphereChange = time;
            } else {
              const sphere = this.state.spheres.pop();
              if (sphere) {
                this.physics.destroy(sphere);
                this.state.treePhase += (1 / 80) * 3.32;
                lastSphereChange = time;
              }
              if (numSpheres === 1) {
                if (this.state.currentSourceIndex !== 3) {
                  this.state.currentSourceIndex++;
                  gsap.to(this.state.sources[this.state.currentSourceIndex].scale, {x: 1, y: 1, z: 1, duration: 0.5});
                  gsap.fromTo(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.0001}, {x: 1, y: 1, z: 1, duration: 0.5});
                  this.state.collecting = true;
                }
              }
            }
          }
        }
      }

      if (this.state.tree.userData.action.time < this.state.treePhase) {
        this.state.tree.userData.mixer.update(deltaSecs / 2);
      }

      if (Math.abs(this.state.tree.userData.action.time - 3.32) < 0.1) {
        if (!this.state.gameOver) {
          this.state.gameOver = true;
          gsap.to(this.scene.fog, {near: 100, far: 110, duration: 10});
          gsap.to(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.001, duration: 0.1});
          const childPositions = [
            [-0.7, 1.3, 0.2],
            [-2, 0.8, -0.9],
            [-0.5, 1.2, -1.9],
            [0, -0.2, 1.5],
            [-0.13, -1.11, -1.25],
            [-0.5, -2.12, 1.33],
            [1.06, -1.47, -0.86],
            [-1.53, -2.29, -0.6],
          ];
          for (const childPosition of childPositions) {
            const [x, y, z] = childPosition;
            setTimeout(() => this.addChild(x, y, z), 500 + Math.random() * 1000);
          }
        }
      }

      for (const child of this.state.children) {
        vec.copy(this.state.player.position);
        vec.sub(child.position);
        vec.normalize();
        vec.multiplyScalar(0.15);
        child.body.applyCentralForce(vec.x, 0, vec.z);
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

        for (const source of this.state.sources) {
          source.visible = false;
        }
        this.state.arrow.visible =
          this.state.tree.visible =
          this.state.marchingCubes.visible =
          this.state.sphere.visible =
            false;

        this.scene.environment = pmremGen.fromScene(this.scene, 0, 0.1, 2000).texture;
        this.scene.environment.encoding = THREE.LinearEncoding;

        this.state.arrow.visible =
          this.state.tree.visible =
          this.state.marchingCubes.visible =
          this.state.sphere.visible =
            true;
        for (const source of this.state.sources) {
          source.visible = true;
        }
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
