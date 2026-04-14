# MANUAL TEST GUIDE: Search Bar Functionality

## Test Setup

**URL:** http://localhost:3000  
**Component:** "Configurer le scraping" section  
**Search Input:** Placeholder "Rechercher..."

---

## ⚠️ AUTOMATED TESTING STATUS

**Issue:** Playwright browser automation unavailable in current environment.  
**Reason:** Browser binaries not accessible in sandbox.  
**Solution:** Manual testing required.

---

## STEP-BY-STEP MANUAL TEST PROCEDURE

### Prerequisites

1. ✅ Dev server running at http://localhost:3000
2. ⚠️ User authentication required (login first)
3. ✅ Database migration `migration_shared_scrapers_motoplex.sql` must be run

---

### Test Procedure

#### Step 1: Navigate and Login

1. Open browser to http://localhost:3000
2. If redirected to login, use valid credentials
3. Wait 5 seconds for page to fully load

#### Step 2: Locate Search Bar

**Expected Location:**
- Section titled "Configurer le scraping"
- Search input with magnifying glass icon
- Placeholder text: "Rechercher..."

**If not immediately visible:**
- Scroll down the page
- Look for a configuration or setup section
- May be below dashboard overview

**Visual Appearance:**
```
┌─────────────────────────────────────────┐
│ Configurer le scraping                  │
├─────────────────────────────────────────┤
│ 🔍 [  Rechercher...              ] ⟳    │
└─────────────────────────────────────────┘
```

#### Step 3: Test Search - "motoplex"

1. **Click** in search input
2. **Type:** `motoplex`
3. **Wait:** 2 seconds (300ms debounce + API call)
4. **Observe:** Dropdown should appear below search bar

**Expected Result:**

```
┌──────────────────────────────────────────────┐
│ ✨ Scrapers Universels                       │
├──────────────────────────────────────────────┤
│ Motoplex St-Eustache                   ⭐    │
│ motoplex.ca                                  │
│ Concessionnaire powersports et marine à...  │
│                                              │
│ [+ Ajouter comme référence]                 │
│ [+ Ajouter comme concurrent]                │
└──────────────────────────────────────────────┘
```

**Verification Checklist:**
- [ ] Dropdown appears
- [ ] "Motoplex St-Eustache" shown (exact name)
- [ ] Domain "motoplex.ca" displayed
- [ ] Description visible
- [ ] Two action buttons present
- [ ] No errors in browser console (F12)

**Screenshot:** Take screenshot named `search_motoplex.png`

#### Step 4: Test Search - "st-eustache"

1. **Clear** search input (Backspace or select all + delete)
2. **Type:** `st-eustache`
3. **Wait:** 2 seconds
4. **Observe:** Results should update

**Expected Result:**

Same as above - "Motoplex St-Eustache" should still appear because:
- `site_name` contains "St-Eustache"
- `search_keywords` array includes "st-eustache"

**Verification Checklist:**
- [ ] Dropdown updates
- [ ] "Motoplex St-Eustache" still shown
- [ ] Domain "motoplex.ca" displayed
- [ ] No duplicate results
- [ ] Loading indicator appeared briefly

**Screenshot:** Take screenshot named `search_st_eustache.png`

---

## EXPECTED API RESPONSE

When you type "motoplex", the browser makes this request:

**Request:**
```
GET /api/shared-scrapers/search?q=motoplex
Authorization: Bearer <token>
```

**Expected Response:**
```json
{
  "scrapers": [
    {
      "id": "uuid-here",
      "site_name": "Motoplex St-Eustache",
      "site_slug": "motoplex",
      "site_url": "https://www.motoplex.ca/fr/",
      "site_domain": "motoplex.ca",
      "search_keywords": [
        "motoplex",
        "st-eustache",
        "saint-eustache",
        "cfmoto",
        "arctic cat",
        "suzuki",
        "starcraft",
        "royal enfield",
        "campagna",
        "trex",
        "t-rex",
        "laurentides",
        "motoplexsteustache"
      ],
      "scraper_module": "motoplex",
      "description": "Concessionnaire powersports et marine à Saint-Eustache, QC (Laurentides). Motos, VTT, côte-à-côte, motomarines, pontons, motoneiges. Plateforme Next.js/PowerGO. Sitemap utilisé pour découverte complète (pagination JS-only).",
      "categories": ["inventaire", "occasion"],
      "vehicle_types": [
        "moto",
        "quad",
        "vtt",
        "cote-a-cote",
        "motomarine",
        "ponton",
        "bateau",
        "moteur-hors-bord",
        "motoneige",
        "t-rex",
        "equipement-mecanique"
      ],
      "extracted_fields": [
        "name",
        "prix",
        "marque",
        "modele",
        "annee",
        "etat",
        "kilometrage",
        "couleur",
        "image",
        "inventaire",
        "vin",
        "vehicule_type",
        "vehicule_categorie",
        "description"
      ],
      "is_active": true,
      "logo_url": null,
      "version": "2.0"
    }
  ],
  "count": 1,
  "query": "motoplex"
}
```

---

## TESTING CHECKLIST

### Visual Elements

- [ ] Search input exists
- [ ] Placeholder text is correct
- [ ] Magnifying glass icon visible
- [ ] Input styling is clean
- [ ] Focus state works (border color change)

### Search Behavior

- [ ] Typing triggers search
- [ ] Debounce delay works (300ms)
- [ ] Loading spinner appears during search
- [ ] Results appear below input
- [ ] Results dropdown has proper styling
- [ ] "Scrapers Universels" header visible with sparkle icon

### Result Display

- [ ] Site name bold and prominent
- [ ] Domain in smaller, gray text
- [ ] Description text visible
- [ ] Action buttons clearly labeled
- [ ] Hover states work on results
- [ ] Click on result selects it

### Edge Cases

- [ ] Type 1 character → No results (minimum 2 chars)
- [ ] Type 2 characters → Search triggers
- [ ] Clear input → Results disappear
- [ ] Type gibberish → "No results" message
- [ ] Fast typing → Only one search fires (debounced)

---

## TROUBLESHOOTING

### Issue: Search bar not visible

**Check:**
1. Are you logged in? (Authentication required)
2. Is the page fully loaded?
3. Scroll down - may be below fold
4. Check browser console for errors

### Issue: "Not authenticated" error

**Solution:**
1. Click logout (if available)
2. Login again with valid credentials
3. Check that session cookie exists (F12 → Application → Cookies)

### Issue: No results for "motoplex"

**Check:**
1. Database migration run? Check Supabase:
   ```sql
   SELECT site_name, site_slug FROM shared_scrapers WHERE site_slug = 'motoplex';
   ```
2. Check browser Network tab (F12) for API call
3. Look at API response - is there an error?
4. Check that `is_active = true` in database

### Issue: Dropdown doesn't appear

**Check:**
1. Browser console for JavaScript errors
2. Network tab - is API call being made?
3. CSS issue - try inspecting element
4. React state issue - check React DevTools

---

## BROWSER CONSOLE DEBUGGING

Open browser console (F12) and run:

```javascript
// Check if component is rendered
document.querySelector('input[placeholder*="Rechercher"]')

// Check current search results state (in React DevTools)
// Look for: sharedSearchResults

// Manually trigger API call
fetch('/api/shared-scrapers/search?q=motoplex')
  .then(r => r.json())
  .then(console.log)
```

---

## ALTERNATIVE: Test API Directly

If UI testing fails, verify API works:

```bash
# Get auth token from browser cookies
# Then:
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/shared-scrapers/search?q=motoplex"
```

Or use Postman/Insomnia to test the API endpoint.

---

## REPORTING RESULTS

When reporting back, include:

1. **Screenshots:**
   - Initial page view
   - Search with "motoplex"
   - Search with "st-eustache"

2. **Observations:**
   - Exact site name shown
   - Domain shown
   - Any badges or icons
   - Button text
   - Any errors or warnings

3. **Console Output:**
   - Any errors in console
   - Network requests made
   - Response data

4. **Issues Found:**
   - What doesn't work as expected
   - Error messages
   - Missing elements

---

## SUCCESS CRITERIA

✅ **Test passes if:**

1. Search input is found and functional
2. Typing "motoplex" shows "Motoplex St-Eustache"
3. Domain "motoplex.ca" is displayed
4. Typing "st-eustache" also shows "Motoplex St-Eustache"
5. No errors in console
6. UI is responsive and clean
7. Action buttons are present

---

**MANUAL TEST GUIDE COMPLETE**

Use this guide to perform thorough manual testing of the search functionality.
