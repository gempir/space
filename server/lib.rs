use spacetimedb::{reducer, table, Identity, ReducerContext, Table, Timestamp};

const SPAWN_X: f32 = 0.0;
const SPAWN_Z: f32 = 0.0;
const PLAYER_SPEED_UNITS_PER_SECOND: f32 = 4.5;
const MAX_MOVE_SECONDS: f32 = 0.12;

#[table(accessor = player, public)]
pub struct Player {
    #[primary_key]
    identity: Identity,
    name: Option<String>,
    online: bool,
    x: f32,
    z: f32,
    facing_x: f32,
    facing_z: f32,
    updated_at: Timestamp,
}

#[reducer]
/// Clients invoke this reducer to set their display names.
pub fn set_name(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let name = validate_name(name)?;
    if let Some(player) = ctx.db.player().identity().find(ctx.sender()) {
        ctx.db.player().identity().update(Player {
            name: Some(name),
            ..player
        });
        Ok(())
    } else {
        Err("Cannot set name for unknown player".to_string())
    }
}

/// Takes a name and checks if it's acceptable as a user's name.
fn validate_name(name: String) -> Result<String, String> {
    if name.is_empty() {
        Err("Names must not be empty".to_string())
    } else {
        Ok(name)
    }
}

#[reducer]
/// Clients send movement intent; the server owns the final position.
pub fn move_player(ctx: &ReducerContext, direction_x: f32, direction_z: f32) -> Result<(), String> {
    let Some(player) = ctx.db.player().identity().find(ctx.sender()) else {
        return Err("Cannot move unknown player".to_string());
    };

    let length = (direction_x * direction_x + direction_z * direction_z).sqrt();
    if !length.is_finite() {
        return Err("Movement direction must be finite".to_string());
    }

    let (normalized_x, normalized_z) = if length > 0.0 {
        (direction_x / length, direction_z / length)
    } else {
        (0.0, 0.0)
    };

    let elapsed_seconds = ctx
        .timestamp
        .duration_since(player.updated_at)
        .map(|duration| duration.as_secs_f32())
        .unwrap_or(0.0)
        .clamp(0.0, MAX_MOVE_SECONDS);

    let distance = PLAYER_SPEED_UNITS_PER_SECOND * elapsed_seconds;
    let moving = length > 0.0;
    let next_facing_x = if moving {
        normalized_x
    } else {
        player.facing_x
    };
    let next_facing_z = if moving {
        normalized_z
    } else {
        player.facing_z
    };

    ctx.db.player().identity().update(Player {
        x: player.x + normalized_x * distance,
        z: player.z + normalized_z * distance,
        facing_x: next_facing_x,
        facing_z: next_facing_z,
        updated_at: ctx.timestamp,
        ..player
    });

    Ok(())
}

#[reducer(client_connected)]
/// Called when a client connects to a SpacetimeDB database.
pub fn client_connected(ctx: &ReducerContext) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender()) {
        ctx.db.player().identity().update(Player {
            online: true,
            updated_at: ctx.timestamp,
            ..player
        });
    } else {
        ctx.db.player().insert(Player {
            name: None,
            identity: ctx.sender(),
            online: true,
            x: SPAWN_X,
            z: SPAWN_Z,
            facing_x: 0.0,
            facing_z: 1.0,
            updated_at: ctx.timestamp,
        });
    }
}

#[reducer(client_disconnected)]
/// Called when a client disconnects from a SpacetimeDB database.
pub fn identity_disconnected(ctx: &ReducerContext) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender()) {
        ctx.db.player().identity().update(Player {
            online: false,
            updated_at: ctx.timestamp,
            ..player
        });
    } else {
        log::warn!(
            "Disconnect event for unknown player with identity {:?}",
            ctx.sender()
        );
    }
}
