.PHONY: *

bindings:
    spacetime generate --lang typescript --out-dir client/src/module_bindings --project-path spacetimedb
