from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = PROJECT_ROOT / "config"
SETTINGS_PATH = CONFIG_DIR / "settings.yaml"
LOGGING_CONFIG_PATH = CONFIG_DIR / "logging.yaml"
STATE_PATH = PROJECT_ROOT / ".bag_gpt_state.json"