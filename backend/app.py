from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import load_settings
from .db import Database
from .jobs import Worker, recover_stale_jobs
from .services import Services


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()
    database = Database(settings.db_path)
    database.initialize()
    services = Services(settings, database)

    app.state.settings = settings
    app.state.db = database
    app.state.services = services

    recover_stale_jobs(database)
    workers = [
        Worker("clusterlens-io", "io", database, services.handlers),
        Worker("clusterlens-ml", "ml", database, services.handlers),
    ]
    for worker in workers:
        worker.start()

    try:
        yield
    finally:
        for worker in workers:
            worker.stop()
        for worker in workers:
            worker.join(timeout=10)


app = FastAPI(title="ClusterLens", version="2.0.0", lifespan=lifespan)
app.include_router(router)

# Serve the built frontend in production. During development, Vite proxies /api.
if (settings := load_settings()).frontend_dist.exists():
    assets = settings.frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        dist = settings.frontend_dist.resolve()
        candidate = (dist / full_path).resolve()
        if candidate.is_relative_to(dist) and candidate.is_file():
            return FileResponse(candidate)
        index = settings.frontend_dist / "index.html"
        if index.exists():
            return FileResponse(index)
        return HTMLResponse("Frontend build not found", status_code=404)
else:

    @app.get("/", include_in_schema=False)
    def root():
        return HTMLResponse(
            "<h1>ClusterLens API</h1><p>Frontend build not found. Run the Vite dev server.</p>"
        )


if __name__ == "__main__":
    settings = load_settings()
    uvicorn.run(
        "backend.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
