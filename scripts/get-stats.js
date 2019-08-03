
// expects from stdin a headerless csv of trip data with columns:
// cab_id, timestamp (YYYY-MM-DD HH:MM:SS), longitude, latitude
// TIMESTAMPS RANGE FROM FEB 2, 2008 (SATURDAY) -> FEB 8, 2008 (FRIDAY)

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })

let timestampMin = null
let timestampMax = null

let totalPts = 0
const cabIds = new Set()

rl.on('line', (input) => {
  if (!input) return
  const [cabId, timestamp, longitude, latitude] = input.split(',')
  cabIds.add(cabId)
  totalPts += 1
  if (timestampMin === null || timestampMin > timestamp) timestampMin = timestamp
  if (timestampMax === null || timestampMax < timestamp) timestampMax = timestamp
})

rl.on('close', () => {
  console.log({
    totalPts,
    cabCount: cabIds.size
  })
  console.log({ timestampMin, timestampMax })
  console.log({
    minSecondsOfWeek: timestampToSecondsOfWeek(timestampMin),
    maxSecondsOfWeek: timestampToSecondsOfWeek(timestampMax)
  })
})

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
