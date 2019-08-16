// expects a directory of headerless dsv files of trip data with space-separated columns:
// latitude, longitude, occupied (boolean), timestamp (seconds since epoch)
// ex: 37.75119 -122.39341 0 1213082433
// each file should be named `new_[CABID].txt`
// NOTE: the OS newline should match the NEWLINE constant in this file
// also note, the input has points listed in reverse chron - the output has the points listed in chron for each cab

// OUTPUTS: 32FloatArray with the following values
// cab id
// trajectory length
// pt1 timestamp (minutes of week)
// pt1 occupied (boolean)
// pt1 direction (radians)
// pt1 longitude
// pt1 latitude
// pt2 timestamp
// pt2 occupied
// pt2 direction
// pt2 longitude
// pt2 latitude
// ...

const fs = require('fs')
const path = require('path')
const workerFarm = require('worker-farm')
const processFile = workerFarm(require.resolve('./process-file'))

const DATA_DIR = path.join(process.cwd(), 'data/cabspottingdata/')

const filenames = fs.readdirSync(DATA_DIR)
  .filter(filename => filename.slice(0, 4) === 'new_')
  .map(filename => path.join(DATA_DIR, filename))

let returned = 0

filenames.forEach((filename, i) => {
  processFile([filename, i], (err, buffer) => {
    returned += 1
    if (err) throw err
    buffer = Buffer.from(buffer)
    process.stdout.write(buffer)
    if (returned === filenames.length) onComplete()
  })
})

function onComplete () {
  workerFarm.end(processFile)
}
