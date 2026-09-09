#!/usr/bin/env node
/**
 * Stamp deployment configuration into the scene before a build or deploy.
 *
 * A Decentraland scene bundle is static — it cannot read environment variables at
 * runtime — so the World name and the server endpoint are written into the sources here,
 * from environment variables, immediately before building.
 *
 * Nothing in this repository claims ownership of any World namespace. Until
 * LINGER_WORLD_URN is set to a World you actually control, `scene.json` carries the
 * literal placeholder `LINGER_WORLD_URN` and deploying is refused.
 *
 *   LINGER_WORLD_URN     required to deploy   e.g. yourname.dcl.eth
 *   LINGER_SERVER_WSS    optional             e.g. wss://linger.example.com
 *
 * Usage:
 *   node scripts/configure-world.js          report current configuration
 *   node scripts/configure-world.js --write  stamp the values in
 *   node scripts/configure-world.js --check  exit non-zero if not deploy-ready
 */

const fs = require('fs')
const path = require('path')

const SCENE_ROOT = path.join(__dirname, '..')
const SCENE_JSON = path.join(SCENE_ROOT, 'scene.json')
const CONFIG_TS = path.join(SCENE_ROOT, 'src', 'linger', 'config.ts')

const PLACEHOLDER_WORLD = 'LINGER_WORLD_URN'
const PLACEHOLDER_WSS = 'wss://LINGER_SERVER_WSS'

const worldUrn = process.env.LINGER_WORLD_URN || ''
const serverWss = process.env.LINGER_SERVER_WSS || ''

const args = process.argv.slice(2)
const write = args.indexOf('--write') !== -1
const check = args.indexOf('--check') !== -1

function readScene() {
  return JSON.parse(fs.readFileSync(SCENE_JSON, 'utf8'))
}

function currentWorld() {
  const scene = readScene()
  return (scene.worldConfiguration && scene.worldConfiguration.name) || ''
}

function currentEndpoint() {
  const source = fs.readFileSync(CONFIG_TS, 'utf8')
  const match = source.match(/productionWss:\s*'([^']*)'/)
  return match ? match[1] : ''
}

function stamp() {
  if (!worldUrn) {
    console.error('LINGER_WORLD_URN is not set. Nothing was written.')
    console.error('Set it to a Decentraland World you control, e.g.:')
    console.error('  LINGER_WORLD_URN=yourname.dcl.eth npm run configure')
    process.exit(1)
  }

  const scene = readScene()
  scene.worldConfiguration = scene.worldConfiguration || {}
  scene.worldConfiguration.name = worldUrn
  fs.writeFileSync(SCENE_JSON, JSON.stringify(scene, null, 2) + '\n')
  console.log(`scene.json  worldConfiguration.name = ${worldUrn}`)

  if (serverWss) {
    const source = fs.readFileSync(CONFIG_TS, 'utf8')
    const next = source.replace(/(productionWss:\s*')[^']*(')/, `$1${serverWss}$2`)
    fs.writeFileSync(CONFIG_TS, next)
    console.log(`config.ts   productionWss = ${serverWss}`)
  } else {
    console.log('config.ts   productionWss unchanged (LINGER_SERVER_WSS not set)')
  }
}

function report() {
  const world = currentWorld()
  const endpoint = currentEndpoint()
  const worldReady = world && world !== PLACEHOLDER_WORLD
  const endpointReady = endpoint && endpoint !== PLACEHOLDER_WSS

  console.log('LINGER deployment configuration')
  console.log(`  World name : ${world || '(unset)'}${worldReady ? '' : '   <- placeholder'}`)
  console.log(`  Server WSS : ${endpoint || '(unset)'}${endpointReady ? '' : '   <- placeholder'}`)

  if (!worldReady) {
    console.log('')
    console.log('Not deploy-ready. This repository does not control any World namespace.')
    console.log('Run:  LINGER_WORLD_URN=yourname.dcl.eth npm run configure')
  }

  return !!worldReady
}

if (write) {
  stamp()
} else {
  const ready = report()
  if (check && !ready) process.exit(1)
}
