import hashlib
import hmac
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
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
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

if os.path.exists(".env"):
    try:
        with open(".env", "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
    except Exception:
        pass

APP_PASSWORD = os.getenv("APP_PASSWORD")
SESSION_SECRET = os.getenv("SESSION_SECRET", "knd-stock-auth-secret-key-v1-production")
SESSION_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds
SESSION_COOKIE_NAME = "knd_session"


def create_session_token() -> str:
    expires_at = int(time.time()) + SESSION_MAX_AGE
    payload = f"{expires_at}"
    sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def is_valid_session(token: str | None) -> bool:
    if not token or ":" not in token:
        return False
    try:
        payload, sig = token.split(":", 1)
        expires_at = int(payload)
        if time.time() > expires_at:
            return False
        expected_sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected_sig)
    except Exception:
        return False


def get_session_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    custom_header = request.headers.get("X-Session-Token")
    if custom_header:
        return custom_header.strip()
    return request.cookies.get(SESSION_COOKIE_NAME)


def check_authenticated(request: Request) -> bool:
    token = get_session_token(request)
    return is_valid_session(token)


class LoginRequest(BaseModel):
    password: str


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
    numeric_price: float = 0.0
    image: str = ""
    brand: str = ""
    subcategory: str = ""
    created_at: str = ""


class SearchResponse(BaseModel):
    products: list[SearchItem]
    success: bool
    message: str = ""


class CatalogResponse(BaseModel):
    products: list[SearchItem]
    total: int
    page: int
    per_page: int
    total_pages: int
    success: bool
    message: str = ""


def _normalize_knd_url(url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    if url.startswith("/"):
        return f"https://www.karzanddolls.com{url}"
    if not url.startswith("http://") and not url.startswith("https://"):
        if url.startswith("karzanddolls.com") or url.startswith("www.karzanddolls.com"):
            return f"https://{url}"
    return url


def _is_allowed_url(url: str) -> bool:
    try:
        norm = _normalize_knd_url(url)
        parsed = urlparse(norm)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        return hostname in ALLOWED_HOSTNAMES or hostname.endswith(".karzanddolls.com")
    except Exception:
        return False


@app.get("/")
async def root(request: Request):
    if check_authenticated(request):
        return FileResponse("index.html")
    return FileResponse("login.html")


@app.get("/index.html")
async def serve_index(request: Request):
    if check_authenticated(request):
        return FileResponse("index.html")
    return RedirectResponse(url="/login.html", status_code=302)


@app.get("/login.html")
async def serve_login():
    return FileResponse("login.html")


@app.get("/script.js")
async def serve_script():
    return FileResponse("script.js", media_type="application/javascript")


@app.get("/styles.css")
async def serve_styles():
    return FileResponse("styles.css", media_type="text/css")


@app.post("/api/login")
def login(req: LoginRequest, request: Request):
    if not APP_PASSWORD:
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "Server authentication not configured. Set APP_PASSWORD environment variable."}
        )
    if req.password == APP_PASSWORD:
        token = create_session_token()
        response = JSONResponse(content={
            "success": True,
            "message": "Authenticated",
            "token": token,
            "expires_in": SESSION_MAX_AGE
        })
        is_secure = request.url.scheme == "https" or "render.com" in request.headers.get("host", "")
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            max_age=SESSION_MAX_AGE,
            httponly=True,
            samesite="none" if is_secure else "lax",
            secure=is_secure,
            path="/"
        )
        return response
    return JSONResponse(status_code=401, content={"success": False, "message": "Incorrect password"})


@app.post("/api/logout")
def logout():
    response = JSONResponse(content={"success": True, "message": "Logged out"})
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return response


@app.get("/api/auth-status")
def auth_status(request: Request):
    return {"authenticated": check_authenticated(request)}


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


def _format_search_item(p: dict, default_brand: str = "", default_subcat: str = "") -> SearchItem | None:
    if not isinstance(p, dict):
        return None
    name = p.get("pro_name") or p.get("product_name") or p.get("title") or "Unknown Product"
    slug = p.get("slug", "")
    pid = p.get("pid", "")
    raw_stock = p.get("pro_stock")
    has_stock_field = raw_stock is not None and str(raw_stock).strip() != ""
    stock = 0
    if has_stock_field:
        if isinstance(raw_stock, str) and raw_stock.strip().isdigit():
            stock = int(raw_stock.strip())
        elif isinstance(raw_stock, (int, float)):
            stock = int(raw_stock)
    in_stock_flag = p.get("in_stock")
    in_s = bool(int(in_stock_flag)) if in_stock_flag is not None else (stock > 0)
    if not has_stock_field and in_s:
        # pro_stock not available on listing pages; use -1 sentinel for "in stock, qty unknown"
        stock = -1

    price_val = p.get("dis_price") or p.get("act_price") or p.get("price") or ""
    numeric_price = 0.0
    price_str = ""
    if price_val:
        try:
            numeric_price = float(str(price_val).replace(",", "").replace("₹", "").strip())
            price_str = f"₹{int(numeric_price) if numeric_price.is_integer() else numeric_price}"
        except Exception:
            price_str = f"₹{price_val}"
            numeric_price = 0.0

    img_val = ""
    imgs = p.get("prd_images") or p.get("images") or p.get("pro_images")
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
    if not prod_url:
        return None

    brand = str(p.get("brand_name") or default_brand or "")
    subcat = str(default_subcat or "")
    created_at = str(p.get("created_at") or p.get("creation_time") or "")

    return SearchItem(
        product_name=name,
        url=prod_url,
        stock_quantity=stock,
        in_stock=in_s,
        price=price_str,
        numeric_price=numeric_price,
        image=img_val,
        brand=brand,
        subcategory=subcat,
        created_at=created_at
    )


def _extract_products_from_soup(soup: BeautifulSoup, default_brand: str = "", default_subcat: str = "") -> list[SearchItem]:
    items: list[SearchItem] = []
    seen_urls: set[str] = set()

    next_data = soup.find("script", id="__NEXT_DATA__")
    if next_data and next_data.string:
        try:
            data = json.loads(next_data.string)
            page_props = (data.get("props") or {}).get("pageProps") or {}
            candidate_keys = [
                "products", "productdata", "newarrivalsdata", "ispreorderdata",
                "bestdata", "trendingdata", "carsdata", "offerprddata", "legodata", "booksdata",
                "childcategory", "subcategory", "subcategorydata", "categorydata"
            ]
            for key in candidate_keys:
                val = page_props.get(key)
                raw_list = []
                if isinstance(val, list):
                    raw_list = val
                elif isinstance(val, dict):
                    raw_list = val.get("products") or val.get("data") or []

                if isinstance(raw_list, list):
                    for raw_p in raw_list:
                        item = _format_search_item(raw_p, default_brand=default_brand, default_subcat=default_subcat)
                        if item and item.url not in seen_urls:
                            seen_urls.add(item.url)
                            items.append(item)

            for k, v in page_props.items():
                if k not in candidate_keys:
                    raw_list = []
                    if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                        raw_list = v
                    elif isinstance(v, dict):
                        sub_prods = v.get("products") or v.get("data")
                        if isinstance(sub_prods, list) and len(sub_prods) > 0 and isinstance(sub_prods[0], dict):
                            raw_list = sub_prods
                    for raw_p in raw_list:
                        item = _format_search_item(raw_p, default_brand=default_brand, default_subcat=default_subcat)
                        if item and item.url not in seen_urls:
                            seen_urls.add(item.url)
                            items.append(item)
        except Exception:
            pass

    if not items:
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"].strip()
            if "/details/" in href:
                full_url = href if href.startswith("http") else f"https://www.karzanddolls.com{href}"
                if full_url not in seen_urls:
                    seen_urls.add(full_url)
                    title = a_tag.get_text(strip=True) or _extract_title_from_url(full_url)
                    items.append(SearchItem(
                        product_name=title,
                        url=full_url,
                        stock_quantity=0,
                        in_stock=False,
                        price="",
                        numeric_price=0.0,
                        image="",
                        brand=default_brand,
                        subcategory=default_subcat,
                        created_at=""
                    ))

    return items


@app.get("/api/search", response_model=SearchResponse)
@limiter.limit(RATE_LIMIT)
def search_products(request: Request, term: str = Query(..., description="Search term")):
    if not check_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Please enter password.")
    if not term.strip():
        return SearchResponse(products=[], success=True, message="Empty query")
    try:
        target_url = f"https://www.karzanddolls.com/search?term={term.strip()}"
        r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        items = _extract_products_from_soup(soup)
        return SearchResponse(products=items, success=True, message=f"Found {len(items)} products.")
    except Exception as e:
        return SearchResponse(products=[], success=False, message=f"Error searching products: {_clean_error_message(e)}")


@app.get("/api/unpack", response_model=SearchResponse)
@limiter.limit(RATE_LIMIT)
def unpack_collection(request: Request, url: str = Query(..., description="Karz & Dolls category, search, or collection URL")):
    if not check_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Please enter password.")
    target_url = _normalize_knd_url(url)
    if not _is_allowed_url(target_url):
        raise HTTPException(status_code=400, detail="Invalid URL. Only karzanddolls.com URLs are allowed.")
    try:
        r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        items = _extract_products_from_soup(soup)
        return SearchResponse(products=items, success=True, message=f"Unpacked {len(items)} products.")
    except Exception as e:
        return SearchResponse(products=[], success=False, message=f"Error unpacking URL: {_clean_error_message(e)}")


_CATEGORY_CACHE: dict = {"data": None, "timestamp": 0}
CATEGORY_CACHE_TTL = 3600  # 1 hour


@app.get("/api/categories")
@limiter.limit(RATE_LIMIT)
def get_categories(request: Request):
    if not check_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Please enter password.")
    now = time.time()
    if _CATEGORY_CACHE["data"] and (now - _CATEGORY_CACHE["timestamp"] < CATEGORY_CACHE_TTL):
        return {"success": True, "categories": _CATEGORY_CACHE["data"]}

    try:
        r = fetch_url("https://www.karzanddolls.com/karzOffice/api/category", timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        raw = r.json()
        raw_cats = raw.get("data", []) if isinstance(raw, dict) else []

        parsed_categories = []
        for c in raw_cats:
            c_title = (c.get("title") or c.get("name") or "Category").strip()
            c_slug = (c.get("slug") or "").strip()
            subcats = []
            for sc in c.get("subcategories") or []:
                sc_name = (sc.get("cat_name") or sc.get("name") or "Brand").strip()
                sc_slug = (sc.get("slug") or "").strip()
                series_list = []
                for ch in sc.get("child_categories") or []:
                    ch_name = (ch.get("sub_name") or ch.get("name") or sc_name).strip()
                    ch_slug = (ch.get("slug") or "").strip()
                    url = f"https://www.karzanddolls.com/{sc_slug}/{ch_slug}" if ch_slug else f"https://www.karzanddolls.com/{sc_slug}/{sc_slug}"
                    series_list.append({
                        "name": ch_name,
                        "slug": ch_slug,
                        "url": url
                    })
                if not series_list and sc_slug:
                    series_list.append({
                        "name": sc_name,
                        "slug": sc_slug,
                        "url": f"https://www.karzanddolls.com/{sc_slug}/{sc_slug}"
                    })
                subcats.append({
                    "name": sc_name,
                    "slug": sc_slug,
                    "series": series_list
                })
            if subcats:
                parsed_categories.append({
                    "name": c_title,
                    "slug": c_slug,
                    "subcategories": subcats
                })

        _CATEGORY_CACHE["data"] = parsed_categories
        _CATEGORY_CACHE["timestamp"] = now
        return {"success": True, "categories": parsed_categories}
    except Exception as e:
        if _CATEGORY_CACHE["data"]:
            return {"success": True, "categories": _CATEGORY_CACHE["data"], "stale": True}
        return {"success": False, "error": f"Failed to fetch live categories: {_clean_error_message(e)}", "categories": []}


_CATALOG_CACHE: dict[str, tuple[list[SearchItem], float]] = {}
CATALOG_CACHE_TTL = 600  # 10 minutes

DEFAULT_DISCOVERY_URLS = [
    ("https://www.karzanddolls.com/mini-gt/mini-gt", "Mini GT", "Mini GT"),
    ("https://www.karzanddolls.com/mini-gt/kaido-house", "Mini GT", "Kaido House"),
    ("https://www.karzanddolls.com/mini-gt/qubecarz", "Mini GT", "Qubecarz"),
    ("https://www.karzanddolls.com/pop-race/pop-race", "Pop Race", "Pop Race"),
    ("https://www.karzanddolls.com/inno64/inno64-model-cars", "Inno64", "Inno64"),
    ("https://www.karzanddolls.com/hot-wheels/card-art-premiums", "Hot Wheels", "Card Art Premiums"),
    ("https://www.karzanddolls.com/pre-orders/pre-order-minigt", "Pre-Orders", "Mini GT Pre-orders"),
]


def _fetch_lineup_products(target_url: str, default_brand: str = "", default_subcat: str = "") -> list[SearchItem]:
    try:
        r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        return _extract_products_from_soup(soup, default_brand=default_brand, default_subcat=default_subcat)
    except Exception:
        return []


@app.get("/api/catalog", response_model=CatalogResponse)
@limiter.limit(RATE_LIMIT)
def get_catalog(
    request: Request,
    category: str = Query("cars", description="Category slug"),
    brand: str = Query("all", description="Brand slug or 'all'"),
    subcategory: str = Query("", description="Lineup / series slug"),
    search: str = Query("", description="Keyword search term"),
    sort: str = Query("latest", description="Sort: latest, oldest, price_low, price_high, stock_high"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(24, ge=1, le=100, description="Items per page")
):
    if not check_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Please enter password.")

    cache_key = f"{category}|{brand}|{subcategory}|{search.strip().lower()}"
    now = time.time()

    all_products: list[SearchItem] = []
    if cache_key in _CATALOG_CACHE and (now - _CATALOG_CACHE[cache_key][1] < CATALOG_CACHE_TTL):
        all_products = _CATALOG_CACHE[cache_key][0]
    else:
        search_term = search.strip()
        if search_term:
            try:
                target_url = f"https://www.karzanddolls.com/search?term={search_term}"
                r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
                r.raise_for_status()
                soup = BeautifulSoup(r.text, "html.parser")
                all_products = _extract_products_from_soup(soup)
            except Exception:
                all_products = []
        elif brand and brand.lower() != "all":
            b_slug = brand.strip()
            s_slug = subcategory.strip() if subcategory and subcategory.lower() != "all" else b_slug
            target_url = f"https://www.karzanddolls.com/{b_slug}/{s_slug}"
            all_products = _fetch_lineup_products(target_url, default_brand=b_slug, default_subcat=s_slug)
            if not all_products and s_slug != b_slug:
                target_url = f"https://www.karzanddolls.com/{b_slug}/{b_slug}"
                all_products = _fetch_lineup_products(target_url, default_brand=b_slug, default_subcat="")
            if not all_products and category:
                c_slug = category.strip()
                target_url = f"https://www.karzanddolls.com/{c_slug}/{s_slug}"
                all_products = _fetch_lineup_products(target_url, default_brand=b_slug, default_subcat=s_slug)
                if not all_products:
                    target_url = f"https://www.karzanddolls.com/{c_slug}/{b_slug}"
                    all_products = _fetch_lineup_products(target_url, default_brand=b_slug, default_subcat="")
        else:
            if category and category.lower() != "cars":
                c_slug = category.strip()
                target_url = f"https://www.karzanddolls.com/{c_slug}/{c_slug}"
                all_products = _fetch_lineup_products(target_url, default_brand=c_slug, default_subcat="")
            else:
                seen_urls = set()
                combined: list[SearchItem] = []
                with ThreadPoolExecutor(max_workers=5) as executor:
                    future_to_info = {
                        executor.submit(_fetch_lineup_products, u, b, s): (b, s)
                        for (u, b, s) in DEFAULT_DISCOVERY_URLS
                    }
                    for future in as_completed(future_to_info):
                        try:
                            items = future.result()
                            for it in items:
                                if it.url not in seen_urls:
                                    seen_urls.add(it.url)
                                    combined.append(it)
                        except Exception:
                            pass
                all_products = combined

        if all_products:
            _CATALOG_CACHE[cache_key] = (all_products, now)

    sorted_items = list(all_products)
    if sort == "price_low":
        sorted_items.sort(key=lambda x: (x.numeric_price <= 0, x.numeric_price))
    elif sort == "price_high":
        sorted_items.sort(key=lambda x: x.numeric_price, reverse=True)
    elif sort == "stock_high":
        sorted_items.sort(key=lambda x: x.stock_quantity, reverse=True)
    elif sort == "oldest":
        sorted_items.reverse()

    total = len(sorted_items)
    total_pages = max(1, (total + limit - 1) // limit)
    page_safe = min(page, total_pages) if total > 0 else 1
    start_idx = (page_safe - 1) * limit
    end_idx = start_idx + limit
    page_products = sorted_items[start_idx:end_idx]

    return CatalogResponse(
        products=page_products,
        total=total,
        page=page_safe,
        per_page=limit,
        total_pages=total_pages,
        success=True,
        message=f"Fetched {len(page_products)} products."
    )



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
    if not check_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Please enter password.")
    target_url = _normalize_knd_url(url)
    if not _is_allowed_url(target_url):
        raise HTTPException(
            status_code=400,
            detail="Invalid URL. Only karzanddolls.com product URLs are allowed."
        )

    derived_title = _extract_title_from_url(target_url)
    try:
        r = fetch_url(target_url, timeout=DEFAULT_TIMEOUT)
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
            pro_stock_raw = product_details.get("pro_stock")
            has_stock = pro_stock_raw is not None and str(pro_stock_raw).strip() != ""
            in_stock_flag = product_details.get("in_stock")
            in_stock_bool = bool(int(in_stock_flag)) if in_stock_flag is not None else False

            if has_stock:
                pro_stock = pro_stock_raw
                if isinstance(pro_stock, str) and pro_stock.strip().isdigit():
                    pro_stock = int(pro_stock.strip())
                elif isinstance(pro_stock, (int, float)):
                    pro_stock = int(pro_stock)
                else:
                    pro_stock = -1 if in_stock_bool else 0
            else:
                # pro_stock hidden until add-to-cart; use -1 sentinel if in_stock flag is set
                pro_stock = -1 if in_stock_bool else 0

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
