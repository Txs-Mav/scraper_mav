#!/usr/bin/env python3
"""
Manual test guide for the search bar
This script provides instructions since browser automation is not available
"""

print("="*80)
print("MANUAL SEARCH BAR TEST GUIDE")
print("="*80)

print("""
Since browser automation is not available in this environment, please follow
these manual testing steps:

STEP 1: Navigate to http://localhost:3000
---------------------------------------
- Open your browser
- Go to http://localhost:3000
- Wait 5 seconds for the page to fully load

STEP 2: Check if Login Required
--------------------------------
If you see a login page:
  - Use your credentials to log in
  - The search functionality requires authentication

STEP 3: Find the Search Bar
----------------------------
Look for:
  ✓ A section titled "Configurer le scraping"
  ✓ OR a search input with placeholder "Rechercher..."
  ✓ It should have a magnifying glass icon on the left

Location hints:
  - Might be near the top of the page
  - Look for a "Configuration" or "Setup" section
  - May need to scroll down slightly

STEP 4: Test Search - "motoplex"
---------------------------------
1. Click on the search input field
2. Type: motoplex
3. Wait 2 seconds (debounce delay is 300ms + API call time)
4. Observe the dropdown that appears

EXPECTED RESULT:
  ╔═══════════════════════════════════════════╗
  ║ ✨ Scrapers Universels                    ║
  ╠═══════════════════════════════════════════╣
  ║ Motoplex St-Eustache                      ║
  ║ motoplex.ca                               ║
  ║ [+ Référence] [+ Concurrent]              ║
  ╚═══════════════════════════════════════════╝

VERIFY:
  ✓ Dropdown appears
  ✓ "Motoplex St-Eustache" is shown as the site name
  ✓ "motoplex.ca" is shown as the domain
  ✓ Two buttons: "+ Référence" and "+ Concurrent"
  ✓ Optional: logo or badges might be visible

STEP 5: Test Search - "st-eustache"
------------------------------------
1. Clear the search input (backspace or select all + delete)
2. Type: st-eustache
3. Wait 2 seconds
4. Observe the dropdown

EXPECTED RESULT:
  Same as above - "Motoplex St-Eustache" should still appear
  because "st-eustache" is in the search keywords array

STEP 6: Test Other Searches (Optional)
---------------------------------------
Try these to verify keyword matching:
  - "saint-eustache" → should find Motoplex
  - "cfmoto" → should find Motoplex (brand keyword)
  - "suzuki" → should find Motoplex (brand keyword)
  - "laurentides" → should find Motoplex (region keyword)
  - "mvm" → should find MVM Moto Sport (if migration run)

STEP 7: Report Results
-----------------------
Please report back:
  1. Did the search bar appear? Where on the page?
  2. Did typing "motoplex" show results?
  3. Exact text displayed:
     - Site name: _________________
     - Domain: ___________________
     - Button labels: ____________
  4. Did "st-eustache" also find it?
  5. Any errors in browser console? (F12 → Console tab)
  6. Screenshot if possible

TROUBLESHOOTING:
----------------

IF NO RESULTS APPEAR:
  → Check browser console (F12) for errors
  → Verify you're logged in
  → Check network tab: is /api/shared-scrapers/search being called?
  → Response status should be 200
  
IF "Not authenticated" ERROR:
  → You need to log in first
  → API endpoint requires authentication

IF "No results found" MESSAGE:
  → Database migration may not have been run
  → Run: psql ... -f dashboard_web/supabase/migration_shared_scrapers_motoplex.sql

IF SEARCH BAR NOT VISIBLE:
  → Scroll down the page
  → Look for "Configurer le scraping" or "Configuration" section
  → Try refreshing the page
  → Check if you're on the correct page (home page vs dashboard)

""")

print("="*80)
print("For automated testing, browser automation requires:")
print("  - Playwright with installed browsers, or")
print("  - Selenium with ChromeDriver/GeckoDriver")
print("="*80)
