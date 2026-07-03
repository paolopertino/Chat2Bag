import logging.config
import yaml

from pathlib import Path


def setup_logging(config_path="logging.yaml"):
    config_file = Path(config_path)
    if config_file.exists():
        with open(config_file, "r") as f:
            config = yaml.safe_load(f)
        logging.config.dictConfig(config)
    else:
        logging.basicConfig(level=logging.INFO)
