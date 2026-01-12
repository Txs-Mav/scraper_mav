import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const CONFIG_FILE = path.join(process.cwd(), '..', 'scraper_config.json')

export async function GET() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return NextResponse.json({
        referenceUrl: "",
        urls: [],
        priceDifferenceFilter: null
      })
    }

    const fileContents = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const config = JSON.parse(fileContents)
    
    return NextResponse.json(config)
  } catch (error: any) {
    console.error('Error reading scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to load config', message: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    const config = {
      referenceUrl: body.referenceUrl || "",
      urls: body.urls || [],
      priceDifferenceFilter: body.priceDifferenceFilter ?? null,
      updatedAt: new Date().toISOString()
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
    
    return NextResponse.json({ success: true, config })
  } catch (error: any) {
    console.error('Error saving scraper config:', error)
    return NextResponse.json(
      { error: 'Failed to save config', message: error.message },
      { status: 500 }
    )
  }
}

