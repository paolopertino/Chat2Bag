from pathlib import Path

from src.services.component_factory import BackendComponentFactory


class ChatService:
    def __init__(self, factory: BackendComponentFactory):
        self._factory = factory

    @staticmethod
    def resolve_and_validate_bag_path(bag_path: str) -> str:
        resolved = Path(bag_path).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError("Bag path does not exist.")
        return str(resolved)

    def chat_with_clip(self, bag_path: str, start_ns: int, duration: int, query: str) -> str | None:
        resolved_bag_path = self.resolve_and_validate_bag_path(bag_path)
        chat_engine = self._factory.create_video_chat(resolved_bag_path)
        return chat_engine.chat_with_clip(
            start_timestamp_ns=start_ns,
            duration_sec=duration,
            query=query,
        )