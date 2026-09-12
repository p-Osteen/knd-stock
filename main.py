import json
import os
import time
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
    "https://knd-stock.onrender.com,http://localhost:8000,http://127.0.0.1:8000,https://p-osteen.github.io/knd-stock,https://p-osteen.github.io"
).split(",")

RATE_LIMIT = os.getenv("RATE_LIMIT", "300/minute")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="KND Stock Checker API")
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error": "Rate limit exceeded. Please wait a moment before checking more items.", "success": False}
    )

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
    image: str = ""


class SearchItem(BaseModel):
    product_name: str
    url: str
    stock_quantity: int
    in_stock: bool
    price: str = ""
    image: str = ""


class SearchResponse(BaseModel):
    products: list[SearchItem]
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


DEFAULT_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "15"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "1"))


def _clean_error_message(err: Exception) -> str:
    err_str = str(err).lower()
    if "404" in err_str:
        return "Out of Stock (Page 404)"
    if "429" in err_str or "rate limit" in err_str:
        return "Rate limit reached. Please wait a moment."
    if "timed out" in err_str or "curl: (28)" in err_str or "timeout" in err_str:
        return "Request timed out. Karz & Dolls server took too long to respond."
    if "could not resolve host" in err_str or "curl: (6)" in err_str:
        return "Could not reach Karz & Dolls (DNS failure)."
    if "connection refused" in err_str or "curl: (7)" in err_str:
        return "Connection refused by Karz & Dolls server."
    if "ssl" in err_str or "curl: (35)" in err_str:
        return "Secure connection (SSL/TLS) failed."
    return "Network error while connecting to Karz & Dolls."


def fetch_url(url: str, timeout: int = DEFAULT_TIMEOUT, max_retries: int = MAX_RETRIES):
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            if attempt == 0:
                return session.get(url, headers=SESSION_HEADERS, timeout=timeout)
            else:
                time.sleep(0.6 * attempt)
                return requests.get(url, headers=SESSION_HEADERS, impersonate="chrome120", timeout=timeout)
        except Exception as e:
            last_exception = e
            err_msg = str(e).lower()
            if "404" in err_msg:
                raise
            if attempt < max_retries:
                continue
    raise last_exception


@app.get("/api/search", response_model=SearchResponse)
@limiter.limit(RATE_LIMIT)
def search_products(request: Request, term: str = Query(..., description="Search term")):
    if not term.strip():
        return SearchResponse(products=[], success=True, message="Empty query")
    try:
        target_url = f"https://www.karzanddolls.com/search?term={term.strip()}"
        r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        next_data = soup.find("script", id="__NEXT_DATA__")
        if not next_data:
            return SearchResponse(products=[], success=False, message="Could not parse search page data.")
        data = json.loads(next_data.string)
        page_props = (data.get("props") or {}).get("pageProps") or {}
        raw_products = page_props.get("products") or []
        items = []
        for p in raw_products:
            name = p.get("pro_name", "Unknown Product")
            slug = p.get("slug", "")
            pid = p.get("pid", "")
            stock = p.get("pro_stock", 0)
            if isinstance(stock, str) and stock.isdigit():
                stock = int(stock)
            elif not isinstance(stock, int):
                stock = 0
            in_s = bool(p.get("in_stock", stock > 0))
            price_val = p.get("dis_price") or p.get("act_price") or ""
            price_str = f"₹{price_val}" if price_val else ""
            img_val = ""
            imgs = p.get("prd_images")
            raw_img = ""
            if isinstance(imgs, list) and len(imgs) > 0:
                first_img = imgs[0]
                if isinstance(first_img, dict):
                    raw_img = str(first_img.get("pro_images") or first_img.get("image") or first_img.get("src") or "")
                elif isinstance(first_img, str):
                    raw_img = first_img
            elif isinstance(imgs, str):
                raw_img = imgs

            if raw_img:
                if raw_img.startswith("http"):
                    img_val = raw_img
                else:
                    img_val = f"https://www.karzanddolls.com/karzOffice/public/assets/productimages/{raw_img}"

            prod_url = f"https://www.karzanddolls.com/details/{slug}?pid={pid}" if (slug and pid) else ""
            items.append(SearchItem(
                product_name=name,
                url=prod_url,
                stock_quantity=stock,
                in_stock=in_s,
                price=price_str,
                image=img_val
            ))
        return SearchResponse(products=items, success=True, message=f"Found {len(items)} products.")
    except Exception as e:
        return SearchResponse(products=[], success=False, message=f"Error searching products: {_clean_error_message(e)}")


def _extract_title_from_url(url: str) -> str:
    try:
        from urllib.parse import unquote
        decoded = unquote(url)
        path = urlparse(decoded).path.strip("/")
        parts = [p for p in path.split("/") if p]
        if parts:
            slug = parts[-1]
            if slug.isdigit() and len(parts) > 1:
                slug = parts[-2]
            slug = slug.replace("+", " ").replace("-", " ").replace("_", " ").replace("\u00a0", " ").strip()
            slug = " ".join(slug.split())
            title = slug.title()
            if title:
                return title
    except Exception:
        pass
    return "Unknown Product"


@app.get("/api/check-stock", response_model=StockResponse)
@limiter.limit(RATE_LIMIT)
def check_stock(request: Request, url: str = Query(..., description="The product URL to check")):
    if not _is_allowed_url(url):
        raise HTTPException(
            status_code=400,
            detail="Invalid URL. Only karzanddolls.com product URLs are allowed."
        )

    derived_title = _extract_title_from_url(url)
    try:
        r = fetch_url(url, timeout=DEFAULT_TIMEOUT)
        if r.status_code == 404:
            return StockResponse(
                product_name=derived_title,
                stock_quantity=0,
                success=True,
                message="Out of Stock (Page 404)",
            )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        next_data = soup.find("script", id="__NEXT_DATA__")

        if next_data:
            data = json.loads(next_data.string)
            props = data.get("props") or {}
            page_props = props.get("pageProps") or {}
            product_details = page_props.get("productdetails") or {}

            if not product_details:
                return StockResponse(
                    product_name=derived_title,
                    stock_quantity=0,
                    success=False,
                    message="Product details not found in page data.",
                )

            pro_name = product_details.get("pro_name") or derived_title
            pro_stock = product_details.get("pro_stock", 0)

            if isinstance(pro_stock, str) and pro_stock.isdigit():
                pro_stock = int(pro_stock)
            elif not isinstance(pro_stock, int):
                pro_stock = 0

            img_val = ""
            imgs = product_details.get("prd_images")
            if isinstance(imgs, list) and len(imgs) > 0:
                first_img = imgs[0]
                raw_img = ""
                if isinstance(first_img, dict):
                    raw_img = str(first_img.get("pro_images") or first_img.get("image") or "")
                elif isinstance(first_img, str):
                    raw_img = first_img
                if raw_img:
                    img_val = raw_img if raw_img.startswith("http") else f"https://www.karzanddolls.com/karzOffice/public/assets/productimages/{raw_img}"

            return StockResponse(
                product_name=pro_name,
                stock_quantity=pro_stock,
                success=True,
                message="Stock retrieved successfully.",
                image=img_val,
            )
        else:
            return StockResponse(
                product_name=derived_title,
                stock_quantity=0,
                success=False,
                message="Could not find stock info in the page.",
            )
    except Exception as e:
        if "404" in str(e):
            return StockResponse(
                product_name=derived_title,
                stock_quantity=0,
                success=True,
                message="Out of Stock (Page 404)",
            )
        return StockResponse(
            product_name=derived_title,
            stock_quantity=0,
            success=False,
            message=_clean_error_message(e),
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
