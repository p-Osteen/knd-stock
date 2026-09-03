import json
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from curl_cffi import requests
from bs4 import BeautifulSoup

app = FastAPI(title="KND Stock Checker API")

# Add CORS middleware so the GitHub Pages frontend can communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (including your github pages site)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files from root
app.mount("/static", StaticFiles(directory="."), name="static")

class StockResponse(BaseModel):
    product_name: str
    stock_quantity: int
    success: bool
    message: str = ""

@app.get("/")
async def root():
    return FileResponse("index.html")

@app.get("/api/check-stock", response_model=StockResponse)
async def check_stock(url: str = Query(..., description="The product URL to check")):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL format. Must start with http or https.")
        
    session = requests.Session(impersonate="chrome120")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        r = session.get(url, headers=headers, timeout=12)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        next_data = soup.find("script", id="__NEXT_DATA__")
        
        if next_data:
            data = json.loads(next_data.string)
            product_details = data.get("props", {}).get("pageProps", {}).get("productdetails", {})
            
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
                message="Stock retrieved successfully."
            )
        else:
            return StockResponse(
                product_name="Unknown",
                stock_quantity=0,
                success=False,
                message="Could not find stock info in the page."
            )
    except Exception as e:
        return StockResponse(
            product_name="Unknown",
            stock_quantity=0,
            success=False,
            message=f"Error fetching product: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
