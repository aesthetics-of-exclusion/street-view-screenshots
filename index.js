#!/usr/bin/env node

const fs = require('fs')
const tempy = require('tempy')
const del = require('del')
const puppeteer = require('puppeteer')

const { db, uploadFile, addAnnotation, getAnnotations } = require('../database/google-cloud')

const argv = require('yargs')
  .option('city', {
    alias: 'c',
    type: 'string',
    describe: 'City',
    demandOption: true
  })
  .argv

const TIMEOUT = 4000

const dimensions = [2880, 1800]

class StreetViewError extends Error {
  constructor (message, address, url) {
    super(message)
    this.name = 'StreetViewError'
    this.address = address
    this.url = url
  }
}

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

async function saveScreenshot (page, path) {
  await remove(page, '#titlecard')
  await remove(page, '#minimap')
  await remove(page, '#image-header')
  await remove(page, '#fineprint')
  await remove(page, '.app-viewcard-strip')

  await page.screenshot({path})
}

async function takeScreenshot (address, dimensions) {
  const url = `https://www.google.nl/maps/place/${encodeURIComponent(address)}`
  console.log(`Taking Street View screenshot for address ${address}...`)
  console.log('  ', url)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  })
  const page = await browser.newPage()

  try {
    await page.goto(url)
    await page.setViewport({
      width: dimensions[0],
      height: dimensions[1]
    })

    await page.waitFor(TIMEOUT * 2)

    await clickAndWait(page, 'button.section-hero-header-image-hero-clickable')
    await clickAndWait(page, 'button.widget-pane-toggle-button')
    await clickAndWait(page, '#pushdown a:last-child')

    const fineprint = await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      if (element) {
        return Promise.resolve(element.textContent)
      }
    }, '.fineprint-item.fineprint-padded.fineprint-copyrights')

    const matched = fineprint.match(/\d{4}/)
    let year
    if (matched) {
      year = parseInt(matched[0])
    }

    const streetViewUrl = page.url()

    const regexNum = '(-?\\d+\\.?\\d*)'
    const streetViewRegex = new RegExp(`@${regexNum},${regexNum},${regexNum}a,${regexNum}y,${regexNum}h,${regexNum}t`)
    const match = streetViewUrl.match(streetViewRegex)

    if (match) {
      const latitude = match[1]
      const longitude = match[2]
      const a = match[3]
      const y = match[4]
      const h = match[5]
      const t = match[6]

      const annotation = {
        dimensions,
        url: streetViewUrl,
        a: parseFloat(a),
        fov: parseFloat(y),
        heading: parseFloat(h),
        pitch: parseFloat(t) - 90,
        year,
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        }
      }

      const filename = tempy.file({extension: 'jpg'})
      await saveScreenshot(page, filename)

      return {
        filename,
        annotation
      }
    } else {
      throw new StreetViewError(`No Street View found at ${address}`, address, url)
    }
  } catch (err) {
    throw err
  } finally {
    await browser.close()
  }
}

const annotationType = 'screenshot'
const city = argv.city

db.collection('pois')
  .where('annotations.screenshot', '==', 0)
  .limit(1)
  .get()
  .then(async (snapshot) => {
    if (snapshot.empty) {
      console.log('No screenshots to be taken')
      return
    }

    for (const poi of snapshot.docs) {
      console.log(`Processing POI ${poi.id}:`)
      try {
        const addressAnnotations = await getAnnotations(poi.id, ['address'])
        const addressAnnotation = addressAnnotations.docs[0].data().data
        const address = addressAnnotation.address

        const contentType = 'image/jpeg'
        const {annotation, filename} = await takeScreenshot(address, dimensions)

        const buffer = fs.readFileSync(filename)
        const { url } = await uploadFile(city, poi.id, annotationType, buffer, 'streetView.jpg', contentType)

        await addAnnotation(poi.id, annotationType, {
          ...annotation,
          screenshotUrl: url
        })

        await del(filename, {
          force: true
        })
      } catch (err) {
        let annotation = {
          error: err.message
        }

        if (err.name === 'StreetViewError') {
          annotation = {
            ...annotation,
            address: err.address,
            url: err.url
          }
        }

        await addAnnotation(poi.id, annotationType, annotation)
        console.error(err)
      }
    }
  })
