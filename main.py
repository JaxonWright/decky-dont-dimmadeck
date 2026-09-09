import json
import os
import tempfile
from typing import Any

import decky

CONFIG_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "config.json")

# Kept in sync with DEFAULT_CONFIG in src/config.ts. The frontend validates and
# fills in anything missing, so this side only has to be valid JSON.
DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "apps": {},
    "global_override": False,
    "baseline": None,
    "inhibit_active": False,
}


class Plugin:
    async def get_config(self) -> dict[str, Any]:
        """Reads the stored config, falling back to defaults if it is missing or unreadable."""
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
                config = json.load(handle)
        except FileNotFoundError:
            return dict(DEFAULT_CONFIG)
        except (OSError, json.JSONDecodeError) as error:
            decky.logger.warning("could not read %s, using defaults: %s", CONFIG_PATH, error)
            return dict(DEFAULT_CONFIG)

        if not isinstance(config, dict):
            decky.logger.warning("%s is not an object, using defaults", CONFIG_PATH)
            return dict(DEFAULT_CONFIG)

        return config

    async def set_config(self, config: dict[str, Any]) -> bool:
        """
        Replaces the stored config.

        Written to a temporary file and renamed so a crash mid-write cannot leave
        a truncated config behind - this file records the timeouts we have to
        restore, so losing it would leave the screen permanently undimmed.
        """
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        handle = None
        try:
            handle = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=decky.DECKY_PLUGIN_SETTINGS_DIR,
                prefix="config.",
                suffix=".tmp",
                delete=False,
            )
            with handle:
                json.dump(config, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(handle.name, CONFIG_PATH)
            return True
        except OSError as error:
            decky.logger.error("could not write %s: %s", CONFIG_PATH, error)
            if handle is not None:
                try:
                    os.unlink(handle.name)
                except OSError:
                    pass
            return False

    async def _main(self):
        decky.logger.info("Don't Dimmadeck loaded")

    async def _unload(self):
        decky.logger.info("Don't Dimmadeck unloaded")

    async def _uninstall(self):
        try:
            os.remove(CONFIG_PATH)
        except FileNotFoundError:
            pass
        except OSError as error:
            decky.logger.warning("could not remove %s: %s", CONFIG_PATH, error)
