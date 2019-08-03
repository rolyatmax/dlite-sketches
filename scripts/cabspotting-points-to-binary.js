
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
// pt1 longitude
// pt1 latitude
// pt2 timestamp
// pt2 occupied
// pt2 longitude
// pt2 latitude
// ...

const fs = require('fs')
const path = require('path')
const { DateTime } = require('luxon')

const NEWLINE = '\r\n'

const DATA_DIR = path.join(process.cwd(), 'data/cabspottingdata/')
const files = fs.readdirSync(DATA_DIR)

let cabCount = 0

for (const filename of files) {
  if (filename.slice(0, 4) !== 'new_') continue
  const cabId = cabCount++
  const pts = []
  const contents = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8')
  const lines = contents.split(NEWLINE)
  for (const input of lines) {
    if (!input) continue
    const [latitude, longitude, occupied, timestamp] = input.split(' ')
    const minutesOfWeek = getMinutesOfWeek(timestamp)
    // unshifting because the input has the points in reverse-chron
    pts.unshift([minutesOfWeek, occupied, longitude, latitude])
  }

  writeCabTrajectory(cabId, pts)
}

function writeCabTrajectory (cabId, trajectory) {
  const floats = new Float32Array(2 + trajectory.length * 4)
  let j = 0
  floats[j++] = cabId
  floats[j++] = trajectory.length
  for (const [minutesOfWeek, occupied, lng, lat] of trajectory) {
    floats[j++] = minutesOfWeek
    floats[j++] = occupied === '0' ? 0 : 1
    floats[j++] = parseFloat(lng)
    floats[j++] = parseFloat(lat)
  }
  process.stdout.write(Buffer.from(floats.buffer))
}

function getMinutesOfWeek (timestamp) {
  const date = DateTime.fromMillis(timestamp * 1000, { zone: 'America/Los_Angeles' })
  return (date.weekday - 1) * 24 * 60 + date.hour * 60 + date.minute
}
