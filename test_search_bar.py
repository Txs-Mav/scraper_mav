#!/usr/bin/env python3
"""
Test the search bar functionality in the local dev server
"""
import asyncio
from playwright.async_api import async_playwright

async def test_search_bar():
    print("="*80)
    print("TESTING SEARCH BAR IN CONFIGURER LE SCRAPING")
    print("="*80)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        print("\n1. Navigating to http://localhost:3000...")
        await page.goto("http://localhost:3000", wait_until='networkidle')
        
        print("2. Waiting 3 seconds for page to load...")
        await asyncio.sleep(3)
        
        print("3. Taking initial snapshot...")
        await page.screenshot(path='dev_server_initial.png', full_page=True)
        
        # Get page title
        title = await page.title()
        print(f"   Page title: {title}")
        
        # Look for "Configurer le scraping" section
        print("\n4. Looking for 'Configurer le scraping' section...")
        
        # Try multiple selectors
        config_selectors = [
            'h2:has-text("Configurer le scraping")',
            'h1:has-text("Configurer le scraping")',
            'text=Configurer le scraping',
            '[data-testid="config-section"]',
            '.config-section',
        ]
        
        config_found = False
        for selector in config_selectors:
            try:
                element = await page.query_selector(selector)
                if element:
                    print(f"   ✅ Found section with selector: {selector}")
                    config_found = True
                    break
            except:
                pass
        
        if not config_found:
            print("   ⚠️  'Configurer le scraping' section not found by text")
            print("   Checking page content...")
            
            # Get all h1, h2, h3 text
            headings = await page.eval_on_selector_all('h1, h2, h3, h4', 
                '''elements => elements.map(e => ({
                    tag: e.tagName,
                    text: e.innerText,
                    class: e.className
                }))''')
            
            print(f"\n   Found {len(headings)} headings:")
            for heading in headings[:10]:
                print(f"     - {heading['tag']}: {heading['text']}")
        
        # Look for search bar
        print("\n5. Looking for search bar (placeholder='Rechercher...')...")
        
        search_selectors = [
            'input[placeholder*="Rechercher"]',
            'input[type="search"]',
            'input[type="text"][placeholder]',
            '[role="searchbox"]',
        ]
        
        search_input = None
        for selector in search_selectors:
            try:
                search_input = await page.query_selector(selector)
                if search_input:
                    placeholder = await search_input.get_attribute('placeholder')
                    print(f"   ✅ Found search input: {selector}")
                    print(f"      Placeholder: {placeholder}")
                    break
            except Exception as e:
                pass
        
        if not search_input:
            print("   ❌ Search bar not found!")
            print("\n   Available input fields:")
            inputs = await page.query_selector_all('input')
            for i, inp in enumerate(inputs[:10]):
                try:
                    inp_type = await inp.get_attribute('type')
                    inp_placeholder = await inp.get_attribute('placeholder')
                    inp_name = await inp.get_attribute('name')
                    print(f"     Input #{i+1}: type={inp_type}, placeholder={inp_placeholder}, name={inp_name}")
                except:
                    pass
            
            await browser.close()
            return
        
        # Test search with "motoplex"
        print("\n6. Testing search with 'motoplex'...")
        await search_input.fill("motoplex")
        
        print("7. Waiting 1 second for debounced search...")
        await asyncio.sleep(1)
        
        print("8. Taking snapshot after 'motoplex' search...")
        await page.screenshot(path='dev_server_motoplex_search.png', full_page=True)
        
        # Look for results
        print("\n9. Looking for 'Motoplex St-Eustache' in results...")
        
        result_selectors = [
            'text=Motoplex St-Eustache',
            '[data-testid="search-result"]',
            '.search-result',
            'li:has-text("Motoplex")',
            'div:has-text("Motoplex St-Eustache")',
        ]
        
        motoplex_found = False
        result_text = None
        
        for selector in result_selectors:
            try:
                result = await page.query_selector(selector)
                if result:
                    result_text = await result.inner_text()
                    print(f"   ✅ Found result: {result_text}")
                    motoplex_found = True
                    
                    # Try to get more details (domain, etc.)
                    parent = await result.query_selector('..')
                    if parent:
                        parent_text = await parent.inner_text()
                        print(f"   Full result details:\n{parent_text}")
                    break
            except:
                pass
        
        if not motoplex_found:
            print("   ❌ 'Motoplex St-Eustache' not found in results")
            
            # Check what's visible on page
            print("\n   Checking visible text on page...")
            page_text = await page.inner_text('body')
            if 'motoplex' in page_text.lower():
                print("   ⚠️  'motoplex' found in page text")
                # Find the context
                lines = page_text.split('\n')
                for i, line in enumerate(lines):
                    if 'motoplex' in line.lower():
                        context = '\n'.join(lines[max(0, i-2):min(len(lines), i+3)])
                        print(f"\n   Context:\n{context}")
                        break
            else:
                print("   ❌ 'motoplex' not found anywhere on page")
        
        # Test search with "st-eustache"
        print("\n10. Testing search with 'st-eustache'...")
        await search_input.fill("")  # Clear
        await asyncio.sleep(0.5)
        await search_input.fill("st-eustache")
        
        print("11. Waiting 1 second for debounced search...")
        await asyncio.sleep(1)
        
        print("12. Taking final snapshot after 'st-eustache' search...")
        await page.screenshot(path='dev_server_st_eustache_search.png', full_page=True)
        
        # Look for results again
        print("\n13. Looking for 'Motoplex St-Eustache' in results...")
        
        st_eustache_found = False
        
        for selector in result_selectors:
            try:
                result = await page.query_selector(selector)
                if result:
                    result_text = await result.inner_text()
                    print(f"   ✅ Found result: {result_text}")
                    st_eustache_found = True
                    break
            except:
                pass
        
        if not st_eustache_found:
            print("   ❌ 'Motoplex St-Eustache' not found in results for 'st-eustache'")
        
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"✅ Search bar found: {search_input is not None}")
        print(f"{'✅' if motoplex_found else '❌'} 'motoplex' search shows Motoplex St-Eustache: {motoplex_found}")
        print(f"{'✅' if st_eustache_found else '❌'} 'st-eustache' search shows Motoplex St-Eustache: {st_eustache_found}")
        
        if result_text:
            print(f"\nResult text found: {result_text}")
        
        print("\n📸 Screenshots saved:")
        print("  - dev_server_initial.png")
        print("  - dev_server_motoplex_search.png")
        print("  - dev_server_st_eustache_search.png")
        
        await browser.close()


async def main():
    try:
        await test_search_bar()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
