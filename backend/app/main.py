"""KubeBeaver FastAPI application."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.logging_config import setup_logging
from app.routers.api import router
from app.history import init_db
from app.cache import close as cache_close
from app.db.factory import close_database
from app.scheduler import start_scheduler, stop_scheduler, reload_scheduler_jobs_async


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging("INFO")
    await init_db()
    start_scheduler()
    await reload_scheduler_jobs_async()
    yield
    stop_scheduler()
    await cache_close()
    await close_database()


app = FastAPI(
    title="KubeBeaver API",
    description="Kubernetes troubleshooting assistant",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
