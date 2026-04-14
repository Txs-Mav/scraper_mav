# Manual Search Bar Test Guide

**Target:** http://localhost:3000  
**Component:** Search bar in "Configurer le scraping" section

---

## Why Manual Testing Required

Browser automation (Playwright/Selenium) is not available in this environment due to:
- Missing browser binaries (Chromium, Firefox, etc.)
- Sandbox restrictions preventing browser installation

---

## Step-by-Step Testing Instructions

### STEP 1: Navigate to the Dev Server

1. Open your web browser
2. Go to: **http://localhost:3000**
3. Wait **5 seconds** for the page to fully load

### STEP 2: Authentication (if required)

If you see a login page:
- Enter your credentials
- The search API requires authentication to work
- After login, you should see the main dashboard

### STEP 3: Locate the Search Bar

Look for one of these:
- ✅ Section titled **"Configurer le scraping"**
- ✅ Search input with placeholder **"Rechercher..."**
- ✅ Magnifying glass icon (🔍) on the left side of an input

**Location hints:**
- Usually near the top of the configuration section
- May be in a card/panel with a header
- Might need to scroll down slightly

### STEP 4: Test Search - "motoplex"

1. **Click** on the search input field
2. **Type:** `motoplex`
3. **Wait** 2 seconds (allows 300ms debounce + API call)
4. **Observe** the dropdown that appears below

**Expected Result:**

```
╔════════════════════════════════════════╗
║ ✨ Scrapers Universels                ║
╠════════════════════════════════════════╣
║ Motoplex St-Eustache                   ║
║ motoplex.ca                            ║
║                                        ║
║ [+ Référence] [+ Concurrent]           ║
╚════════════════════════════════════════╝
```

**Verify:**
- ✅ Dropdown appears
- ✅ Site name: **"Motoplex St-Eustache"**
- ✅ Domain: **"motoplex.ca"**
- ✅ Two action buttons visible
- ✅ Optional: Loading spinner appears briefly

### STEP 5: Test Search - "st-eustache"

1. **Clear** the search input (Backspace or Ctrl+A → Delete)
2. **Type:** `st-eustache`
3. **Wait** 2 seconds
4. **Observe** the dropdown

**Expected Result:**
- ✅ Same result as "motoplex" search
- ✅ "Motoplex St-Eustache" should appear
- ✅ This verifies keyword matching works

### STEP 6: Additional Tests (Optional)

Try these searches to verify comprehensive keyword matching:

| Search Term | Should Find | Reason |
|-------------|-------------|--------|
| `saint-eustache` | Motoplex St-Eustache | Alternate spelling in keywords |
| `cfmoto` | Motoplex St-Eustache | Brand keyword |
| `suzuki` | Motoplex St-Eustache | Brand keyword |
| `laurentides` | Motoplex St-Eustache | Region keyword |
| `t-rex` | Motoplex St-Eustache | Vehicle type keyword |
| `mvm` | MVM Moto Sport | Different site (if migration run) |

---

## What to Report

Please provide:

### 1. Search Bar Location
- [ ] Found the search bar
- [ ] Location on page: _________________
- [ ] Screenshot of the search bar area

### 2. "motoplex" Search Results
- [ ] Dropdown appeared
- [ ] Site name shown: _________________
- [ ] Domain shown: _________________
- [ ] Button labels: _________________
- [ ] Any badges/icons: _________________

### 3. "st-eustache" Search Results
- [ ] Results appeared
- [ ] Same as "motoplex" search? Yes / No
- [ ] If different, what changed: _________________

### 4. Technical Details
- [ ] Browser console errors? (F12 → Console)
- [ ] Network request made? (F12 → Network → Filter: shared-scrapers)
- [ ] API response status: _________________
- [ ] Response time: _________________

### 5. Screenshots
- [ ] Initial page load
- [ ] Search bar with "motoplex" typed
- [ ] Results dropdown for "motoplex"
- [ ] Results dropdown for "st-eustache"

---

## Troubleshooting

### ❌ No Results Appear

**Symptoms:** Typing search terms shows nothing or "No results found"

**Possible Causes:**
1. **Database migration not run**
   - Solution: Run `migration_shared_scrapers_motoplex.sql`
   
2. **Not authenticated**
   - Solution: Log in to the application
   
3. **API error**
   - Check browser console for errors
   - Check Network tab for failed requests

### ❌ "Not authenticated" Error

**Symptoms:** API returns 401 status

**Solution:**
- You must log in first
- The `/api/shared-scrapers/search` endpoint requires authentication
- Create an account or use existing credentials

### ❌ Search Bar Not Visible

**Symptoms:** Can't find the search input

**Solutions:**
1. Scroll down the page - it might be below the fold
2. Look for "Configurer le scraping" section header
3. Try refreshing the page (Ctrl+R)
4. Check if you're on the home page (should be at `/`)
5. Try navigating to `/dashboard` if that exists

### ❌ Dropdown Doesn't Appear

**Symptoms:** Type search but no dropdown shows

**Checks:**
1. Did you type at least 2 characters? (minimum required)
2. Wait full 2 seconds (debounce is 300ms + API call time)
3. Check browser console for JavaScript errors
4. Check Network tab - is API being called?

### ❌ Wrong Results Shown

**Symptoms:** Results don't match expected site

**Checks:**
1. Verify database migration was run correctly
2. Check `is_active` field in database (should be `true`)
3. Verify `search_keywords` array contains expected terms

---

## Database Verification

To verify the data exists in the database:

```sql
-- Check if Motoplex entry exists
SELECT site_name, site_slug, site_domain, search_keywords, is_active
FROM shared_scrapers
WHERE site_slug = 'motoplex';

-- Expected result:
-- site_name: "Motoplex St-Eustache"
-- site_slug: "motoplex"
-- site_domain: "motoplex.ca"
-- search_keywords: {motoplex, st-eustache, saint-eustache, ...}
-- is_active: true
```

---

## API Testing Alternative

If you can't test through the UI, you can test the API directly:

### Using curl (with authentication cookie):

```bash
# Get your session cookie from browser (F12 → Application → Cookies)
# Then:

curl -H "Cookie: sb-access-token=YOUR_TOKEN_HERE" \
     "http://localhost:3000/api/shared-scrapers/search?q=motoplex"
```

### Expected API Response:

```json
{
  "scrapers": [
    {
      "id": "...",
      "site_name": "Motoplex St-Eustache",
      "site_slug": "motoplex",
      "site_url": "https://www.motoplex.ca/fr/",
      "site_domain": "motoplex.ca",
      "search_keywords": ["motoplex", "st-eustache", ...],
      "scraper_module": "motoplex",
      "description": "Concessionnaire powersports...",
      "is_active": true,
      "version": "2.0"
    }
  ],
  "count": 1,
  "query": "motoplex"
}
```

---

## Code Reference

**Search Bar Component:**
```
File: dashboard_web/src/components/scraper-config.tsx
Lines: 644-690
```

**API Endpoint:**
```
File: dashboard_web/src/app/api/shared-scrapers/search/route.ts
```

**Database Migration:**
```
File: dashboard_web/supabase/migration_shared_scrapers_motoplex.sql
```

---

## Summary Checklist

Use this checklist when reporting results:

- [ ] Navigated to http://localhost:3000
- [ ] Page loaded successfully
- [ ] Logged in (if required)
- [ ] Found "Configurer le scraping" section
- [ ] Found search bar with "Rechercher..." placeholder
- [ ] Typed "motoplex" (2+ characters)
- [ ] Dropdown appeared within 2 seconds
- [ ] "Motoplex St-Eustache" displayed correctly
- [ ] Domain "motoplex.ca" displayed correctly
- [ ] Action buttons visible
- [ ] Cleared and typed "st-eustache"
- [ ] Same result appeared
- [ ] No errors in browser console
- [ ] Screenshots captured

---

**End of Manual Test Guide**

For questions or issues, refer to `SEARCH_BAR_TEST_REPORT.md` for technical details.
