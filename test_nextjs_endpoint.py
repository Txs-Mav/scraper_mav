#!/usr/bin/env python3
"""
Test Next.js data endpoint for pagination
"""
import requests
import re
import json

def test_nextjs_endpoint():
    print("="*80)
    print("TESTING NEXT.JS DATA ENDPOINT")
    print("="*80)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.motoplex.ca/fr/inventaire-neuf/'
    }
    
    # Get main page
    print("\n1. Fetching main page to find build ID...")
    response = requests.get("https://www.motoplex.ca/fr/inventaire-neuf/", headers=headers)
    html = response.text
    
    print(f"Status: {response.status_code}")
    print(f"HTML Length: {len(html)} characters")
    
    # Try multiple patterns to find build ID
    print("\n2. Searching for build ID...")
    
    patterns = [
        r'"buildId":"([^"]+)"',
        r'buildId:\"([^"]+)\"',
        r'"b":"([^"]+)"',  # Shortened version
        r'/_next/data/([^/]+)/',
    ]
    
    build_id = None
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            build_id = match.group(1)
            print(f"✅ Found build ID with pattern '{pattern}': {build_id}")
            break
    
    if not build_id:
        print("❌ Could not find build ID")
        print("\nTrying to find any /_next/data/ references...")
        next_data_refs = re.findall(r'/_next/data/[^"\']+', html)
        if next_data_refs:
            print(f"Found {len(next_data_refs)} /_next/data/ references:")
            for ref in next_data_refs[:5]:
                print(f"  {ref}")
        return
    
    # Test data endpoint
    print("\n3. Testing data endpoints...")
    
    base_urls = [
        f"https://www.motoplex.ca/_next/data/{build_id}/fr/inventaire-neuf.json",
        f"https://www.motoplex.ca/_next/data/{build_id}/fr/inventaire-neuf",
        f"https://www.motoplex.ca/_next/data/{build_id}/inventaire-neuf.json",
    ]
    
    for base_url in base_urls:
        print(f"\n--- Testing: {base_url} ---")
        
        for page_num in [None, 1, 2]:
            url = base_url
            if page_num:
                url += f"?page={page_num}"
            
            print(f"\nRequest: {url}")
            
            try:
                data_response = requests.get(url, headers=headers, timeout=10)
                print(f"Status: {data_response.status_code}")
                
                if data_response.status_code == 200:
                    print("✅ SUCCESS!")
                    
                    try:
                        data = data_response.json()
                        print(f"Response keys: {list(data.keys())}")
                        
                        # Try to find vehicle data
                        if 'pageProps' in data:
                            props = data['pageProps']
                            print(f"  pageProps keys: {list(props.keys())}")
                            
                            if 'results' in props:
                                results = props['results']
                                print(f"    results keys: {list(results.keys())}")
                                
                                if 'pagination' in results:
                                    pag = results['pagination']
                                    print(f"    ✅ Pagination: page={pag.get('page')}, per_page={pag.get('per_page')}, total={pag.get('total')}")
                                
                                if 'data' in results and 'items' in results['data']:
                                    items = results['data']['items']
                                    print(f"    ✅ Found {len(items)} vehicles!")
                                    
                                    if items:
                                        first = items[0]
                                        print(f"\n    First vehicle:")
                                        print(f"      Stock: {first.get('stockNumber')}")
                                        print(f"      Name: {first.get('label')}")
                                        print(f"      Price: {first.get('salePriceValue')}")
                                    
                                    # Save sample
                                    with open(f'nextjs_page_{page_num or 1}.json', 'w') as f:
                                        json.dump(data, f, indent=2)
                                    print(f"    💾 Saved to: nextjs_page_{page_num or 1}.json")
                                    
                                    return True  # Success!
                        
                        # Print first 500 chars of response
                        print(f"\nResponse preview:\n{json.dumps(data, indent=2)[:500]}...")
                        
                    except json.JSONDecodeError:
                        print(f"❌ Response is not valid JSON")
                        print(f"Response (first 200 chars): {data_response.text[:200]}")
                
                elif data_response.status_code == 404:
                    print("❌ Not found (404)")
                else:
                    print(f"❌ Error status: {data_response.status_code}")
                    
            except Exception as e:
                print(f"❌ Request failed: {e}")
    
    print("\n" + "="*80)
    print("ENDPOINT TEST COMPLETE")
    print("="*80)
    print("\n⚠️  No working Next.js data endpoint found.")
    print("Recommendation: Use browser automation (Playwright) for pagination.")
    
    return False


if __name__ == "__main__":
    success = test_nextjs_endpoint()
    
    if not success:
        print("\n" + "="*80)
        print("ALTERNATIVE: Try extracting data from page source")
        print("="*80)
        print("\nThe vehicle data is embedded in the JavaScript bundles.")
        print("You can either:")
        print("1. Use Playwright to click through pages (RECOMMENDED)")
        print("2. Parse the embedded JSON from self.__next_f.push() calls")
