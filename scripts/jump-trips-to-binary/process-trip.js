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

const { DateTime } = require('luxon')
const vec2 = require('gl-vec2')

module.exports = function processTrip ({ tripLineJSON, startTime, endTime }, settings, callback) {
  const { directionLookahead, timezone } = settings
  const tripLine = JSON.parse(tripLineJSON)
  const path = tripLine.coordinates
  const startDatetime = DateTime.fromMillis(startTime, { zone: timezone })
  const tripDurationMillis = endTime - startTime

  const pts = []
  for (let i = 0; i < path.length; i++) {
    const [lon, lat] = path[i]

    // lets estimate when this point was visited by interpolating between start/end times
    // using this coords index in the path list
    const estimatedMillis = tripDurationMillis * i / path.length | 0
    const estimatedDatetime = startDatetime.plus(estimatedMillis)

    // in Luxon, Monday is 1 and Sunday is 7. Let's subtract 1 here so the workweek is
    // 0-4, and the weekend is 5-6
    const dayOfWeek = estimatedDatetime.weekday - 1
    const elapsedMinutesInWeek = dayOfWeek * 24 * 60 + estimatedDatetime.hour * 60 + estimatedDatetime.minute

    const lookahead = Math.min(path.length - i - 1, directionLookahead)
    const avgNextPt = lookahead ? [0, 0] : [lon, lat]
    let j = lookahead
    while (j--) {
      const scaled = vec2.scale([], path[i + j + 1], 1 / lookahead)
      vec2.add(avgNextPt, avgNextPt, scaled)
    }
    const vecDirection = vec2.subtract(avgNextPt, avgNextPt, [lon, lat])
    let rads = Math.atan2(vecDirection[1], vecDirection[0])
    if (rads < 0) rads += Math.PI * 2 // put the output in the range of [0 -> 6.28...]
    if (vec2.length(vecDirection) < Number.EPSILON) {
      rads = -1 // setting direction to -1 if there is no direction
    }

    pts.push([
      elapsedMinutesInWeek,
      rads,
      lon,
      lat
    ])
  }

  const trajectoryLength = pts.length
  const data = pts.flat()
  data.unshift(trajectoryLength)

  callback(null, data)
}
