"""KubeBeaver FastAPI application."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_config import setup_logging
from app.routers.api import router
from app.history import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging("INFO")
    await init_db()
    yield
    # shutdown if needed


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
