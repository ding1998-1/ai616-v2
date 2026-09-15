"""Serialize optional GPU1 post-processing jobs without touching upload workers."""

import asyncio


GPU_POST_PROCESSING_SEMAPHORE = asyncio.Semaphore(1)
