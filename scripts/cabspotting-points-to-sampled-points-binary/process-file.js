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
const { DateTime } = require('luxon')
const vec2 = require('gl-vec2')

const NEWLINE = '\r\n'
const DIRECTION_LOOKAHEAD = 1

module.exports = function processFile ([filename, cabId], cb) {
  const pts = []
  const contents = fs.readFileSync(filename, 'utf-8')
  const lines = contents.split(NEWLINE)
  // the input has the points in reverse-chron
  lines.reverse()
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue
    let [latitude, longitude, occupied, timestamp] = lines[i].split(' ')
    longitude = parseFloat(longitude)
    latitude = parseFloat(latitude)

    const date = DateTime.fromMillis(timestamp * 1000, { zone: 'America/Los_Angeles' })
    const minutesOfWeek = (date.weekday - 1) * 24 * 60 + date.hour * 60 + date.minute

    const lookahead = Math.min(lines.length - i - 1, DIRECTION_LOOKAHEAD)
    const avgNextPt = lookahead ? [0, 0] : [longitude, latitude]
    let j = lookahead
    while (j--) {
      const scaled = vec2.scale([], lines[i + j + 1], 1 / lookahead)
      vec2.add(avgNextPt, avgNextPt, scaled)
    }
    const vecDirection = vec2.subtract(avgNextPt, avgNextPt, [longitude, latitude])
    let direction = Math.atan2(vecDirection[1], vecDirection[0])
    if (direction < 0) direction += Math.PI * 2 // put the output in the range of [0 -> 6.28...]
    if (vec2.length(vecDirection) < Number.EPSILON) {
      direction = -1 // setting direction to -1 if there is no direction
    }

    pts.push([
      minutesOfWeek,
      occupied === '0' ? 0 : 1,
      direction,
      longitude,
      latitude
    ])
  }

  const floats = new Float32Array(2 + pts.length * pts[0].length)
  let j = 0
  floats[j++] = cabId
  floats[j++] = pts.length
  for (const pt of pts) {
    for (const val of pt) {
      floats[j++] = val
    }
  }

  cb(null, Buffer.from(floats.buffer))
}
