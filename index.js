import { Project, Scene3D, PhysicsLoader, THREE } from "enable3d";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

function map(v, a, b, c, d) {
  return ((v - a) / (b - a)) * (d - c) + c;
}

function deadzone(v, z = 0.1) {
  const s = Math.sign(v);
  const av = Math.abs(v);
  v = av < z ? z : av;
  return s * map(v, z, 1, 0, 1);
}

class Tween {
  constructor(duration, func) {
    this.duration = duration;
    this.time = 0;
    this.func = func.bind(this);
  }
  update(deltaSecs) {
    this.time += deltaSecs;
    this.func(Math.min(1, this.time / this.duration));
  }
  reset() {
    this.time = 0;
  }
}

const collisionFlags = {
  dynamic: 0,
  static: 1,
  kinematic: 2,
  ghost: 4,
};

const loadModel = (() => {
  const gltfLoader = new GLTFLoader();
  return (model) => {
    return new Promise((resolve) => {
      gltfLoader.load(model, (gltf) => {
        resolve(gltf.scene.getObjectByProperty("type", "Mesh"));
      });
    });
  };
})();

class MainScene extends Scene3D {
  async preload() {
    this.assets = {
      models: {
        sphere: await loadModel("sphere.glb")
      },
    };
  }

  async init() {
    this.state = Object.preventExtensions({
      player: null,
    });
    //this.physics.debug.enable();
  }

  makePlayer(color) {
    const player = new THREE.Object3D();
    player.position.y = 1;

    const box = this.make.box(
      { height: 1.5 },
      { standard: { metalness: 0.8, roughness: 0.4, color: color, emissive: color, emissiveIntensity: 0.5 } }
    );
    box.add(this.make.sphere({ radius: 0.1, y: 0.8, z: 0.5 }));
    player.userData.box = box;
    player.add(box);

    this.physics.addExisting(player, { shape: "capsule", radius: 0.5, height: 0.4 });
    player.body.setAngularFactor(0, 0, 0);
    player.body.setDamping(0.95, 1);

    this.scene.add(player);
    return player;
  }

  async create() {
    await this.warpSpeed();
    this.physics.add.box({width:3, height: 0.5, depth: 3, collisionFlags: collisionFlags.static});
    this.physics.add.box({x: 1, y: 0.25, width:3, height: 0.5, depth: 3, collisionFlags: collisionFlags.static});
    this.state.player = this.makePlayer("red");
    this.state.player.add(this.camera);
  }

  getGamepad(i) {
    const gamepads = navigator.getGamepads();
    if (gamepads.length && gamepads[i]) return gamepads[i];
  }

  update = (() => {
    const vec = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const forward = new THREE.Vector3(0, 0, 1);
    const tween = new Tween(0.1, function(t) {
      if (!this.a || !this.b) return;
      this.a.slerp(this.b, t);
    });
    let aWasUp = true;
    return (time, delta) => {
      const deltaSecs = delta / 1000;

      const gamepad = this.getGamepad(0);
      if (gamepad) {
        const ax = deadzone(gamepad.axes[0]);
        const ay = deadzone(gamepad.axes[1]);
        if (ax || ay) {
          vec.set(ax, 0, ay);
          vec.normalize();
          tween.reset();
          tween.a = this.state.player.userData.box.quaternion;
          tween.b = quat.setFromUnitVectors(forward, vec)
        }
        this.state.player.body.applyCentralForce(20 * ax, 0, 20 * ay);

        if (aWasUp && gamepad.buttons[0].pressed) {
          this.state.player.body.applyCentralImpulse(0, 6, 0);
        }
        aWasUp = !gamepad.buttons[0].pressed;
      }

      tween.update(deltaSecs);
    };
  })();
}

PhysicsLoader(
  "lib",
  () =>
    new Project({
      gravity: { x: 0, y: -9.8, z: 0 },
      scenes: [MainScene],
    })
);
