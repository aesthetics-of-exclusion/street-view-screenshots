#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

const argv = require('yargs')
  .option('feature', {
    alias: 'f',
    describe: 'GeoJSON feature',
    conflicts: 'url'
  })
  .option('url', {
    alias: 'u',
    describe: 'Google Maps URL',
    conflicts: 'feature'
  })
  .argv

const TIMEOUT = 4000

const dimensions = [2880, 1800]

async function remove (page, selector) {
  await page.evaluate((selector) => {
    const element = document.querySelector(selector)
    if (element) {
      element.remove()
    }
  }, selector)
}

async function clickAndWait (page, selector) {
  const elements = await page.$$(selector)

  let clicked = false

  for (let element of elements) {
    try {
      await element.click(selector, {waitUntil: 'domcontentloaded'})
    } catch (err) {
      // console.error('Could not click element!')
    }

    clicked = true
  }

  if (!clicked) {

  }

  // await page.click(selector, {waitUntil: 'domcontentloaded'})
  // await page.waitForNavigation({ waitUntil: 'networkidle0' })

  await page.waitFor(TIMEOUT)
}

async function screenshot (page, path) {
  await remove(page, '#titlecard')
  await remove(page, '#minimap')
  await remove(page, '#image-header')
  await remove(page, '#fineprint')
  await remove(page, '.app-viewcard-strip')

  await page.screenshot({path})
}

async function start (url, feature, dimensions) {
  let address

  if (!url) {
    if (feature.properties.address) {
      address = feature.properties.address
      url = `https://www.google.nl/maps/place/${encodeURIComponent(address)}`
    } else {
      console.error('No address found in POI data')
      return
    }
  }

  if (address) {
    console.log(`Taking Street View screenshot for address ${address}...`)
  } else {
    console.log(`Taking Street View screenshot of ${url}...`)
  }

  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  await page.goto(url)
  await page.setViewport({
    width: dimensions[0],
    height: dimensions[1]
  })

  await page.waitFor(TIMEOUT * 2)

  await clickAndWait(page, 'button.section-hero-header-image-hero-clickable')
  await clickAndWait(page, 'button.widget-pane-toggle-button')
  await clickAndWait(page, '#pushdown a:last-child')

  const browserUrl = page.url()

  const regexNum = '(-?\\d+\\.?\\d*)'
  const streetViewRegex = new RegExp(`@${regexNum},${regexNum},${regexNum}a,${regexNum}y,${regexNum}h,${regexNum}t`)
  const match = browserUrl.match(streetViewRegex)

  // console.log(match)

  if (match) {
    const latitude = match[1]
    const longitude = match[2]
    const a = match[3]
    const y = match[4]
    const h = match[5]
    const t = match[6]

    let id
    if (address) {
      id = address.toLowerCase().replace(/\s+/g, '+')
    } else {
      id = match.slice(1, 6).join('-')
    }

    const meta = {
      id,
      streetView: {
        dimensions,
        url,
        a: parseFloat(a),
        fov: parseFloat(y),
        heading: parseFloat(h),
        pitch: parseFloat(t) - 90,
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        }
      },
      osm: feature
    }

    const screenshotPath = path.join('screenshots', `${id}.jpg`)
    const metaPath = path.join('screenshots', `${id}.json`)

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

    await screenshot(page, screenshotPath)
  }

  await browser.close()
}

if (argv.feature) {
  const feature = JSON.parse(argv.feature)
  start(undefined, feature, dimensions)
} else if (argv.url) {
  const url = argv.url
  start(url, undefined, dimensions)
} else {
  console.error('No URL or GeoJSON feature provided!')
}

