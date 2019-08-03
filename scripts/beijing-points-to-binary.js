
// expects from stdin a headerless csv of trip data with columns:
// cab_id, timestamp (YYYY-MM-DD HH:MM:SS), longitude, latitude
// TIMESTAMPS RANGE FROM FEB 2, 2008 (SATURDAY) -> FEB 8, 2008 (FRIDAY)

// OUTPUTS: 32FloatArray with the following values
// cab id
// trajectory length
// pt1 timestamp (in seconds elapsed of week)
// pt1 longitude
// pt1 latitude
// pt2 timestamp
// pt2 longitude
// pt2 latitude
// ...

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })

let currentCabId = null
const currentCabPts = []
rl.on('line', (input) => {
  if (!input) return
  const [cabId, timestamp, longitude, latitude] = input.split(',')
  if (cabId === undefined || timestamp === undefined || longitude === undefined || latitude === undefined) {
    throw new Error(`Received some undefined values for cabId, timestamp, longitude, or latitude from input "${input}" with length ${input.length}`)
  }
  if (currentCabId === null) currentCabId = cabId
  if (currentCabId !== cabId) {
    writeCabTrajectory(currentCabId, currentCabPts)
    currentCabId = cabId
    currentCabPts.length = 0
  }
  currentCabPts.push([timestamp, longitude, latitude])
})

rl.on('close', () => {
  writeCabTrajectory(currentCabId, currentCabPts)
})

function writeCabTrajectory (cabId, trajectory) {
  const floats = new Float32Array(2 + trajectory.length * 3)
  let j = 0
  floats[j++] = parseInt(cabId, 10)
  floats[j++] = trajectory.length
  for (const [ts, lng, lat] of trajectory) {
    floats[j++] = timestampToSecondsOfWeek(ts)
    floats[j++] = parseFloat(lng)
    floats[j++] = parseFloat(lat)
  }
  process.stdout.write(Buffer.from(floats.buffer))
}

// TIMESTAMPS RANGE FROM FEB 2, 2008 (SATURDAY) -> FEB 8, 2008 (FRIDAY)
function timestampToSecondsOfWeek (ts) {
  const [date, time] = ts.split(' ')
  const day = parseInt(date.split('-')[2], 10) - 2
  let [hour, minute, second] = time.split(':')
  hour = parseInt(hour, 10)
  minute = parseInt(minute, 10)
  second = parseInt(second, 10)
  const elapsedSecondsOfWeek = day * 24 * 60 * 60 + hour * 60 * 60 + minute * 60 + second
  return elapsedSecondsOfWeek
}
