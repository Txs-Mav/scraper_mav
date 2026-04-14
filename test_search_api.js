#!/usr/bin/env node
/**
 * Test the shared scrapers search API directly
 */
const https = require('https');
const url = require('url');

// Supabase credentials from .env.local
const SUPABASE_URL = 'https://nvvvtlbfhiwffnrrtgfg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52dnZ0bGJmaGl3ZmZucnJ0Z2ZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzE2MTE2NywiZXhwIjoyMDgyNzM3MTY3fQ.coaSoZyzrSSUV4HobzHpJ8bgjy72mJEWdcXgVyDDzJM';

console.log('='.repeat(80));
console.log('TESTING SHARED SCRAPERS SEARCH');
console.log('='.repeat(80));

// Check if Motoplex exists in database
async function queryDatabase(searchTerm) {
  return new Promise((resolve, reject) => {
    const apiUrl = `${SUPABASE_URL}/rest/v1/shared_scrapers?select=*&is_active=eq.true&or=(site_name.ilike.*${searchTerm}*,site_slug.ilike.*${searchTerm}*,site_domain.ilike.*${searchTerm}*,search_keywords.cs.{${searchTerm}})`;
    
    const parsedUrl = url.parse(apiUrl);
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    console.log(`\n📡 Querying database for: "${searchTerm}"`);
    console.log(`   URL: ${apiUrl.substring(0, 100)}...`);
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const results = JSON.parse(data);
            resolve(results);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.end();
  });
}

async function testSearch() {
  try {
    // Test 1: Search for "motoplex"
    console.log('\n' + '='.repeat(80));
    console.log('TEST 1: Search for "motoplex"');
    console.log('='.repeat(80));
    
    const results1 = await queryDatabase('motoplex');
    
    if (results1.length > 0) {
      console.log(`\n✅ Found ${results1.length} result(s):\n`);
      
      results1.forEach((scraper, i) => {
        console.log(`Result #${i + 1}:`);
        console.log(`  Site Name: ${scraper.site_name}`);
        console.log(`  Site Slug: ${scraper.site_slug}`);
        console.log(`  Site URL: ${scraper.site_url}`);
        console.log(`  Site Domain: ${scraper.site_domain}`);
        console.log(`  Search Keywords: ${scraper.search_keywords ? scraper.search_keywords.join(', ') : 'N/A'}`);
        console.log(`  Module: ${scraper.scraper_module}`);
        console.log(`  Version: ${scraper.version}`);
        console.log(`  Active: ${scraper.is_active}`);
        
        if (scraper.description) {
          console.log(`  Description: ${scraper.description.substring(0, 100)}...`);
        }
        
        console.log('');
      });
      
      // Check specifically for Motoplex St-Eustache
      const motoplexFound = results1.find(s => 
        s.site_name && s.site_name.toLowerCase().includes('motoplex')
      );
      
      if (motoplexFound) {
        console.log('✅ "Motoplex St-Eustache" FOUND in search results!');
      } else {
        console.log('❌ "Motoplex St-Eustache" NOT found in results');
      }
    } else {
      console.log('\n❌ No results found for "motoplex"');
    }
    
    // Test 2: Search for "st-eustache"
    console.log('\n' + '='.repeat(80));
    console.log('TEST 2: Search for "st-eustache"');
    console.log('='.repeat(80));
    
    const results2 = await queryDatabase('st-eustache');
    
    if (results2.length > 0) {
      console.log(`\n✅ Found ${results2.length} result(s):\n`);
      
      results2.forEach((scraper, i) => {
        console.log(`Result #${i + 1}:`);
        console.log(`  Site Name: ${scraper.site_name}`);
        console.log(`  Site Domain: ${scraper.site_domain}`);
        console.log('');
      });
      
      const motoplexFound = results2.find(s => 
        s.site_name && s.site_name.toLowerCase().includes('motoplex')
      );
      
      if (motoplexFound) {
        console.log('✅ "Motoplex St-Eustache" FOUND in search results!');
      } else {
        console.log('❌ "Motoplex St-Eustache" NOT found in results');
      }
    } else {
      console.log('\n❌ No results found for "st-eustache"');
    }
    
    // Test 3: Get all active scrapers
    console.log('\n' + '='.repeat(80));
    console.log('TEST 3: List ALL active scrapers in database');
    console.log('='.repeat(80));
    
    const allScrapers = await new Promise((resolve, reject) => {
      const apiUrl = `${SUPABASE_URL}/rest/v1/shared_scrapers?select=site_name,site_slug,site_domain,is_active&is_active=eq.true&order=site_name.asc`;
      
      const parsedUrl = url.parse(apiUrl);
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: 'GET',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
    
    console.log(`\n📊 Total active scrapers: ${allScrapers.length}\n`);
    
    if (allScrapers.length > 0) {
      allScrapers.forEach((scraper, i) => {
        console.log(`${i + 1}. ${scraper.site_name} (${scraper.site_domain})`);
      });
    } else {
      console.log('❌ No scrapers found in database!');
      console.log('\n⚠️  The migration may not have been run yet.');
      console.log('   Run: dashboard_web/supabase/migration_shared_scrapers_motoplex.sql');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack:', error.stack);
  }
}

testSearch();
