from fastapi import FastAPI
from starlette.staticfiles import StaticFiles

from automatic1111 import api as automatic1111_api
from results import api as results_api
from settings import api as settings_api
from utils.constants import OUTPUT_FOLDER_PATH
import os

app = FastAPI()


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

app.include_router(automatic1111_api.router)
app.include_router(results_api.router)
app.include_router(settings_api.router)
if os.environ.get("EASYSD_DEV_TEST_API") == "1":
    from dev_test import api as dev_test_api
    app.include_router(dev_test_api.router)


@app.on_event("startup")
async def startup_event():
    OUTPUT_FOLDER_PATH.mkdir(exist_ok=True, parents=True)
    app.mount("/static", ImmutableStaticFiles(directory=str(OUTPUT_FOLDER_PATH)), name="static")
