import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import "./App.css";
import GameCanvas from "./GameCanvas";
import { reducers, tables } from "./module_bindings";

const MOVE_TICK_MS = 55;

type MoveIntent = {
  directionX: number;
  directionZ: number;
};

const idleIntent: MoveIntent = {
  directionX: 0,
  directionZ: 0,
};

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const [players, playersReady] = useTable(
    tables.player.where((player) => player.online.eq(true)),
  );
  const movePlayer = useReducer(reducers.movePlayer);
  const setName = useReducer(reducers.setName);

  const pressedKeysRef = useRef(new Set<string>());
  const latestIntentRef = useRef<MoveIntent>(idleIntent);
  const [intent, setIntent] = useState<MoveIntent>(idleIntent);
  const [draftName, setDraftName] = useState("");

  const localPlayer = useMemo(() => {
    if (!identity) {
      return undefined;
    }
    return players.find((player) => player.identity.isEqual(identity));
  }, [identity, players]);

  useEffect(() => {
    if (localPlayer?.name) {
      setDraftName(localPlayer.name);
    }
  }, [localPlayer?.name]);

  useEffect(() => {
    const updateIntent = () => {
      const pressedKeys = pressedKeysRef.current;
      let directionX = 0;
      let directionZ = 0;

      if (pressedKeys.has("KeyA")) {
        directionX -= 1;
      }
      if (pressedKeys.has("KeyD")) {
        directionX += 1;
      }
      if (pressedKeys.has("KeyW")) {
        directionZ += 1;
      }
      if (pressedKeys.has("KeyS")) {
        directionZ -= 1;
      }

      const length = Math.hypot(directionX, directionZ);
      const nextIntent =
        length > 0
          ? {
              directionX: directionX / length,
              directionZ: directionZ / length,
            }
          : idleIntent;

      latestIntentRef.current = nextIntent;
      setIntent(nextIntent);
      return nextIntent;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const movementKey = getMovementKey(event);
      if (!movementKey || event.repeat) {
        return;
      }
      pressedKeysRef.current.add(movementKey);
      const nextIntent = updateIntent();
      if (!connected || !playersReady) {
        return;
      }

      void movePlayer({
        directionX: nextIntent.directionX,
        directionZ: nextIntent.directionZ,
      }).catch((error: unknown) => {
        console.error("Failed to move player", error);
      });
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const movementKey = getMovementKey(event);
      if (!movementKey) {
        return;
      }
      pressedKeysRef.current.delete(movementKey);
      updateIntent();
    };

    const onWindowBlur = () => {
      pressedKeysRef.current.clear();
      updateIntent();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [connected, movePlayer, playersReady]);

  useEffect(() => {
    if (!connected || !playersReady) {
      return;
    }

    const sendMoveIntent = () => {
      const currentIntent = latestIntentRef.current;
      if (currentIntent.directionX === 0 && currentIntent.directionZ === 0) {
        return;
      }

      void movePlayer({
        directionX: currentIntent.directionX,
        directionZ: currentIntent.directionZ,
      }).catch((error: unknown) => {
        console.error("Failed to move player", error);
      });
    };

    sendMoveIntent();
    const interval = window.setInterval(sendMoveIntent, MOVE_TICK_MS);
    return () => window.clearInterval(interval);
  }, [connected, movePlayer, playersReady]);

  useEffect(() => {
    if (!connected || !playersReady) {
      return;
    }
    if (intent.directionX === 0 && intent.directionZ === 0) {
      return;
    }

    void movePlayer({
      directionX: intent.directionX,
      directionZ: intent.directionZ,
    }).catch((error: unknown) => {
      console.error("Failed to move player", error);
    });
  }, [connected, intent, movePlayer, playersReady]);

  const playerName =
    localPlayer?.name ?? identity?.toHexString().slice(0, 8) ?? "joining";

  const onSubmitName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (name.length === 0) {
      return;
    }
    void setName({ name }).catch((error: unknown) => {
      console.error("Failed to set name", error);
    });
  };

  return (
    <main className="game-app">
      <GameCanvas identity={identity} inputIntent={intent} players={players} />
      <section className="hud" aria-label="Player status">
        <div className="hud__status">
          <span className={connected ? "status-dot online" : "status-dot"} />
          <span>{connected && playersReady ? playerName : "connecting"}</span>
        </div>
        <div className="hud__count">{players.length} online</div>
        <form className="hud__name-form" onSubmit={onSubmitName}>
          <input
            aria-label="Display name"
            maxLength={24}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Display name"
            type="text"
            value={draftName}
          />
          <button type="submit">Set</button>
        </form>
      </section>
    </main>
  );
}

function getMovementKey(event: KeyboardEvent) {
  if (
    event.code === "KeyW" ||
    event.code === "KeyA" ||
    event.code === "KeyS" ||
    event.code === "KeyD"
  ) {
    return event.code;
  }

  switch (event.key.toLowerCase()) {
    case "w":
      return "KeyW";
    case "a":
      return "KeyA";
    case "s":
      return "KeyS";
    case "d":
      return "KeyD";
    default:
      return undefined;
  }
}

export default App;
