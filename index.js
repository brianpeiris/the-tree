import "./global";
import { Project, Scene3D, PhysicsLoader, THREE } from "enable3d";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes";
import Stats from "three/examples/jsm/libs/stats.module";
import SimplexNoise from "simplex-noise";
import gsap from "gsap";
import { Camera, Renderer } from "holoplay";

const queryParams = new URLSearchParams(location.search);

function map(v, a, b, c, d) {
  return ((v - a) / (b - a)) * (d - c) + c;
}

function deadzone(v, z = 0.1) {
  const s = Math.sign(v);
  const av = Math.abs(v);
  v = av < z ? z : av;
  return s * map(v, z, 1, 0, 1);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
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

const TREE_ANIMATION_DURATION = 3.32;
const NUM_SOURCES = 4;
const NUM_SPHERES_PER_SOURCE = 20;
const TOTAL_SPHERES = NUM_SPHERES_PER_SOURCE * NUM_SOURCES;

class MainScene extends Scene3D {
  async preload() {
    this.assets = {
      textures: {
        grain: loadTexture("grain.png"),
        cube: loadTexture("cube.png"),
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
      directionalLight: null,
      sources: [],
      currentSourceIndex: 0,
      collecting: true,
      gameOver: false,
      treePhase: 0,
      children: [],
      storm: null,
      stormEnabled: true,
    });
    //this.physics.debug.enable();
  }

  addChild(i, x, y, z) {
    const childMesh = this.assets.models.sphere.getObjectByProperty("type", "Mesh").clone();
    childMesh.castShadow = childMesh.receiveShadow = true;
    childMesh.material = childMesh.material.clone();
    childMesh.material.metalness = 0.9;
    childMesh.material.roughness = 0;
    childMesh.position.set(x, y, z);
    childMesh.material.color.setHSL(i / 8, 1, 0.5);
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

    this.physics.addExisting(player, { shape: "sphere", radius: 1, collisionFlags: collisionFlags.dynamic });
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
    this.scene.environment = this.assets.textures.cube;
    this.scene.environment.encoding = THREE.LinearEncoding;
    this.scene.environment.mapping = THREE.CubeUVReflectionMapping;
    this.scene.environment.magFilter = THREE.NearestFilter;
    this.scene.environment.minFilter = THREE.NearestFilter;
    this.scene.environment.generateMipmaps = false;


    const warp = await this.warpSpeed("-ground", "-orbitControls");
    this.state.directionalLight = warp.lights.directionalLight;

    // this.camera.position.set(1, 1, 1).setScalar(100);
    // this.camera.position.y = 50;
    // this.camera.position.set(0, 150, 0);
    // this.camera.lookAt(this.scene.position);

    this.scene.fog = new THREE.Fog(0xedf5ff, 30, 40);
    window.scene = this;

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
    // tree.userData.action.time = TREE_ANIMATION_DURATION;
    tree.userData.mixer.update(0);
    this.physics.add.cylinder(
      { collisionFlags: collisionFlags.static, y: -3, height: 5, radiusTop: 0.2, radiusBottom: 0.2 },
      { lambert: { visible: false } }
    );

    this.state.player = this.makePlayer();
    this.state.directionalLight.target = this.state.player;

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
    const heightMap = this.heightMap.add(new THREE.CanvasTexture(canvas));
    heightMap.scale.multiplyScalar(10);
    heightMap.castShadow = false;
    heightMap.receiveShadow = true;
    heightMap.material.color.setHex(0xf2dfb1);
    heightMap.material.map = this.assets.textures.grain;
    heightMap.material.map.wrapS = heightMap.material.map.wrapT = THREE.RepeatWrapping;
    heightMap.material.map.repeat.setScalar(20);
    heightMap.position.y = -10;
    this.physics.add.existing(heightMap, { collisionFlags: collisionFlags.static });

    const centers = [
      [16, 16],
      [48, 16],
      [16, 48],
      [48, 48],
    ];
    for (let i = 0; i < NUM_SOURCES; i++) {
      const x = Math.floor(centers[i][0] + rand(-6, 6));
      const z = Math.floor(centers[i][1] + rand(-6, 6));
      const y = data.data[z * canvas.width * 4 + x * 4] / 16 - 6;
      const source = this.make.sphere(
        { x: (x - canvas.width / 2) * 1.57 + 0.5, y, z: (z - canvas.width / 2) * 1.57 + 0.5 },
        { standard: { roughness: 0, metalness: 1 } }
      );
      source.frustumCulled = false;
      if (i !== 0) {
        source.scale.setScalar(0.001);
      }
      this.scene.add(source);
      this.state.sources.push(source);
    }

    this.state.storm = new THREE.Points();
    this.state.storm.material.size = 2;
    this.state.storm.material.sizeAttenuation = false;
    this.state.storm.material.color.setStyle('brown');
    this.state.storm.material.color.offsetHSL(0, -0.3, -0.1);
    const points = [];
    for (let i = 0; i < 10000; i++) {
      points.push(rand(-50, 50), rand(-10, 10), rand(-50, 50));
    }
    this.state.storm.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    this.scene.add(this.state.storm);
  }

  update = (() => {
    const vec = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let lastSphereChange = 0;
    return (time, delta) => {
      stats.update();

      const deltaSecs = delta / 1000;

      const playerPosition = this.state.player.position;

      this.state.sphere.position.copy(playerPosition);
      this.state.sphere.quaternion.copy(this.state.player.quaternion);
      this.state.sphere.body.needUpdate = true;

      this.camera.position.copy(playerPosition);
      vec.set(0, 6, 15);
      //vec.multiplyScalar(5);
      this.camera.position.add(vec);
      this.camera.lookAt(playerPosition);

      const currentSource = this.state.sources[this.state.currentSourceIndex];

      this.state.arrow.position.copy(playerPosition);
      this.state.arrow.position.y += 2;
      const destination = this.state.collecting ? currentSource.position : this.state.tree.position;
      this.state.arrow.lookAt(destination);
      const distanceToDestination = playerPosition.distanceTo(destination);
      this.state.arrow.children[0].material.opacity = map(distanceToDestination, 4, 32, 0, 0.5);

      this.state.directionalLight.position.copy(playerPosition);
      vec.set(100, 50, 50);
      this.state.directionalLight.position.add(vec);

      const gamepad = getGamepad(0);
      if (gamepad) {
        const ax = deadzone(gamepad.axes[0]);
        const ay = deadzone(gamepad.axes[1]);
        const scale = 20;
        this.state.player.body.applyCentralForce(scale * ax, 0, scale * ay);

        if (gamepad.buttons[0].pressed && distanceToDestination < 6 && time - lastSphereChange > 0.1) {
          if (this.state.collecting) {
            this.addSphere();
            const numSpheres = this.state.spheres.length;
            const sourceScale = Math.max(0.00001, 1 - numSpheres / NUM_SPHERES_PER_SOURCE);
            gsap.to(currentSource.scale, { x: sourceScale, y: sourceScale, z: sourceScale, duration: 0.2 });
            if (numSpheres === NUM_SPHERES_PER_SOURCE) {
              currentSource.visible = false;
              this.state.collecting = false;
              gsap.fromTo(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.0001}, {x: 1, y: 1, z: 1, duration: 0.5});
            }
            lastSphereChange = time;
          } else {
            if (this.state.spheres.length) {
              const sphere = this.state.spheres.pop();
              this.physics.destroy(sphere);
              this.state.treePhase += (1 / TOTAL_SPHERES) * TREE_ANIMATION_DURATION;
              lastSphereChange = time;
            } else if (this.state.currentSourceIndex !== NUM_SOURCES - 1) {
              this.state.currentSourceIndex++;
              const currentSource = this.state.sources[this.state.currentSourceIndex];
              gsap.to(currentSource.scale, {x: 1, y: 1, z: 1, duration: 0.5});
              gsap.fromTo(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.0001}, {x: 1, y: 1, z: 1, duration: 0.5});
              this.state.collecting = true;
            }
          }
        }
      }

      if (this.state.tree.userData.action.time < this.state.treePhase) {
        this.state.tree.userData.mixer.update(deltaSecs / 2);
      }

      if (Math.abs(this.state.tree.userData.action.time - TREE_ANIMATION_DURATION) < 0.1) {
        if (!this.state.gameOver) {
          this.state.gameOver = true;
          gsap.to(this.scene.fog, {near: 100, far: 110, duration: 10});
          gsap.to(this.state.arrow.scale, {x: 0.0001, y: 0.0001, z: 0.0001, duration: 0.1});
          this.state.storm.material.transparent = true;
          gsap.to(this.state.storm.material, {opacity: 0, duration: 0.5}).then(() => {
            this.state.storm.visible = false;
            this.state.stormEnabled = false;
          });
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
          for(let i = 0; i < childPositions.length; i++) {
            const [x, y, z] = childPositions[i];
            setTimeout(() => this.addChild(i, x, y, z), rand(1, 2) * 1000);
          }
        }
      }

      for (const child of this.state.children) {
        vec.copy(playerPosition);
        vec.sub(child.position);
        vec.normalize();
        vec.multiplyScalar(0.15);
        vec.applyAxisAngle(up, 15 * Math.PI / 180);
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
        const objectsToToggle = [
          ...this.state.sources,
          this.state.arrow,
          this.state.tree,
          this.state.marchingCubes,
          this.state.sphere,
          this.state.storm,
        ];

        for (const obj of objectsToToggle) {
          obj.visible = false;
        }

        /*
        const renderer = new THREE.WebGLRenderer();
        const pmremGen = new THREE.PMREMGenerator(renderer);
        const renderTarget = pmremGen.fromScene(this.scene, 0, 0.1, 2000);
        const buff = new Uint8ClampedArray(renderTarget.width * 4 * renderTarget.height);
        const canvas = document.createElement("canvas");
        canvas.width = renderTarget.width;
        canvas.height = renderTarget.height;
        const ctx = canvas.getContext("2d");
        renderer.readRenderTargetPixels(renderTarget, 0, 0, renderTarget.width, renderTarget.height, buff, 0);
        const imageData = new ImageData(buff, renderTarget.width);
        ctx.putImageData(imageData, 0, 0 );
        document.body.append(canvas);
        this.scene.environment = new THREE.CanvasTexture(canvas);
        this.scene.environment.mapping = THREE.CubeUVReflectionMapping;
        this.scene.environment.encoding = THREE.LinearEncoding;
        const plane = this.add.plane({}, {basic: {map: this.scene.environment}});
        plane.scale.setScalar(4);
        //*/

        for (const obj of objectsToToggle) {
          obj.visible = true;
        }

      }

      if (this.state.stormEnabled) {
        const pos = this.state.storm.geometry.attributes.position;
        for (let i = 0; i < pos.array.length; i += 3) {
          pos.array[i] += rand(0.4, 0.6);
          pos.array[i + 1] += rand(-0.1, 0.1);
          pos.array[i + 2] += rand(-0.1, 0.1);
          if (pos.array[i] > 50) {
            pos.array[i] = -50;
          }
          if (pos.array[i + 1] > 10) {
            pos.array[i + 1] = -10;
          }
          if (pos.array[i + 1] < -10) {
            pos.array[i + 1] = 10;
          }
          if (pos.array[i + 2] > 50) {
            pos.array[i + 2] = -50;
          }
          if (pos.array[i + 2] < -50) {
            pos.array[i + 2] = 50;
          }
        }
        pos.needsUpdate = true;
      }
    };
  })();
}

const renderer = window.renderer = new Renderer({ disableFullscreenUi: queryParams.has("2d") });
renderer.renderQuilt = true;
renderer.render2d = queryParams.has("2d");
renderer.setSize = (width, height) => {
  return renderer.webglRenderer.setSize(width, height);
};
renderer.setPixelRatio = (ratio) => {
  return renderer.webglRenderer.setPixelRatio(ratio);
};
renderer.setAnimationLoop = (func) => {
  return renderer.webglRenderer.setAnimationLoop(func);
};
renderer.compile = (a, b) => {
  return renderer.webglRenderer.compile(a, b);
};
renderer.getClearColor = (a) => {
  return renderer.webglRenderer.getClearColor(a);
};
renderer.getRenderTarget = () => {
  return renderer.webglRenderer.getRenderTarget();
};
renderer.setRenderTarget = (a, b, c) => {
  return renderer.webglRenderer.setRenderTarget(a, b, c);
};
Object.defineProperty(renderer, "shadowMap", {
  get() {
    return renderer.webglRenderer.shadowMap;
  },
});

const camera = window.camera = new Camera();

PhysicsLoader(
  "lib",
  () =>
    new Project({
      renderer,
      camera,
      gravity: { x: 0, y: -9.8, z: 0 },
      // gravity: { x: 0, y: 0, z: 0 },
      scenes: [MainScene],
    })
);
