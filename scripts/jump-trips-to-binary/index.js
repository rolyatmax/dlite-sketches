/* global process, Buffer */

// expects raw jump trip data with columns:
// start_time,end_time,ST_ASGEOJSON(route)

// OUTPUTS: 32FloatArray with the following values
// trajectory length
// pt1 timestamp (minutes of week)
// pt1 direction (radians)
// pt1 longitude
// pt1 latitude
// pt2 timestamp
// pt2 direction
// pt2 longitude
// pt2 latitude
// ...

const workerFarm = require('worker-farm')
const readline = require('readline')
const { csvParseRows } = require('d3-dsv')
const processTripWorker = workerFarm(require.resolve('./process-trip'))
const argv = require('minimist')(process.argv.slice(2))

const sampleRate = Number(argv.sample)
const timezone = argv.timezone
const directionLookahead = parseInt(argv.directionLookahead, 10) ? parseInt(argv.directionLookahead, 10) : 1
if (!sampleRate || !timezone || argv.h || argv.help) {
  process.stderr.write('\n')
  process.stderr.write('Must pass in sample rate as a flag.\n')
  process.stderr.write(
    'Usage:\n\n  cat data.csv | node jump-trips-to-binary/index.js --sample 0.05 --timezone America/Los_Angeles --directionLookahead 1'
  )
  process.stderr.write('\n\n')
  process.exit()
}

const rl = readline.createInterface({ input: process.stdin })

const MAX_QUEUE_LENGTH = 10000
const settings = { directionLookahead, timezone }

let getVal = null
let jobsStarted = 0
let jobsEnded = 0
let lastLineRead = false
let rlPaused = false

let isFirstLine = true
rl.on('line', input => {
  // prepare the columns map with the first line
  if (isFirstLine) {
    getVal = createValueGetter(input.split(','))
    isFirstLine = false
    return
  }

  if (Math.random() > sampleRate) return

  const values = csvParseRows(input)[0]

  const tripLineJSON = getVal(values, 'ST_ASGEOJSON(route)')
  if (!tripLineJSON) return
  const startTime = parseInt(getVal(values, 'start_time'), 10)
  const endTime = parseInt(getVal(values, 'end_time'), 10)

  jobsStarted += 1
  processTripWorker({ tripLineJSON, startTime, endTime }, settings, onWorkerComplete)

  // once we reach the max number of jobs in the queue, let's pause the
  // readline stream until we drop back below that threshold again.
  if (!rlPaused && jobsStarted - jobsEnded > MAX_QUEUE_LENGTH) {
    rl.pause()
    rlPaused = true
  }
})

rl.on('close', () => {
  lastLineRead = true
  if (lastLineRead && jobsStarted === jobsEnded) {
    onFarmComplete()
  }
})

function onWorkerComplete (error, data) {
  jobsEnded += 1
  if (error) {
    process.stderr.write('Error from Child Process:')
    throw new Error(error)
  }

  if (rlPaused && jobsStarted - jobsEnded < MAX_QUEUE_LENGTH) {
    rl.resume()
    rlPaused = false
  }

  const floats = new Float32Array(data)
  process.stdout.write(Buffer.from(floats.buffer))
  if (lastLineRead && jobsStarted === jobsEnded) {
    onFarmComplete()
  }
}

function onFarmComplete () {
  workerFarm.end(processTripWorker)
  process.exit()
}

function createValueGetter (columnNames) {
  const columns = {}
  columnNames.forEach((name, i) => {
    columns[name] = i
  })
  return (values, key) => values[columns[key]]
}
