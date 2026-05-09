import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
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

const FIELD_SIZE = 48;
const PLAYER_LOCAL_SPEED = 4.5;
const PLAYER_COLOR = new Color3(0.18, 0.38, 0.95);
const OTHER_PLAYER_COLOR = new Color3(0.94, 0.64, 0.24);

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
      stencil: false,
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.67, 0.84, 0.92, 1);

    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 4,
      Math.PI / 3.2,
      34,
      Vector3.Zero(),
      scene,
    );
    camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -14;
    camera.orthoRight = 14;
    camera.orthoTop = 10;
    camera.orthoBottom = -10;
    camera.lowerRadiusLimit = 18;
    camera.upperRadiusLimit = 52;
    camera.attachControl(canvas, true);

    new HemisphericLight("sun", new Vector3(0.3, 1, 0.25), scene).intensity =
      0.9;

    const grassMaterial = new StandardMaterial("grass-material", scene);
    const grassTexture = createGrassTexture(scene);
    grassTexture.uScale = 12;
    grassTexture.vScale = 12;
    grassMaterial.diffuseTexture = grassTexture;
    grassMaterial.specularColor = Color3.Black();

    const ground = MeshBuilder.CreateGround(
      "grass-field",
      { width: FIELD_SIZE, height: FIELD_SIZE, subdivisions: 24 },
      scene,
    );
    ground.material = grassMaterial;

    const resize = () => {
      engine.resize();
      const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      const halfHeight = 10;
      camera.orthoTop = halfHeight;
      camera.orthoBottom = -halfHeight;
      camera.orthoRight = halfHeight * aspect;
      camera.orthoLeft = -halfHeight * aspect;
    };

    const onBeforeRender = () => {
      syncPlayers(
        scene,
        entitiesRef.current,
        playersRef.current,
        identityRef.current,
      );
      const deltaSeconds = engine.getDeltaTime() / 1000;
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
          isLocalPlayer ? 0.2 : 0.12,
        );

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
      );
      entity.root.position.set(player.x, 0, player.z);
      entities.set(playerIdentity, entity);
    }

    entity.targetPosition.set(player.x, 0, player.z);
    entity.facing.set(player.facingX, 0, player.facingZ);
  }

  for (const [playerIdentity, entity] of entities) {
    if (!liveIdentities.has(playerIdentity)) {
      entity.root.dispose();
      entities.delete(playerIdentity);
    }
  }
}

function createPlayerEntity(
  scene: Scene,
  isLocalPlayer: boolean,
): PlayerEntity {
  const root = new TransformNode("player", scene);
  const material = new StandardMaterial("player-material", scene);
  material.diffuseColor = isLocalPlayer ? PLAYER_COLOR : OTHER_PLAYER_COLOR;
  material.specularColor = new Color3(0.1, 0.1, 0.1);

  const body = MeshBuilder.CreateCylinder(
    "player-body",
    {
      diameterBottom: 0.65,
      diameterTop: 0.48,
      height: 0.9,
      tessellation: 8,
    },
    scene,
  );
  body.position.y = 0.6;
  body.material = material;
  body.parent = root;

  const head = MeshBuilder.CreateSphere(
    "player-head",
    {
      diameter: 0.5,
      segments: 8,
    },
    scene,
  );
  head.position.y = 1.25;
  head.material = material;
  head.parent = root;

  const nose = MeshBuilder.CreateCylinder(
    "player-facing",
    {
      diameterBottom: 0.16,
      diameterTop: 0,
      height: 0.35,
      tessellation: 8,
    },
    scene,
  );
  nose.position.set(0, 1.25, 0.35);
  nose.rotation.x = Math.PI / 2;
  nose.material = material;
  nose.parent = root;

  const shadow = MeshBuilder.CreateDisc(
    "player-shadow",
    {
      radius: 0.48,
      tessellation: 24,
    },
    scene,
  );
  shadow.position.y = 0.02;
  shadow.rotation.x = Math.PI / 2;
  const shadowMaterial = new StandardMaterial("player-shadow-material", scene);
  shadowMaterial.diffuseColor = new Color3(0.05, 0.12, 0.06);
  shadowMaterial.alpha = 0.22;
  shadow.material = shadowMaterial;
  shadow.parent = root;

  return {
    root,
    targetPosition: Vector3.Zero(),
    facing: new Vector3(0, 0, 1),
  };
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

  const context = texture.getContext();
  context.fillStyle = "#68b15a";
  context.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 64) {
    for (let x = 0; x < 512; x += 64) {
      context.fillStyle = (x / 64 + y / 64) % 2 === 0 ? "#70bc61" : "#5fa953";
      context.fillRect(x, y, 64, 64);
    }
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.14)";
  context.lineWidth = 2;
  for (let position = 0; position <= 512; position += 64) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }

  texture.update();
  return texture;
}
