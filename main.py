import json
import os
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from curl_cffi import requests
from bs4 import BeautifulSoup
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://knd-stock.onrender.com,http://localhost:8000,http://127.0.0.1:8000,https://p-osteen.github.io/knd-stock"
).split(",")

RATE_LIMIT = os.getenv("RATE_LIMIT", "30/minute")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="KND Stock Checker API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

session = requests.Session(impersonate="chrome120")
SESSION_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
}

ALLOWED_HOSTNAMES = {"karzanddolls.com", "www.karzanddolls.com"}


class StockResponse(BaseModel):
    product_name: str
    stock_quantity: int
    success: bool
    message: str = ""


def _is_allowed_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        return hostname in ALLOWED_HOSTNAMES or hostname.endswith(".karzanddolls.com")
    except Exception:
        return False


@app.get("/")
async def root():
    return FileResponse("index.html")


@app.get("/script.js")
async def serve_script():
    return FileResponse("script.js", media_type="application/javascript")


@app.get("/styles.css")
async def serve_styles():
    return FileResponse("styles.css", media_type="text/css")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def config():
    return {"backend_url": ""}


@app.get("/api/check-stock", response_model=StockResponse)
@limiter.limit(RATE_LIMIT)
def check_stock(request: Request, url: str = Query(..., description="The product URL to check")):
    if not _is_allowed_url(url):
        raise HTTPException(
            status_code=400,
            detail="Invalid URL. Only karzanddolls.com product URLs are allowed."
        )

    try:
        r = session.get(url, headers=SESSION_HEADERS, timeout=12)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        next_data = soup.find("script", id="__NEXT_DATA__")

        if next_data:
            data = json.loads(next_data.string)
            product_details = (
                data.get("props", {})
                .get("pageProps", {})
                .get("productdetails", {})
            )

            pro_name = product_details.get("pro_name", "Unknown Product")
            pro_stock = product_details.get("pro_stock", 0)

            if isinstance(pro_stock, str) and pro_stock.isdigit():
                pro_stock = int(pro_stock)
            elif not isinstance(pro_stock, int):
                pro_stock = 0

            return StockResponse(
                product_name=pro_name,
                stock_quantity=pro_stock,
                success=True,
                message="Stock retrieved successfully.",
            )
        else:
            return StockResponse(
                product_name="Unknown",
                stock_quantity=0,
                success=False,
                message="Could not find stock info in the page.",
            )
    except Exception as e:
        return StockResponse(
            product_name="Unknown",
            stock_quantity=0,
            success=False,
            message=f"Error fetching product: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
