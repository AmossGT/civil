from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    database_url: str = "postgresql+psycopg://tender:tender@localhost:5432/tenders"
    secret_key: str = "change-this-before-deploying"
    upload_dir: Path = Path("uploads")
    allowed_origins: str = "http://localhost:5173"
    cookie_secure: bool = False
    max_upload_bytes: int = 15 * 1024 * 1024
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None
    load_prototype_data: bool = False
    @property
    def cors_origins(self):
        return [v.strip() for v in self.allowed_origins.split(",") if v.strip()]
settings = Settings()
