class UpstreamError(Exception):
    """Sanitized upstream failure; never return raw provider payloads to clients."""

    def __init__(
        self, code: str, message: str, status: int = 502, retry_after: int | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after
