import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import { useEffect, useRef } from "react";
import type { Identity } from "spacetimedb";
import type { Player } from "./module_bindings/types";

type MoveIntent = {
  directionX: number;
  directionZ: number;
};

type GameCanvasProps = {
  identity: Identity | undefined;
  inputIntent: MoveIntent;
  players: readonly Player[];
};

type PlayerEntity = {
  root: TransformNode;
  targetPosition: Vector3;
  facing: Vector3;
};

type WorldMaterials = ReturnType<typeof createWorldMaterials>;

const PLAYER_LOCAL_SPEED = 4.5;
const PLAYER_COLOR = new Color3(0.15, 0.42, 0.9);
const OTHER_PLAYER_COLOR = new Color3(0.96, 0.58, 0.17);
const CAMERA_HALF_HEIGHT = 10.2;
const SHORE_Y = -0.22;
const LAND_Y = 0;

export default function GameCanvas({
  identity,
  inputIntent,
  players,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const entitiesRef = useRef(new Map<string, PlayerEntity>());
  const playersRef = useRef(players);
  const identityRef = useRef(identity);
  const inputIntentRef = useRef(inputIntent);

  useEffect(() => {
    playersRef.current = players;
    identityRef.current = identity;
    inputIntentRef.current = inputIntent;
  }, [identity, inputIntent, players]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const engine = new Engine(canvas, true, {
      antialias: true,
      preserveDrawingBuffer: false,
      stencil: true,
    });
    engine.setHardwareScalingLevel(Math.min(window.devicePixelRatio, 1.5));

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.58, 0.82, 0.98, 1);
    scene.ambientColor = new Color3(0.5, 0.6, 0.58);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.58, 0.83, 0.97);
    scene.fogDensity = 0.0025;
    scene.imageProcessingConfiguration.contrast = 1.24;
    scene.imageProcessingConfiguration.exposure = 1.1;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.vignetteEnabled = false;

    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 4,
      Math.PI / 3.05,
      34,
      new Vector3(0, 0.3, 2),
      scene,
    );
    camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    camera.lowerRadiusLimit = 20;
    camera.upperRadiusLimit = 46;
    camera.wheelDeltaPercentage = 0.015;
    camera.panningSensibility = 110;
    camera.attachControl(canvas, true);

    const ambientLight = new HemisphericLight(
      "ambient-sky",
      new Vector3(0.25, 1, 0.2),
      scene,
    );
    ambientLight.intensity = 0.74;
    ambientLight.groundColor = new Color3(0.46, 0.72, 0.55);

    const sunLight = new DirectionalLight(
      "sun",
      new Vector3(-0.7, -1.25, 0.85),
      scene,
    );
    sunLight.position.set(18, 27, -18);
    sunLight.intensity = 1.42;

    const materials = createWorldMaterials(scene);
    const shadowGenerator = createShadowGenerator(sunLight);
    const addShadowCaster = (mesh: AbstractMesh) => {
      mesh.receiveShadows = true;
      shadowGenerator.addShadowCaster(mesh, true);
    };

    setupPostProcessing(scene, camera);
    createWorld(scene, materials, addShadowCaster);
    const waterTexture = materials.water.diffuseTexture as Texture | null;

    const resize = () => {
      engine.resize();
      const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      camera.orthoTop = CAMERA_HALF_HEIGHT;
      camera.orthoBottom = -CAMERA_HALF_HEIGHT;
      camera.orthoRight = CAMERA_HALF_HEIGHT * aspect;
      camera.orthoLeft = -CAMERA_HALF_HEIGHT * aspect;
    };

    const onBeforeRender = () => {
      syncPlayers(
        scene,
        entitiesRef.current,
        playersRef.current,
        identityRef.current,
        addShadowCaster,
      );
      const deltaSeconds = engine.getDeltaTime() / 1000;
      if (waterTexture) {
        waterTexture.uOffset += deltaSeconds * 0.014;
        waterTexture.vOffset += deltaSeconds * 0.008;
      }
      const localIdentity = identityRef.current?.toHexString();

      for (const [playerIdentity, entity] of entitiesRef.current) {
        const isLocalPlayer = playerIdentity === localIdentity;
        if (isLocalPlayer) {
          const intent = inputIntentRef.current;
          entity.root.position.x +=
            intent.directionX * PLAYER_LOCAL_SPEED * deltaSeconds;
          entity.root.position.z +=
            intent.directionZ * PLAYER_LOCAL_SPEED * deltaSeconds;
        }

        entity.root.position = Vector3.Lerp(
          entity.root.position,
          entity.targetPosition,
          isLocalPlayer ? 0.18 : 0.11,
        );

        entity.root.position.x = clamp(entity.root.position.x, -15.5, 15.5);
        entity.root.position.z = clamp(entity.root.position.z, -9.5, 10.8);

        if (entity.facing.lengthSquared() > 0.01) {
          entity.root.rotation.y = Math.atan2(entity.facing.x, entity.facing.z);
        }
      }
    };

    scene.onBeforeRenderObservable.add(onBeforeRender);
    window.addEventListener("resize", resize);
    resize();
    engine.runRenderLoop(() => scene.render());

    sceneRef.current = scene;
    engineRef.current = engine;

    return () => {
      window.removeEventListener("resize", resize);
      scene.onBeforeRenderObservable.removeCallback(onBeforeRender);
      for (const entity of entitiesRef.current.values()) {
        entity.root.dispose();
      }
      entitiesRef.current.clear();
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      engineRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Game field"
      className="game-canvas"
      tabIndex={0}
    />
  );
}

function syncPlayers(
  scene: Scene,
  entities: Map<string, PlayerEntity>,
  players: readonly Player[],
  localIdentity: Identity | undefined,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const liveIdentities = new Set<string>();

  for (const player of players) {
    const playerIdentity = player.identity.toHexString();
    liveIdentities.add(playerIdentity);

    let entity = entities.get(playerIdentity);
    if (!entity) {
      entity = createPlayerEntity(
        scene,
        playerIdentity === localIdentity?.toHexString(),
        addShadowCaster,
      );
      entity.root.position.set(player.x, LAND_Y, player.z);
      entities.set(playerIdentity, entity);
    }

    entity.targetPosition.set(player.x, LAND_Y, player.z);
    entity.facing.set(player.facingX, 0, player.facingZ);
  }

  for (const [playerIdentity, entity] of entities) {
    if (!liveIdentities.has(playerIdentity)) {
      entity.root.dispose();
      entities.delete(playerIdentity);
    }
  }
}

function createShadowGenerator(sunLight: DirectionalLight) {
  const shadowGenerator = new ShadowGenerator(2048, sunLight);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  shadowGenerator.bias = 0.00008;
  shadowGenerator.normalBias = 0.018;
  shadowGenerator.setDarkness(0.34);
  shadowGenerator.frustumEdgeFalloff = 0.18;
  return shadowGenerator;
}

function setupPostProcessing(scene: Scene, camera: ArcRotateCamera) {
  const pipeline = new DefaultRenderingPipeline("cozy-rendering", true, scene, [
    camera,
  ]);
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.74;
  pipeline.bloomWeight = 0.12;
  pipeline.bloomKernel = 38;
  pipeline.bloomScale = 0.45;
  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.16;
  pipeline.sharpen.colorAmount = 0.92;
}

function createWorld(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  createSkyDome(scene);
  createWater(scene, materials);
  createIsland(scene, materials);
  createPaths(scene, materials);
  createStairs(scene, materials, addShadowCaster);
  createBridge(scene, materials, addShadowCaster);
  createDock(scene, materials, addShadowCaster);
  createBuildings(scene, materials, addShadowCaster);
  createTrees(scene, materials, addShadowCaster);
  createFences(scene, materials, addShadowCaster);
  createGardens(scene, materials, addShadowCaster);
  createMeadowDetails(scene, materials, addShadowCaster);
  createProps(scene, materials, addShadowCaster);
  createCompanions(scene, materials, addShadowCaster);
}

function createSkyDome(scene: Scene) {
  const sky = MeshBuilder.CreateSphere(
    "painted-sky-dome",
    {
      diameter: 92,
      segments: 32,
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  sky.position.set(0, 9, 0);
  sky.rotation.y = Math.PI * 0.35;

  const skyMaterial = new StandardMaterial("painted-sky-material", scene);
  skyMaterial.diffuseColor = new Color3(0.6, 0.84, 1);
  skyMaterial.emissiveColor = new Color3(0.6, 0.84, 1);
  skyMaterial.disableLighting = true;
  skyMaterial.backFaceCulling = false;
  sky.material = skyMaterial;
  sky.applyFog = false;
  sky.isPickable = false;
  sky.infiniteDistance = true;
}

function createWorldMaterials(scene: Scene) {
  const grass = createTexturedMaterial(
    scene,
    "grass",
    createGrassTexture(scene),
    new Color3(0.66, 0.95, 0.46),
  );
  const path = createTexturedMaterial(
    scene,
    "path",
    createPathTexture(scene),
    new Color3(0.93, 0.74, 0.45),
  );
  const water = createTexturedMaterial(
    scene,
    "water",
    createWaterTexture(scene),
    new Color3(0.09, 0.68, 0.91),
  );
  water.disableLighting = true;
  water.diffuseColor = new Color3(1, 1, 1);
  water.alpha = 1;
  water.emissiveColor = new Color3(0.08, 0.68, 0.9);
  water.specularColor = new Color3(0.22, 0.36, 0.4);
  water.specularPower = 96;

  const cliff = createTexturedMaterial(
    scene,
    "cliff",
    createCliffTexture(scene),
    new Color3(0.82, 0.52, 0.34),
  );
  const sand = createTexturedMaterial(
    scene,
    "sand",
    createSandTexture(scene),
    new Color3(0.96, 0.82, 0.53),
  );
  const stone = createTexturedMaterial(
    scene,
    "stone",
    createStoneTexture(scene, "#cdbf9f", "#a99a82"),
    new Color3(0.78, 0.72, 0.62),
  );
  const darkStone = createTexturedMaterial(
    scene,
    "dark-stone",
    createStoneTexture(scene, "#928770", "#706552"),
    new Color3(0.53, 0.48, 0.4),
  );
  const wood = createTexturedMaterial(
    scene,
    "wood",
    createWoodTexture(scene, "#9b552c", "#d28446"),
    new Color3(0.65, 0.32, 0.15),
  );
  const lightWood = createTexturedMaterial(
    scene,
    "light-wood",
    createWoodTexture(scene, "#c37a3d", "#f0b46c"),
    new Color3(0.78, 0.43, 0.2),
  );
  const rope = solidMaterial(scene, "rope", "#d2b27a");
  const creamWall = createTexturedMaterial(
    scene,
    "cream-wall",
    createStuccoTexture(scene, "#f1d9ad", "#fff0cb"),
    new Color3(0.95, 0.82, 0.63),
  );
  const plaster = createTexturedMaterial(
    scene,
    "plaster",
    createStuccoTexture(scene, "#f5dfbd", "#fff6df"),
    new Color3(0.98, 0.88, 0.72),
  );
  const redRoof = createTexturedMaterial(
    scene,
    "red-roof",
    createRoofTexture(scene, "#b9432f", "#f1794c"),
    new Color3(0.86, 0.32, 0.22),
  );
  const blueRoof = createTexturedMaterial(
    scene,
    "blue-roof",
    createRoofTexture(scene, "#0b7fa5", "#35c2de"),
    new Color3(0.12, 0.65, 0.78),
  );
  const purpleRoof = createTexturedMaterial(
    scene,
    "purple-roof",
    createRoofTexture(scene, "#8162c4", "#c2a6f3"),
    new Color3(0.66, 0.51, 0.85),
  );
  const thatch = createTexturedMaterial(
    scene,
    "thatch",
    createThatchTexture(scene),
    new Color3(0.9, 0.64, 0.25),
  );
  const doorTeal = solidMaterial(scene, "door-teal", "#35a789");
  const doorBrown = solidMaterial(scene, "door-brown", "#9a4f2c");
  const windowBlue = solidMaterial(scene, "window-blue", "#65c6ed");
  windowBlue.emissiveColor = new Color3(0.04, 0.14, 0.18);
  const trunk = solidMaterial(scene, "trunk", "#8a4a24");
  const leaf = solidMaterial(scene, "leaf", "#4eaf47");
  const leafLight = solidMaterial(scene, "leaf-light", "#78c948");
  const pine = solidMaterial(scene, "pine", "#16825d");
  const flowerWhite = solidMaterial(scene, "flower-white", "#fff4cf");
  const flowerYellow = solidMaterial(scene, "flower-yellow", "#ffd441");
  const flowerPink = solidMaterial(scene, "flower-pink", "#ff79a8");
  const flowerBlue = solidMaterial(scene, "flower-blue", "#68aef4");
  const flowerPurple = solidMaterial(scene, "flower-purple", "#b888f2");
  const black = solidMaterial(scene, "soft-black", "#233121");
  const lamp = solidMaterial(scene, "lamp", "#ffe596");
  lamp.emissiveColor = new Color3(0.75, 0.47, 0.12);
  const cloud = solidMaterial(scene, "cloud", "#ffffff");
  cloud.alpha = 0.86;
  const shadow = solidMaterial(scene, "soft-shadow", "#214123");
  shadow.alpha = 0.22;

  for (const material of [
    creamWall,
    plaster,
    redRoof,
    blueRoof,
    purpleRoof,
    thatch,
  ]) {
    material.backFaceCulling = false;
  }

  return {
    black,
    blueRoof,
    cliff,
    cloud,
    creamWall,
    darkStone,
    doorBrown,
    doorTeal,
    flowerBlue,
    flowerPink,
    flowerPurple,
    flowerWhite,
    flowerYellow,
    grass,
    lamp,
    leaf,
    leafLight,
    lightWood,
    path,
    pine,
    plaster,
    purpleRoof,
    redRoof,
    rope,
    sand,
    shadow,
    stone,
    thatch,
    trunk,
    water,
    windowBlue,
    wood,
  };
}

function createWater(scene: Scene, materials: WorldMaterials) {
  const water = MeshBuilder.CreateGround(
    "turquoise-water",
    { width: 80, height: 62, subdivisions: 1 },
    scene,
  );
  water.position.y = -0.38;
  water.material = materials.water;

  const cove = MeshBuilder.CreateCylinder(
    "soft-sand-cove",
    { height: 0.08, diameter: 1, tessellation: 32 },
    scene,
  );
  cove.scaling.set(11, 1, 4.5);
  cove.position.set(6.5, -0.18, 12.4);
  cove.rotation.y = -0.18;
  cove.material = materials.sand;

  for (const [x, z, sx, sz, rotation] of [
    [11.2, 15.5, 3.4, 1.2, -0.25],
    [15.5, 10.6, 2.4, 1.0, 0.3],
    [-7.8, 13.6, 3.2, 1.15, 0.05],
  ] as const) {
    const foam = MeshBuilder.CreateCylinder(
      "shore-foam",
      { height: 0.025, diameter: 1, tessellation: 28 },
      scene,
    );
    foam.scaling.set(sx, 1, sz);
    foam.position.set(x, -0.12, z);
    foam.rotation.y = rotation;
    foam.material = solidMaterial(scene, `foam-${x}-${z}`, "#e9fbff");
  }
}

function createIsland(scene: Scene, materials: WorldMaterials) {
  const islandPieces = [
    { x: 0, z: 0, sx: 14.8, sz: 10.5, height: 1.25, y: -0.72 },
    { x: -10.6, z: 0.4, sx: 7.2, sz: 8.4, height: 1.15, y: -0.68 },
    { x: 10.2, z: -0.4, sx: 7.5, sz: 8.2, height: 1.2, y: -0.7 },
    { x: -3.5, z: 8.3, sx: 9.2, sz: 5.4, height: 1.05, y: -0.66 },
    { x: 8.3, z: 7.4, sx: 7.6, sz: 5.2, height: 1.05, y: -0.66 },
  ];

  for (const piece of islandPieces) {
    const cliff = MeshBuilder.CreateCylinder(
      "warm-cliff",
      { height: piece.height, diameter: 1, tessellation: 28 },
      scene,
    );
    cliff.scaling.set(piece.sx, 1, piece.sz);
    cliff.position.set(piece.x, piece.y, piece.z);
    cliff.material = materials.cliff;

    const grass = MeshBuilder.CreateCylinder(
      "grass-cap",
      { height: 0.18, diameter: 1, tessellation: 28 },
      scene,
    );
    grass.scaling.set(piece.sx * 0.98, 1, piece.sz * 0.98);
    grass.position.set(piece.x, SHORE_Y + 0.22, piece.z);
    grass.material = materials.grass;
    grass.receiveShadows = true;
  }

  const rearTerrace = MeshBuilder.CreateCylinder(
    "rear-terrace",
    { height: 0.92, diameter: 1, tessellation: 26 },
    scene,
  );
  rearTerrace.scaling.set(10.8, 1, 4.4);
  rearTerrace.position.set(1.2, 0.2, -8.7);
  rearTerrace.material = materials.cliff;

  const rearGrass = MeshBuilder.CreateCylinder(
    "rear-terrace-grass",
    { height: 0.16, diameter: 1, tessellation: 26 },
    scene,
  );
  rearGrass.scaling.set(10.4, 1, 4.1);
  rearGrass.position.set(1.2, 0.72, -8.7);
  rearGrass.material = materials.grass;
  rearGrass.receiveShadows = true;

  for (const [x, z, sx, sz] of [
    [-13.2, 8.7, 3.2, 1.3],
    [-15.5, 4.2, 2.3, 1.1],
    [15.5, 6.3, 2.8, 1.3],
    [13.6, 11.4, 2.2, 1.1],
    [-3.8, 13.1, 3.5, 1.2],
  ] as const) {
    const sandPatch = MeshBuilder.CreateCylinder(
      "sand-shore",
      { height: 0.08, diameter: 1, tessellation: 24 },
      scene,
    );
    sandPatch.scaling.set(sx, 1, sz);
    sandPatch.position.set(x, 0.05, z);
    sandPatch.material = materials.sand;
  }

  for (const [x, z, sx, sz] of [
    [-8.3, -7.1, 2.7, 1.2],
    [-1.6, -10.2, 2.4, 1],
    [7.8, -9.4, 2.7, 1.1],
    [13.8, -4.8, 2.2, 1],
  ] as const) {
    const backGrass = MeshBuilder.CreateCylinder(
      "distant-grass-islet",
      { height: 0.12, diameter: 1, tessellation: 20 },
      scene,
    );
    backGrass.scaling.set(sx, 1, sz);
    backGrass.position.set(x, -0.08, z);
    backGrass.material = materials.grass;
  }
}

function createPaths(scene: Scene, materials: WorldMaterials) {
  const pathPoints = [
    [-11, 4.3],
    [-8.8, 3.5],
    [-6.5, 2.7],
    [-4.2, 1.6],
    [-1.9, 0.8],
    [0.4, 0.4],
    [2.8, 0.2],
    [5.2, -0.4],
    [7.4, -1.5],
  ] as const;
  createStonePath(scene, materials, pathPoints, 1.55);
  createStonePath(
    scene,
    materials,
    [
      [0.2, 0.4],
      [-0.2, 2.7],
      [-0.4, 5.1],
      [-0.2, 7.4],
      [0.4, 9.5],
    ],
    1.55,
  );
  createStonePath(
    scene,
    materials,
    [
      [2.7, 0.2],
      [3.6, -2.1],
      [4.7, -4.6],
      [5.7, -6.4],
    ],
    1.4,
  );
  createStonePath(
    scene,
    materials,
    [
      [-5.6, 2.1],
      [-7.7, 0.4],
      [-9.5, -1.5],
      [-11.6, -2.7],
    ],
    1.35,
  );

  for (const [x, z, width, depth] of [
    [-12.5, 5.3, 3.6, 1.2],
    [6.4, -6.9, 4.2, 1.4],
    [13.1, 2.1, 3.5, 1.2],
  ] as const) {
    const landing = MeshBuilder.CreateBox(
      "path-landing",
      { width, depth, height: 0.045 },
      scene,
    );
    landing.position.set(x, 0.12, z);
    landing.material = materials.path;
    landing.receiveShadows = true;
  }
}

function createStonePath(
  scene: Scene,
  materials: WorldMaterials,
  points: readonly (readonly [number, number])[],
  width: number,
) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [startX, startZ] = points[i];
    const [endX, endZ] = points[i + 1];
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(length / 0.8));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const wobble = Math.sin((i * 31 + step) * 1.7) * 0.16;
      const px = startX + dx * t + wobble * (dz / Math.max(length, 0.001));
      const pz = startZ + dz * t - wobble * (dx / Math.max(length, 0.001));
      const stone = MeshBuilder.CreateCylinder(
        "path-stone",
        { height: 0.055, diameter: 1, tessellation: 9 },
        scene,
      );
      stone.scaling.set(
        width * (0.44 + 0.08 * hashNoise(i * 19 + step)),
        1,
        0.48 + 0.1 * hashNoise(i * 41 + step),
      );
      stone.position.set(px, 0.13, pz);
      stone.rotation.y = Math.atan2(dx, dz) + hashNoise(i * 13 + step) * 0.32;
      stone.material = materials.path;
      stone.receiveShadows = true;
    }
  }
}

function createBuildings(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  createCottage(scene, materials, addShadowCaster, {
    position: new Vector3(-12.5, LAND_Y, 1.2),
    rotation: -0.08,
    roofMaterial: materials.redRoof,
    doorMaterial: materials.doorBrown,
    wallMaterial: materials.plaster,
    scale: 1.05,
  });
  createCottage(scene, materials, addShadowCaster, {
    position: new Vector3(6.4, LAND_Y, -6.3),
    rotation: 0.06,
    roofMaterial: materials.blueRoof,
    doorMaterial: materials.doorTeal,
    wallMaterial: materials.creamWall,
    scale: 1.03,
  });
  createRoundHut(
    scene,
    materials,
    addShadowCaster,
    new Vector3(13.1, LAND_Y, -0.8),
  );
  createCottage(scene, materials, addShadowCaster, {
    position: new Vector3(-4.3, 0.72, -9.3),
    rotation: 0.03,
    roofMaterial: materials.purpleRoof,
    doorMaterial: materials.doorBrown,
    wallMaterial: materials.creamWall,
    scale: 0.86,
  });
}

function createCottage(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  options: {
    position: Vector3;
    rotation: number;
    roofMaterial: StandardMaterial;
    doorMaterial: StandardMaterial;
    wallMaterial: StandardMaterial;
    scale: number;
  },
) {
  const root = new TransformNode("cottage", scene);
  root.position = options.position.clone();
  root.rotation.y = options.rotation;
  root.scaling.setAll(options.scale);
  createSoftShadow(scene, materials, root, 3.0, 2.35, 0.2);

  const base = MeshBuilder.CreateBox(
    "cottage-walls",
    { width: 4.1, height: 2.45, depth: 3.45 },
    scene,
  );
  base.position.y = 1.26;
  base.material = options.wallMaterial;
  base.parent = root;
  base.receiveShadows = true;
  addShadowCaster(base);

  const trim = MeshBuilder.CreateBox(
    "cottage-stone-trim",
    { width: 4.4, height: 0.34, depth: 3.72 },
    scene,
  );
  trim.position.y = 0.2;
  trim.material = materials.stone;
  trim.parent = root;

  for (const x of [-2.12, 2.12]) {
    const cornerPost = MeshBuilder.CreateBox(
      "cottage-corner-post",
      { width: 0.18, height: 2.25, depth: 0.2 },
      scene,
    );
    cornerPost.position.set(x, 1.34, 1.78);
    cornerPost.material = materials.lightWood;
    cornerPost.parent = root;
  }

  createCurvedCottageRoof(
    scene,
    materials,
    addShadowCaster,
    root,
    options.roofMaterial,
  );

  const chimney = MeshBuilder.CreateBox(
    "cottage-chimney",
    { width: 0.58, height: 1.18, depth: 0.58 },
    scene,
  );
  chimney.position.set(1.15, 3.38, -0.75);
  chimney.material = materials.darkStone;
  chimney.parent = root;
  addShadowCaster(chimney);

  const door = MeshBuilder.CreateBox(
    "cottage-door",
    { width: 0.95, height: 1.55, depth: 0.08 },
    scene,
  );
  door.position.set(0, 0.88, 1.78);
  door.material = options.doorMaterial;
  door.parent = root;

  const doorTop = MeshBuilder.CreateBox(
    "cottage-door-top-trim",
    { width: 1.18, height: 0.16, depth: 0.12 },
    scene,
  );
  doorTop.position.set(0, 1.68, 1.87);
  doorTop.material = materials.lightWood;
  doorTop.parent = root;

  for (const x of [-0.55, 0.55]) {
    const doorSide = MeshBuilder.CreateBox(
      "cottage-door-side-trim",
      { width: 0.13, height: 1.54, depth: 0.12 },
      scene,
    );
    doorSide.position.set(x, 0.88, 1.87);
    doorSide.material = materials.lightWood;
    doorSide.parent = root;
  }

  const doorknob = MeshBuilder.CreateSphere(
    "door-knob",
    { diameter: 0.12, segments: 8 },
    scene,
  );
  doorknob.position.set(0.32, 0.9, 1.85);
  doorknob.material = materials.flowerYellow;
  doorknob.parent = root;

  for (const x of [-1.35, 1.35]) {
    const window = MeshBuilder.CreateBox(
      "cottage-window",
      { width: 0.72, height: 0.72, depth: 0.08 },
      scene,
    );
    window.position.set(x, 1.32, 1.79);
    window.material = materials.windowBlue;
    window.parent = root;

    const verticalMuntin = MeshBuilder.CreateBox(
      "window-vertical-muntin",
      { width: 0.08, height: 0.72, depth: 0.1 },
      scene,
    );
    verticalMuntin.position.set(x, 1.32, 1.86);
    verticalMuntin.material = materials.lightWood;
    verticalMuntin.parent = root;

    const horizontalMuntin = MeshBuilder.CreateBox(
      "window-horizontal-muntin",
      { width: 0.72, height: 0.08, depth: 0.1 },
      scene,
    );
    horizontalMuntin.position.set(x, 1.32, 1.87);
    horizontalMuntin.material = materials.lightWood;
    horizontalMuntin.parent = root;

    const sill = MeshBuilder.CreateBox(
      "window-sill",
      { width: 0.95, height: 0.12, depth: 0.16 },
      scene,
    );
    sill.position.set(x, 0.88, 1.86);
    sill.material = materials.lightWood;
    sill.parent = root;
  }

  for (const x of [-1.65, 1.65]) {
    const planter = MeshBuilder.CreateBox(
      "flower-box",
      { width: 0.92, height: 0.22, depth: 0.3 },
      scene,
    );
    planter.position.set(x, 0.76, 1.96);
    planter.material = materials.wood;
    planter.parent = root;
    for (let i = 0; i < 3; i += 1) {
      createFlowerCluster(
        scene,
        materials,
        new Vector3(x - 0.28 + i * 0.28, 0.96, 2.1),
        0.36,
        root,
      );
    }
  }

  createCottageFacade(scene, materials, root, options.doorMaterial, -1.79, -1);
}

function createCottageFacade(
  scene: Scene,
  materials: WorldMaterials,
  root: TransformNode,
  doorMaterial: StandardMaterial,
  z: number,
  depthSign: -1 | 1,
) {
  const detailZ = z + depthSign * 0.08;
  const door = MeshBuilder.CreateBox(
    "cottage-visible-door",
    { width: 0.95, height: 1.48, depth: 0.08 },
    scene,
  );
  door.position.set(0, 0.86, z);
  door.material = doorMaterial;
  door.parent = root;

  const doorArch = MeshBuilder.CreateTorus(
    "cottage-door-arch",
    { diameter: 1.15, thickness: 0.09, tessellation: 16 },
    scene,
  );
  doorArch.position.set(0, 1.56, detailZ);
  doorArch.rotation.x = Math.PI / 2;
  doorArch.scaling.set(1, 0.58, 0.1);
  doorArch.material = materials.lightWood;
  doorArch.parent = root;

  for (const x of [-0.55, 0.55]) {
    const doorSide = MeshBuilder.CreateBox(
      "cottage-visible-door-trim",
      { width: 0.12, height: 1.48, depth: 0.12 },
      scene,
    );
    doorSide.position.set(x, 0.86, detailZ);
    doorSide.material = materials.lightWood;
    doorSide.parent = root;
  }

  const doorknob = MeshBuilder.CreateSphere(
    "visible-door-knob",
    { diameter: 0.12, segments: 8 },
    scene,
  );
  doorknob.position.set(0.32, 0.88, detailZ + depthSign * 0.02);
  doorknob.material = materials.flowerYellow;
  doorknob.parent = root;

  for (const x of [-1.35, 1.35]) {
    const frame = MeshBuilder.CreateBox(
      "visible-window-frame",
      { width: 0.9, height: 0.82, depth: 0.1 },
      scene,
    );
    frame.position.set(x, 1.35, detailZ);
    frame.material = materials.lightWood;
    frame.parent = root;

    const window = MeshBuilder.CreateBox(
      "visible-window-glass",
      { width: 0.66, height: 0.6, depth: 0.12 },
      scene,
    );
    window.position.set(x, 1.35, detailZ + depthSign * 0.02);
    window.material = materials.windowBlue;
    window.parent = root;

    const muntin = MeshBuilder.CreateBox(
      "visible-window-muntin",
      { width: 0.06, height: 0.62, depth: 0.14 },
      scene,
    );
    muntin.position.set(x, 1.35, detailZ + depthSign * 0.04);
    muntin.material = materials.lightWood;
    muntin.parent = root;

    const sill = MeshBuilder.CreateBox(
      "visible-window-sill",
      { width: 1.02, height: 0.12, depth: 0.18 },
      scene,
    );
    sill.position.set(x, 0.9, detailZ + depthSign * 0.02);
    sill.material = materials.lightWood;
    sill.parent = root;
  }
}

function createCurvedCottageRoof(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  root: TransformNode,
  roofMaterial: StandardMaterial,
) {
  const roof = createArchRoofMesh(scene, {
    name: "cottage-curved-roof",
    width: 5.25,
    depth: 4.55,
    baseY: 2.55,
    archHeight: 0.95,
    overhang: 0.16,
  });
  roof.material = roofMaterial;
  roof.parent = root;
  roof.receiveShadows = true;
  addShadowCaster(roof);

  for (const z of [-2.28, 2.28]) {
    const gable = createArchGableMesh(scene, {
      name: "cottage-roof-gable",
      width: 4.65,
      baseY: 2.5,
      archHeight: 0.8,
      z,
    });
    gable.material = materials.plaster;
    gable.parent = root;
    gable.receiveShadows = true;
  }

  for (const z of [-2.35, 2.35]) {
    const trim = createArchGableMesh(scene, {
      name: "cottage-gable-trim",
      width: 4.95,
      baseY: 2.48,
      archHeight: 0.9,
      z: z + Math.sign(z) * 0.035,
      frameOnly: true,
    });
    trim.material = materials.lightWood;
    trim.parent = root;
    addShadowCaster(trim);
  }

  for (let i = 0; i < 7; i += 1) {
    const z = -1.86 + i * 0.62;
    const tileRow = MeshBuilder.CreateBox(
      "rounded-roof-tile-row",
      { width: 4.9, height: 0.055, depth: 0.1 },
      scene,
    );
    tileRow.position.set(0, 3.02 - Math.abs(i - 3) * 0.015, z);
    tileRow.material = materials.lightWood;
    tileRow.parent = root;
  }

  const ridge = MeshBuilder.CreateCylinder(
    "rounded-roof-ridge",
    { height: 4.7, diameter: 0.2, tessellation: 12 },
    scene,
  );
  ridge.position.set(0, 3.5, 0);
  ridge.rotation.x = Math.PI / 2;
  ridge.material = roofMaterial;
  ridge.parent = root;
  addShadowCaster(ridge);

  for (const x of [-2.8, 2.8]) {
    const eave = MeshBuilder.CreateBox(
      "curved-roof-eave",
      { width: 0.24, height: 0.22, depth: 4.72 },
      scene,
    );
    eave.position.set(x, 2.54, 0);
    eave.material = materials.lightWood;
    eave.parent = root;
    addShadowCaster(eave);
  }
}

function createArchRoofMesh(
  scene: Scene,
  options: {
    name: string;
    width: number;
    depth: number;
    baseY: number;
    archHeight: number;
    overhang: number;
  },
) {
  const xSegments = 18;
  const zSegments = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const zT = zIndex / zSegments;
    const z = (zT - 0.5) * options.depth;
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const xT = xIndex / xSegments;
      const side = Math.abs(xT - 0.5) * 2;
      const x = (xT - 0.5) * (options.width + options.overhang);
      const y = options.baseY + options.archHeight * (1 - side ** 1.82);
      positions.push(x, y, z);
      uvs.push(xT * 2.8, zT * 4.6);
    }
  }

  const row = xSegments + 1;
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(options.name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  return mesh;
}

function createArchGableMesh(
  scene: Scene,
  options: {
    name: string;
    width: number;
    baseY: number;
    archHeight: number;
    z: number;
    frameOnly?: boolean;
  },
) {
  if (options.frameOnly) {
    const meshes: Mesh[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const side = Math.abs(t - 0.5) * 2;
      const x = (t - 0.5) * options.width;
      const y = options.baseY + options.archHeight * (1 - side ** 1.82);
      const piece = MeshBuilder.CreateSphere(
        "arched-gable-frame-piece",
        { diameter: 0.16, segments: 8 },
        scene,
      );
      piece.position.set(x, y, options.z);
      piece.scaling.set(1.15, 0.55, 0.55);
      meshes.push(piece);
    }
    return Mesh.MergeMeshes(meshes, true, true, undefined, false, true) as Mesh;
  }

  const steps = 20;
  const positions: number[] = [0, options.baseY, options.z];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [0.5, 1];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const side = Math.abs(t - 0.5) * 2;
    const x = (t - 0.5) * options.width;
    const y = options.baseY + options.archHeight * (1 - side ** 1.82);
    positions.push(x, y, options.z);
    uvs.push(t, 0);
  }

  for (let i = 1; i <= steps; i += 1) {
    indices.push(0, i, i + 1);
  }

  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(options.name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  return mesh;
}

function createRoundHut(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
) {
  const root = new TransformNode("round-hut", scene);
  root.position = position.clone();
  root.rotation.y = -0.1;
  createSoftShadow(scene, materials, root, 2.5, 2.1, 0.05);

  const wall = MeshBuilder.CreateCylinder(
    "round-hut-wall",
    { height: 2.45, diameter: 3.8, tessellation: 22 },
    scene,
  );
  wall.position.y = 1.25;
  wall.material = materials.creamWall;
  wall.parent = root;
  wall.receiveShadows = true;
  addShadowCaster(wall);

  for (let i = 0; i < 4; i += 1) {
    const roof = MeshBuilder.CreateCylinder(
      "thatched-roof-ring",
      {
        height: 0.55,
        diameterBottom: 4.45 - i * 0.62,
        diameterTop: 3.55 - i * 0.62,
        tessellation: 24,
      },
      scene,
    );
    roof.position.y = 2.45 + i * 0.36;
    roof.material = materials.thatch;
    roof.parent = root;
    addShadowCaster(roof);
  }

  const roofCap = MeshBuilder.CreateCylinder(
    "thatched-roof-cap",
    { height: 0.7, diameterBottom: 1.25, diameterTop: 0, tessellation: 22 },
    scene,
  );
  roofCap.position.y = 3.85;
  roofCap.material = materials.thatch;
  roofCap.parent = root;
  addShadowCaster(roofCap);

  const door = MeshBuilder.CreateBox(
    "round-hut-door",
    { width: 0.9, height: 1.45, depth: 0.08 },
    scene,
  );
  door.position.set(0, 0.85, 1.92);
  door.material = materials.doorBrown;
  door.parent = root;

  for (const x of [-1.15, 1.15]) {
    const window = MeshBuilder.CreateBox(
      "round-hut-window",
      { width: 0.62, height: 0.68, depth: 0.08 },
      scene,
    );
    window.position.set(x, 1.45, 1.78);
    window.material = materials.windowBlue;
    window.parent = root;
  }

  const visibleDoor = MeshBuilder.CreateBox(
    "round-hut-visible-door",
    { width: 0.92, height: 1.42, depth: 0.08 },
    scene,
  );
  visibleDoor.position.set(0, 0.86, -1.92);
  visibleDoor.material = materials.doorBrown;
  visibleDoor.parent = root;

  const visibleDoorTrim = MeshBuilder.CreateTorus(
    "round-hut-door-trim",
    { diameter: 1.12, thickness: 0.08, tessellation: 18 },
    scene,
  );
  visibleDoorTrim.position.set(0, 1.57, -1.98);
  visibleDoorTrim.rotation.x = Math.PI / 2;
  visibleDoorTrim.scaling.set(1, 0.6, 0.12);
  visibleDoorTrim.material = materials.lightWood;
  visibleDoorTrim.parent = root;

  for (const x of [-1.12, 1.12]) {
    const frame = MeshBuilder.CreateCylinder(
      "round-visible-window-frame",
      { height: 0.1, diameter: 0.78, tessellation: 16 },
      scene,
    );
    frame.position.set(x, 1.43, -1.76);
    frame.rotation.x = Math.PI / 2;
    frame.material = materials.lightWood;
    frame.parent = root;

    const glass = MeshBuilder.CreateCylinder(
      "round-visible-window-glass",
      { height: 0.12, diameter: 0.56, tessellation: 16 },
      scene,
    );
    glass.position.set(x, 1.43, -1.84);
    glass.rotation.x = Math.PI / 2;
    glass.material = materials.windowBlue;
    glass.parent = root;
  }
}

function createTrees(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const fruitTrees = [
    [-4.7, -1.4, 1.05],
    [-14.6, -5.0, 1.2],
    [11.6, -6.2, 1.05],
    [16.0, 4.5, 1.05],
    [-7.6, 7.7, 0.95],
  ] as const;
  for (const [x, z, scale] of fruitTrees) {
    createFruitTree(
      scene,
      materials,
      addShadowCaster,
      new Vector3(x, LAND_Y, z),
      scale,
    );
  }

  const pines = [
    [-17.8, -3.4, 1.2],
    [-16.2, 2.2, 1.1],
    [0.8, -11.4, 1.05],
    [3.2, -10.5, 0.9],
    [14.4, -9.3, 1.1],
    [17.6, 0.3, 0.95],
  ] as const;
  for (const [x, z, scale] of pines) {
    createPineTree(
      scene,
      materials,
      addShadowCaster,
      new Vector3(x, LAND_Y, z),
      scale,
    );
  }

  for (const [x, z, sx, sz] of [
    [-6.8, 5.2, 1.2, 0.78],
    [-2.4, 4.4, 1.1, 0.72],
    [3.2, 3.6, 1.2, 0.74],
    [8.8, 2.5, 1.2, 0.7],
    [-11.2, 8.2, 1.4, 0.8],
    [12.7, 7.7, 1.35, 0.82],
  ] as const) {
    createBush(
      scene,
      materials,
      addShadowCaster,
      new Vector3(x, LAND_Y, z),
      sx,
      sz,
    );
  }
}

function createFruitTree(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
  scale: number,
) {
  const root = new TransformNode("fruit-tree", scene);
  root.position = position.clone();
  root.scaling.setAll(scale);
  createSoftShadow(scene, materials, root, 1.45, 1.15, 0.1);

  const trunk = MeshBuilder.CreateCylinder(
    "tree-trunk",
    { height: 2.5, diameterBottom: 0.62, diameterTop: 0.42, tessellation: 8 },
    scene,
  );
  trunk.position.y = 1.25;
  trunk.material = materials.trunk;
  trunk.parent = root;
  addShadowCaster(trunk);

  const crownPositions = [
    [0, 2.85, 0, 2.3],
    [-0.9, 2.55, 0.25, 1.65],
    [0.9, 2.55, -0.1, 1.7],
    [0.05, 3.35, -0.35, 1.7],
    [0.15, 2.5, 0.95, 1.55],
  ] as const;
  for (const [x, y, z, diameter] of crownPositions) {
    const crown = MeshBuilder.CreateSphere(
      "tree-crown",
      { diameter, segments: 8 },
      scene,
    );
    crown.position.set(x, y, z);
    crown.scaling.y = 0.84;
    crown.material = y > 3 ? materials.leafLight : materials.leaf;
    crown.parent = root;
    addShadowCaster(crown);
  }

  for (const [x, y, z] of [
    [-0.8, 2.9, 0.9],
    [0.85, 2.75, 0.66],
    [0.15, 3.42, 0.3],
    [-0.35, 2.45, 1.15],
    [0.55, 3.05, -0.72],
  ] as const) {
    const fruit = MeshBuilder.CreateSphere(
      "orange-fruit",
      { diameter: 0.28, segments: 8 },
      scene,
    );
    fruit.position.set(x, y, z);
    fruit.material = materials.flowerYellow;
    fruit.parent = root;
  }
}

function createPineTree(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
  scale: number,
) {
  const root = new TransformNode("pine-tree", scene);
  root.position = position.clone();
  root.scaling.setAll(scale);
  createSoftShadow(scene, materials, root, 1.1, 0.9, 0.08);

  const trunk = MeshBuilder.CreateCylinder(
    "pine-trunk",
    { height: 1.8, diameter: 0.45, tessellation: 8 },
    scene,
  );
  trunk.position.y = 0.9;
  trunk.material = materials.trunk;
  trunk.parent = root;
  addShadowCaster(trunk);

  for (let i = 0; i < 3; i += 1) {
    const needles = MeshBuilder.CreateCylinder(
      "pine-needles",
      {
        height: 1.55,
        diameterBottom: 2.4 - i * 0.45,
        diameterTop: 0.18,
        tessellation: 12,
      },
      scene,
    );
    needles.position.y = 1.65 + i * 0.78;
    needles.material = i === 0 ? materials.pine : materials.leaf;
    needles.parent = root;
    addShadowCaster(needles);
  }
}

function createBush(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
  scaleX: number,
  scaleZ: number,
) {
  const root = new TransformNode("bush", scene);
  root.position = position.clone();
  createSoftShadow(scene, materials, root, 0.9 * scaleX, 0.6 * scaleZ, 0.02);
  for (const [x, z, diameter] of [
    [-0.38, 0, 1],
    [0.28, 0.1, 0.95],
    [0.02, -0.36, 0.85],
  ] as const) {
    const sphere = MeshBuilder.CreateSphere(
      "bush-lobe",
      { diameter, segments: 8 },
      scene,
    );
    sphere.position.set(x * scaleX, 0.48, z * scaleZ);
    sphere.scaling.set(scaleX, 0.62, scaleZ);
    sphere.material = materials.leafLight;
    sphere.parent = root;
    addShadowCaster(sphere);
  }
}

function createFences(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  createFenceLine(scene, materials, addShadowCaster, [
    [-13.2, 6.9],
    [-9.4, 6.7],
    [-6.1, 5.8],
  ]);
  createFenceLine(scene, materials, addShadowCaster, [
    [2.2, 3.6],
    [6.0, 3.5],
    [9.4, 2.8],
    [12.4, 3.9],
  ]);
  createFenceLine(scene, materials, addShadowCaster, [
    [8.4, -5.4],
    [11.2, -4.4],
    [14.3, -4.1],
    [16.4, -2.8],
  ]);
  createFenceLine(scene, materials, addShadowCaster, [
    [-3.1, 8.8],
    [0.4, 9.4],
    [3.5, 8.8],
  ]);
}

function createFenceLine(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  points: readonly (readonly [number, number])[],
) {
  for (const [x, z] of points) {
    const post = MeshBuilder.CreateCylinder(
      "fence-post",
      { height: 1.05, diameter: 0.24, tessellation: 8 },
      scene,
    );
    post.position.set(x, 0.55, z);
    post.material = materials.wood;
    addShadowCaster(post);
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const [startX, startZ] = points[i];
    const [endX, endZ] = points[i + 1];
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const rail = MeshBuilder.CreateBox(
      "fence-rail",
      { width: 0.18, height: 0.16, depth: length },
      scene,
    );
    rail.position.set((startX + endX) / 2, 0.78, (startZ + endZ) / 2);
    rail.rotation.y = Math.atan2(dx, dz);
    rail.material = materials.lightWood;
    addShadowCaster(rail);

    const lowerRail = rail.clone("fence-rail-low");
    if (lowerRail) {
      lowerRail.position.y = 0.47;
      lowerRail.material = materials.lightWood;
      addShadowCaster(lowerRail);
    }
  }
}

function createBridge(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const root = new TransformNode("bridge", scene);
  root.position.set(0, 0, 11.55);

  for (let i = 0; i < 7; i += 1) {
    const plank = MeshBuilder.CreateBox(
      "bridge-plank",
      { width: 4.4, height: 0.16, depth: 0.72 },
      scene,
    );
    plank.position.set(
      0,
      0.26 + Math.sin((i / 6) * Math.PI) * 0.2,
      i * 0.78 - 2.35,
    );
    plank.rotation.x = 0.03 * Math.sin(i);
    plank.material = i % 2 === 0 ? materials.wood : materials.lightWood;
    plank.parent = root;
    addShadowCaster(plank);
  }

  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const post = MeshBuilder.CreateCylinder(
        "bridge-post",
        { height: 1.55, diameter: 0.28, tessellation: 8 },
        scene,
      );
      post.position.set(side * 2.25, 0.9, i * 1.45 - 2.25);
      post.material = materials.wood;
      post.parent = root;
      addShadowCaster(post);
    }

    const rope = MeshBuilder.CreateBox(
      "bridge-rope",
      { width: 0.14, height: 0.14, depth: 4.7 },
      scene,
    );
    rope.position.set(side * 2.25, 1.33, 0);
    rope.material = materials.rope;
    rope.parent = root;
  }
}

function createDock(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const root = new TransformNode("dock", scene);
  root.position.set(12.7, 0, 14.2);
  root.rotation.y = -0.1;

  for (let i = 0; i < 7; i += 1) {
    const plank = MeshBuilder.CreateBox(
      "dock-plank",
      { width: 0.72, height: 0.14, depth: 4.2 },
      scene,
    );
    plank.position.set(i * 0.74 - 2.3, -0.02, 0);
    plank.material = i % 2 === 0 ? materials.wood : materials.lightWood;
    plank.parent = root;
    addShadowCaster(plank);
  }

  for (const [x, z] of [
    [-2.8, -1.9],
    [2.5, -1.9],
    [-2.8, 1.9],
    [2.5, 1.9],
  ] as const) {
    const post = MeshBuilder.CreateCylinder(
      "dock-post",
      { height: 1.8, diameter: 0.32, tessellation: 8 },
      scene,
    );
    post.position.set(x, 0.55, z);
    post.material = materials.wood;
    post.parent = root;
    addShadowCaster(post);
  }

  const crate = MeshBuilder.CreateBox(
    "dock-crate",
    { width: 0.9, height: 0.75, depth: 0.9 },
    scene,
  );
  crate.position.set(-1.85, 0.42, -1.1);
  crate.material = materials.lightWood;
  crate.parent = root;
  addShadowCaster(crate);

  createLamp(
    scene,
    materials,
    addShadowCaster,
    new Vector3(15.2, 0, 15.7),
    0.9,
  );
}

function createStairs(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const root = new TransformNode("terrace-stairs", scene);
  root.position.set(1.1, 0, -5.35);

  for (let i = 0; i < 7; i += 1) {
    const step = MeshBuilder.CreateBox(
      "stone-stair",
      { width: 2.35 - i * 0.04, height: 0.2, depth: 0.56 },
      scene,
    );
    step.position.set(0, 0.11 + i * 0.11, -i * 0.52);
    step.material = i % 2 === 0 ? materials.stone : materials.darkStone;
    step.parent = root;
    step.receiveShadows = true;
    addShadowCaster(step);
  }

  for (const side of [-1, 1]) {
    const rail = MeshBuilder.CreateBox(
      "stair-rail",
      { width: 0.16, height: 0.18, depth: 3.8 },
      scene,
    );
    rail.position.set(side * 1.35, 0.78, -1.55);
    rail.rotation.x = -0.15;
    rail.material = materials.lightWood;
    rail.parent = root;
    addShadowCaster(rail);
  }
}

function createGardens(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const flowerBands = [
    { centerX: -8.7, centerZ: 4.7, width: 5.6, depth: 2.2, count: 42 },
    { centerX: 1.3, centerZ: 4.4, width: 5.2, depth: 2.4, count: 38 },
    { centerX: 9.7, centerZ: 4.9, width: 5.8, depth: 2.4, count: 40 },
    { centerX: -7.0, centerZ: 9.2, width: 5.0, depth: 1.8, count: 30 },
    { centerX: 10.9, centerZ: 8.7, width: 4.8, depth: 1.7, count: 26 },
    { centerX: -13.6, centerZ: -2.5, width: 4.4, depth: 2.4, count: 28 },
  ];

  let seed = 5;
  for (const band of flowerBands) {
    for (let i = 0; i < band.count; i += 1) {
      seed += 1;
      const x = band.centerX + (hashNoise(seed) - 0.5) * band.width;
      const z = band.centerZ + (hashNoise(seed + 50) - 0.5) * band.depth;
      createFlowerCluster(
        scene,
        materials,
        new Vector3(x, LAND_Y, z),
        0.62 + hashNoise(seed + 100) * 0.2,
      );
    }
  }

  for (const [x, z, sx, sz] of [
    [-0.9, 6.1, 1.2, 0.7],
    [4.0, 5.7, 1.0, 0.65],
    [-12.0, 9.4, 0.9, 0.55],
    [13.2, 5.8, 0.9, 0.55],
  ] as const) {
    const planter = MeshBuilder.CreateBox(
      "wood-planter",
      { width: 1.6 * sx, height: 0.34, depth: 0.8 * sz },
      scene,
    );
    planter.position.set(x, 0.22, z);
    planter.material = materials.lightWood;
    addShadowCaster(planter);
    createFlowerCluster(
      scene,
      materials,
      new Vector3(x - 0.4 * sx, 0.36, z),
      0.6,
    );
    createFlowerCluster(
      scene,
      materials,
      new Vector3(x + 0.38 * sx, 0.36, z),
      0.6,
    );
  }
}

function createMeadowDetails(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const regions = [
    { centerX: -12.5, centerZ: -3.2, width: 7.2, depth: 4.8, count: 42 },
    { centerX: -3.2, centerZ: -2.8, width: 6.8, depth: 4.6, count: 34 },
    { centerX: 7.8, centerZ: -2.8, width: 7.2, depth: 4.8, count: 36 },
    { centerX: 0.2, centerZ: 6.9, width: 10.5, depth: 4.8, count: 46 },
    { centerX: 11.4, centerZ: 6.8, width: 7.5, depth: 4.4, count: 32 },
  ];

  let seed = 300;
  for (const region of regions) {
    for (let i = 0; i < region.count; i += 1) {
      seed += 1;
      const x = region.centerX + (hashNoise(seed) - 0.5) * region.width;
      const z = region.centerZ + (hashNoise(seed + 61) - 0.5) * region.depth;
      if (Math.abs(x) < 1.6 && z > -0.5 && z < 7.8) {
        continue;
      }
      createGrassTuft(
        scene,
        materials,
        new Vector3(x, LAND_Y, z),
        0.55 + hashNoise(seed + 11) * 0.45,
      );
    }
  }

  for (const [x, z, material] of [
    [-3.6, 10.8, materials.flowerYellow],
    [-10.7, 8.9, materials.flowerPink],
    [4.8, 7.5, materials.flowerBlue],
    [12.2, 4.8, materials.flowerPurple],
    [7.2, 11.2, materials.flowerWhite],
  ] as const) {
    const star = MeshBuilder.CreateSphere(
      "large-blossom-head",
      { diameter: 0.34, segments: 8 },
      scene,
    );
    star.position.set(x, 0.38, z);
    star.scaling.set(1, 0.38, 1);
    star.material = material;
    addShadowCaster(star);
  }
}

function createGrassTuft(
  scene: Scene,
  materials: WorldMaterials,
  position: Vector3,
  scale: number,
) {
  const root = new TransformNode("grass-tuft", scene);
  root.position = position.clone();
  root.rotation.y = hashNoise(position.x * 11 + position.z * 37) * Math.PI;
  root.scaling.setAll(scale);

  for (let i = 0; i < 4; i += 1) {
    const blade = MeshBuilder.CreateBox(
      "grass-blade",
      { width: 0.055, height: 0.42 + i * 0.035, depth: 0.075 },
      scene,
    );
    blade.position.set((i - 1.5) * 0.12, 0.19, Math.sin(i) * 0.08);
    blade.rotation.z = (i - 1.5) * 0.2;
    blade.rotation.x = Math.sin(i * 1.7) * 0.16;
    blade.material = i % 2 === 0 ? materials.leafLight : materials.leaf;
    blade.parent = root;
  }
}

function createFlowerCluster(
  scene: Scene,
  materials: WorldMaterials,
  position: Vector3,
  scale: number,
  parent?: TransformNode,
) {
  const root = new TransformNode("flower-cluster", scene);
  if (parent) {
    root.parent = parent;
  }
  root.position = position.clone();
  root.scaling.setAll(scale);

  const leaves = MeshBuilder.CreateSphere(
    "flower-leaves",
    { diameter: 0.42, segments: 6 },
    scene,
  );
  leaves.scaling.set(1.2, 0.35, 0.9);
  leaves.position.y = 0.14;
  leaves.material = materials.leaf;
  leaves.parent = root;

  const flowerMaterials = [
    materials.flowerWhite,
    materials.flowerYellow,
    materials.flowerPink,
    materials.flowerBlue,
    materials.flowerPurple,
  ];
  const material =
    flowerMaterials[
      Math.floor(
        hashNoise(position.x * 17 + position.z * 29) * flowerMaterials.length,
      )
    ];
  for (let i = 0; i < 3; i += 1) {
    const flower = MeshBuilder.CreateSphere(
      "flower-head",
      { diameter: 0.16, segments: 6 },
      scene,
    );
    flower.position.set((i - 1) * 0.17, 0.34 + i * 0.02, Math.sin(i) * 0.1);
    flower.material = material;
    flower.parent = root;
  }

  return root;
}

function createProps(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  createMailbox(
    scene,
    materials,
    addShadowCaster,
    new Vector3(-15.4, LAND_Y, 4.5),
  );
  createSign(
    scene,
    materials,
    addShadowCaster,
    new Vector3(-1.2, LAND_Y, 1.8),
    0.22,
  );
  createLamp(
    scene,
    materials,
    addShadowCaster,
    new Vector3(-8.7, LAND_Y, 8.0),
    1,
  );
  createLamp(
    scene,
    materials,
    addShadowCaster,
    new Vector3(8.9, LAND_Y, 0.1),
    0.95,
  );

  for (const [x, z, size] of [
    [-2.2, 11.2, 0.55],
    [4.9, 10.8, 0.48],
    [10.3, 12.2, 0.62],
    [-10.8, 11.4, 0.46],
    [16.8, 8.0, 0.52],
  ] as const) {
    const rock = MeshBuilder.CreateSphere(
      "shore-rock",
      { diameter: size, segments: 8 },
      scene,
    );
    rock.position.set(x, 0.1, z);
    rock.scaling.y = 0.52;
    rock.material = materials.darkStone;
    addShadowCaster(rock);
  }

  createLighthouse(scene, materials, addShadowCaster);
}

function createCompanions(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  createSmallCompanion(scene, materials, addShadowCaster, {
    position: new Vector3(-5.4, LAND_Y, 6.3),
    body: materials.flowerPurple,
    accent: materials.flowerWhite,
    scale: 0.9,
    ears: true,
  });
  createSmallCompanion(scene, materials, addShadowCaster, {
    position: new Vector3(9.6, LAND_Y, 8.9),
    body: materials.flowerBlue,
    accent: materials.flowerYellow,
    scale: 0.82,
    ears: true,
  });
  createSmallCompanion(scene, materials, addShadowCaster, {
    position: new Vector3(13.4, LAND_Y, 10.9),
    body: materials.leafLight,
    accent: materials.flowerPink,
    scale: 0.72,
    ears: false,
  });
}

function createSmallCompanion(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  options: {
    position: Vector3;
    body: StandardMaterial;
    accent: StandardMaterial;
    scale: number;
    ears: boolean;
  },
) {
  const root = new TransformNode("small-companion", scene);
  root.position = options.position.clone();
  root.rotation.y = -0.15;
  root.scaling.setAll(options.scale);

  const body = MeshBuilder.CreateSphere(
    "companion-body",
    { diameter: 0.78, segments: 10 },
    scene,
  );
  body.position.y = 0.42;
  body.scaling.set(1, 0.86, 0.92);
  body.material = options.body;
  body.parent = root;
  addShadowCaster(body);

  const head = MeshBuilder.CreateSphere(
    "companion-head",
    { diameter: 0.64, segments: 10 },
    scene,
  );
  head.position.set(0, 0.92, 0.1);
  head.material = options.accent;
  head.parent = root;
  addShadowCaster(head);

  if (options.ears) {
    for (const side of [-1, 1]) {
      const ear = MeshBuilder.CreateSphere(
        "companion-ear",
        { diameter: 0.32, segments: 8 },
        scene,
      );
      ear.position.set(side * 0.22, 1.34, 0.06);
      ear.scaling.set(0.54, 1.35, 0.4);
      ear.rotation.z = side * 0.2;
      ear.material = options.body;
      ear.parent = root;
      addShadowCaster(ear);
    }
  } else {
    const sprout = MeshBuilder.CreateCylinder(
      "companion-sprout",
      {
        height: 0.48,
        diameterBottom: 0.12,
        diameterTop: 0.03,
        tessellation: 7,
      },
      scene,
    );
    sprout.position.set(0, 1.34, 0);
    sprout.rotation.z = 0.38;
    sprout.material = materials.leaf;
    sprout.parent = root;
  }

  for (const x of [-0.14, 0.14]) {
    const eye = MeshBuilder.CreateSphere(
      "companion-eye",
      { diameter: 0.07, segments: 6 },
      scene,
    );
    eye.position.set(x, 0.96, 0.42);
    eye.material = materials.black;
    eye.parent = root;
  }

  const shadow = MeshBuilder.CreateDisc(
    "companion-shadow",
    { radius: 0.48, tessellation: 20 },
    scene,
  );
  shadow.position.y = 0.02;
  shadow.rotation.x = Math.PI / 2;
  shadow.material = materials.shadow;
  shadow.parent = root;
}

function createSoftShadow(
  scene: Scene,
  materials: WorldMaterials,
  parent: TransformNode,
  scaleX: number,
  scaleZ: number,
  zOffset: number,
) {
  const shadow = MeshBuilder.CreateDisc(
    "soft-contact-shadow",
    { radius: 1, tessellation: 28 },
    scene,
  );
  shadow.position.set(0, 0.025, zOffset);
  shadow.rotation.x = Math.PI / 2;
  shadow.scaling.set(scaleX, scaleZ, 1);
  shadow.material = materials.shadow;
  shadow.parent = parent;
}

function createMailbox(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
) {
  const root = new TransformNode("mailbox", scene);
  root.position = position.clone();
  root.rotation.y = -0.12;

  const post = MeshBuilder.CreateBox(
    "mailbox-post",
    { width: 0.2, height: 0.72, depth: 0.2 },
    scene,
  );
  post.position.y = 0.36;
  post.material = materials.wood;
  post.parent = root;
  addShadowCaster(post);

  const box = MeshBuilder.CreateBox(
    "mailbox-body",
    { width: 0.75, height: 0.42, depth: 0.55 },
    scene,
  );
  box.position.set(0, 0.82, 0);
  box.material = materials.blueRoof;
  box.parent = root;
  addShadowCaster(box);
}

function createSign(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
  rotation: number,
) {
  const root = new TransformNode("sign", scene);
  root.position = position.clone();
  root.rotation.y = rotation;

  const post = MeshBuilder.CreateBox(
    "sign-post",
    { width: 0.2, height: 0.82, depth: 0.2 },
    scene,
  );
  post.position.y = 0.41;
  post.material = materials.wood;
  post.parent = root;
  addShadowCaster(post);

  const board = MeshBuilder.CreateBox(
    "sign-board",
    { width: 1.2, height: 0.55, depth: 0.12 },
    scene,
  );
  board.position.y = 0.95;
  board.material = materials.lightWood;
  board.parent = root;
  addShadowCaster(board);
}

function createLamp(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
  position: Vector3,
  scale: number,
) {
  const root = new TransformNode("lamp-post", scene);
  root.position = position.clone();
  root.scaling.setAll(scale);

  const post = MeshBuilder.CreateCylinder(
    "lamp-post-pole",
    { height: 1.75, diameter: 0.18, tessellation: 8 },
    scene,
  );
  post.position.y = 0.88;
  post.material = materials.wood;
  post.parent = root;
  addShadowCaster(post);

  const lamp = MeshBuilder.CreateBox(
    "lamp-glass",
    { width: 0.46, height: 0.55, depth: 0.46 },
    scene,
  );
  lamp.position.y = 1.85;
  lamp.material = materials.lamp;
  lamp.parent = root;

  const cap = MeshBuilder.CreateCylinder(
    "lamp-cap",
    { height: 0.24, diameterBottom: 0.62, diameterTop: 0.35, tessellation: 8 },
    scene,
  );
  cap.position.y = 2.23;
  cap.material = materials.black;
  cap.parent = root;
  addShadowCaster(cap);
}

function createLighthouse(
  scene: Scene,
  materials: WorldMaterials,
  addShadowCaster: (mesh: AbstractMesh) => void,
) {
  const root = new TransformNode("distant-lighthouse", scene);
  root.position.set(20, -0.08, -8.3);
  root.scaling.setAll(0.78);

  const tower = MeshBuilder.CreateCylinder(
    "lighthouse-tower",
    { height: 5, diameterBottom: 1.2, diameterTop: 0.82, tessellation: 16 },
    scene,
  );
  tower.position.y = 2.5;
  tower.material = materials.plaster;
  tower.parent = root;
  addShadowCaster(tower);

  for (const y of [1.3, 2.65]) {
    const stripe = MeshBuilder.CreateCylinder(
      "lighthouse-stripe",
      {
        height: 0.32,
        diameterBottom: 1.1,
        diameterTop: 0.98,
        tessellation: 16,
      },
      scene,
    );
    stripe.position.y = y;
    stripe.material = materials.redRoof;
    stripe.parent = root;
  }

  const room = MeshBuilder.CreateCylinder(
    "lighthouse-room",
    { height: 0.8, diameter: 1.28, tessellation: 16 },
    scene,
  );
  room.position.y = 5.18;
  room.material = materials.windowBlue;
  room.parent = root;
  addShadowCaster(room);

  const roof = MeshBuilder.CreateCylinder(
    "lighthouse-roof",
    { height: 0.7, diameterBottom: 1.45, diameterTop: 0, tessellation: 16 },
    scene,
  );
  roof.position.y = 5.92;
  roof.material = materials.blueRoof;
  roof.parent = root;
  addShadowCaster(roof);
}

function createPlayerEntity(
  scene: Scene,
  isLocalPlayer: boolean,
  addShadowCaster: (mesh: AbstractMesh) => void,
): PlayerEntity {
  const root = new TransformNode("player", scene);
  const shirt = playerMaterial(
    scene,
    "player-shirt",
    isLocalPlayer ? PLAYER_COLOR : OTHER_PLAYER_COLOR,
    0.24,
  );
  const shorts = playerMaterial(scene, "player-shorts", "#2c4055", 0.12);
  const skin = playerMaterial(
    scene,
    "player-skin",
    isLocalPlayer ? "#e69a6c" : "#965e3a",
    0.18,
  );
  const blush = playerMaterial(scene, "player-blush", "#ff9aa5", 0.04);
  const hair = playerMaterial(
    scene,
    "player-hair",
    isLocalPlayer ? "#4a2415" : "#151412",
    0.08,
  );
  const shoe = playerMaterial(scene, "player-shoe", "#302a2a", 0.08);
  const white = playerMaterial(scene, "player-eye-white", "#fff4df", 0.05);
  const black = playerMaterial(scene, "player-eye-dark", "#141616", 0.04);

  const torso = MeshBuilder.CreateCapsule(
    "player-torso",
    {
      height: 0.95,
      radius: 0.31,
      tessellation: 18,
      subdivisions: 3,
      capSubdivisions: 5,
    },
    scene,
  );
  torso.position.y = 0.72;
  torso.scaling.set(1.02, 1, 0.82);
  torso.material = shirt;
  torso.parent = root;
  addShadowCaster(torso);

  const shortsMesh = MeshBuilder.CreateCylinder(
    "player-shorts",
    { height: 0.22, diameterBottom: 0.72, diameterTop: 0.62, tessellation: 18 },
    scene,
  );
  shortsMesh.position.y = 0.38;
  shortsMesh.scaling.z = 0.78;
  shortsMesh.material = shorts;
  shortsMesh.parent = root;
  addShadowCaster(shortsMesh);

  const head = MeshBuilder.CreateSphere(
    "player-head",
    {
      diameter: 0.82,
      segments: 24,
    },
    scene,
  );
  head.position.y = 1.35;
  head.scaling.set(0.94, 1.0, 0.88);
  head.material = skin;
  head.parent = root;
  addShadowCaster(head);

  const hairCap = MeshBuilder.CreateSphere(
    "player-hair-cap",
    { diameter: 0.88, segments: 18 },
    scene,
  );
  hairCap.position.set(0, 1.58, -0.02);
  hairCap.scaling.set(0.96, 0.43, 0.9);
  hairCap.material = hair;
  hairCap.parent = root;
  addShadowCaster(hairCap);

  for (const [x, y, size] of [
    [-0.32, 1.52, 0.26],
    [0.31, 1.51, 0.25],
    [-0.12, 1.68, 0.22],
    [0.1, 1.68, 0.2],
  ] as const) {
    const curl = MeshBuilder.CreateSphere(
      "player-hair-curl",
      { diameter: size, segments: 10 },
      scene,
    );
    curl.position.set(x, y, 0.27);
    curl.scaling.y = 0.78;
    curl.material = hair;
    curl.parent = root;
    addShadowCaster(curl);
  }

  for (const side of [-1, 1]) {
    const arm = MeshBuilder.CreateCapsule(
      "player-arm",
      {
        height: 0.58,
        radius: 0.09,
        tessellation: 12,
        subdivisions: 2,
        capSubdivisions: 4,
      },
      scene,
    );
    arm.position.set(side * 0.44, 0.82, 0.03);
    arm.rotation.z = side * 0.2;
    arm.material = skin;
    arm.parent = root;
    addShadowCaster(arm);

    const sleeve = MeshBuilder.CreateSphere(
      "player-sleeve",
      { diameter: 0.23, segments: 10 },
      scene,
    );
    sleeve.position.set(side * 0.39, 1.02, 0.03);
    sleeve.scaling.set(1, 0.65, 0.85);
    sleeve.material = shirt;
    sleeve.parent = root;
    addShadowCaster(sleeve);

    const leg = MeshBuilder.CreateCapsule(
      "player-leg",
      {
        height: 0.38,
        radius: 0.095,
        tessellation: 12,
        subdivisions: 2,
        capSubdivisions: 4,
      },
      scene,
    );
    leg.position.set(side * 0.17, 0.2, 0.04);
    leg.material = skin;
    leg.parent = root;
    addShadowCaster(leg);

    const foot = MeshBuilder.CreateCapsule(
      "player-foot",
      {
        height: 0.36,
        radius: 0.105,
        tessellation: 12,
        subdivisions: 1,
        capSubdivisions: 3,
      },
      scene,
    );
    foot.position.set(side * 0.18, 0.08, 0.16);
    foot.rotation.x = Math.PI / 2;
    foot.scaling.set(1.15, 0.68, 0.75);
    foot.material = shoe;
    foot.parent = root;
    addShadowCaster(foot);
  }

  for (const x of [-0.16, 0.16]) {
    const eyeWhite = MeshBuilder.CreateSphere(
      "player-eye-white",
      { diameter: 0.135, segments: 10 },
      scene,
    );
    eyeWhite.position.set(x, 1.39, 0.37);
    eyeWhite.scaling.set(0.72, 1.15, 0.28);
    eyeWhite.material = white;
    eyeWhite.parent = root;

    const pupil = MeshBuilder.CreateSphere(
      "player-eye-pupil",
      { diameter: 0.075, segments: 8 },
      scene,
    );
    pupil.position.set(x, 1.38, 0.41);
    pupil.scaling.set(0.72, 1.1, 0.26);
    pupil.material = black;
    pupil.parent = root;
  }

  for (const x of [-0.28, 0.28]) {
    const cheek = MeshBuilder.CreateSphere(
      "player-cheek",
      { diameter: 0.1, segments: 8 },
      scene,
    );
    cheek.position.set(x, 1.25, 0.39);
    cheek.scaling.set(1.2, 0.48, 0.22);
    cheek.material = blush;
    cheek.parent = root;
  }

  const nose = MeshBuilder.CreateSphere(
    "player-nose",
    { diameter: 0.07, segments: 8 },
    scene,
  );
  nose.position.set(0, 1.29, 0.42);
  nose.scaling.set(0.75, 0.55, 0.7);
  nose.material = skin;
  nose.parent = root;

  const shadow = MeshBuilder.CreateDisc(
    "player-shadow",
    {
      radius: 0.58,
      tessellation: 24,
    },
    scene,
  );
  shadow.position.y = 0.025;
  shadow.rotation.x = Math.PI / 2;
  const shadowMaterial = new StandardMaterial("player-shadow-material", scene);
  shadowMaterial.diffuseColor = new Color3(0.04, 0.14, 0.05);
  shadowMaterial.alpha = 0.28;
  shadow.material = shadowMaterial;
  shadow.parent = root;

  return {
    root,
    targetPosition: Vector3.Zero(),
    facing: new Vector3(0, 0, 1),
  };
}

function playerMaterial(
  scene: Scene,
  name: string,
  color: string | Color3,
  specular: number,
) {
  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseColor =
    typeof color === "string" ? Color3.FromHexString(color) : color;
  material.specularColor = new Color3(
    specular,
    specular * 0.9,
    specular * 0.75,
  );
  material.specularPower = 96;
  return material;
}

function createTexturedMaterial(
  scene: Scene,
  name: string,
  texture: DynamicTexture,
  fallbackColor: Color3,
) {
  const material = new StandardMaterial(`${name}-material`, scene);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  material.diffuseTexture = texture;
  material.diffuseColor = fallbackColor;
  material.specularColor = new Color3(0.11, 0.12, 0.09);
  material.specularPower = 72;
  return material;
}

function solidMaterial(scene: Scene, name: string, color: string) {
  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseColor = Color3.FromHexString(color);
  material.specularColor = new Color3(0.05, 0.045, 0.035);
  material.specularPower = 64;
  return material;
}

function createGrassTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "grass-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;

  const context = texture.getContext() as CanvasRenderingContext2D;
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#79ca4e");
  gradient.addColorStop(0.5, "#62b94e");
  gradient.addColorStop(1, "#91d65a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 380; i += 1) {
    const x = hashNoise(i * 9) * 512;
    const y = hashNoise(i * 19) * 512;
    const length = 4 + hashNoise(i * 29) * 10;
    context.strokeStyle = i % 3 === 0 ? "#a1df67" : "#4fa644";
    context.lineWidth = 1 + hashNoise(i * 13) * 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.sin(i) * 2, y - length);
    context.stroke();
  }

  texture.update();
  texture.uScale = 8;
  texture.vScale = 8;
  return texture;
}

function createPathTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "path-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#d9b76e";
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 260; i += 1) {
    const x = hashNoise(i * 7) * 512;
    const y = hashNoise(i * 11) * 512;
    const radius = 4 + hashNoise(i * 23) * 12;
    context.fillStyle = i % 2 === 0 ? "#e7c982" : "#caa15d";
    context.globalAlpha = 0.35;
    context.beginPath();
    context.ellipse(x, y, radius * 1.5, radius, Math.sin(i), 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.uScale = 4;
  texture.vScale = 4;
  return texture;
}

function createSandTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "sand-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#ffe6a3");
  gradient.addColorStop(0.5, "#efca73");
  gradient.addColorStop(1, "#f9da91");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 420; i += 1) {
    context.globalAlpha = 0.18 + hashNoise(i * 5) * 0.2;
    context.fillStyle = i % 2 === 0 ? "#b99051" : "#fff3bd";
    context.beginPath();
    context.arc(
      hashNoise(i * 17) * 512,
      hashNoise(i * 29) * 512,
      0.8 + hashNoise(i * 41) * 1.6,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
  texture.update();
  texture.uScale = 5;
  texture.vScale = 5;
  return texture;
}

function createStoneTexture(scene: Scene, base: string, line: string) {
  const texture = new DynamicTexture(
    `stone-texture-${base}`,
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = line;
  context.lineWidth = 3;
  context.globalAlpha = 0.34;
  for (let y = 58; y < 512; y += 92) {
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= 512; x += 64) {
      context.lineTo(x, y + Math.sin(x * 0.04 + y) * 9);
    }
    context.stroke();
  }
  for (let x = 52; x < 512; x += 96) {
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 72) {
      context.lineTo(x + Math.sin(y * 0.06 + x) * 7, y);
    }
    context.stroke();
  }
  context.globalAlpha = 1;
  texture.update();
  texture.uScale = 3;
  texture.vScale = 3;
  return texture;
}

function createStuccoTexture(scene: Scene, base: string, highlight: string) {
  const texture = new DynamicTexture(
    `stucco-texture-${base}`,
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 520; i += 1) {
    context.globalAlpha = 0.05 + hashNoise(i * 3) * 0.12;
    context.fillStyle = i % 3 === 0 ? "#a8754c" : highlight;
    context.beginPath();
    context.ellipse(
      hashNoise(i * 7) * 512,
      hashNoise(i * 11) * 512,
      2 + hashNoise(i * 17) * 7,
      1 + hashNoise(i * 23) * 4,
      hashNoise(i * 31) * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
  texture.update();
  texture.uScale = 2.2;
  texture.vScale = 2.2;
  return texture;
}

function createRoofTexture(scene: Scene, dark: string, light: string) {
  const texture = new DynamicTexture(
    `roof-texture-${dark}`,
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.45, dark);
  gradient.addColorStop(1, light);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let y = 26; y < 512; y += 54) {
    context.strokeStyle = "rgba(255, 240, 210, 0.45)";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(150, y + 12, 290, y - 10, 512, y + 7);
    context.stroke();
    context.strokeStyle = "rgba(55, 31, 24, 0.18)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, y + 14);
    context.bezierCurveTo(160, y + 25, 300, y + 4, 512, y + 20);
    context.stroke();
  }

  for (let x = 35; x < 512; x += 72) {
    context.strokeStyle = "rgba(35, 23, 20, 0.12)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 18, 512);
    context.stroke();
  }
  texture.update();
  texture.uScale = 2.2;
  texture.vScale = 2.8;
  return texture;
}

function createThatchTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "thatch-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#e6b949";
  context.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 340; i += 1) {
    const x = hashNoise(i * 7) * 512;
    const y = hashNoise(i * 13) * 512;
    context.strokeStyle = i % 3 === 0 ? "#fff09a" : "#a87229";
    context.globalAlpha = 0.25;
    context.lineWidth = 2 + hashNoise(i * 17) * 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.sin(i) * 18, y + 32 + hashNoise(i * 23) * 28);
    context.stroke();
  }
  context.globalAlpha = 1;
  texture.update();
  texture.uScale = 3.2;
  texture.vScale = 3.2;
  return texture;
}

function createWaterTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "water-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#12a9d6";
  context.fillRect(0, 0, 512, 512);

  context.strokeStyle = "rgba(211, 251, 255, 0.48)";
  context.lineWidth = 3;
  for (let y = 26; y < 512; y += 52) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 24) {
      const waveY = y + Math.sin(x / 32 + y / 40) * 7;
      if (x === 0) {
        context.moveTo(x, waveY);
      } else {
        context.lineTo(x, waveY);
      }
    }
    context.stroke();
  }

  context.strokeStyle = "rgba(5, 103, 153, 0.18)";
  context.lineWidth = 6;
  for (let y = 48; y < 512; y += 104) {
    context.beginPath();
    for (let x = 0; x <= 512; x += 32) {
      const waveY = y + Math.sin(x / 44 + y / 36) * 9;
      if (x === 0) {
        context.moveTo(x, waveY);
      } else {
        context.lineTo(x, waveY);
      }
    }
    context.stroke();
  }

  texture.update();
  texture.uScale = 5;
  texture.vScale = 5;
  return texture;
}

function createCliffTexture(scene: Scene) {
  const texture = new DynamicTexture(
    "cliff-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = "#c98352";
  context.fillRect(0, 0, 512, 512);

  for (let x = 0; x < 512; x += 38) {
    context.strokeStyle = x % 76 === 0 ? "#a86443" : "#e1a16e";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x + Math.sin(x) * 8, 0);
    context.bezierCurveTo(x + 14, 160, x - 18, 310, x + 8, 512);
    context.stroke();
  }

  for (let i = 0; i < 90; i += 1) {
    context.fillStyle = "rgba(116, 73, 44, 0.18)";
    context.beginPath();
    context.ellipse(
      hashNoise(i * 5) * 512,
      hashNoise(i * 17) * 512,
      8 + hashNoise(i * 23) * 18,
      4 + hashNoise(i * 31) * 8,
      hashNoise(i) * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  texture.update();
  texture.uScale = 4;
  texture.vScale = 3;
  return texture;
}

function createWoodTexture(scene: Scene, dark: string, light: string) {
  const texture = new DynamicTexture(
    `wood-texture-${dark}`,
    { width: 512, height: 512 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = light;
  context.fillRect(0, 0, 512, 512);

  for (let y = 18; y < 512; y += 52) {
    context.strokeStyle = dark;
    context.globalAlpha = 0.38;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(130, y + 8, 260, y - 10, 512, y + 4);
    context.stroke();
  }
  context.globalAlpha = 1;

  texture.update();
  texture.uScale = 2;
  texture.vScale = 5;
  return texture;
}

function hashNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
