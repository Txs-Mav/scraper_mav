# MVM Moto Sport Website Structure Analysis

**Website:** https://www.mvmmotosport.com/fr/  
**Analysis Date:** March 6, 2026  
**Purpose:** Building hardcoded CSS selectors for web scraper

---

## 1. HOMEPAGE STRUCTURE

### URL
`https://www.mvmmotosport.com/fr/`

### Key Navigation Links
- **New Products (Catalogues)**: `/fr/motocyclettes/` (general catalog entry)
- **Used Inventory (Occasion)**: `/fr/produits-occasion/`
- **New Inventory Complete**: `/fr/inventaire-neuf/`

### Product Categories
- Motocyclettes (Motorcycles): `/fr/motocyclettes/`
- VTT (ATVs): `/fr/vtt/`
- Côtes-à-côtes (Side-by-sides): `/fr/cotes-a-cotes/`
- Motoneiges (Snowmobiles): `/fr/motoneiges/`
- Motomarines (Watercraft): `/fr/motomarines/`
- Vélos électriques (E-bikes): `/fr/velos-electriques/`
- Produits mécaniques (Mechanical products): `/fr/produits-mecaniques/`

### Featured Products on Homepage
Products displayed as cards with:
- Model name (e.g., "Triumph TIGER 660 SPORT 2024")
- Price (current and original if discounted)
- Kilométrage (mileage) when applicable
- Link to detail page: `/fr/inventaire/{category}-{brand}-{model}-{year}-a-vendre-{stock_id}/`

---

## 2. USED INVENTORY LISTING PAGE

### URL
`https://www.mvmmotosport.com/fr/produits-occasion/`

### Page Structure

#### Body Class
```html
<body class="page-template page-template-template-listing-used-products ... is-used is-listing">
```

#### Filters Section
Uses FacetWP plugin for dynamic filtering:

**Filter Container:** 
```html
<div class="facetwp-facet facetwp-facet-{filter_name} facetwp-type-dropdown" data-name="{filter_name}" data-type="dropdown">
```

**Available Filters:**
- `used_type` - Type (Motocyclettes, VTT, Motomarines, etc.)
- `used_category` - Catégorie (Aventure, Custom, Sport, etc.)
- `used_make` - Marque (Triumph, Kawasaki, KTM, etc.)
- `used_year` - Année (2026, 2025, 2024, etc.)
- `used_price` - Prix (price ranges)
- `used_stock` - Inventaire (stock number search - autocomplete type)

**CSS Selectors for Filters:**
```css
.facetwp-facet.facetwp-facet-used_type    /* Type filter */
.facetwp-facet.facetwp-facet-used_category /* Category filter */
.facetwp-facet.facetwp-facet-used_make     /* Brand filter */
.facetwp-facet.facetwp-facet-used_year     /* Year filter */
.facetwp-facet.facetwp-facet-used_price    /* Price filter */
.facetwp-facet.facetwp-facet-used_stock    /* Stock search */
```

#### Product Listing Container
```html
<div class="facetwp-template">
  <div class="product-list listWImgs">
    <!-- Products loop here -->
  </div>
</div>
```

**CSS Selector for Listing Container:**
```css
.facetwp-template .product-list.listWImgs
```

#### Individual Product Card Structure
```html
<div class="item">
  <div class="content">
    <div class="img">
      <a href="{product_url}" title="{product_title}">
        <img src="{cdn_image_url}" alt="{product_title}">
      </a>
    </div>
    
    <div class="listWImgsContent">
      <h3>
        <a href="{product_url}">{Brand} {Model} {Year}</a>
      </h3>
      
      <ul class="specs">
        <li class="km">
          <span class="label">Kilométrage : </span>
          <span class="value">
            <span class="number">{mileage}</span>
            <span class="unit">km</span>
          </span>
        </li>
        
        <li class="stock">
          <span class="label"># inventaire : </span>
          <span class="value">{stock_number}</span>
        </li>
        
        <li class="price">
          <span class="label">Prix : </span>
          <del>
            <span class="value">
              <span class="number">{original_price}</span>
              <span class="unit">$</span>
            </span>
          </del>
          <span class="value">
            <span class="number">{current_price}</span>
            <span class="unit">$</span>
          </span>
        </li>
      </ul>
      
      <div class="btn">
        <a href="{product_url}">Voir les détails</a>
      </div>
    </div>
  </div>
</div>
```

**CSS Selectors for Product Cards:**
```css
.product-list.listWImgs .item                    /* Product card container */
.item .content                                    /* Content wrapper */
.item .img a                                      /* Product link (image) */
.item .img img                                    /* Product image */
.item .listWImgsContent                           /* Product info container */
.item .listWImgsContent h3 a                      /* Product title/name */
.item .specs li.km .value .number                 /* Mileage number */
.item .specs li.stock .value                      /* Stock number */
.item .specs li.price del .value .number          /* Original price */
.item .specs li.price > .value .number            /* Current/Sale price */
.item .btn a                                      /* Details button/link */
```

#### Pagination
```html
<div class="sortwrap after">
  <div class="pager">
    <div class="facetwp-pager"></div>
  </div>
</div>
```

**Pagination Display:** "1-10 de 42 résultats"

**CSS Selector:**
```css
.facetwp-pager    /* Pagination controls (dynamically populated) */
```

#### No Results Message
```html
<div class="no-result hidden">
  Aucun produit ne correspond à vos critères de recherche.
</div>
```

**CSS Selector:**
```css
.no-result    /* No results message (hidden by default) */
```

#### Product Count
```html
<div class="facet-counts hidden" data-count="42">
  <div class="facetwp-counts"></div>
</div>
```

**CSS Selector:**
```css
.facet-counts[data-count]    /* Contains total product count */
```

### Listing Page Key Observations
- **Products per page:** 10 (default)
- **Total products shown:** e.g., "1-10 de 42 résultats"
- **Pagination mechanism:** FacetWP dynamic pagination (AJAX-based)
- **Layout:** Vertical list with images on left (listWImgs)
- **Images:** Served from CDN: `https://cdn.powergo.ca/media/inventory/`
- **Image format:** WebP format (`_1024x768_webp/`)
- **Filter system:** FacetWP plugin (JavaScript-driven dropdowns)

---

## 3. NEW INVENTORY LISTING PAGE

### URL
`https://www.mvmmotosport.com/fr/inventaire-neuf/`

### Key Differences from Used Inventory
- **Similar structure** to used inventory page
- **Filter names** use `new_` prefix instead of `used_`:
  - `new_make` (instead of `used_make`)
  - `new_type` (instead of `used_type`)
  - etc.
- **Mileage field:** Often absent for brand new vehicles (may show 0 km or be omitted)
- **Product URLs:** Same pattern: `/fr/inventaire/{category}-{brand}-{model}-{year}-a-vendre-{stock_id}/`

### CSS Selectors for New Inventory
Same as used inventory, but filters have different names:
```css
.facetwp-facet.facetwp-facet-new_type
.facetwp-facet.facetwp-facet-new_make
.facetwp-facet.facetwp-facet-new_year
.facetwp-facet.facetwp-facet-new_price
```

---

## 4. PRODUCT DETAIL PAGE

### URL Pattern
```
/fr/inventaire/{category}-{brand}-{model}-{year}-a-vendre-{stock_id}/
```

**Examples:**
- Used: `https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-scrambler-400x-2026-a-vendre-m43373/`
- New: `https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-tiger-660-sport-2025-a-vendre-mn5564/`

### Page Structure

#### Header Section
```html
<div class="product-header">
  <!-- Price display -->
  Prix : 
  <del>{original_price} $</del>
  {current_price} $
</div>
```

#### Specifications Section
```html
<section id="product-specs">
  <div class="tabs-group">
    <ul class="tabs inverted">
      <li class="active">
        <a href="#product-specs-overview">Aperçu</a>
      </li>
    </ul>
  </div>
  
  <div class="tab-content">
    <div id="product-specs-overview" class="tab-pane fade active in">
      <header>
        <h2>Aperçu</h2>
      </header>
      
      <div class="content">
        <ul>
          <li class="condition">
            <span class="label">Condition:</span>
            <span class="value">Véhicule d'occasion</span>
          </li>
          
          <li class="make">
            <span class="label">Manufacturier :</span>
            <span class="value">{brand}</span>
          </li>
          
          <li class="model">
            <span class="label">Modèle :</span>
            <span class="value">{model}</span>
          </li>
          
          <li class="year">
            <span class="label">Année :</span>
            <span class="value">{year}</span>
          </li>
          
          <li class="stock">
            <span class="label"># inventaire :</span>
            <span class="value">{stock_number}</span>
          </li>
          
          <li class="type">
            <span class="label">Type :</span>
            <span class="value">{type}</span>
          </li>
          
          <li class="km">
            <span class="label">Kilométrage : </span>
            <span class="value">
              <span class="number">{mileage}</span>
              <span class="unit">km</span>
            </span>
          </li>
          
          <li class="vin">
            <span class="label">NIV :</span>
            <span class="value">{vin}</span>
          </li>
          
          <li class="ext-color">
            <span class="label">Couleur extérieure :</span>
            <span class="value">{color}</span>
          </li>
          
          <li class="engine-capacity">
            <span class="label">Capacité du moteur :</span>
            <span class="value">{cc} CC</span>
          </li>
          
          <li class="cylinders">
            <span class="label">Cylindres :</span>
            <span class="value">{cylinders}</span>
          </li>
          
          <li class="transmission">
            <span class="label">Transmission :</span>
            <span class="value">{transmission}</span>
          </li>
          
          <li class="fuel">
            <span class="label">Essence :</span>
            <span class="value">{fuel_type}</span>
          </li>
          
          <li class="vehicle-id hidden">
            <span class="label">Vehicle ID:</span>
            <span class="value">{uuid}</span>
          </li>
          
          <li class="category hidden">
            <span class="label">Type :</span>
            <span class="value">{category}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</section>
```

#### Description/Notes Section
```html
<section id="product-description" class="description">
  <div class="tabs-group">
    <ul class="tabs inverted">
      <li class="active">
        <a href="#product-notes">Notes</a>
      </li>
    </ul>
  </div>
  
  <div class="tab-content">
    <div id="product-notes" class="tab-pane fade active in">
      <header>
        <h2>Notes</h2>
      </header>
      
      <div class="text reset-text">
        <h3>Notes :</h3>
        <p>{description_content}</p>
      </div>
    </div>
  </div>
</section>
```

### CSS Selectors for Product Detail Page

#### Specifications
```css
#product-specs-overview .content ul                /* Specs list container */
#product-specs-overview li.condition .value        /* Condition (neuf/occasion) */
#product-specs-overview li.make .value             /* Brand/Manufacturer */
#product-specs-overview li.model .value            /* Model */
#product-specs-overview li.year .value             /* Year */
#product-specs-overview li.stock .value            /* Stock number */
#product-specs-overview li.type .value             /* Type (Rue, Sport, etc.) */
#product-specs-overview li.km .value .number       /* Mileage */
#product-specs-overview li.vin .value              /* VIN number */
#product-specs-overview li.ext-color .value        /* Exterior color */
#product-specs-overview li.engine-capacity .value  /* Engine capacity (CC) */
#product-specs-overview li.cylinders .value        /* Number of cylinders */
#product-specs-overview li.transmission .value     /* Transmission type */
#product-specs-overview li.fuel .value             /* Fuel type */
#product-specs-overview li.vehicle-id .value       /* Vehicle UUID */
#product-specs-overview li.category .value         /* Category */
```

#### Price
```css
.product-header del                 /* Original price (if discounted) */
.product-header .current-price      /* Current/Sale price */
```

#### Description
```css
#product-notes .text.reset-text     /* Description text container */
#product-notes h3                   /* "Notes :" heading */
#product-notes p                    /* Description paragraphs */
```

### Product Detail Page Observations
- **Price display:** Shows both original and sale price when discounted
- **Specs format:** Consistent label/value pairs in `<li>` elements
- **Hidden fields:** Some fields have `.hidden` class but contain valuable data (vehicle-id, category)
- **Description:** Rich HTML content in "Notes" section
- **VIN:** Full VIN number available
- **Condition field:** Clearly indicates "Véhicule neuf" or "Véhicule d'occasion"

---

## 5. CATALOG PAGES (BY BRAND/TYPE)

### URL Pattern
```
/fr/motocyclettes/
/fr/vtt/
/fr/cotes-a-cotes/
/fr/motoneiges/
/fr/motomarines/
/fr/velos-electriques/
/fr/produits-mecaniques/
```

### Structure
These are **catalog-style pages** showing models with base prices ("À partir de:"), not specific inventory items.

**Example from `/fr/motocyclettes/`:**
```html
<div class="product-group">
  <h2>{Brand Name}</h2>
  
  <h3>{Category}</h3>
  
  <div class="product-card">
    <h4>{Brand} {Model} {Color} {Year}</h4>
    <p>À partir de :</p>
    <p class="price">{price} $</p>
    <p class="notice">Frais de transport et préparation inclus.</p>
  </div>
</div>
```

### Key Differences from Inventory Pages
- **No stock numbers** - these are base models, not specific units
- **"À partir de"** pricing (starting at) rather than exact prices
- **Grouped by brand** (CFMOTO, Kawasaki, Triumph, etc.)
- **Subcategorized** (Scooter, Aventure, Naked, etc.)
- **Color variations** shown as separate entries

### Use Case for Scraping
These pages are best for:
- Getting model information
- Base MSRP pricing
- Available color options
- Model year availability

**Not ideal for actual inventory scraping** (no stock numbers, no specific units).

---

## 6. DATA FLOW & SCRAPING STRATEGY

### FacetWP Dynamic Loading
The site uses **FacetWP** WordPress plugin for filtering and pagination:
- JavaScript-driven AJAX requests
- Filters update URL parameters
- Page content updates without full reload

### AJAX Endpoints (Likely)
```
/fr/wp-json/facetwp/v1/refresh
```

### Recommended Scraping Approach

#### Option 1: Headless Browser (Selenium/Playwright)
**Pros:**
- Handles JavaScript rendering
- Can interact with filters
- Pagination works seamlessly

**Cons:**
- Slower
- More resource-intensive

#### Option 2: Direct HTML Scraping
**Pros:**
- Faster
- Simpler
- Works for initial page load

**Cons:**
- Only gets first page (10 products)
- Cannot filter without JavaScript execution
- Pagination not accessible

#### Recommended Hybrid Approach
1. Use headless browser to load initial page
2. Wait for FacetWP to fully load products
3. Extract product links from listing
4. Scrape individual product detail pages with direct HTTP requests (faster)

---

## 7. KEY CSS SELECTORS SUMMARY

### Listing Pages (Used/New Inventory)

| Element | CSS Selector |
|---------|-------------|
| Product cards | `.product-list.listWImgs .item` |
| Product link | `.item .listWImgsContent h3 a` |
| Product title | `.item .listWImgsContent h3 a` (text content) |
| Product image | `.item .img img` |
| Mileage | `.item .specs li.km .value .number` |
| Stock number | `.item .specs li.stock .value` |
| Current price | `.item .specs li.price > .value .number` |
| Original price | `.item .specs li.price del .value .number` |
| Details link URL | `.item .btn a` (href attribute) |
| Pagination | `.facetwp-pager` |
| Total results count | `.facet-counts[data-count]` (data-count attribute) |

### Product Detail Pages

| Element | CSS Selector |
|---------|-------------|
| Condition | `#product-specs-overview li.condition .value` |
| Brand | `#product-specs-overview li.make .value` |
| Model | `#product-specs-overview li.model .value` |
| Year | `#product-specs-overview li.year .value` |
| Stock number | `#product-specs-overview li.stock .value` |
| Type/Category | `#product-specs-overview li.type .value` |
| Mileage | `#product-specs-overview li.km .value .number` |
| VIN | `#product-specs-overview li.vin .value` |
| Color | `#product-specs-overview li.ext-color .value` |
| Engine size | `#product-specs-overview li.engine-capacity .value` |
| Cylinders | `#product-specs-overview li.cylinders .value` |
| Transmission | `#product-specs-overview li.transmission .value` |
| Fuel type | `#product-specs-overview li.fuel .value` |
| Description | `#product-notes .text.reset-text` |
| Vehicle UUID | `#product-specs-overview li.vehicle-id .value` |

---

## 8. URL PATTERNS REFERENCE

### Main Sections
```
Homepage:               /fr/
Used Inventory:         /fr/produits-occasion/
New Inventory:          /fr/inventaire-neuf/
Motorcycles Catalog:    /fr/motocyclettes/
ATVs Catalog:           /fr/vtt/
Side-by-sides Catalog:  /fr/cotes-a-cotes/
Snowmobiles Catalog:    /fr/motoneiges/
Watercraft Catalog:     /fr/motomarines/
E-bikes Catalog:        /fr/velos-electriques/
```

### Product Detail URL Pattern
```
/fr/inventaire/{category}-{brand}-{model}-{year}-a-vendre-{stock_id}/
```

**Components:**
- `{category}`: motocyclettes, vtt, motomarines, etc.
- `{brand}`: triumph, kawasaki, ktm, etc. (lowercase, no spaces)
- `{model}`: scrambler-400x, tiger-660-sport, etc. (lowercase, hyphens)
- `{year}`: 2026, 2025, 2024, etc.
- `{stock_id}`: Unique stock identifier (e.g., m43373, mn5564)

**Stock ID Patterns:**
- Often starts with letter(s) indicating something (M, K, C, etc.)
- Followed by 5 digits
- Examples: M43373, MN5564, K03284, C01495

---

## 9. IMAGES

### Image URL Pattern
```
https://cdn.powergo.ca/media/inventory/{year}/{week_or_id}/{hash}_{resolution}_{format}/{year}-{brand}-{model}-{index}.{ext}
```

**Example:**
```
https://cdn.powergo.ca/media/inventory/2025/39/5280653d11754501b1c004a04e158a66_1024x768_webp/2026-triumph-scrambler-400x-0.webp
```

**Format Details:**
- **Resolution:** `1024x768_webp`
- **Format:** WebP
- **Index:** `-0`, `-1`, `-2`, etc. (multiple photos per vehicle)

---

## 10. SCRAPING RECOMMENDATIONS

### Step-by-Step Scraping Strategy

1. **Navigate to listing page** (used or new inventory)
   - URL: `/fr/produits-occasion/` or `/fr/inventaire-neuf/`

2. **Wait for FacetWP to load**
   - Check for presence of `.product-list.listWImgs .item` elements

3. **Extract total product count**
   - From `.facet-counts[data-count]` attribute
   - Use to calculate number of pages needed

4. **Iterate through pages**
   - FacetWP loads 10 products per page
   - Navigate pagination by clicking or constructing URLs

5. **Collect product URLs**
   - Extract all `.item .listWImgsContent h3 a` href attributes
   - Store in a list for detail scraping

6. **Scrape individual product pages**
   - Visit each URL
   - Extract all specs using selectors from Section 7
   - Save to database/JSON

7. **Handle images**
   - Multiple images per product (change index: `-0`, `-1`, `-2`)
   - Download or store CDN URLs

### Data Fields to Capture

#### From Listing Page
- Product URL
- Product title/name
- Stock number
- Current price
- Original price (if discounted)
- Mileage (if present)
- Thumbnail image URL

#### From Detail Page
- Condition (new/used)
- Brand/Manufacturer
- Model
- Year
- Stock number (confirm)
- Type/Category
- Mileage
- VIN
- Color
- Engine capacity (CC)
- Cylinders
- Transmission
- Fuel type
- Description/Notes
- Vehicle UUID
- Price (confirm from listing)
- All image URLs

### Error Handling
- **Missing fields:** Some fields may not exist for all products (e.g., mileage for brand new)
- **Discounted prices:** Check for `<del>` tag to detect original price
- **Multiple pages:** Ensure pagination completes before finishing
- **Rate limiting:** Add delays between requests to avoid blocking

---

## 11. TECHNICAL DETAILS

### Technologies Detected
- **CMS:** WordPress
- **Filter Plugin:** FacetWP
- **JavaScript Framework:** jQuery (based on common WP patterns)
- **CDN:** PowerGO (cdn.powergo.ca) - likely a dealership platform
- **Image Format:** WebP
- **Analytics:** Google Tag Manager, Facebook Pixel

### Notes on PowerGO Platform
The site appears to use **PowerGO**, a platform specifically designed for powersports dealerships. This explains:
- The consistent URL patterns
- The `cdn.powergo.ca` image hosting
- The structured data format
- The vehicle ID UUIDs

### WordPress Specifics
- **Theme Path:** `/wp-content/themes/site/`
- **Language:** French Canadian (`lang='fr_CA'`)
- **Template:** Custom template (`template-listing-used-products.php`)

---

## 12. SAMPLE DATA EXTRACTION

### Example: Used Product (Triumph Scrambler 400X 2026)

**URL:** `https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-scrambler-400x-2026-a-vendre-m43373/`

**Extracted Data:**
```json
{
  "url": "https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-scrambler-400x-2026-a-vendre-m43373/",
  "condition": "Véhicule d'occasion",
  "manufacturer": "Triumph",
  "model": "SCRAMBLER 400X",
  "year": 2026,
  "stock_number": "M43373",
  "type": "Rue",
  "category": "Motocyclettes",
  "mileage": 108,
  "mileage_unit": "km",
  "vin": "SMTT147Y9TNA43373",
  "color_exterior": "Orange",
  "engine_capacity": 399.0,
  "engine_capacity_unit": "CC",
  "cylinders": 1,
  "transmission": "Manuelle",
  "fuel_type": "Essence",
  "vehicle_id": "abc852c4-3e5c-4606-b4a0-d89c8abbe7b6",
  "price_current": 7795,
  "price_original": 8445,
  "price_currency": "$",
  "description": "DÉMO !! La Triumph Scrambler 400 X 2026 est une moto d'aventure légère et agile...",
  "image_url": "https://cdn.powergo.ca/media/inventory/2025/39/5280653d11754501b1c004a04e158a66_1024x768_webp/2026-triumph-scrambler-400x-0.webp",
  "scraped_at": "2026-03-06T12:00:00Z"
}
```

### Example: New Product (Triumph Tiger 660 Sport 2024)

**URL:** `https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-tiger-660-sport-2025-a-vendre-mn5564/`

**Extracted Data:**
```json
{
  "url": "https://www.mvmmotosport.com/fr/inventaire/motocyclettes-triumph-tiger-660-sport-2025-a-vendre-mn5564/",
  "condition": "Véhicule neuf",
  "manufacturer": "Triumph",
  "model": "TIGER 660 SPORT",
  "year": 2024,
  "stock_number": "MN5564",
  "type": "Sport",
  "category": "Motocyclettes",
  "mileage": null,
  "mileage_unit": null,
  "vin": "SMTL20UL2RTBN5564",
  "color_exterior": "Noir",
  "engine_capacity": 660.0,
  "engine_capacity_unit": "CC",
  "cylinders": 2,
  "transmission": "Manuelle",
  "fuel_type": null,
  "vehicle_id": "27dcca96-c171-4c19-bb1e-597637a0c011",
  "price_current": 9975,
  "price_original": 12930,
  "price_currency": "$",
  "description": "La Triumph Tiger Sport 660 est la moto idéale...",
  "image_url": "https://cdn.powergo.ca/media/inventory/...",
  "scraped_at": "2026-03-06T12:00:00Z"
}
```

---

## 13. PAGINATION DETAILS

### Total Results Format
Display text: **"1-10 de 42 résultats"**

**Parsing:**
- Total count: 42 products
- Current page shows items 1-10
- Products per page: 10

### Pagination Logic
```
Total Products: 42
Products per page: 10
Total pages: ceil(42 / 10) = 5 pages
```

### FacetWP Pagination
- Dynamically generated by JavaScript
- No static page numbers in HTML
- AJAX-based navigation

### Scraping Pagination
**Option 1: Headless browser**
- Wait for `.facetwp-pager` to load
- Click next page buttons
- Wait for new products to load

**Option 2: Reverse engineer AJAX**
- Capture network requests
- Replicate POST/GET parameters
- Parse JSON responses

---

## 14. ADDITIONAL NOTES

### Condition Field Values
- **New vehicles:** "Véhicule neuf"
- **Used vehicles:** "Véhicule d'occasion"

### Price Display Patterns
- **No discount:** Single price display
- **Discount:** Original price in `<del>` tag, current price follows

### Mileage
- **New vehicles:** Often missing or 0 km
- **Used vehicles:** Always present with unit "km"

### Stock Number Prefixes (Observed)
- **M**: General motorcycle stock
- **K**: Kawasaki vehicles
- **C**: CFMOTO or other brands
- **U**: Used vehicles (possibly)
- **MC, MN, MH, MJ**: Various prefixes (meaning unclear)

### Categories Observed
- Motocyclettes (Motorcycles)
- VTT (ATVs)
- Motomarines (Watercraft)
- Motoneiges (Snowmobiles)
- Remorques (Trailers)
- Autres (Other)

### Vehicle Types Observed
- Rue (Street)
- Sport
- Aventure (Adventure)
- Custom
- Double usage (Dual-purpose)
- Enduros
- Montagne (Mountain)
- Motocross
- Tourisme (Touring)
- Côtes-à-côtes (Side-by-sides)
- Sentier (Trail)

---

## 15. CONCLUSION

The MVM Moto Sport website follows a consistent, structured pattern ideal for scraping:

✅ **Consistent URL patterns**  
✅ **Well-structured HTML with semantic classes**  
✅ **Consistent data fields across products**  
✅ **Clear distinction between new and used inventory**  
✅ **Detailed product specifications**  

⚠️ **Challenges:**
- JavaScript-based filtering and pagination (FacetWP)
- AJAX loading requires headless browser or API reverse-engineering
- Rate limiting considerations

**Best Approach:**
1. Use headless browser (Selenium/Playwright) for listing pages
2. Extract product URLs
3. Scrape individual product detail pages with direct HTTP requests
4. Parse HTML with BeautifulSoup
5. Store in structured database

---

**End of Analysis**
