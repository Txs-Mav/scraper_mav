#!/usr/bin/env python3
"""
Extract embedded vehicle data from page source
"""
import requests
import re
import json

def extract_embedded_data():
    print("="*80)
    print("EXTRACTING EMBEDDED DATA FROM PAGE SOURCE")
    print("="*80)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    
    print("\n1. Fetching page...")
    response = requests.get("https://www.motoplex.ca/fr/inventaire-neuf/", headers=headers)
    html = response.text
    
    print(f"Status: {response.status_code}")
    print(f"HTML Length: {len(html)} characters")
    
    # Save HTML for analysis
    with open('motoplex_source.html', 'w') as f:
        f.write(html)
    print("💾 Saved HTML to: motoplex_source.html")
    
    # Look for self.__next_f.push patterns
    print("\n2. Searching for self.__next_f.push patterns...")
    push_pattern = r'self\.__next_f\.push\((\[.*?\])\)'
    
    matches = re.findall(push_pattern, html, re.DOTALL)
    print(f"Found {len(matches)} self.__next_f.push() calls")
    
    if matches:
        print("\n3. Analyzing push calls...")
        
        all_vehicles = []
        
        for i, match in enumerate(matches):
            try:
                # Parse the array
                data = json.loads(match)
                
                # Check if it contains vehicle data
                if len(data) >= 2:
                    content = str(data[1])
                    
                    # Look for vehicle indicators
                    if any(keyword in content.lower() for keyword in ['stocknumber', 'vehicle', 'inventory', 'saleprice']):
                        print(f"\n--- Push #{i+1} (possibly contains vehicles) ---")
                        print(f"Data type: {type(data)}")
                        print(f"Length: {len(data)}")
                        print(f"First element: {data[0]}")
                        
                        # Try to extract JSON from the string
                        # The data is often escaped JSON string
                        if isinstance(data[1], str):
                            # Look for JSON objects in the string
                            json_objects = re.findall(r'\{[^{}]*"stockNumber"[^{}]*\}', data[1])
                            
                            if json_objects:
                                print(f"Found {len(json_objects)} potential vehicle objects")
                                
                                for obj_str in json_objects[:3]:
                                    try:
                                        # Unescape and parse
                                        obj_str = obj_str.replace('\\\\', '\\').replace('\\"', '"')
                                        obj = json.loads(obj_str)
                                        print(f"\nVehicle found:")
                                        print(f"  Stock: {obj.get('stockNumber')}")
                                        print(f"  Label: {obj.get('label')}")
                                        all_vehicles.append(obj)
                                    except:
                                        pass
                        
                        # Save this chunk for manual inspection
                        with open(f'push_chunk_{i}.json', 'w') as f:
                            json.dump(data, f, indent=2)
                        print(f"💾 Saved to: push_chunk_{i}.json")
                        
            except Exception as e:
                continue
        
        if all_vehicles:
            print(f"\n✅ Extracted {len(all_vehicles)} vehicles from embedded data!")
            
            with open('extracted_vehicles.json', 'w') as f:
                json.dump(all_vehicles, f, indent=2)
            print("💾 Saved to: extracted_vehicles.json")
            
            return True
    
    # Alternative: Look for NEXT_DATA script
    print("\n4. Looking for __NEXT_DATA__ script...")
    next_data_pattern = r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>'
    next_data_match = re.search(next_data_pattern, html, re.DOTALL)
    
    if next_data_match:
        print("✅ Found __NEXT_DATA__!")
        
        try:
            data = json.loads(next_data_match.group(1))
            
            with open('next_data.json', 'w') as f:
                json.dump(data, f, indent=2)
            print("💾 Saved to: next_data.json")
            
            # Navigate to vehicle data
            if 'props' in data:
                props = data['props']
                print(f"Props keys: {list(props.keys())}")
                
                if 'pageProps' in props:
                    page_props = props['pageProps']
                    print(f"pageProps keys: {list(page_props.keys())}")
                    
                    # Look for vehicles
                    if 'results' in page_props:
                        results = page_props['results']
                        if 'data' in results and 'items' in results['data']:
                            vehicles = results['data']['items']
                            print(f"✅ Found {len(vehicles)} vehicles in __NEXT_DATA__!")
                            return True
        except Exception as e:
            print(f"❌ Error parsing __NEXT_DATA__: {e}")
    else:
        print("❌ No __NEXT_DATA__ found")
    
    # Look for inline JSON
    print("\n5. Searching for inline JSON with vehicle data...")
    
    # Pattern for JSON objects with vehicle-like structure
    vehicle_pattern = r'\{[^}]*"stockNumber"[^}]*"label"[^}]*\}'
    
    inline_matches = re.findall(vehicle_pattern, html)
    print(f"Found {len(inline_matches)} potential inline vehicle JSON objects")
    
    if inline_matches:
        vehicles = []
        for match in inline_matches[:10]:
            try:
                # Clean up the JSON string
                cleaned = match.replace('\\', '')
                obj = json.loads(cleaned)
                vehicles.append(obj)
                print(f"  - {obj.get('stockNumber')}: {obj.get('label')}")
            except:
                pass
        
        if vehicles:
            with open('inline_vehicles.json', 'w') as f:
                json.dump(vehicles, f, indent=2)
            print(f"\n💾 Saved {len(vehicles)} vehicles to: inline_vehicles.json")
    
    print("\n" + "="*80)
    print("EXTRACTION COMPLETE")
    print("="*80)
    
    return False


if __name__ == "__main__":
    success = extract_embedded_data()
    
    if not success:
        print("\n⚠️  Could not reliably extract vehicle data from page source.")
        print("\n" + "="*80)
        print("CONCLUSION")
        print("="*80)
        print("\nThe Motoplex website uses complex Next.js client-side rendering.")
        print("\nBest approach: Use browser automation (Playwright/Selenium)")
        print("\nThe data is NOT easily accessible through:")
        print("  ❌ Direct API endpoints")
        print("  ❌ URL parameters (?page=2)")
        print("  ❌ Simple embedded JSON parsing")
        print("\n✅ MUST use browser automation to:")
        print("  1. Load the page")
        print("  2. Wait for JavaScript to render")
        print("  3. Click 'Suivant' button for each page")
        print("  4. Extract data from rendered DOM")
